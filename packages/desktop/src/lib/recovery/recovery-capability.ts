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
 */
import { bridge } from "$lib/platform/bridge";
import type { RecoveryEntry } from "$lib/platform/dtos";

/** Write a debounced crash-recovery snapshot of the open buffer (#44). */
export function writeRecovery(filePath: string, content: string, baseMtimeMs: number): Promise<{ ok: boolean }> {
  return bridge().recovery.write(filePath, content, baseMtimeMs);
}

/** Clear a recovery snapshot after a successful disk save (#44). */
export function clearRecovery(filePath: string): Promise<{ ok: boolean }> {
  return bridge().recovery.clear(filePath);
}

/** List pending recovery snapshots for an opened project, newest first (#44). */
export function listRecovery(projectDir: string): Promise<RecoveryEntry[]> {
  return bridge().recovery.list(projectDir);
}
