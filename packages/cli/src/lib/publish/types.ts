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

/** Stable provider identifiers (the `--provider` values / manifest keys). */
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
  const stored = await deps.tokenStore.get(info.credential.host);
  return stored ? { credential: stored, source: "store" } : null;
}
