/**
 * Updater capability (SFE-P5b, collapsed to single-transport SFE-P5c4) —
 * the auto-update surface `update-controller.svelte.ts` consumes. Replaces
 * `getPlatform().updater.*`.
 *
 * Through SFE-P5c3, `getStatus`/`check`/`download` were plain request/
 * response so they went through the HTTP route client (ARCH review #8)
 * while `applyNow`/`onEvent` stayed on the IPC bridge — real fan-out logic,
 * which is why this module existed rather than collapsing into its single
 * consumer. SFE-P5c4 deletes the last HTTP routes: every member below now
 * goes through the same bridge, so this module is a thin single-transport
 * forwarder — kept as its own module for the same reason `vcs-capability.ts`/
 * `remote-capability.ts` are: `update-controller.svelte.ts` names it as a
 * distinct bounded context, and collapsing it into that one consumer would
 * just move the same five functions, not simplify anything.
 */
import { bridge } from "$lib/platform/bridge";
import type { UpdaterEvent, UpdaterStatus } from "$lib/platform/contract";

export function getUpdaterStatus(): Promise<UpdaterStatus> {
  return bridge().updater.getStatus();
}

export function checkForUpdate(): Promise<UpdaterStatus> {
  return bridge().updater.check();
}

export function downloadUpdate(): Promise<UpdaterStatus> {
  return bridge().updater.download();
}

export function applyUpdateNow(): Promise<{ applied: boolean; version?: string; error?: string }> {
  return bridge().updater.applyNow();
}

export function onUpdaterEvent(cb: (event: UpdaterEvent) => void): () => void {
  return bridge().updater.onEvent(cb);
}
