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
import type { Diagnostic, DocumentSnapshot } from "@dimm-city/gutterpress-editor/core";
import { loadManifestWithPath, resolveConfig } from "gutterpress";
import { loadPluginsWithCss } from "gutterpress/plugins";
import { createEditorProjection, createMarkdownRenderer, type GutterpressProjection } from "gutterpress/render";
import { projectionBuildFailedDiagnostic } from "../protocol/diagnostics.ts";
import type { ProjectionPluginError } from "../protocol/messages.ts";
import type { GutterpressProjectInfo } from "./discover.ts";

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
 * specifier too (verified empirically before choosing this design; see
 * this run's report). `tests/project/projection.test.ts` needs the REAL
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
 */
export async function buildProjectEditorProjection(
  args: ProjectEditorProjectionArgs,
  loadPlugins: PluginLoaderFn = loadPluginsWithCss,
): Promise<ProjectEditorProjectionResult> {
  const { manifest, manifestDir } = await loadManifestWithPath(args.projectDir);
  const config = resolveConfig({}, manifest);

  const pluginErrors: ProjectionPluginError[] = [];
  const { plugins, pluginCss } = await loadPlugins(config.plugins, manifestDir, (pluginRef, error) => {
    pluginErrors.push({ pluginRef, message: error.message });
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

  return { projection: buildBaseEditorProjection(snapshot.text, snapshot.version), pluginCss: "", pluginErrors: [] };
}
