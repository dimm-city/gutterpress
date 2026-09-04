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
 *
 * Error semantics (run rule 2): the three request/reply members
 * (`getUpdaterStatus`/`checkForUpdate`/`downloadUpdate`) scrub the Electron
 * IPC transport prefix (`friendlyHostError`) off a rejection's message
 * before re-throwing — the same discipline
 * `remote-capability.ts`/`vcs-capability.ts`/`project-config-capability.ts`/
 * `files-capability.ts`/`app-lifecycle-capability.ts` use, so
 * `update-controller.svelte.ts`'s `e instanceof Error ? e.message : …`
 * toast handling never shows an author `Error invoking remote method
 * 'updater:check': …`. Declaring these `async function` (rather than a
 * plain function returning `hostCall(...)`) also matters off-Electron: `bridge()`
 * throws SYNCHRONOUSLY when no desktop host is present (see `bridge.ts`),
 * and wrapping the body in an `async function` turns that synchronous throw
 * into a rejected promise — the shape every `.catch()`/`await`-in-`try`
 * caller (including `+page.svelte`'s `getDoctorDiagnostics().then().catch()`
 * sibling in `doctor-capability.ts`) already assumes.
 */
import { bridge } from "$lib/platform/bridge";
import { hostCall } from "$lib/errors";
import type { UpdaterEvent, UpdaterStatus } from "$lib/platform/contract";

export async function getUpdaterStatus(): Promise<UpdaterStatus> {
  return hostCall(bridge().updater.getStatus());
}

export async function checkForUpdate(): Promise<UpdaterStatus> {
  return hostCall(bridge().updater.check());
}

export async function downloadUpdate(): Promise<UpdaterStatus> {
  return hostCall(bridge().updater.download());
}

export function applyUpdateNow(): Promise<{ applied: boolean; version?: string; error?: string }> {
  return bridge().updater.applyNow();
}

export function onUpdaterEvent(cb: (event: UpdaterEvent) => void): () => void {
  return bridge().updater.onEvent(cb);
}
