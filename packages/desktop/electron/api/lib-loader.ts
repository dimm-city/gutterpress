/**
 * Cached `gutterpress` lib loaders for the electron/api/*.ts IPC handlers
 * (SFE-P5c2).
 *
 * Ports `src/routes/api/_lib/route.ts`'s `loadLib()`/`loadApiLib()` verbatim
 * (same cache-once-per-process shape) into the main process. At the time of
 * that port, `_lib/route.ts` itself was NOT deleted or moved: `remote`,
 * `publish`, `doctor`, `lint`, and `recovery` routes (out of that subrun)
 * still imported it — moving a helper whose consumers don't all migrate in
 * the same subrun is exactly what the run specification forbids.
 * `electron/main.ts` kept its own private `loadLib()` for the same reason
 * `_lib/route.ts` did (it imports this one now) — this module gives every
 * `electron/api/*.ts` handler
 * (project/manifest/tpl/snip/media/plugin/theme/vcs/style/lint/doctor) ONE
 * shared cache instead of many private copies. SFE-P5c4 (the last subrun)
 * migrated `doctor`/`lint`/`recovery`/`updater` and deleted
 * `src/routes/api/**` — including `_lib/route.ts` — wholesale; this module
 * is now the one surviving `loadLib`/`loadApiLib` cache.
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
