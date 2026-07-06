/**
 * Project remote diagnostics (#14, ADR 0006 D7).
 *
 * Pure-lib replacement for the issue's original shell diagnostics
 * (`git status` / `git remote -v` / `git branch --show-current` — all
 * forbidden by CLAUDE.md §7): folder classification reuses
 * `detectProjectSource`, remote/branch come from the classification, and the
 * stored-credential check goes through an injected {@link TokenStore}.
 * Everything here is local reads — the only network diagnostic is the
 * explicit, user-initiated `testRemoteAccess` probe (separate module).
 *
 * SECURITY INVARIANT (D7): `remoteUrl` is sanitized — credentials embedded in
 * the clone URL never appear in the diagnosis (which the UI displays).
 */
import {
  detectProjectSource,
  type ProjectSource,
} from "../project-source.ts";
import { GITHUB_HOST } from "./github-auth.ts";
import { knownForgeTokenUrl } from "./generic-auth.ts";
import { isSshRemoteUrl } from "./test-access.ts";
import { extractUrlCredential, type TokenStore } from "./token-store.ts";

/** How the project's remote is addressed. "https" covers smart HTTP(S). */
export type RemoteProtocol = "https" | "ssh" | "none";

/** Recognized forge families, for per-provider guidance copy. */
export type ForgeKind =
  | "github"
  | "gitea"
  | "forgejo"
  | "gitlab"
  | "bitbucket"
  | "azure"
  | "generic";

/**
 * Machine-readable next-step hint the UI maps to author copy:
 * - `local-only` — no remote; everything is on this computer.
 * - `connect-github-to-sync` — HTTPS github.com remote, no stored credential.
 * - `https-connect-server` — HTTPS non-GitHub remote, no stored credential.
 * - `ready-to-sync` — HTTPS remote with a stored credential (sync lands
 *   with #15's sync phase; the plumbing is in place).
 * - `ssh-use-own-tools` — SSH remote: full local features, sync externally
 *   (ADR 0006 D6). The UI layers the "switch to HTTPS" hint on recognized hosts.
 */
export type RemoteGuidanceId =
  | "local-only"
  | "connect-github-to-sync"
  | "https-connect-server"
  | "ready-to-sync"
  | "ssh-use-own-tools";

export interface ProjectRemoteDiagnosis {
  /** The #12 classification, unchanged. */
  classification: ProjectSource;
  /** Sanitized remote URL (no embedded credentials), when one exists. */
  remoteUrl?: string;
  /** Host of the remote (hostname[:port], lower-case), when parseable. */
  remoteHost?: string;
  remoteProtocol: RemoteProtocol;
  branch?: string;
  /** A credential for `remoteHost` exists in the injected store. */
  credentialPresent: boolean;
  /** Forge family of the remote host; null when there is no remote. */
  provider: ForgeKind | null;
  /** Token-settings deep link for recognized non-GitHub forges. */
  tokenSettingsUrl: string | null;
  /**
   * ADR 0006 D4: hasRemote && smart-HTTPS && credential stored. The sync
   * flow (#15 D5) is live, so this is the real "offer the Sync action"
   * gate, not a future-capability hint.
   */
  canSync: boolean;
  /**
   * @deprecated Same value as {@link canSync}. Do not use in new code —
   * this field will be removed once all callers have migrated to `canSync`.
   * (Terminology note: the concept formerly called "publish" is now "Sync";
   * "Publish" is reserved for publishing output to distribution targets, #35.
   * The alias keeps its original name for shape stability.)
   */
  canPublishWhenImplemented: boolean;
  guidance: RemoteGuidanceId;
}

/** Parse any git remote URL (https, ssh://, scp-like) to protocol + host. */
export function parseRemoteOrigin(url: string): {
  protocol: RemoteProtocol;
  host?: string;
} {
  const trimmed = url.trim();
  if (!trimmed) return { protocol: "none" };
  // scp-like git@host:owner/repo.git — no scheme, can't feed URL() directly.
  const scp = /^[\w.-]+@([\w.][\w.-]*):/.exec(trimmed);
  if (scp) return { protocol: "ssh", host: scp[1]!.toLowerCase() };
  try {
    const parsed = new URL(trimmed);
    const host = parsed.port
      ? `${parsed.hostname}:${parsed.port}`.toLowerCase()
      : parsed.hostname.toLowerCase();
    if (/^https?:$/.test(parsed.protocol)) return { protocol: "https", host };
    if (/^ssh:$/.test(parsed.protocol) || isSshRemoteUrl(trimmed)) {
      return { protocol: "ssh", host };
    }
    return { protocol: "none" };
  } catch {
    return { protocol: "none" };
  }
}

/** Classify a host into a forge family for guidance copy. Heuristic by name. */
export function forgeKindForHost(host: string): ForgeKind {
  const name = host.toLowerCase().split(":")[0]!;
  if (name === GITHUB_HOST || name.endsWith(`.${GITHUB_HOST}`)) return "github";
  if (name === "bitbucket.org" || name.includes("bitbucket")) return "bitbucket";
  if (name === "dev.azure.com" || name.endsWith(".visualstudio.com")) return "azure";
  if (name.includes("gitlab")) return "gitlab";
  if (name.includes("forgejo")) return "forgejo";
  if (name.includes("gitea")) return "gitea";
  return "generic";
}

export interface DiagnoseProjectRemoteOptions {
  /** Host-keyed credential store to check for a stored connection. */
  tokenStore?: TokenStore;
  /**
   * Pre-classified source for `projectDir`, when the caller already ran
   * detectProjectSource (e.g. buildRecoveryContext). Skips the redundant
   * parent-dir walk; when omitted, classification runs here as before.
   */
  source?: ProjectSource;
}

/**
 * Build the Advanced Setup environment status for an opened project folder.
 * Local reads only; never throws (classification itself never throws, and a
 * store failure degrades to `credentialPresent: false`).
 */
export async function diagnoseProjectRemote(
  projectDir: string,
  options: DiagnoseProjectRemoteOptions = {},
): Promise<ProjectRemoteDiagnosis> {
  const classification = options.source ?? (await detectProjectSource(projectDir));

  const rawRemoteUrl =
    classification.type === "local-git-folder" ? classification.remoteUrl : undefined;
  const branch =
    classification.type === "local-git-folder" ? classification.branch : undefined;

  if (!rawRemoteUrl) {
    return {
      classification,
      remoteProtocol: "none",
      ...(branch ? { branch } : {}),
      credentialPresent: false,
      provider: null,
      tokenSettingsUrl: null,
      canSync: false,
      canPublishWhenImplemented: false,
      guidance: "local-only",
    };
  }

  const { protocol, host } = parseRemoteOrigin(rawRemoteUrl);
  // D7: never surface a token fossilized in the clone URL — sanitize both the
  // top-level remoteUrl AND the embedded classification (the UI displays both).
  const remoteUrl =
    protocol === "https" ? extractUrlCredential(rawRemoteUrl).cleanUrl : rawRemoteUrl;
  const sanitizedClassification: ProjectSource =
    classification.type === "local-git-folder" && classification.remoteUrl
      ? { ...classification, remoteUrl }
      : classification;

  let credentialPresent = false;
  if (host && options.tokenStore) {
    try {
      credentialPresent = (await options.tokenStore.get(host)) !== null;
    } catch {
      credentialPresent = false;
    }
  }

  const provider = host && protocol !== "none" ? forgeKindForHost(host) : null;
  const canSync = protocol === "https" && credentialPresent;

  let guidance: RemoteGuidanceId;
  if (protocol === "ssh") guidance = "ssh-use-own-tools";
  else if (protocol !== "https") guidance = "local-only";
  else if (credentialPresent) guidance = "ready-to-sync";
  else if (provider === "github") guidance = "connect-github-to-sync";
  else guidance = "https-connect-server";

  return {
    classification: sanitizedClassification,
    remoteUrl,
    ...(host ? { remoteHost: host } : {}),
    remoteProtocol: protocol === "none" ? "none" : protocol,
    ...(branch ? { branch } : {}),
    credentialPresent,
    provider,
    tokenSettingsUrl: host ? knownForgeTokenUrl(host) : null,
    canSync,
    canPublishWhenImplemented: canSync,
    guidance,
  };
}
