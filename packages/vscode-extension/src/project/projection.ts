/**
 * SFE-P3c Lane B — the host-side plugin-aware editor projection builder
 * (run spec deliverable 2: "THE PROJECTION (the gap Lane A flagged).
 * mountGutterpressEditor REQUIRES a projection; nothing produces one
 * today.").
 *
 * Built HOST-SIDE, exactly on the SFE-P3e desktop precedent
 * (`packages/desktop/electron/editor-projection.ts`): trusted + project
 * present -> `loadPluginsWithCss` (degrade-and-report) -> `createMarkdownRenderer`
 * -> `createEditorProjection(content, {sourceVersion, md, trusted: true})`;
 * untrusted OR no project -> `createEditorProjection(content, {sourceVersion})`
 * (base pipeline only — core markers still project; workspace plugin code
 * NEVER loads untrusted, D9/D12).
 *
 * ONE PROCESS, NO IPC-SERIALIZATION WORKAROUND NEEDED: unlike the desktop
 * precedent — which had to move its classification out of a thrown Error
 * because Electron's `ipcMain.handle`/`ipcRenderer.invoke` boundary strips
 * custom Error properties (`.code`) when serializing a rejection — this
 * module and its one caller (`../provider.ts`) run in the SAME Node
 * extension-host process. A thrown Error's message survives a plain
 * `try`/`catch` here with no serialization boundary to cross, so
 * {@link buildProjectEditorProjection} simply throws on a hard failure and
 * {@link resolveEditorProjectionPayload} catches it directly — no resolved-
 * outcome-instead-of-throwing dance is needed (see that desktop module's own
 * "IPC-boundary classification" header for the problem this sidesteps).
 *
 * RECONCILIATION ADDENDUM — MESSAGE MERGE: this module used to build a
 * complete, standalone `ProjectionMessage` (`type`/`protocolVersion`
 * included). That message type is deleted; the projection payload now rides
 * inside a `presentation-input` resend instead (`PresentationInputMessage`'s
 * own doc comment, `../protocol/messages.ts`). {@link resolveEditorProjectionPayload}
 * therefore returns just the PAYLOAD fields (`projection`/`pluginCss`/
 * `pluginErrors`/`diagnostic?`) — `../provider.ts`'s `sendProjection()` is
 * the one place that wraps them into a full wire message, combined with the
 * session's own fixed `mode`.
 *
 * NO CACHING, NO SPECULATIVE INVALIDATION (P3e's binding decision, restated
 * here because it applies equally to this host): every call re-resolves the
 * manifest and reloads plugins from scratch. `../provider.ts` only calls
 * this at the events D9/G-11 actually name (the initial handshake, an
 * accepted edit, an external change, a trust grant) through its own epoch
 * guard — never a second cache layer here.
 */
import { resolve } from "node:path";
import type { Diagnostic, DocumentSnapshot } from "@dimm-city/gutterpress-editor/core";
import { loadManifestWithPath, resolveConfig } from "gutterpress";
import { loadPluginsWithCss } from "gutterpress/plugins";
import { createEditorProjection, createMarkdownRenderer, type GutterpressProjection } from "gutterpress/render";
import { pluginsUntrustedDiagnostic, projectionBuildFailedDiagnostic } from "../protocol/diagnostics.ts";
import type { ProjectionPluginError } from "../protocol/messages.ts";
import type { GutterpressProjectInfo } from "./discover.ts";
import { isPathInsideFolder } from "./path-containment.ts";

/**
 * Repair round 1 (finding "Absolute filesystem paths cross into the webview
 * via presentation-input.pluginErrors"): the fixed, categorized wire message
 * for a plugin the real `gutterpress/plugins` loader reported as failed —
 * NEVER the loader's own `error.message`, which interpolates absolute
 * filesystem paths (`Plugin file not found: ${pluginPath} (resolved from
 * manifest entry path="…")`, and similarly for the vendored-tree cases).
 * D12/D14: "not … unrestricted absolute paths in user-visible output." The
 * raw, detailed error is still available host-side via `onPluginLoadError`
 * below — this constant is only what ever reaches `pluginErrors`, the field
 * that crosses into the webview.
 */
const PLUGIN_LOAD_FAILED_WIRE_MESSAGE = "This plugin could not be loaded. See the Gutterpress output channel for details.";

/**
 * The fixed, categorized wire message for a manifest plugin `path` that
 * resolves outside the project directory (repair round 1, finding "Manifest
 * plugin paths are not workspace-root-scoped: a `../` escape … loads and
 * EXECUTES code outside the project"). Already safe on its own — it names
 * no absolute path — but kept alongside `PLUGIN_LOAD_FAILED_WIRE_MESSAGE`
 * for the same "one fixed string per failure class" reason.
 */
const PLUGIN_PATH_ESCAPES_PROJECT_MESSAGE = "Plugin path escapes the project directory and was not loaded.";

export interface ProjectEditorProjectionArgs {
  /** The open project's root directory — where `manifest.yaml` and
   *  plugin-relative paths resolve from. */
  readonly projectDir: string;
  /** The document's exact current source. */
  readonly content: string;
  /** The document host's current version, stamped onto the returned
   *  projection verbatim (G-11). */
  readonly sourceVersion: number;
}

/**
 * The exact shape of `gutterpress/plugins`' `loadPluginsWithCss`, derived
 * via `typeof` rather than hand-written so it can never drift from the real
 * signature.
 *
 * WHY THIS IS INJECTABLE (optional, defaulting to the real function):
 * `mock.module()`-replacing a REAL, resolvable, shared package specifier
 * like `"gutterpress/plugins"` was tried and MEASURED to leak across test
 * FILES in this exact Bun version (1.3.11) regardless of file order — a
 * spy registered in one file's `mock.module("gutterpress/plugins", ...)`
 * silently served a DIFFERENT file's un-mocked import of the same
 * specifier too (verified empirically before choosing this design).
 * `tests/project/projection.test.ts` needs the REAL
 * loader (a real project, real plugin, real CSS) in the SAME `bun test`
 * run as `tests/project/provider-projection.test.ts`'s spy-verified
 * "never invoked when untrusted" proof (D9/run spec deliverable 3) — those
 * two requirements are incompatible under a global module mock. A plain,
 * optional, defaulted parameter sidesteps the whole problem: production
 * code (`../provider.ts`) never passes it (so it always gets the REAL
 * loader, zero behavior change), and a test passes a plain spy FUNCTION —
 * no module registry involved at all.
 */
export type PluginLoaderFn = typeof loadPluginsWithCss;

export interface ProjectEditorProjectionResult {
  readonly projection: GutterpressProjection;
  /** Concatenated plugin CSS (load order) — `""` when no loaded plugin
   *  declares any. */
  readonly pluginCss: string;
  /** Every plugin that failed to load. Empty when every configured plugin
   *  loaded (or none are configured). */
  readonly pluginErrors: readonly ProjectionPluginError[];
}

/**
 * Builds a plugin-aware, trusted editor projection for `args.content`, using
 * `args.projectDir`'s real manifest and real plugins — receipt-verified
 * vendored npm plugins and local files alike, loaded by the SAME loader the
 * CLI build/preview path and the desktop rich editor use
 * (`gutterpress/plugins`'s `loadPluginsWithCss`, D11).
 *
 * Never throws for a plugin load failure (that is exactly what
 * degrade-and-report means: the failure is collected into the returned
 * `pluginErrors` instead) — only for something the caller must treat as a
 * hard failure across the WHOLE build (e.g. a malformed `manifest.yaml`,
 * surfaced by `loadManifestWithPath`).
 *
 * `loadPlugins` defaults to the real `loadPluginsWithCss` — see
 * {@link PluginLoaderFn}'s own doc comment for why this is a plain,
 * optional parameter rather than a `mock.module()` target.
 *
 * `onPluginLoadError`, when supplied, is called with the RAW plugin ref and
 * error for every per-plugin failure — a workspace-escaping path (repair
 * round 1) or a real loader failure alike — before this function reduces it
 * to the fixed, safe wire message that actually lands in the returned
 * `pluginErrors` (never `error.message`, which can carry absolute
 * filesystem paths). Mirrors {@link resolveEditorProjectionPayload}'s own
 * `onBuildError` pattern for the whole-build-failure case; `../provider.ts`
 * uses both callbacks the same way — log the detail host-side, never send
 * it over the wire.
 */
export async function buildProjectEditorProjection(
  args: ProjectEditorProjectionArgs,
  loadPlugins: PluginLoaderFn = loadPluginsWithCss,
  onPluginLoadError?: (pluginRef: string, error: Error) => void,
): Promise<ProjectEditorProjectionResult> {
  const { manifest, manifestDir } = await loadManifestWithPath(args.projectDir);
  const config = resolveConfig({}, manifest);

  const pluginErrors: ProjectionPluginError[] = [];

  // Repair round 1 (finding "Manifest plugin paths are not workspace-root-
  // scoped: a `../` escape ... loads and EXECUTES code outside the
  // project"). `gutterpress/plugins`' own loader resolves a manifest's
  // local `path` entry with a plain `resolve(baseDir, config.path)` and no
  // containment check (packages/cli/src/lib/markdown/plugins.ts) — that
  // stays the shared loader's own concern to fix independently; THIS
  // package scopes every local plugin path to `manifestDir` (the trusted
  // project root a VS Code custom editor ever resolves plugins for) before
  // any entry ever reaches that loader, so an escaping entry is refused
  // here rather than silently imported and executed. `config.name` entries
  // (npm-package-name plugins) are untouched — they resolve through the
  // vendored-tree/receipt mechanism, not a raw filesystem join, and are
  // outside this specific escape vector.
  const scopedConfigs = config.plugins.filter((pluginConfig) => {
    if (pluginConfig.path === undefined) return true;
    const resolvedPath = resolve(manifestDir, pluginConfig.path);
    if (isPathInsideFolder(resolvedPath, manifestDir)) return true;
    onPluginLoadError?.(
      pluginConfig.path,
      new Error(`Plugin path "${pluginConfig.path}" resolves to ${resolvedPath}, outside project root ${manifestDir}.`),
    );
    pluginErrors.push({ pluginRef: pluginConfig.path, message: PLUGIN_PATH_ESCAPES_PROJECT_MESSAGE });
    return false;
  });

  const { plugins, pluginCss } = await loadPlugins(scopedConfigs, manifestDir, (pluginRef, error) => {
    onPluginLoadError?.(pluginRef, error);
    pluginErrors.push({ pluginRef, message: PLUGIN_LOAD_FAILED_WIRE_MESSAGE });
  });

  const md = createMarkdownRenderer(plugins);
  const projection = createEditorProjection(args.content, {
    sourceVersion: args.sourceVersion,
    md,
    trusted: true,
  });

  return { projection, pluginCss, pluginErrors };
}

/** The base, non-plugin-aware pipeline (D9: untrusted or no project). Core
 *  layout markers, attributes, and raw HTML still project — only project
 *  plugin code is absent. */
export function buildBaseEditorProjection(content: string, sourceVersion: number): GutterpressProjection {
  return createEditorProjection(content, { sourceVersion });
}

/**
 * The projection PAYLOAD `PresentationInputMessage`'s optional
 * `projection`/`pluginCss`/`pluginErrors`/`diagnostic` fields carry
 * (reconciliation addendum — message merge; see this module's header for
 * why this is no longer a standalone wire message).
 */
export interface EditorProjectionPayload {
  readonly projection: GutterpressProjection;
  readonly pluginCss: string;
  readonly pluginErrors: readonly ProjectionPluginError[];
  readonly diagnostic?: Diagnostic;
}

/**
 * The one function `../provider.ts` calls to decide and build the
 * projection PAYLOAD it merges into a `presentation-input` resend
 * (deliverable 2/3's trust gate, in one place): `trusted && project`
 * selects the plugin-aware path; anything else selects the base pipeline.
 * `project` is `undefined` -> no Gutterpress project at this document's
 * workspace folder (D9: a supported, non-error state); `trusted` is
 * `false` -> `vscode.workspace.isTrusted` (an untrusted workspace never
 * loads project plugin code, D9/D12 — this is the ONLY gate; there is no
 * second, workspace-writable trust setting to consult, since a
 * workspace-writable setting could grant itself trust).
 *
 * `onBuildError`, when supplied, is called with the raw caught error before
 * this function falls back to the base pipeline — D15 ("development logs
 * may record ... projection fallback reason"), never document text; the
 * caller (`../provider.ts`) reduces it to a safe log line.
 *
 * `onPluginLoadError`, when supplied, is forwarded to
 * {@link buildProjectEditorProjection} unchanged — see that function's own
 * doc comment. Same rationale as `onBuildError`: the RAW per-plugin failure
 * detail (which can include absolute filesystem paths) is only ever safe
 * host-side; `pluginErrors` on the returned payload always carries the
 * fixed, sanitized wire message instead (repair round 1, finding "Absolute
 * filesystem paths cross into the webview via presentation-input.pluginErrors").
 *
 * `loadPlugins` is forwarded to {@link buildProjectEditorProjection}
 * unchanged (see that function's own doc comment / {@link PluginLoaderFn}
 * for why it exists and defaults to the real loader) — it is what
 * `tests/project/provider-projection.test.ts` spies on to prove D9's
 * untrusted-workspace gate: "plugins do not execute (assert the loader is
 * never invoked — a spy, not absence of errors)". When `trusted && project`
 * is false, this function returns via the base-pipeline branch below WITHOUT
 * EVER REFERENCING `loadPlugins` at all — the spy call-count IS the proof.
 */
export async function resolveEditorProjectionPayload(
  snapshot: DocumentSnapshot,
  project: GutterpressProjectInfo | undefined,
  trusted: boolean,
  onBuildError?: (error: unknown) => void,
  loadPlugins: PluginLoaderFn = loadPluginsWithCss,
  onPluginLoadError?: (pluginRef: string, error: Error) => void,
): Promise<EditorProjectionPayload> {
  if (trusted && project) {
    try {
      const built = await buildProjectEditorProjection(
        {
          projectDir: project.projectDir,
          content: snapshot.text,
          sourceVersion: snapshot.version,
        },
        loadPlugins,
        onPluginLoadError,
      );
      return { projection: built.projection, pluginCss: built.pluginCss, pluginErrors: built.pluginErrors };
    } catch (error) {
      onBuildError?.(error);
      return {
        projection: buildBaseEditorProjection(snapshot.text, snapshot.version),
        pluginCss: "",
        pluginErrors: [],
        diagnostic: projectionBuildFailedDiagnostic(),
      };
    }
  }

  // Repair round 1 (finding "D9's required trust explanation is not
  // implemented"): a REAL project's plugins are being withheld here purely
  // because the workspace is untrusted (D9/D12) — the behavior table
  // requires this be explained, not silently dropped. `!project` (no
  // manifest at all — D9's own "supported, non-error state") carries no
  // such diagnostic: there is nothing being withheld to explain.
  const diagnostic = !trusted && project ? pluginsUntrustedDiagnostic() : undefined;
  return {
    projection: buildBaseEditorProjection(snapshot.text, snapshot.version),
    pluginCss: "",
    pluginErrors: [],
    ...(diagnostic ? { diagnostic } : {}),
  };
}
