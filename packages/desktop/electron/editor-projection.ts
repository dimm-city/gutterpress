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
 */
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
