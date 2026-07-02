/**
 * Shared remote-operation hooks for remote:* server routes.
 */

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
}

const GLOBAL_KEY = '__printMdRemoteHooks__' as const;

declare global {
  // eslint-disable-next-line no-var
  var __printMdRemoteHooks__: RemoteHooks<unknown, unknown> | undefined;
}

export function registerRemoteHooks<RemoteLibModule, TokenStoreType>(
  hooks: RemoteHooks<RemoteLibModule, TokenStoreType>,
): void {
  globalThis[GLOBAL_KEY] = hooks;
}

export function getRemoteHooks<RemoteLibModule = LibModule, TokenStoreType = TokenStore>(): RemoteHooks<RemoteLibModule, TokenStoreType> | null {
  return (globalThis[GLOBAL_KEY] as RemoteHooks<RemoteLibModule, TokenStoreType> | undefined) ?? null;
}
