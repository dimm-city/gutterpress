/**
 * Publish provider contract (#35).
 *
 * A publish provider pushes a built artifact (PDF or static-site HTML) to a
 * distribution platform — or, where the platform has no upload API
 * (DriveThruRPG, Amazon KDP), stages a validated upload package and hands the
 * author a checklist + the platform's upload URL ("guided" publishing).
 *
 * Architecture mirrors the remote-auth subsystem (ADR 0006):
 *   - The lib NEVER touches OS keychains, the network, or child processes
 *     directly through ambient globals — hosts inject a {@link TokenStore},
 *     and tests inject {@link PublishDeps.fetch} / {@link PublishDeps.runCommand}.
 *   - Credentials are keyed by provider host (e.g. "itch.io") in the same
 *     TokenStore the Git remote features use: the CLI's 0600 file store, the
 *     viewer's safeStorage-backed store.
 *
 * SECURITY INVARIANT: token values never appear in logs, error messages,
 * spawned argv (process lists are world-readable — pass secrets via env), or
 * host responses.
 */
import type { HostCredential, TokenStore } from "../remote-auth/token-store.ts";

/**
 * One author-editable, NON-SECRET settings field (stored in the manifest's
 * `publish.<id>` section). Declared by each provider so settings UIs are
 * fully data-driven — a new provider brings its own fields, no UI edits.
 */
export interface PublishConfigField {
  /** Manifest key under `publish.<id>` (e.g. "target"). */
  key: string;
  /** Author-facing label ("Project (user/game)"). */
  label: string;
  placeholder?: string;
}

/** Stable provider identifiers: the `--provider` values AND the manifest
 * `publish.<id>` keys — one spelling everywhere. */
export type PublishProviderId =
  | "itch"
  | "drivethrurpg"
  | "kdp"
  | "azure-swa"
  | "shopify";

/**
 * How the provider integrates:
 *   - "api"    — real programmatic upload (itch.io, Azure SWA, Shopify)
 *   - "guided" — no upload API exists; we validate + stage a package and open
 *                the platform's upload page with a checklist (DTRPG, KDP)
 */
export type PublishProviderKind = "api" | "guided";

/** Which build output the provider consumes. */
export type PublishArtifactFormat = "pdf" | "html";

/** Static, UI-facing description of a provider. */
export interface PublishProviderInfo {
  id: PublishProviderId;
  /** Human name ("itch.io"). */
  label: string;
  kind: PublishProviderKind;
  /** The artifact format this provider publishes. */
  format: PublishArtifactFormat;
  /** One-line author-facing description of what publishing here does. */
  description: string;
  /** The provider's author-editable manifest settings. */
  configFields: PublishConfigField[];
  /**
   * Credential requirements. `host` keys the TokenStore entry; guided
   * providers need no credential at all. `envVar` is the CI escape hatch —
   * when set in the environment it wins over the stored credential.
   */
  credential: {
    required: boolean;
    host: string;
    /** Environment variable honoured for headless/CI use. */
    envVar?: string;
    /** Where the author creates the key (shown in connect UIs). */
    tokenUrl?: string;
    /** Author-facing hint ("Paste an API key from …"). */
    hint?: string;
  };
}

/** The project being published (resolved from the manifest by the orchestrator). */
export interface PublishProject {
  projectDir: string;
  title: string;
  authors: string[];
}

/** The built artifact to publish. For "html" this is the export directory. */
export interface PublishArtifact {
  path: string;
  format: PublishArtifactFormat;
}

/** Result of a spawned command (see {@link CommandRunner}). */
export interface CommandResult {
  code: number;
  stdout: string;
  stderr: string;
}

/**
 * Injectable child-process seam. The default implementation wraps
 * `node:child_process.spawn`; tests substitute a fake. Secrets must only ever
 * travel through `env`, never `args`.
 */
export type CommandRunner = (
  cmd: string,
  args: string[],
  options?: {
    cwd?: string;
    env?: Record<string, string | undefined>;
    /** Called once per output line — drives live progress logs. */
    onOutput?: (line: string) => void;
    /**
     * Idle-kill budget in ms (audit B2). If the child produces no output and
     * has not exited within this window, it is SIGKILL'd and the run rejects
     * with a timeout error, so a stalled upload can't hang publish forever.
     * Omitted / undefined = no timeout (unchanged default behavior).
     */
    timeoutMs?: number;
  },
) => Promise<CommandResult>;

/**
 * Host-injected dependencies for every provider call. Everything with a side
 * effect enters through here, which is what makes providers unit-testable.
 */
export interface PublishDeps {
  tokenStore: TokenStore;
  /** HTTP seam (Shopify, butler download). Defaults to global fetch. */
  fetch?: typeof globalThis.fetch;
  /** Child-process seam (butler, swa). Defaults to node spawn. */
  runCommand?: CommandRunner;
  /** Environment (CI credential overrides). Defaults to process.env. */
  env?: Record<string, string | undefined>;
  /** User config dir override (butler tool cache). Defaults to defaultConfigDir(). */
  configDir?: string;
  /** Live progress line sink (CLI logger / viewer progress log). */
  onProgress?: (message: string) => void;
  /**
   * The selected NAMED credential (account label) for this operation, when the
   * user has more than one saved credential for the provider. The store is
   * keyed by a compound `<host>#<account>` for named accounts (see
   * {@link publishCredentialKey}); empty/undefined resolves the legacy
   * bare-host entry, so existing single-credential setups keep working. The
   * orchestrator sets this from the effective selection (book manifest →
   * project/global default); providers read it transparently via
   * {@link resolvePublishCredential}.
   */
  credentialAccount?: string;
}

/**
 * The TokenStore key for a publishing provider credential. Named accounts use a
 * compound `<host>#<account>` key so MULTIPLE credentials can coexist under one
 * provider host (two itch.io accounts, two Shopify stores) in the same flat
 * store — WITHOUT changing the TokenStore contract or disturbing git-sync,
 * which keeps using bare host keys. An empty/absent account is the bare host
 * (the legacy single-credential entry). The account segment is trimmed; host
 * normalisation (lower-casing) is left to the store's `normalizeHost`.
 */
export function publishCredentialKey(host: string, account?: string | null): string {
  const a = (account ?? "").trim();
  return a ? `${host}#${a}` : host;
}

/** Everything a provider method needs for one operation. */
export interface PublishRequest {
  project: PublishProject;
  /** The provider's manifest `publish.<id>` section (non-secret config). */
  config: Record<string, unknown>;
  artifact: PublishArtifact;
  deps: PublishDeps;
}

/** A single preflight finding. `error` blocks publishing; others inform. */
export interface PreflightIssue {
  severity: "error" | "warning" | "info";
  /** Stable machine id, e.g. "itch/target-missing". */
  id: string;
  message: string;
}

/** Redacted authentication status — NEVER carries the token value. */
export interface PublishAuthStatus {
  ok: boolean;
  /** Where the accepted credential came from. */
  source?: "env" | "store";
  /** Friendly failure guidance when `ok` is false. */
  message?: string;
}

/** A product/listing already on the platform (for update flows). */
export interface PublishProduct {
  id: string;
  title: string;
  url?: string;
}

/** Listing metadata for {@link PublishProvider.updateListing}. */
export interface PublishListingMetadata {
  title?: string;
  description?: string;
}

/** What a publish produced. */
export type PublishOutcome =
  | {
      kind: "published";
      /** Where the published work lives (page URL / deploy URL). */
      url?: string;
      /** Human summary ("Pushed build 42 to dimm-city/ops-manual:pdf"). */
      detail?: string;
      /** Remaining manual steps, when the API covers only part of the flow. */
      followUp?: string[];
    }
  | {
      kind: "guided";
      /** Directory containing the staged upload package. */
      packageDir: string;
      /** The platform upload page to open. */
      openUrl: string;
      /** Manual steps the author completes on the platform. */
      checklist: string[];
      detail?: string;
    };

/**
 * The publish provider contract (#35). `authenticate`/`listProducts`/
 * `upload`/`updateListing` per the issue; guided providers implement
 * `upload` as package staging and omit the listing operations.
 */
export interface PublishProvider {
  readonly info: PublishProviderInfo;
  /**
   * Verify that a usable credential exists (env var or token store) and is
   * accepted by the platform. Guided providers resolve `{ ok: true }`.
   */
  authenticate(req: PublishRequest): Promise<PublishAuthStatus>;
  /** Provider-specific checks run before upload (config, artifact, specs). */
  preflight(req: PublishRequest): Promise<PreflightIssue[]>;
  /** Publish the artifact (or stage the guided package). */
  upload(req: PublishRequest): Promise<PublishOutcome>;
  /** Existing products/listings, for update flows. API providers only. */
  listProducts?(req: PublishRequest): Promise<PublishProduct[]>;
  /** Update an existing listing's metadata. API providers only. */
  updateListing?(
    req: PublishRequest,
    productId: string,
    metadata: PublishListingMetadata,
  ): Promise<PublishProduct>;
}

/**
 * Resolve the credential for a provider: the CI env var wins, then the token
 * store. Returns null when neither is present. The returned credential is a
 * secret — callers must never log or echo it.
 */
export async function resolvePublishCredential(
  info: PublishProviderInfo,
  deps: PublishDeps,
  account: string | undefined = deps.credentialAccount,
): Promise<{ credential: HostCredential; source: "env" | "store" } | null> {
  const env = deps.env ?? process.env;
  const fromEnv = info.credential.envVar
    ? env[info.credential.envVar]?.trim()
    : undefined;
  if (fromEnv) {
    return {
      credential: {
        host: info.credential.host,
        kind: "token",
        token: fromEnv,
        createdAt: 0,
      },
      source: "env",
    };
  }
  // Named account → compound key; no account → the legacy bare-host entry.
  const stored = await deps.tokenStore.get(
    publishCredentialKey(info.credential.host, account),
  );
  return stored ? { credential: stored, source: "store" } : null;
}

/**
 * Redacted connection status for a provider — the ONE definition of
 * "connected" (env var or stored key) shared by the CLI's `--list` and the
 * viewer's provider cards, so the two surfaces can never disagree.
 */
export async function publishConnectionStatus(
  info: PublishProviderInfo,
  deps: PublishDeps,
  account: string | undefined = deps.credentialAccount,
): Promise<{ connected: boolean; source?: "env" | "store" }> {
  if (!info.credential.required) return { connected: true };
  const resolved = await resolvePublishCredential(info, deps, account);
  return resolved
    ? { connected: true, source: resolved.source }
    : { connected: false };
}

/** A saved credential for a provider, REDACTED (no token) — for a picker. */
export interface PublishSavedAccount {
  /**
   * The account label (the compound-key `#<account>` segment). Empty string is
   * the default (unnamed / bare-host) credential.
   */
  account: string;
  /** Display name for the picker (the credential's label). */
  label: string;
  createdAt: number;
}

/**
 * The saved credentials for a provider, redacted — one per named account plus
 * the default (unnamed) entry, when present. Recovered from the store's flat
 * {@link TokenStore.list} by matching the provider host; the account label is
 * carried in each credential's `username` (see `connect.ts`), empty for the
 * default entry. Never returns token values.
 */
export async function listPublishAccounts(
  info: PublishProviderInfo,
  deps: PublishDeps,
): Promise<PublishSavedAccount[]> {
  const wantHost = info.credential.host.trim().toLowerCase();
  const all = await deps.tokenStore.list();
  return all
    .filter((c) => c.host.trim().toLowerCase() === wantHost)
    .map((c) => ({
      account: (c.username ?? "").trim(),
      label: c.label ?? (c.username || info.label),
      createdAt: c.createdAt,
    }));
}
