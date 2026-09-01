/**
 * Crash-recovery capability (SFE-P5c4) — replaces `api.recovery.*`.
 *
 * Consumed by `buffer-state.svelte.ts` (debounced snapshot write on every
 * edit; clear on successful save) and `CrashRecoveryController`
 * (`crash-recovery-controller.svelte.ts`, wired from `+page.svelte`: list on
 * project open, clear on discard). Typed IPC through the shared bridge.
 *
 * D7 (crash-recovery semantics): `listRecovery` propagates a listing
 * failure as a REJECTED promise — it never resolves to `[]` on error, so a
 * genuine host/store failure can never be mistaken for "no pending
 * recoveries" by a caller that checks the result. (How a caller CHOOSES to
 * present that rejection — e.g. `CrashRecoveryController.scan()`'s existing
 * "show nothing" UI fallback — is unchanged product behavior, not something
 * this transport migration alters.)
 *
 * Error semantics (run rule 2, repair round 1): scrubs the Electron IPC
 * transport prefix (`friendlyHostError`) off a rejection before re-throwing
 * — the same discipline every other capability module uses. This changes
 * only the message text of the D7 rejection above, never whether it rejects.
 */
import { bridge } from "$lib/platform/bridge";
import { friendlyHostError } from "$lib/errors";
import type { RecoveryEntry } from "$lib/platform/dtos";

async function call<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    throw new Error(friendlyHostError(e instanceof Error ? e.message : String(e)));
  }
}

/** Write a debounced crash-recovery snapshot of the open buffer (#44). */
export async function writeRecovery(filePath: string, content: string, baseMtimeMs: number): Promise<{ ok: boolean }> {
  return call(bridge().recovery.write(filePath, content, baseMtimeMs));
}

/** Clear a recovery snapshot after a successful disk save (#44). */
export async function clearRecovery(filePath: string): Promise<{ ok: boolean }> {
  return call(bridge().recovery.clear(filePath));
}

/** List pending recovery snapshots for an opened project, newest first (#44). */
export async function listRecovery(projectDir: string): Promise<RecoveryEntry[]> {
  return call(bridge().recovery.list(projectDir));
}
