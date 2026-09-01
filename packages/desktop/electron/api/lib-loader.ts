/**
 * Cached `gutterpress` lib loaders for the electron/api/*.ts IPC handlers
 * (SFE-P5c2).
 *
 * Ports `src/routes/api/_lib/route.ts`'s `loadLib()`/`loadApiLib()` verbatim
 * (same cache-once-per-process shape) into the main process. `_lib/route.ts`
 * itself is NOT deleted or moved: `remote`, `publish`, `doctor`, `lint`, and
 * `recovery` routes (out of this subrun) still import it — moving a helper
 * whose consumers don't all migrate this subrun is exactly what the run
 * specification forbids. `electron/main.ts` already keeps its own private
 * `loadLib()` for the same reason `_lib/route.ts` does — this module gives
 * every `electron/api/*.ts` handler (project/manifest/tpl/snip/media/plugin/
 * theme/vcs/style) ONE shared cache instead of six private copies.
 */

/** The full `gutterpress` lib surface. */
export type LibModule = typeof import("gutterpress");
let libPromise: Promise<LibModule> | null = null;

/** Load (and cache) the `gutterpress` lib. Never re-imports once resolved. */
export function loadLib(): Promise<LibModule> {
  if (!libPromise) libPromise = import("gutterpress");
  return libPromise;
}

/**
 * The narrower `gutterpress/api` surface (manifest/style config mutation) —
 * a distinct package export, not an alternate way to reach {@link loadLib}'s
 * module.
 */
export type ApiLibModule = typeof import("gutterpress/api");
let apiLibPromise: Promise<ApiLibModule> | null = null;

/** Load (and cache) the `gutterpress/api` surface. */
export function loadApiLib(): Promise<ApiLibModule> {
  if (!apiLibPromise) apiLibPromise = import("gutterpress/api");
  return apiLibPromise;
}
