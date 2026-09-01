/**
 * Editor-projection capability (SFE-P5b/SFE-P3e). Replaces
 * `getPlatform().buildEditorProjection`, `+page.svelte`'s only call site.
 *
 * Kept as its own small module even though the forwarding itself is a pure
 * 1:1 delegation with no marshalling: this capability's D14 diagnostic
 * contract (`EditorProjectionOutcome`) is worth a stable, independently
 * discoverable/testable seam of its own, next to `desktop-document-host.ts`
 * in this same directory — the one deliberate exception to "pure forwarding
 * dies" (capability-map.md §3).
 *
 * Because this is the declared exception, its DTOs live here too, not in
 * `platform/contract.ts` — the run specification's "DTOs move to their
 * owning capability" constraint applied literally, not just the forwarding
 * function. `contract.ts`'s `ElectronBridge.buildEditorProjection` imports
 * `EditorProjectionArgs`/`EditorProjectionOutcome` back from here with a
 * type-only import; that is a circular *module* reference (this file also
 * imports the value `bridge` from `./bridge`, which imports the type
 * `ElectronBridge` from `contract.ts`) but not a circular *runtime*
 * reference — `import type` is erased before bundling, so no runtime cycle
 * exists.
 */
// Relative import, not the `$lib/platform/bridge` alias every other
// capability module uses: `contract.ts` type-imports this file's DTOs back
// (see this file's own header), and `contract.ts` is transitively pulled
// into `electron/tsconfig.json`'s separate TS program (via
// `electron/main.ts` → `persistence-failures.ts` → `platform/contract.ts`),
// which has no `$lib` path mapping. A relative import resolves in both
// programs; `$lib/...` only resolves in the SvelteKit/SPA one.
import { bridge } from "../platform/bridge";
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
  return bridge().buildEditorProjection(args);
}
