/**
 * Shared remote-operation hooks for remote:* server routes.
 *
 * Storage lives in the single collapsed host object (ARCH review #31,
 * `./host-services.ts`) — `getRemoteHooks()` is a thin derived selector over
 * it. main.ts's real registration stores the hooks against the REAL
 * `gutterpress` module type (`host-services.ts`'s `LibModule`), not
 * this file's own looser `LibModule` (a hand-mirrored subset) — that concrete
 * type is what `LibModule` here, and `getRemoteHooks<RemoteLibModule = LibModule>()`,
 * default to for callers that don't ask for a narrower view.
 */

import { getHostServices } from './host-services';
import type {
  CloneRepositoryArgs,
  ResolveSyncConflictsArgs,
  SyncOutcome,
} from '../bridge-types';

export interface TokenStore {
  get(host: string): Promise<{ token: string; host: string; username?: string; kind: string; label?: string; createdAt: number } | null>;
  set(host: string, credential: { token: string; host: string; username?: string; kind: string; label?: string; createdAt: number }): Promise<void>;
  delete(host: string): Promise<void>;
  status(host: string): Promise<{ connected: boolean; username?: string; label?: string }>;
  listRedacted(): Promise<Array<{ host: string; kind: string; username?: string; label?: string; createdAt: number }>>;
}

export interface LibModule {
  listGitHubRepositories?(credential: unknown): Promise<unknown[]>;
  listGitHubBranches?(credential: unknown, owner: string, repo: string): Promise<unknown[]>;
  listRepoBooks?(credential: unknown, owner: string, repo: string, branch: string): Promise<unknown[]>;
  diagnoseProjectRemote?(dir: string, opts: { tokenStore: TokenStore }): Promise<unknown>;
  testRemoteAccess?(args: { url: string; credential?: unknown }): Promise<unknown>;
  connectGenericHost?(args: { host: string; username?: string; token: string; repoUrl?: string }): Promise<{ host: string; username?: string; kind: string; token: string; label?: string; createdAt: number }>;
  knownForgeTokenUrl?(host: string): Promise<string | null>;
  syncProject?(args: { projectDir: string; tokenStore: TokenStore; message?: string; authorName?: string; authorEmail?: string }): Promise<unknown>;
}

export interface RemoteHooks<RemoteLibModule = LibModule, TokenStoreType = TokenStore> {
  loadLib(): Promise<RemoteLibModule>;
  tokenStore: TokenStoreType;
  GITHUB_HOST: string;
  /**
   * Clone a repo into `${parentDir}/${sanitized folderName}` and resolve to the
   * dir to open (the repo root, or a chosen book subPath inside it). Bound in
   * main.ts (ARCH review #8): the closure does the folder-name sanitization,
   * credential lookup, and `mainWindow.webContents.send("remote:cloneProgress",
   * …)` progress push internally, so the route (a separate Vite bundle with no
   * `mainWindow` reference) only ever calls this one method.
   */
  cloneRepository(args: CloneRepositoryArgs): Promise<{ projectDir: string }>;
  /**
   * Apply the author's per-file conflict choices and sync the combined result.
   * Bound in main.ts: also clears/re-arms the auto-sync conflict latch for the
   * project on success, mirroring what the resolve flow always did inline.
   */
  resolveSyncConflicts(args: ResolveSyncConflictsArgs): Promise<SyncOutcome>;
}

/**
 * The live `RemoteHooks` slice of the collapsed host object, narrowed to
 * whatever generic view the caller asks for (same "narrow at the point of
 * use" pattern as `getPrefsHooks` — see its doc comment).
 */
export function getRemoteHooks<RemoteLibModule = LibModule, TokenStoreType = TokenStore>(): RemoteHooks<RemoteLibModule, TokenStoreType> | null {
  const remote = getHostServices()?.remote;
  return (remote as unknown as RemoteHooks<RemoteLibModule, TokenStoreType> | undefined) ?? null;
}
