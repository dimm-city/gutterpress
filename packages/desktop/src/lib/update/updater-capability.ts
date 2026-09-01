/**
 * Updater capability (SFE-P5b) — the auto-update surface `update-controller.svelte.ts`
 * consumes. Replaces `getPlatform().updater.*`.
 *
 * Real marshalling preserved from the old `ElectronAdapter.updater` getter:
 * `getStatus`/`check`/`download` are plain request/response, so they go
 * through the HTTP route client (`api.updater.*`, ARCH review #8) — NOT the
 * IPC bridge; `applyNow` (a live-BrowserWindow quit+install flush) and
 * `onEvent` (a push subscription) stay on the bridge. This split is real
 * fan-out logic, not pure forwarding, so it earns its own module rather than
 * collapsing into the single consumer.
 */
import { bridge } from "$lib/platform/bridge";
import { api } from "$lib/api";
import type { UpdaterEvent, UpdaterStatus } from "$lib/platform/contract";

export function getUpdaterStatus(): Promise<UpdaterStatus> {
  return api.updater.getStatus();
}

export function checkForUpdate(): Promise<UpdaterStatus> {
  return api.updater.check();
}

export function downloadUpdate(): Promise<UpdaterStatus> {
  return api.updater.download();
}

export function applyUpdateNow(): Promise<{ applied: boolean; version?: string; error?: string }> {
  return bridge().updater.applyNow();
}

export function onUpdaterEvent(cb: (event: UpdaterEvent) => void): () => void {
  return bridge().updater.onEvent(cb);
}
