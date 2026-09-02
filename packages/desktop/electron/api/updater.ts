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
 * these four operations move from the HTTP route client to the bridge, so
 * `updater-capability.ts` becomes single-transport — see that module's
 * header for the renderer-side half. `applyNow` joined this file (rather
 * than staying a direct `installNow()` call) in the SFE-P6b repair round:
 * like every other `electron/api/*.ts` module, this file must stay
 * Electron-runtime free (it loads and its handlers run under plain
 * `bun test`, no Electron host present) — a top-level
 * `import { installNow } from "../updater"` would drag `electron/updater.ts`'s
 * own top-level `import "electron"` in with it. `applyNow` is reached
 * through `UpdaterHooks` exactly like getStatus/check/download.
 */
import { getUpdaterHooks } from "../server-bridge/updater-hooks";
import type { UpdaterStatus } from "../../src/lib/platform/shared-types";
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

/** Quit and install the downloaded update. */
export async function updaterApplyNow(): Promise<{
  applied: boolean;
  version?: string;
  error?: string;
}> {
  return requireHooks().applyNow();
}

/** Register the updater:* IPC channels (SFE-P6b). */
export function registerUpdaterHandlers(secureHandle: SecureHandle): void {
  secureHandle("updater:getStatus", () => updaterGetStatus());
  secureHandle("updater:check", () => updaterCheck());
  secureHandle("updater:download", () => updaterDownload());
  secureHandle("updater:applyNow", () => updaterApplyNow());
}
