import type { SyncStatus } from "$lib/platform/contract";

/**
 * True when a sync status means the host changed files on disk and any open
 * editor buffer must re-read/reconcile immediately. This is an explicit signal
 * from sync/pull, not a filesystem-watch guess.
 */
export function shouldReconcileAfterSync(status: SyncStatus): boolean {
  return status.filesChanged === true && (
    status.state === "synced" ||
    status.state === "offline" ||
    status.state === "auth" ||
    status.state === "error" ||
    status.state === "recovered"
  );
}
