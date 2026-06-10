/**
 * GitHub device-flow auth provider (#15, ADR 0006 D1/D3 layer 3).
 *
 * OAuth Device Authorization Grant against a registered GitHub App: POST the
 * PUBLIC client id to `login/device/code`, surface the user code so the host
 * UI can display it and open the verification page in the system browser, then
 * poll `login/oauth/access_token` until the user approves. No redirect URI, no
 * loopback server, no client secret, no hosted token exchange — the same
 * mechanism the `gh` CLI uses.
 *
 * All network calls use injectable `fetch` (testability) with explicit
 * timeouts and author-friendly error mapping. Token values are never logged.
 */
import type { HostCredential } from "./token-store.ts";

/** What the host UI needs to show the user during the device flow. */
export interface DeviceCodeInfo {
  /** The code the user types at the verification page, e.g. "ABCD-1234". */
  userCode: string;
  /** Where the user enters the code (https://github.com/login/device). */
  verificationUri: string;
  /** Seconds until the device code expires. */
  expiresIn: number;
  /** Minimum seconds between token polls. */
  interval: number;
}

/** Host-supplied callbacks for the interactive connect flow (ADR 0006 D3). */
export interface HostCallbacks {
  /** Called once with the code/URL so the UI can display them. */
  onUserCode(info: DeviceCodeInfo): void;
  /** Optional cancellation (user closed the dialog). */
  signal?: AbortSignal;
}

/**
 * Per-host auth-acquisition plugin contract (ADR 0006 D3 layer 3). github.com
 * gets the device flow below; every other host gets the generic token flow
 * (#14, not in this change).
 */
export interface RemoteAuthProvider {
  /** Does this provider handle the given remote host? */
  matches(origin: URL): boolean;
  /** Interactive flow producing a credential for the host. */
  connect(callbacks: HostCallbacks): Promise<HostCredential>;
  /** Cheap revalidation for stored credentials. */
  validate(credential: HostCredential): Promise<boolean>;
}

/**
 * Default GitHub App client id for the registered "print-md" GitHub App
 * (registered 2026-06-10 under the dimm-city org). Client IDs are public by
 * design (ADR 0006 D1); never put a client SECRET anywhere in this codebase.
 *
 * Registration settings the app relies on (ADR 0006 D1 — if the app is ever
 * re-registered, these are release blocking):
 *   1. GitHub App (not an OAuth App) for selected-repository access.
 *   2. "Device flow" ENABLED (App settings → General).
 *   3. Permissions: Repository → Contents: Read and write. Nothing else.
 *   4. "User-to-server token expiration" DISABLED (App settings → Optional
 *      features) — refreshing expiring tokens requires the client secret,
 *      which we cannot ship; with expiration left on, every session silently
 *      dies after 8 hours.
 *
 * Override order: explicit option → PRINT_MD_GITHUB_CLIENT_ID env var → this
 * default (see {@link resolveGitHubClientId}). The env var exists so a
 * rotated registration can ship without a code change.
 *
 * Intentionally NOT exported from the public API — hosts resolve through
 * {@link resolveGitHubClientId}.
 */
const DEFAULT_GITHUB_CLIENT_ID = "Iv23liuFxmMqnaRNjIK5";

/**
 * Client id resolution: explicit option → env var → placeholder default.
 * Empty/whitespace-only values at any layer are treated as unset (the packaged
 * viewer bakes `process.env.PRINT_MD_GITHUB_CLIENT_ID` in via a vite `define`,
 * which yields `""` when the secret is missing at build time).
 */
export function resolveGitHubClientId(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.PRINT_MD_GITHUB_CLIENT_ID?.trim() ||
    DEFAULT_GITHUB_CLIENT_ID
  );
}

export const GITHUB_HOST = "github.com";
const DEVICE_CODE_URL = "https://github.com/login/device/code";
const ACCESS_TOKEN_URL = "https://github.com/login/oauth/access_token";
const API_BASE = "https://api.github.com";
const REQUEST_TIMEOUT_MS = 15_000;

/** Author-friendly message for connectivity failures (ADR 0006 D7). */
export const OFFLINE_MESSAGE =
  "Couldn't reach GitHub. Check your connection and try again.";

export interface GitHubAuthProviderOptions {
  /** Explicit client id (overrides env + default). */
  clientId?: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Injectable sleep for tests (so polling tests run instantly). */
  sleepImpl?: (ms: number) => Promise<void>;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Wrap network-level failures in the friendly offline message. */
async function safeFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  try {
    return await fetchImpl(url, {
      ...init,
      signal: init.signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (cause) {
    if (cause instanceof Error && cause.name === "AbortError") throw cause;
    throw new Error(OFFLINE_MESSAGE, { cause });
  }
}

interface DeviceCodeResponse {
  device_code: string;
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

interface TokenPollResponse {
  access_token?: string;
  error?: string;
  interval?: number;
}

/** GitHub device-flow {@link RemoteAuthProvider} (ADR 0006 D1). */
export class GitHubAuthProvider implements RemoteAuthProvider {
  private readonly clientId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GitHubAuthProviderOptions = {}) {
    this.clientId = resolveGitHubClientId(options.clientId);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
  }

  matches(origin: URL): boolean {
    return origin.hostname.toLowerCase() === GITHUB_HOST;
  }

  async connect(callbacks: HostCallbacks): Promise<HostCredential> {
    const { signal } = callbacks;
    // 1. Request a device + user code.
    const codeRes = await safeFetch(this.fetchImpl, DEVICE_CODE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: this.clientId }),
      signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!codeRes.ok) {
      throw new Error(
        "GitHub couldn't start the sign-in. Please try again in a moment.",
      );
    }
    const code = (await codeRes.json()) as DeviceCodeResponse;
    callbacks.onUserCode({
      userCode: code.user_code,
      verificationUri: code.verification_uri,
      expiresIn: code.expires_in,
      interval: code.interval,
    });

    // 2. Poll for the access token, honoring the server-directed interval.
    let intervalSec = Math.max(1, code.interval || 5);
    const deadline = Date.now() + code.expires_in * 1000;
    for (;;) {
      throwIfAborted(signal);
      await this.sleep(intervalSec * 1000);
      throwIfAborted(signal);
      if (Date.now() > deadline) {
        throw new Error(
          "The sign-in code expired before it was entered. Connect GitHub again to get a new code.",
        );
      }
      const pollRes = await safeFetch(this.fetchImpl, ACCESS_TOKEN_URL, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: this.clientId,
          device_code: code.device_code,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        }),
        signal: signal ?? AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const poll = (await pollRes.json()) as TokenPollResponse;
      if (poll.access_token) {
        const username = await this.fetchUsername(poll.access_token);
        return {
          host: GITHUB_HOST,
          kind: "github-app",
          token: poll.access_token,
          ...(username ? { username, label: `GitHub — @${username}` } : {}),
          createdAt: Date.now(),
        };
      }
      switch (poll.error) {
        case "authorization_pending":
          continue; // user hasn't approved yet — keep polling
        case "slow_down":
          // RFC 8628 §3.5: the server-sent interval is authoritative; the
          // client must wait that interval PLUS 5 seconds. When the response
          // carries no interval, add 5s to the current one.
          intervalSec = (poll.interval ?? intervalSec) + 5;
          continue;
        case "expired_token":
          throw new Error(
            "The sign-in code expired before it was entered. Connect GitHub again to get a new code.",
          );
        case "access_denied":
          throw new Error(
            "GitHub sign-in was declined. You can connect GitHub again whenever you're ready.",
          );
        default:
          throw new Error(
            "GitHub sign-in failed unexpectedly. Please try connecting again.",
          );
      }
    }
  }

  /**
   * Cheap credential revalidation against `GET /user`. Returns `false` on any
   * non-200 (401 revoked/expired, 403 forbidden/rate-limit-blocked, …);
   * network failures are treated as "can't tell" → `true`.
   */
  async validate(credential: HostCredential): Promise<boolean> {
    try {
      const res = await safeFetch(this.fetchImpl, `${API_BASE}/user`, {
        method: "GET",
        headers: githubApiHeaders(credential.token),
      });
      return res.status === 200;
    } catch {
      // Network failure ≠ invalid credential — treat as "can't tell" → valid,
      // so an offline launch never wipes a working connection.
      return true;
    }
  }

  /** Best-effort login lookup after auth — failure is non-fatal. */
  private async fetchUsername(token: string): Promise<string | undefined> {
    try {
      const res = await safeFetch(this.fetchImpl, `${API_BASE}/user`, {
        method: "GET",
        headers: githubApiHeaders(token),
      });
      if (!res.ok) return undefined;
      const body = (await res.json()) as { login?: string };
      return body.login;
    } catch {
      return undefined;
    }
  }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw new Error("GitHub sign-in was canceled.");
  }
}

/** Standard headers for api.github.com calls. */
export function githubApiHeaders(token: string): Record<string, string> {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
