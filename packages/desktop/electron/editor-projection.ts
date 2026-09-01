/**
 * editor-projection.ts (SFE-P3e) — the desktop host's plugin-aware
 * rich-editor projection builder.
 *
 * This is the ROOT-CAUSE fix the run's product-owner ruling names directly:
 * `+page.svelte`'s `buildRichProjection` used to call
 * `createEditorProjection(content, { sourceVersion })` with neither `md` nor
 * `trusted`, so the desktop's rich editor could never show a project's own
 * plugin regions. This module is the missing host-side half — given a
 * project directory, it loads that project's manifest and its plugins and
 * builds a plugin-aware, trusted projection from them, through the SAME
 * production `createMarkdownRenderer`/`createEditorProjection` the CLI
 * build/preview path uses.
 *
 * PURE ENOUGH TO UNIT TEST DIRECTLY (per the run spec): this module takes
 * plain strings, returns plain data, and never touches `ipcMain` — see
 * `tests/editor/editor-projection-host.test.ts`, which calls
 * {@link buildHostEditorProjection} directly, the exact function
 * `main.ts`'s `api:editorProjection` handler calls. All IPC-boundary
 * concerns (sender validation, argument shape/size/range checks) live in
 * `main.ts` itself, matching the existing `fs:watchFolder` precedent — this
 * module assumes its caller already validated `args`.
 *
 * NO CACHING: per the run's binding decision ("no cache layers, no
 * speculative invalidation machinery"), every call re-resolves the manifest
 * and reloads plugins from scratch. `main.ts` only calls this at the
 * existing `rebuildRichDocHost` points (a file switch or rich-mode entry),
 * never per keystroke, so a full rebuild is the right cost/complexity
 * trade-off here.
 *
 * ## Loader boundary (SFE-P3e)
 *
 * Plugin loading goes through `gutterpress/plugins` — the D11 pre-approved
 * subpath, added for this module as its first real consumer. It re-exports
 * `loadPluginsWithCss` from `packages/cli/src/lib/markdown/plugins.ts`: the
 * SAME degrade-and-report loader the live preview uses, receipt-verified
 * vendored npm plugins and local files alike. This module no longer carries
 * a second, narrower duplicate of that loader.
 *
 * ## IPC-boundary classification (SFE-P3e review round 2)
 *
 * `validateEditorProjectionArgs` and {@link resolveEditorProjection} below
 * used to live in `main.ts` and its `api:editorProjection` handler used to
 * let a thrown, `.code`-tagged `Error` propagate straight out of
 * `ipcMain.handle`. That never worked: Electron serializes a REJECTED
 * handler's error by stringifying it — the renderer's `ipcRenderer.invoke`
 * rejection carries a reconstructed `Error` with only `message`/`stack`,
 * never a custom own-property such as `.code` (confirmed against this exact
 * channel: a thrown `Error` with `.code` set reaches the renderer as a
 * plain `Error` with `.code === undefined`). So neither D14 classification
 * this module produces — `EDITOR_FILE_TOO_LARGE` (D13's rich-mode ceiling)
 * nor `EDITOR_PLUGIN_LOAD_FAILED` (a manifest that fails to load outright,
 * distinct from a per-plugin degrade, which never throws) — could ever
 * reach `+page.svelte`'s `buildRichProjection`, which branched on that
 * (always-`undefined`) `.code`.
 *
 * The fix: classification travels in a RESOLVED value, never a rejection.
 * {@link resolveEditorProjection} validates and builds the projection, and
 * for the two named hard-failure shapes returns `{ ok: false, code,
 * message }` instead of throwing — a plain, structured-cloneable value that
 * crosses `ipcMain.handle`/`ipcRenderer.invoke` intact, the same as any
 * other resolved IPC result. `main.ts`'s `api:editorProjection` handler
 * calls this function directly and returns its result unchanged (no
 * try/catch of its own needed there) — moved here, rather than kept in
 * `main.ts`, so it is unit-testable the same way {@link buildHostEditorProjection}
 * already is (this module's own "PURE ENOUGH TO UNIT TEST DIRECTLY" header
 * note, now extended to the validation/classification step too) without
 * needing to import `main.ts` itself, which has Electron-`app`-lifecycle
 * side effects at module scope that make it unsafe to import under `bun
 * test`. `validateEditorProjectionArgs` takes `activeWorkspaceRoot` as a
 * parameter rather than reading `main.ts`'s module-scoped mutable variable,
 * for the same reason: a pure function a test can call with any workspace
 * root it likes, matching the `ExportController` injected-deps precedent
 * (`electron/export/controller.ts`) for testable main-process logic.
 *
 * A validation failure OTHER than the size ceiling (a malformed `args`
 * shape, or a `projectDir` that does not match the host's own open
 * workspace) still throws a plain `Error` and rejects across IPC exactly as
 * before — those are contract violations a well-behaved renderer never
 * triggers in practice, not a D14 user-facing diagnostic with a "safe next
 * action" to state, so there is no more specific classification to give
 * them (D14: "a generic 'failed' errors at a boundary are a confirmed
 * review finding unless no more specific classification is possible" — for
 * these, none is).
 */
import path from "node:path";
import {
  createEditorProjection,
  createMarkdownRenderer,
  type GutterpressProjection,
} from "gutterpress/render";
import { loadManifestWithPath, resolveConfig } from "gutterpress";
import { loadPluginsWithCss } from "gutterpress/plugins";

/** One plugin that failed to load, degrade-and-report style (D14 `EDITOR_PLUGIN_LOAD_FAILED`). */
export interface EditorProjectionPluginError {
  /** The manifest entry's own ref — a local path (e.g. `./plugins/foo.js`) or an npm package name, whichever the manifest used. */
  readonly pluginRef: string;
  /** A user-facing message naming why this one plugin was skipped. */
  readonly message: string;
}

export interface EditorProjectionHostResult {
  readonly projection: GutterpressProjection;
  /** Concatenated plugin CSS (load order), ready for the mount's `extraCss` — `""` when no loaded plugin declares any. */
  readonly pluginCss: string;
  /** Every plugin that failed to load. Empty when every configured plugin loaded (or none are configured). */
  readonly pluginErrors: readonly EditorProjectionPluginError[];
}

export interface EditorProjectionHostArgs {
  /** The open project's root directory (where `manifest.yaml` and plugin-relative paths resolve from). */
  readonly projectDir: string;
  /** The document's exact current source. */
  readonly content: string;
  /** The document host's current version, stamped onto the returned projection verbatim (G-11). */
  readonly sourceVersion: number;
}

/**
 * Build a plugin-aware, trusted editor projection for `args.content`, using
 * `args.projectDir`'s real manifest and its real plugins — receipt-verified
 * vendored npm plugins and local files alike, loaded by the SAME loader the
 * CLI build/preview path uses.
 *
 * Steps:
 *   (a) resolve the manifest's plugin configs (`loadManifestWithPath` + `resolveConfig` — both real, public `gutterpress` exports);
 *   (b) load them degrade-and-report (`loadPluginsWithCss`'s `onError` callback,
 *       collected into `pluginErrors` below — a real, public `gutterpress/plugins`
 *       export; this IS the loader the live preview uses, in the same mode);
 *   (c) build the plugin-applied `md` the exact way the render path does
 *       (`createMarkdownRenderer(plugins)` — a real, public `gutterpress/render`
 *       export);
 *   (d) return `{ projection, pluginCss, pluginErrors }` — `pluginCss` comes
 *       straight from `loadPluginsWithCss` (it already calls `collectPluginCss`
 *       internally), never a second hand-rolled join.
 *
 * Never throws for a plugin load failure (that is exactly what degrade-and-
 * report means) — only for something the caller must treat as a hard
 * failure (e.g. a malformed `manifest.yaml`, surfaced by `loadManifestWithPath`).
 */
export async function buildHostEditorProjection(
  args: EditorProjectionHostArgs,
): Promise<EditorProjectionHostResult> {
  const { manifest, manifestDir } = await loadManifestWithPath(args.projectDir);
  const config = resolveConfig({}, manifest);

  const pluginErrors: EditorProjectionPluginError[] = [];
  const { plugins, pluginCss } = await loadPluginsWithCss(config.plugins, manifestDir, (pluginRef, error) => {
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

// ── IPC-boundary validation and classification (SFE-P3e review round 2) ────
// See the module header "IPC-boundary classification" for why this lives
// here (testable without importing main.ts) and why classification must be
// a resolved value, never a thrown `.code`.

/** D13: rich mode's own file-size ceiling — a document too large for rich
 *  mode at all should never reach a host projection build. */
export const RICH_MODE_MAX_CONTENT_BYTES = 2 * 1024 * 1024;

/** Thrown ONLY by {@link validateEditorProjectionArgs}'s D13 ceiling check —
 *  a distinct class (not a plain `Error`) so {@link resolveEditorProjection}
 *  can tell "the size ceiling" apart from every other validation failure
 *  without parsing message text. Never crosses a process boundary itself
 *  (`resolveEditorProjection` catches it and returns a plain, structured-
 *  cloneable `{ ok: false, code: "EDITOR_FILE_TOO_LARGE", message }` value
 *  instead) — it exists purely as an in-process discriminator. */
export class EditorProjectionTooLargeError extends Error {}

/**
 * Runtime-validates `args` at the IPC boundary (D10: "runtime validation is
 * required at every IPC request boundary") and returns the validated,
 * host-authoritative arguments — never the caller's own unresolved
 * `projectDir` string. Mirrors `fs:watchFolder`'s existing pattern in
 * `main.ts`: `projectDir` must equal the host's OWN open workspace root
 * (passed in as `activeWorkspaceRoot`, not read from module-scoped state —
 * see the module header), so a compromised or buggy renderer cannot point
 * this handler at an arbitrary directory. Throws a distinct, descriptive
 * error per failure reason (typed errors, not one generic "invalid
 * arguments" message); the D13 ceiling specifically throws
 * {@link EditorProjectionTooLargeError}, not a plain `Error`, so its caller
 * can classify it.
 */
export function validateEditorProjectionArgs(
  args: unknown,
  activeWorkspaceRoot: string | null,
): EditorProjectionHostArgs {
  if (!args || typeof args !== "object") {
    throw new Error("api:editorProjection: expected an arguments object.");
  }
  const { projectDir, content, sourceVersion } = args as Record<string, unknown>;

  if (typeof projectDir !== "string" || projectDir.length === 0) {
    throw new Error("api:editorProjection: projectDir must be a non-empty string.");
  }
  if (!activeWorkspaceRoot || path.resolve(projectDir) !== activeWorkspaceRoot) {
    throw new Error(
      `api:editorProjection: projectDir must be the active workspace directory (got: ${projectDir}).`,
    );
  }
  if (typeof content !== "string") {
    throw new Error("api:editorProjection: content must be a string.");
  }
  if (Buffer.byteLength(content, "utf8") > RICH_MODE_MAX_CONTENT_BYTES) {
    throw new EditorProjectionTooLargeError(
      `api:editorProjection: content exceeds the ${RICH_MODE_MAX_CONTENT_BYTES}-byte rich-mode ceiling (D13).`,
    );
  }
  if (typeof sourceVersion !== "number" || !Number.isFinite(sourceVersion) || sourceVersion < 0) {
    throw new Error("api:editorProjection: sourceVersion must be a finite, non-negative number.");
  }

  // activeWorkspaceRoot (not the caller's raw projectDir) is what actually
  // resolves manifest/plugin paths in buildHostEditorProjection — already
  // proven equal above.
  return { projectDir: activeWorkspaceRoot, content, sourceVersion };
}

/** D14 classification codes {@link resolveEditorProjection} can resolve
 *  with instead of throwing (see the module header) — a subset of D14's
 *  full vocabulary, exactly the two shapes this handler can actually
 *  produce. */
export type EditorProjectionFailureCode = "EDITOR_FILE_TOO_LARGE" | "EDITOR_PLUGIN_LOAD_FAILED";

/**
 * {@link resolveEditorProjection}'s result: either the successful
 * {@link EditorProjectionHostResult} (`ok: true`), or one of the two named
 * hard-failure classifications (`ok: false`) — never a rejection for either
 * of those two cases (see the module header). Every field is plain,
 * JSON-shaped data, so this value survives Electron's `ipcMain.handle` /
 * `ipcRenderer.invoke` structured clone intact.
 */
export type EditorProjectionOutcome =
  | ({ readonly ok: true } & EditorProjectionHostResult)
  | { readonly ok: false; readonly code: EditorProjectionFailureCode; readonly message: string };

/**
 * The full `api:editorProjection` handler body: validate, then build —
 * classifying the two named hard-failure shapes into a resolved
 * {@link EditorProjectionOutcome} instead of letting them reject (see the
 * module header for why a rejection cannot carry `.code` across IPC).
 * `main.ts`'s `secureHandle("api:editorProjection", ...)` registration
 * calls this directly and returns its result unchanged.
 *
 * Still THROWS (rejects) for a validation failure other than the size
 * ceiling — a malformed `args` shape or a `projectDir` that does not match
 * the open workspace — since those are contract violations with no more
 * specific D14 classification to give (see the module header).
 */
export async function resolveEditorProjection(
  args: unknown,
  activeWorkspaceRoot: string | null,
): Promise<EditorProjectionOutcome> {
  let validated: EditorProjectionHostArgs;
  try {
    validated = validateEditorProjectionArgs(args, activeWorkspaceRoot);
  } catch (e) {
    if (e instanceof EditorProjectionTooLargeError) {
      return { ok: false, code: "EDITOR_FILE_TOO_LARGE", message: e.message };
    }
    throw e;
  }

  try {
    const result = await buildHostEditorProjection(validated);
    return { ok: true, ...result };
  } catch (e) {
    // The host call itself failed outright (e.g. a malformed
    // manifest.yaml) — never a per-plugin degrade, which never throws (see
    // buildHostEditorProjection's own doc comment above).
    const message = e instanceof Error ? e.message : String(e);
    return { ok: false, code: "EDITOR_PLUGIN_LOAD_FAILED", message };
  }
}
