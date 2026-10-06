/**
 * The rich editor's one host call: the plugin-aware projection of a chapter,
 * built host-side by `routes/api/editor/projection` (see
 * `$lib/server/editor-projection`) and reached through the `api` wrapper like
 * every other host capability (CLAUDE.md §8).
 *
 * The DTOs live here, renderer-side (D4: renderer types are decoupled from
 * the lib/host); the route module carries the same shapes, kept in sync by
 * hand.
 */
// Relative import (not `$lib/api`): this file is also reachable from
// `electron/tsconfig.json`'s separate TS program, which has no `$lib` mapping.
import { api } from "../api";
import type { GutterpressProjection } from "gutterpress/render";

/** Arguments for {@link buildEditorProjection} (SFE-P3e). No `FolderRef`
 *  translation is needed here (unlike the build/preview capability's own
 *  args) — `projectDir` is a plain path string on both sides; the host
 *  validates it against its own open-workspace state. */
export interface EditorProjectionArgs {
  readonly projectDir: string;
  readonly content: string;
  readonly sourceVersion: number;
}

/** One project plugin that failed to load (D14 `EDITOR_PLUGIN_LOAD_FAILED`), degrade-and-report style. */
export interface EditorProjectionPluginError {
  readonly pluginRef: string;
  readonly message: string;
}

/** The successful half of {@link buildEditorProjection}'s result. */
export interface EditorProjectionResult {
  readonly projection: GutterpressProjection;
  readonly pluginCss: string;
  readonly pluginErrors: readonly EditorProjectionPluginError[];
  /** The book's CSS layers scoped to the editor document — the rich mount's `extraCss`. */
  readonly bookCss: string;
}

/** D14 classification codes {@link buildEditorProjection} can resolve with
 *  instead of succeeding. */
export type EditorProjectionFailureCode = "EDITOR_FILE_TOO_LARGE" | "EDITOR_PLUGIN_LOAD_FAILED";

/**
 * {@link buildEditorProjection}'s actual return shape (SFE-P3e review round
 * 2, CONFIRMED finding): a RESOLVED discriminated union, never a rejection
 * carrying the failure classification. Electron's IPC boundary serializes a
 * rejected `ipcMain.handle` error by stringifying it — the renderer's
 * `ipcRenderer.invoke` rejection carries a reconstructed `Error` with only
 * `message`/`stack`, never a custom own-property such as `.code` — so
 * `EDITOR_FILE_TOO_LARGE`/`EDITOR_PLUGIN_LOAD_FAILED` could never have
 * reached a caller that branched on a thrown error's `.code`, which is
 * exactly the shape this used to be before that fix. Local to this file
 * (D4: renderer types are decoupled from the lib/host, defined here rather
 * than imported from `electron/editor-projection.ts`'s own
 * `EditorProjectionOutcome` — this is that same shape's renderer-side
 * mirror, kept structurally in sync by hand like `EditorProjectionResult`
 * above already is).
 */
export type EditorProjectionOutcome =
  | ({ readonly ok: true } & EditorProjectionResult)
  | { readonly ok: false; readonly code: EditorProjectionFailureCode; readonly message: string };

/**
 * SFE-P3e — the desktop rich editor's plugin-aware projection, built
 * host-side (degrade-and-report — a plugin that fails to load is skipped,
 * reported in `pluginErrors`, and never blanks the projection). Resolves to
 * {@link EditorProjectionOutcome} — `ok: false` for the two classified
 * hard-failure shapes, never a rejection for either.
 */
export function buildEditorProjection(args: EditorProjectionArgs): Promise<EditorProjectionOutcome> {
  return api.editor.projection({ ...args }) as Promise<EditorProjectionOutcome>;
}
