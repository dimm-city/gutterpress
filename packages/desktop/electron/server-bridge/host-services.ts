/**
 * Single typed host/route seam (ARCH review #31).
 *
 * Before this module, the main-bundle <-> SvelteKit-handler seam was 11
 * separate `__gutterpress*Hooks__` globalThis keys (`create-host-bridge.ts`'s
 * service-locator pattern, hand-rolled once per domain), registered from 8
 * scattered call sites spread across main.ts — including an ordering
 * landmine ("Must be AFTER discoverScanDeps is initialized") and a
 * hand-narrowed `loadLib` cast that erased the real lib type down to a
 * fabricated four-method interface just to satisfy `PrefsHooks`'s generic
 * default.
 *
 * This module collapses all of it to ONE globalThis key (`__gutterpressHost__`)
 * holding ONE typed `HostServices` object, written exactly once by
 * `registerHostServices()` after every dependency any field's closures need
 * has been constructed. Each domain's `server-bridge/*-hooks.ts` module keeps
 * its own typed interface and its own `getXHooks()` accessor — narrow,
 * well-typed accessors are good call-site ergonomics, and ~40 call sites
 * across the `electron/api/*.ts` IPC registrars already call them by name —
 * but each accessor now reads a field off THIS single object instead of
 * owning an independent globalThis slot.
 *
 * `LibModule` below is the REAL `gutterpress` module type (matching
 * main.ts's own `loadLib`). Storing every hook group against this concrete
 * type — instead of each domain module's own looser default (`unknown`, or a
 * bespoke subset interface) — is what lets `registerHostServices` accept
 * main.ts's real functions with no narrowing cast: `Promise<LibModule>` is
 * assignable to `Promise<unknown>` (or any narrower view a route asks for at
 * `getPrefsHooks<T>()`/`getRemoteHooks<T,U>()`/`getVcsHooks<T>()` call sites)
 * for free, covariantly. The old per-hook registration instead narrowed
 * `loadLib` DOWN via `as` at the point of truth — throwing type information
 * away exactly where it mattered most.
 */
import { createHostBridge } from "./create-host-bridge";
import type { AppHooks } from "./app-hooks";
import type { AppImageHooks, DesktopHooks, DoctorHooks } from "./host-hooks";
import type { FsGuardHooks } from "./fs-guard";
import type { MediaHooks } from "./media-hooks";
import type { PickedFilesHooks, SavePathHooks } from "./picked-files";
import type { PrefsHooks } from "./prefs-hooks";
import type { RecoveryHooks } from "./recovery-hooks";
import type { RemoteHooks, TokenStore } from "./remote-hooks";
import type { SyncSettingsHooks } from "./sync-settings-hooks";
import type { UpdaterHooks } from "./updater-hooks";
import type { VcsHooks } from "./vcs-hooks";
import type { WatchHooks } from "./watch-hooks";
import type { WriteHooks } from "./write-hooks";
import type { DesktopPrefs } from "../prefs-store";
import type { AppSettings } from "../settings-store";
import type { ProjectStateMap } from "../project-state";
import type { RecentFolder } from "../recent-folders";

/** The real `gutterpress` module shape — see the module doc above. */
export type LibModule = typeof import("gutterpress");

/**
 * The full host surface the typed IPC handlers (`electron/api/*.ts`'s
 * `secureHandle(...)` registrars) can reach into main.ts through. One field
 * per former globalThis key. Registration is atomic (see
 * {@link registerHostServices}), so there is no "half registered" state for
 * a handler to reason about — a field is either present with the real
 * object, or the whole thing is `null`.
 */
export interface HostServices {
  app: AppHooks;
  appImage: AppImageHooks;
  desktop: DesktopHooks;
  doctor: DoctorHooks;
  fsGuard: FsGuardHooks;
  media: MediaHooks;
  pickedFiles: PickedFilesHooks;
  prefs: PrefsHooks<LibModule, DesktopPrefs, AppSettings, ProjectStateMap | undefined, RecentFolder>;
  recovery: RecoveryHooks;
  remote: RemoteHooks<LibModule, TokenStore>;
  savePaths: SavePathHooks;
  sync: SyncSettingsHooks;
  updater: UpdaterHooks;
  vcs: VcsHooks<LibModule>;
  watch: WatchHooks;
  write: WriteHooks;
}

const bridge = createHostBridge<HostServices>("__gutterpressHost__");

/**
 * Register the full host surface. Call exactly ONCE, after every dependency
 * any field's closures need has been constructed — main.ts does this a
 * single time at the end of its startup sequence, replacing the previous 8
 * scattered `registerXHooks()` call sites (one of which carried an explicit
 * "must run after X" ordering comment).
 */
export function registerHostServices(services: HostServices): void {
  bridge.register(services);
}

/** The full host surface, or null before {@link registerHostServices} runs. */
export function getHostServices(): HostServices | null {
  return bridge.get();
}
