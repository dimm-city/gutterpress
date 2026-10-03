/**
 * The one typed host/route seam.
 *
 * The SvelteKit handler and main.ts run in the same Node.js process but in
 * separate Vite bundles, so the live references are shared through ONE
 * globalThis key (`__gutterpressHost__`) holding ONE `HostServices` object.
 * main.ts writes it exactly once, at module top level, before `app.whenReady`
 * — so in production no route ever runs before registration, and
 * {@link getHostServices} simply throws if it somehow did. Each domain's
 * `server-bridge/*-hooks.ts` module keeps only its typed interface; routes
 * read a field off the object this module returns.
 */
import type { AppHooks } from "./app-hooks";
import type { AppImageHooks, DesktopHooks, DoctorHooks } from "./host-hooks";
import type { FsGuardHooks } from "./fs-guard";
import type { MediaHooks } from "./media-hooks";
import type { PickedFilesHooks, SavePathHooks } from "./picked-files";
import type { PrefsHooks } from "./prefs-hooks";
import type { RecoveryHooks } from "./recovery-hooks";
import type { RemoteHooks } from "./remote-hooks";
import type { SyncSettingsHooks } from "./sync-settings-hooks";
import type { UpdaterHooks } from "./updater-hooks";
import type { VcsHooks } from "./vcs-hooks";
import type { WriteHooks } from "./write-hooks";

/** The full host surface the SvelteKit handler's server routes can reach into main.ts through. */
export interface HostServices {
  app: AppHooks;
  appImage: AppImageHooks;
  desktop: DesktopHooks;
  doctor: DoctorHooks;
  fsGuard: FsGuardHooks;
  media: MediaHooks;
  pickedFiles: PickedFilesHooks;
  prefs: PrefsHooks;
  recovery: RecoveryHooks;
  remote: RemoteHooks;
  savePaths: SavePathHooks;
  sync: SyncSettingsHooks;
  updater: UpdaterHooks;
  vcs: VcsHooks;
  write: WriteHooks;
}

const GLOBAL_KEY = "__gutterpressHost__";
const store = globalThis as unknown as { [GLOBAL_KEY]?: HostServices };

/**
 * Register the full host surface. main.ts calls this once, after every
 * dependency any field's closures need has been constructed; tests call it
 * with a fake per suite.
 */
export function registerHostServices(services: HostServices): void {
  store[GLOBAL_KEY] = services;
}

/** The registered host surface. Throws if {@link registerHostServices} has not run. */
export function getHostServices(): HostServices {
  const services = store[GLOBAL_KEY];
  if (!services) {
    throw new Error("Host services are not registered (electron/main.ts registers them at startup)");
  }
  return services;
}
