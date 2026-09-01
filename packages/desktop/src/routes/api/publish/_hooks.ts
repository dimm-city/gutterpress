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
  /** #221 phase 3, D8 — present only for a provider that supports more than
   *  one format (gdrive: ["pdf", "html"]); absent for every other provider,
   *  which keeps them fixed on `format` above. */
  formats?: Array<'pdf' | 'html'>;
  description: string;
  configFields: Array<{ key: string; label: string; placeholder?: string }>;
  credential: {
    required: boolean;
    host: string;
    envVar?: string;
    tokenUrl?: string;
    hint?: string;
    /** #221 — "token" (default/absent) = pasted-key connect; "oauth" = the
     *  browser consent flow (gdrive). Drives the wizard's connect UI branch. */
    connect?: 'token' | 'oauth';
  };
  /** #221 — present when the provider has a folder/destination picker. */
  destinations?: {
    label: string;
    canCreate: boolean;
  };
}

/** One existing destination a provider can publish into (#221, gdrive: a
 *  Drive folder). Mirrors the lib's `PublishProduct`. */
export interface LibPublishDestination {
  id: string;
  title: string;
  url?: string;
}

/** The subset of a live provider object the destinations routes call —
 *  narrower than the lib's real `PublishProvider` (only what's needed here). */
export interface LibPublishProviderHandle {
  info: LibPublishProviderInfo;
  listDestinations?(req: unknown): Promise<LibPublishDestination[]>;
  createDestination?(req: unknown, name: string): Promise<LibPublishDestination>;
}

/**
 * The dependency bag the publish routes hand to the lib. Typed (not
 * `unknown`) because the token store is security-sensitive — forgetting to
 * pass it must fail the build, not the runtime.
 */
interface PublishRouteDeps {
  tokenStore: TokenStore;
  /** The selected NAMED account (label) to resolve against; "" = default. */
  credentialAccount?: string;
  /** Progress-line sink for long runs (butler/swa output). */
  onProgress?: (line: string) => void;
}

/** A saved credential for a provider, redacted (no token). */
interface LibPublishSavedAccount {
  account: string;
  label: string;
  createdAt: number;
}

export interface PublishLibModule {
  listPublishProviders?(): LibPublishProviderInfo[];
  publishProviderFor?(id: string): LibPublishProviderHandle;
  /**
   * Resolve the {@link PublishRequest}-shaped object a provider's
   * `listDestinations`/`createDestination` (and, in principle, any other
   * provider method) needs — #221's destinations routes are the only current
   * callers. `unknown` here is intentional: the real shape is the lib's
   * `PublishRequest`, and these routes only ever pass it straight through to
   * a provider method, never read its fields themselves.
   */
  resolvePublishRequest?(
    options: { projectDir: string; providerId: string },
    deps: PublishRouteDeps,
  ): Promise<unknown>;
  /** Best-effort revoke at Google (never throws) — used by disconnect for
   *  `kind: "google-oauth"` credentials, mirroring the CLI's `--disconnect`. */
  revokeGoogleCredential?(refreshToken: string): Promise<void>;
  publishConnectionStatus?(
    info: LibPublishProviderInfo,
    deps: PublishRouteDeps,
    account?: string,
  ): Promise<{ connected: boolean; source?: 'env' | 'store' }>;
  /** Redacted saved credentials for a provider (default + named accounts). */
  listPublishAccounts?(
    info: LibPublishProviderInfo,
    deps: PublishRouteDeps,
  ): Promise<LibPublishSavedAccount[]>;
  /** The compound `<host>#<account>` store key ("" account → bare host). */
  publishCredentialKey?(host: string, account?: string): string;
  connectPublishProvider?(
    options: {
      projectDir: string;
      providerId: string;
      token: string;
      /** Named-account label; empty stores the default (bare-host) credential. */
      account?: string;
    },
    deps: PublishRouteDeps,
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
    deps: PublishRouteDeps,
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
