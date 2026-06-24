/**
 * "Test Remote Access" diagnostic (#14, ADR 0006 D7).
 *
 * A single refs probe (isomorphic-git `listServerRefs` over smart HTTPS — the
 * node-native replacement for `git ls-remote origin`, CLAUDE.md §7) that
 * answers: can print-md reach this remote with what it has stored? Failures
 * are CLASSIFIED so the Advanced Setup UI can show the right next step instead
 * of raw transport errors.
 *
 * SSH URLs short-circuit to `ssh-unsupported` WITHOUT any network call —
 * isomorphic-git has no SSH transport and we never shell out (ADR 0006 D6).
 *
 * SECURITY INVARIANT: token values (explicit credential or embedded in the
 * URL) never appear in result messages.
 */
import git from "isomorphic-git";
import httpNode from "isomorphic-git/http/node";

import { extractUrlCredential, type HostCredential } from "./token-store.ts";

/** Why a remote-access probe failed, in machine-readable form. */
export type RemoteAccessFailureReason =
  | "auth"
  | "not-found"
  | "unreachable"
  | "ssh-unsupported"
  | "tls"
  | "unknown";

export type RemoteAccessResult =
  | { ok: true; defaultBranch?: string; refCount: number }
  | { ok: false; reason: RemoteAccessFailureReason; message: string };

export interface TestRemoteAccessOptions {
  /** The remote URL to probe (HTTPS; SSH is classified, never contacted). */
  url: string;
  /** Credential for the remote's host, if one is stored. */
  credential?: HostCredential;
  /** Injectable git HTTP transport for tests. Defaults to the node client. */
  httpClient?: typeof httpNode;
  /** Probe timeout. The probe resolves `unreachable` when it elapses. */
  timeoutMs?: number;
}

/**
 * True for any remote URL print-md's HTTPS-only transport cannot use:
 * `ssh://…` and the scp-like `git@host:owner/repo.git` shorthand.
 */
export function isSshRemoteUrl(url: string): boolean {
  const trimmed = url.trim();
  if (/^ssh:\/\//i.test(trimmed)) return true;
  // scp-like: user@host:path — no scheme, a colon after the host part.
  // Hosts can also be bracketed IPv6 literals: git@[::1]:owner/repo.git.
  return /^[\w.-]+@[\w.][\w.-]*:/.test(trimmed) || /^[\w.-]+@\[/.test(trimmed);
}

/** Author-friendly messages per failure reason (no URLs, no tokens). */
const FAILURE_MESSAGES: Record<RemoteAccessFailureReason, string> = {
  auth: "The Git server didn't accept the saved connection. Reconnect to this server with a current access token and try again.",
  "not-found":
    "The server answered, but no repository was found at that address. It may have been moved, renamed, or you may no longer have access.",
  unreachable:
    "Couldn't reach the Git server. Check your internet connection (and VPN, if this is a private server), then try again.",
  "ssh-unsupported":
    "This project's online address uses SSH (git@…), which print-md can't check or sync with. Everything on this computer still works — sync with your usual Git tool.",
  tls: "The server's security certificate couldn't be verified. If this is a private server with its own certificate, ask its administrator about trusting it (NODE_EXTRA_CA_CERTS).",
  unknown:
    "The connection test failed unexpectedly. The server may not be a Git server, or it may be temporarily unavailable.",
};

function failure(reason: RemoteAccessFailureReason): RemoteAccessResult {
  return { ok: false, reason, message: FAILURE_MESSAGES[reason] };
}

/** Map a raw transport error to a classified failure. Never echoes the URL. */
export function classifyRemoteAccessError(e: unknown): RemoteAccessResult {
  const msg = e instanceof Error ? e.message : String(e);
  // "cancel" maps to auth: the only cancellation in this flow is our own
  // onAuthFailure → { cancel: true } after the server rejected the credential
  // (isomorphic-git then throws UserCanceledError).
  if (/401|403|auth|credential|denied|cancel/i.test(msg)) return failure("auth");
  if (/404|not found/i.test(msg)) return failure("not-found");
  if (
    /certificate|self.signed|unable_to_verify|cert_|tls|ssl/i.test(msg) &&
    !/fetch failed/i.test(msg)
  ) {
    return failure("tls");
  }
  if (
    /ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|EHOSTUNREACH|network|fetch failed|timed out/i.test(
      msg,
    )
  ) {
    return failure("unreachable");
  }
  return failure("unknown");
}

/**
 * Probe a remote with a single refs listing (the `git ls-remote` equivalent).
 *
 * - Never throws — every outcome is a classified {@link RemoteAccessResult}.
 * - SSH URLs return `ssh-unsupported` with zero network traffic.
 * - Credentials embedded in the URL are stripped and used for auth when no
 *   explicit credential is supplied (ADR 0006 D7) — they never leak onward.
 * - `defaultBranch` comes from the server's `HEAD` symref when advertised.
 */
export async function testRemoteAccess(
  options: TestRemoteAccessOptions,
): Promise<RemoteAccessResult> {
  if (isSshRemoteUrl(options.url)) return failure("ssh-unsupported");

  let parsed: URL;
  try {
    parsed = new URL(options.url);
  } catch {
    return failure("unknown");
  }
  if (!/^https?:$/.test(parsed.protocol)) return failure("ssh-unsupported");

  const { cleanUrl, credential: urlCredential } = extractUrlCredential(
    options.url,
  );
  const credential = options.credential ?? urlCredential;
  const timeoutMs = options.timeoutMs ?? 15_000;

  // isomorphic-git's HTTP clients take no AbortSignal — race a timer instead.
  // On timeout the probe resolves `unreachable`; the lingering socket is
  // harmless for a one-shot diagnostic.
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<RemoteAccessResult>((resolve) => {
    timer = setTimeout(() => resolve(failure("unreachable")), timeoutMs);
  });

  const probe = (async (): Promise<RemoteAccessResult> => {
    try {
      const refs = await git.listServerRefs({
        http: options.httpClient ?? httpNode,
        url: cleanUrl,
        // v1 advertisement: universally supported (GitHub, Gitea, GitLab,
        // Bitbucket, Azure, plain `git http-backend`) and carries the HEAD
        // symref in capabilities.
        protocolVersion: 1,
        symrefs: true,
        ...(credential
          ? {
              onAuth: () => ({
                username:
                  credential.kind === "github-oauth"
                    ? "x-access-token"
                    : credential.username || credential.token,
                password: credential.token,
              }),
              // One shot — never loop on a rejected credential.
              onAuthFailure: () => ({ cancel: true }),
            }
          : {}),
      });
      const head = refs.find((r) => r.ref === "HEAD" && r.target);
      const defaultBranch = head?.target?.replace(/^refs\/heads\//, "");
      return {
        ok: true,
        refCount: refs.filter((r) => r.ref !== "HEAD").length,
        ...(defaultBranch ? { defaultBranch } : {}),
      };
    } catch (e) {
      return classifyRemoteAccessError(e);
    }
  })();

  try {
    return await Promise.race([probe, timeout]);
  } finally {
    clearTimeout(timer);
  }
}
