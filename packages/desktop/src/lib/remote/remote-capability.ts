/**
 * Sync/remote/GitHub capability (SFE-P5b, D10's single named bounded
 * context "sync/remote/GitHub"). Replaces the corresponding
 * `getPlatform()` members for `SyncStatusPill.svelte`, `SettingsView.svelte`,
 * `GitHubDialog.svelte`, and `ConnectionsSettings.svelte`.
 *
 * SFE-P5c3: `remote/*` and `sync/*` (the deleted `src/routes/api/{remote,
 * sync}/**` HTTP routes and their `api.remote.*`/`api.sync.*` client
 * methods) JOIN this module — every member here is now real 1:1 delegation
 * to the preload bridge (push subscriptions AND request/reply alike; the
 * ARCH review #8 HTTP/IPC split this module's header used to describe is
 * superseded by this run's D10 "converge on typed IPC" decision).
 *
 * Error semantics (run rule 2): every request/reply function scrubs the
 * Electron IPC transport prefix (`friendlyHostError`) off a rejection's
 * message before re-throwing — the same discipline
 * `files-capability.ts`/`project-config-capability.ts`/`vcs-capability.ts`
 * use, so a caller's existing `e instanceof Error ? e.message : String(e)`
 * handling keeps showing the same author-facing text the deleted HTTP
 * routes used to send as the response body.
 */
import { bridge } from "$lib/platform/bridge";
import { friendlyHostError } from "$lib/errors";
import type {
  CloneProgressEvent,
  CloneRepositoryArgs,
  ConnectGenericHostArgs,
  DeviceCodeInfo,
  HostConnectionInfo,
  ProjectRemoteDiagnosis,
  RemoteAccessResult,
  RemoteBranch,
  RemoteConnection,
  RemoteRepository,
  RepoBook,
  SyncOutcome,
  SyncStatus,
} from "$lib/platform/contract";

async function call<T>(op: Promise<T>): Promise<T> {
  try {
    return await op;
  } catch (e) {
    throw new Error(friendlyHostError(e instanceof Error ? e.message : String(e)));
  }
}

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

/** Forget the stored GitHub connection. */
export function disconnectGitHub(): Promise<{ ok: boolean }> {
  return call(bridge().remote.disconnectGitHub());
}

/**
 * Redacted connection status for a host (default github.com). NEVER returns
 * the token — only { connected, username?, label? }.
 */
export function getRemoteConnection(host?: string): Promise<RemoteConnection> {
  return call(bridge().remote.getConnection(host));
}

/** Repositories the user granted the Gutterpress GitHub App. */
export function listRemoteRepositories(): Promise<RemoteRepository[]> {
  return call(bridge().remote.listRepositories());
}

/** Branches of a chosen repository. */
export function listRemoteBranches(owner: string, repo: string): Promise<RemoteBranch[]> {
  return call(bridge().remote.listBranches(owner, repo));
}

/** Book folders (manifest.yaml/.yml) inside a repository branch. */
export function listRepoBooks(owner: string, repo: string, branch: string): Promise<RepoBook[]> {
  return call(bridge().remote.listRepoBooks(owner, repo, branch));
}

/** Classify the project's remote situation for the environment panel. */
export function diagnoseProjectRemote(projectDir: string): Promise<ProjectRemoteDiagnosis> {
  return call(bridge().remote.diagnoseProject(projectDir));
}

/** Explicit, user-initiated remote probe (the git ls-remote equivalent). */
export function testRemoteAccess(url: string): Promise<RemoteAccessResult> {
  return call(bridge().remote.testRemoteAccess(url));
}

/**
 * Validate + store a credential for any smart-HTTPS Git host. Response is
 * redacted — never includes the token.
 */
export function connectGenericHost(
  args: ConnectGenericHostArgs,
): Promise<{ connected: boolean; host: string; username?: string }> {
  return call(bridge().remote.connectGenericHost(args));
}

/** Forget the stored connection for a host. */
export function disconnectHost(host: string): Promise<{ ok: boolean }> {
  return call(bridge().remote.disconnectHost(host));
}

/** Redacted list of stored connections (host/username/label — no tokens). */
export function listHostConnections(): Promise<HostConnectionInfo[]> {
  return call(bridge().remote.listConnections());
}

/** Token-settings deep link for recognized forges; null when unknown. */
export function forgeTokenUrl(host: string): Promise<string | null> {
  return call(bridge().remote.forgeTokenUrl(host));
}

/** Snapshot-first sync of the project to its online repository. */
export function syncChanges(projectDir: string, message?: string): Promise<SyncOutcome> {
  return call(bridge().remote.sync(projectDir, message));
}

/** Download ("clone") a repository into a new local project folder. */
export function cloneRemoteRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }> {
  return call(bridge().remote.cloneRepository(args));
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
  await call(bridge().sync.setAutoSync(enabled));
}

/**
 * The last sync status the host emitted for a project, or null. The
 * queryable counterpart to the fire-and-forget `onSyncStatus` push channel —
 * the status pill seeds itself from this right after subscribing so a
 * subscription that lands after an emit never strands on blank/stale status.
 */
export function getSyncStatus(projectDir: string): Promise<SyncStatus | null> {
  return call(bridge().sync.getStatus(projectDir) as Promise<SyncStatus | null>);
}
