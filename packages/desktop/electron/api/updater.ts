/**
 * Desktop update IPC handlers for the "updater" capability (SFE-P5c4).
 *
 * Ports `src/routes/api/updater/{get-status,check,download}/+server.ts`
 * verbatim — same `UpdaterHooks` bag (`electron/server-bridge/updater-hooks.ts`,
 * unchanged: `electron/updater.ts`'s mutable state, populated by the one
 * `initUpdater()` call in `main.ts`, is still reached through the collapsed
 * host object, same rationale that module's header documents), same
 * "hooks not registered" fail-closed check, same "check() is always the
 * user-initiated (non-silent) form" contract.
 *
 * This is the run's "collapse the fan-out" subject (P5c4 SPECIAL WEIGHT 1):
 * these three operations move from the HTTP route client to the bridge
 * alongside `applyNow`/`onEvent`, so `updater-capability.ts` becomes
 * single-transport — see that module's header for the renderer-side half.
 */
import { getUpdaterHooks } from "../server-bridge/updater-hooks";
import type { UpdaterStatus } from "../../src/lib/platform/shared-types";
import { installNow } from "../updater";
import type { SecureHandle } from "../server-bridge/secure-handle";

function requireHooks() {
  const hooks = getUpdaterHooks();
  if (!hooks) throw new Error("Updater hooks not registered");
  return hooks;
}

/** Current update status (idle/checking/available/downloading/staged/error). */
export async function updaterGetStatus(): Promise<UpdaterStatus> {
  return requireHooks().getStatus();
}

/** User-initiated (non-silent) check — full error reporting. */
export async function updaterCheck(): Promise<UpdaterStatus> {
  return requireHooks().check();
}

/** Download the update, or open its GitHub page on check-only macOS. */
export async function updaterDownload(): Promise<UpdaterStatus> {
  return requireHooks().download();
}

/**
 * Register the updater:* IPC channels (SFE-P6b). `updater:applyNow` calls
 * `installNow()` (electron/updater.ts) directly rather than through
 * `UpdaterHooks` — it has no main.ts-only state of its own to reach through
 * the collapsed host object, unlike getStatus/check/download (see that
 * module's header on `initUpdater()`'s process-wide state).
 */
export function registerUpdaterHandlers(secureHandle: SecureHandle): void {
  secureHandle("updater:getStatus", () => updaterGetStatus());
  secureHandle("updater:check", () => updaterCheck());
  secureHandle("updater:download", () => updaterDownload());
  secureHandle("updater:applyNow", () => installNow());
}
