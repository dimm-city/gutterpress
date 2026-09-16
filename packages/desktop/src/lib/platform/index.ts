/**
 * Platform seam entry point (#41, narrowed SFE-P5b, trimmed SFE-P5b review
 * round 1).
 *
 * SFE-P5a deleted the dormant browser host (`WebAdapter`). SFE-P5b deleted
 * the service locator itself: `getPlatform()`, `Platform`, `HostServices`,
 * and `ElectronAdapter` are all gone — each capability a component needs is
 * now a plain function imported directly from a feature-owned module (see
 * `./contract.ts`'s header and `docs/plans/source-first-editor/
 * capability-map.md`).
 *
 * What survives here: `isDesktop()` (still re-exported from `./bridge.ts` —
 * ~15 components only ever needed this boolean check, never the deleted
 * locator) and the type/value re-exports below that still have a real
 * importer THROUGH THIS BARREL (`import … from "$lib/platform"`, not
 * `"$lib/platform/contract"` or another subpath) — verified by enumerating
 * every such import in `src/` and `tests/` (SFE-P5b review round 1). A type
 * with real consumers that all import it from `./contract` or `./dtos`
 * directly does NOT belong here; add it back only when a real barrel
 * importer needs it.
 */
export { isDesktop } from "./bridge";

export { DEFAULT_SETTINGS } from "./contract";

export type { AppSettings, DeepPartial, UpdaterAvailableAction } from "./contract";

export type { PrintSafeWarning } from "./dtos";

export type { WorkspaceMode } from "./shared-types";
