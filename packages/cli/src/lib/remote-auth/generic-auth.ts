/**
 * Generic token auth provider (#14, ADR 0006 D3 layer 3).
 *
 * The universal floor for every smart-HTTPS Git host that is not github.com:
 * the user pastes a host URL + (optional) username + access token collected by
 * the Advanced Setup UI, and the credential is VERIFIED with a refs probe
 * BEFORE it is saved — a bad paste fails immediately with friendly guidance,
 * never later during a sync.
 *
 * The transport is identical for every forge (Gitea, Forgejo, GitLab,
 * Bitbucket, Azure Repos, plain `git http-backend`), so a private Gitea works
 * the day this lands. Per-forge sugar is limited to {@link knownForgeTokenUrl},
 * the deep link to the host's token-settings page.
 *
 * SECURITY INVARIANT: token values never appear in error messages or logs.
 */
import type httpNode from "isomorphic-git/http/node";

import type { HostCallbacks, RemoteAuthProvider } from "./github-auth.ts";
import { GITHUB_HOST } from "./github-auth.ts";
import { credentialHostKey, type HostCredential } from "./token-store.ts";
import { testRemoteAccess, type RemoteAccessResult } from "./test-access.ts";

/** What the Advanced Setup UI collects for "Connect a Git server". */
export interface GenericTokenConnectInput {
  /** The server, as a hostname ("git.example.com") or any URL on it. */
  host: string;
  /**
   * Login associated with the token. Optional — many forges (Gitea, GitLab)
   * accept the token alone as Basic auth; when omitted the transport sends the
   * token-as-username convention.
   */
  username?: string;
  /** The access token pasted by the user. NEVER log this. */
  token: string;
  /**
   * A repository HTTPS URL on the host to validate against. When provided the
   * probe must fully succeed; when omitted the probe runs against the host
   * root, which verifies reachability and catches rejected tokens (401) but
   * cannot prove repo access (most forge roots are not Git endpoints, so a
   * not-found answer there is expected and accepted).
   */
  repoUrl?: string;
}

/**
 * The {@link RemoteAuthProvider} `connect` input for the generic provider:
 * the UI-collected fields plus the standard host callbacks (`onUserCode` is
 * part of the shared contract but unused — there is no device code in the
 * token flow; pass a no-op, or use {@link connectGenericHost} directly).
 */
export interface GenericHostCallbacks extends HostCallbacks, GenericTokenConnectInput {}

export interface GenericAuthOptions {
  /** Injectable git HTTP transport for tests. */
  httpClient?: typeof httpNode;
  /** Probe timeout forwarded to {@link testRemoteAccess}. */
  timeoutMs?: number;
}

/**
 * Reduce user input ("https://git.example.com/some/repo", "Git.Example.com",
 * "git.example.com:3000/x") to the normalized host the credential is keyed by.
 * Delegates to {@link credentialHostKey} — the ONE canonical derivation shared
 * by every credential writer and reader — so a host typed here always keys
 * identically to the same host parsed out of a remote URL by diagnose or the
 * sync transport. Returns "" when nothing usable remains.
 */
export function normalizeForgeHost(input: string): string {
  return credentialHostKey(input);
}

/**
 * Deep link to the token-settings page for recognized forges; `null` for
 * unknown hosts (the UI then shows generic "create an access token" guidance).
 * github.com intentionally returns `null` — GitHub uses the managed device
 * flow, never a pasted token.
 */
export function knownForgeTokenUrl(host: string): string | null {
  const h = normalizeForgeHost(host);
  if (!h) return null;
  const name = h.split(":")[0]!; // match on the hostname, keep port in links
  if (name === GITHUB_HOST || name.endsWith(`.${GITHUB_HOST}`)) return null;
  if (name === "bitbucket.org") {
    return "https://bitbucket.org/account/settings/app-passwords/";
  }
  if (name === "dev.azure.com" || name.endsWith(".visualstudio.com")) {
    return "https://dev.azure.com/_usersSettings/tokens";
  }
  if (name.includes("gitlab")) {
    return `https://${h}/-/user_settings/personal_access_tokens`;
  }
  if (name.includes("gitea") || name.includes("forgejo")) {
    return `https://${h}/user/settings/applications`;
  }
  return null;
}

/** Map a failed validation probe to a friendly, token-free error. */
function connectError(result: Extract<RemoteAccessResult, { ok: false }>, host: string): Error {
  switch (result.reason) {
    case "auth":
      return new Error(
        "The Git server didn't accept that access token. Check the token (and username, if your server needs one) and try again.",
      );
    case "ssh-unsupported":
      return new Error(
        "Enter the server's web address (starting with https://), not an SSH address (git@…).",
      );
    case "unreachable":
      return new Error(
        `Couldn't reach ${host}. Check the server address and your connection, then try again.`,
      );
    case "tls":
      return new Error(result.message);
    case "not-found":
      return new Error(
        "The server answered, but that repository wasn't found. Check the repository address and that the token has access to it.",
      );
    default:
      return new Error(
        `Couldn't verify the connection to ${host}. Check the server address and try again.`,
      );
  }
}

/**
 * Validate-then-build a host credential from UI-collected input (the D3
 * "Connect a Git server" flow). Throws a friendly error when validation
 * fails; the caller stores the returned credential in its TokenStore.
 *
 * KNOWN LIMITATION (root probe): when `repoUrl` is omitted, the probe runs
 * against `https://host/`, and most forge roots are not Git endpoints — they
 * answer "not found" without ever evaluating the credential. That answer is
 * accepted (it proves reachability and that the token was not actively
 * rejected), which means **a wrong token can be accepted** in this mode. Only
 * an explicit 401/403 rejects. Pass `repoUrl` whenever one is available to get
 * a full end-to-end verification of the token against a real repository.
 */
export async function connectGenericHost(
  input: GenericTokenConnectInput,
  options: GenericAuthOptions = {},
): Promise<HostCredential> {
  const host = normalizeForgeHost(input.host);
  if (!host) {
    throw new Error("Enter your Git server's web address (like https://git.example.com).");
  }
  const token = input.token?.trim();
  if (!token) {
    throw new Error("Paste an access token from your Git server to connect.");
  }
  const username = input.username?.trim() || undefined;

  const candidate: HostCredential = {
    host,
    kind: "token",
    token,
    ...(username ? { username } : {}),
    label: username ? `${host} — ${username}` : host,
    createdAt: Date.now(),
  };

  const probeUrl = input.repoUrl?.trim() || `https://${host}/`;
  const result = await testRemoteAccess({
    url: probeUrl,
    credential: candidate,
    ...(options.httpClient ? { httpClient: options.httpClient } : {}),
    ...(options.timeoutMs ? { timeoutMs: options.timeoutMs } : {}),
  });

  if (!result.ok) {
    // Host-root probes can't distinguish "root is not a repo" from a real
    // missing repo — a not-found/unknown answer there still proves the server
    // is reachable and did NOT reject the token, so accept it. With an
    // explicit repoUrl the probe must fully succeed.
    const rootProbe = !input.repoUrl?.trim();
    const inconclusiveButReachable =
      rootProbe && (result.reason === "not-found" || result.reason === "unknown");
    if (!inconclusiveButReachable) throw connectError(result, host);
  }

  return candidate;
}

/**
 * {@link RemoteAuthProvider} wrapper for the generic token flow, so host apps
 * can route any non-GitHub origin through the shared provider contract.
 */
export class GenericTokenAuthProvider implements RemoteAuthProvider {
  private readonly options: GenericAuthOptions;

  constructor(options: GenericAuthOptions = {}) {
    this.options = options;
  }

  /** Handles any smart-HTTP(S) host that is not github.com (device flow). */
  matches(origin: URL): boolean {
    return (
      /^https?:$/.test(origin.protocol) &&
      origin.hostname.toLowerCase() !== GITHUB_HOST
    );
  }

  connect(callbacks: GenericHostCallbacks): Promise<HostCredential> {
    return connectGenericHost(callbacks, this.options);
  }

  /** Revalidate a stored credential: false only on a definitive rejection. */
  async validate(credential: HostCredential): Promise<boolean> {
    const result = await testRemoteAccess({
      url: `https://${credential.host}/`,
      credential,
      ...(this.options.httpClient ? { httpClient: this.options.httpClient } : {}),
      ...(this.options.timeoutMs ? { timeoutMs: this.options.timeoutMs } : {}),
    });
    // Network failure / non-repo root ≠ invalid credential — only an explicit
    // auth rejection invalidates (same "can't tell → keep" policy as GitHub).
    return result.ok || result.reason !== "auth";
  }
}
