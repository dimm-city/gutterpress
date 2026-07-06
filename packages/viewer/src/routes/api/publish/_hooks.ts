/**
 * Publish routes' host bridge (#35).
 *
 * Publishing needs exactly what the remote:* routes need — the lazily-loaded
 * lib and the safeStorage-backed credential store — so it shares the remote
 * hooks bridge registered by electron/main.ts rather than adding a parallel
 * registration. Only the LibModule surface differs, re-typed here.
 *
 * SECURITY: token values never appear in responses. Connect passes the raw
 * token to the lib (which verifies BEFORE storing); every read path returns
 * redacted status only.
 */
import {
  getRemoteHooks,
  type RemoteHooks,
  type TokenStore,
} from '../../../../electron/server-bridge/remote-hooks';

export type { TokenStore };
export { handlePublishErrors } from '../../../../electron/server-bridge/friendly-errors';

/** Lib provider description (mirrors the lib's PublishProviderInfo). */
export interface LibPublishProviderInfo {
  id: string;
  label: string;
  kind: 'api' | 'guided';
  format: 'pdf' | 'html';
  description: string;
  configFields: Array<{ key: string; label: string; placeholder?: string }>;
  credential: {
    required: boolean;
    host: string;
    envVar?: string;
    tokenUrl?: string;
    hint?: string;
  };
}

export interface PublishLibModule {
  listPublishProviders?(): LibPublishProviderInfo[];
  publishProviderFor?(id: string): { info: LibPublishProviderInfo };
  publishConnectionStatus?(
    info: LibPublishProviderInfo,
    deps: unknown,
  ): Promise<{ connected: boolean; source?: 'env' | 'store' }>;
  connectPublishProvider?(
    options: {
      projectDir: string;
      providerId: string;
      token: string;
    },
    deps: unknown,
  ): Promise<{ connected: boolean; providerId: string }>;
  readPublishSettings?(
    projectDir: string,
  ): Promise<Record<string, Record<string, unknown>>>;
  setPublishProviderConfig?(
    projectDir: string,
    providerId: string,
    values: Record<string, unknown>,
  ): Promise<Record<string, Record<string, unknown>>>;
  runPublish?(
    options: {
      projectDir: string;
      providerId: string;
      artifactPath?: string;
      dryRun?: boolean;
    },
    deps: unknown,
  ): Promise<{
    ok: boolean;
    providerId: string;
    issues: unknown[];
    outcome?: unknown;
    error?: string;
  }>;
}

export function getHooks(): RemoteHooks<PublishLibModule, TokenStore> | null {
  return getRemoteHooks<PublishLibModule, TokenStore>();
}
