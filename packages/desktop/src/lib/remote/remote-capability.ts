/**
 * Sync/remote/GitHub capability (SFE-P5b, D10's single named bounded
 * context "sync/remote/GitHub"). Replaces the corresponding
 * `getPlatform()` members for `SyncStatusPill.svelte`, `SettingsView.svelte`,
 * `GitHubDialog.svelte`, and `ConnectionsSettings.svelte`.
 *
 * All seven members here are real 1:1 delegation to the preload bridge
 * (push subscriptions and IPC-only request/reply, per ARCH review #8 — the
 * plain-HTTP siblings `disconnectGitHub`/`getRemoteConnection`/
 * `listRemoteRepositories`/etc. already live on `api.remote.*` directly, not
 * through this seam). Grouped into one module (rather than one file per
 * member) because they share one bounded context and, for
 * `onCloneProgress`/`cloneRemoteRepository`, one real caller sequence
 * (`GitHubDialog.svelte`'s `startClone`).
 */
import { bridge } from "$lib/platform/bridge";
import { api } from "$lib/api";
import type {
  CloneProgressEvent,
  CloneRepositoryArgs,
  DeviceCodeInfo,
  RemoteConnection,
  SyncStatus,
} from "$lib/platform/contract";

// ── Managed GitHub integration (#15, ADR 0006) ──────────────────────────────

/** Begin the GitHub device flow; resolves with the code/URL to display. */
export function connectGitHubStart(): Promise<DeviceCodeInfo> {
  return bridge().connectGitHubStart();
}

/** Await user approval of the in-flight device flow. */
export function connectGitHubWait(): Promise<RemoteConnection> {
  return bridge().connectGitHubWait();
}

/** Cancel an in-flight device flow (user closed the dialog). */
export function connectGitHubCancel(): Promise<{ ok: boolean }> {
  return bridge().connectGitHubCancel();
}

/** Download ("clone") a repository into a new local project folder. */
export function cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }> {
  return api.remote.cloneRepository(args);
}

/** Subscribe to clone progress events. Returns an unsubscribe fn. */
export function onCloneProgress(cb: (data: CloneProgressEvent) => void): () => void {
  return bridge().onCloneProgress(cb);
}

// ── Auto-sync orchestrator seam (transparent sync, §4.4 integration plan) ──

/**
 * Subscribe to ambient sync-status updates from the host orchestrator. NOTE:
 * there is NO initial replay — a handler that subscribes after a sync has
 * already settled stays uninvoked until the next transition. Returns an
 * unsubscribe fn — call it in `onDestroy` to prevent leaks.
 */
export function onSyncStatus(handler: (status: SyncStatus) => void): () => void {
  return bridge().onSyncStatus(handler as (data: unknown) => void);
}

/**
 * Enable or disable the auto-sync master switch for the current project.
 * Persisted via the host settings store.
 */
export async function setAutoSync(enabled: boolean): Promise<void> {
  await api.sync.setAutoSync(enabled);
}
