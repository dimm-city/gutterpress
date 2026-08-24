/**
 * GitHub device-flow auth provider (#15, ADR 0006 D1/D3 layer 3).
 *
 * OAuth Device Authorization Grant against a registered OAuth App: POST the
 * PUBLIC client id (plus `scope: "repo"`) to `login/device/code`, surface the
 * user code so the host UI can display it and open the verification page in
 * the system browser, then poll `login/oauth/access_token` until the user
 * approves. No redirect URI, no loopback server, no client secret, no hosted
 * token exchange — the same mechanism the `gh` CLI uses.
 *
 * All network calls use injectable `fetch` (testability) with explicit
 * timeouts and author-friendly error mapping. Token values are never logged.
 */
import { withFetchTimeout } from "../fetch-timeout.ts";
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
 * Default client id for the registered "gutterpress" OAuth App (registered
 * 2026-06-10 under the dimm-city org; switched from the original GitHub App
 * the same day — see ADR 0006 D1 amendment). Client IDs are public by design
 * (ADR 0006 D1); never put a client SECRET anywhere in this codebase — the
 * device flow needs none.
 *
 * Registration settings the app relies on (release blocking if the app is
 * ever re-registered):
 *   1. OAuth App (not a GitHub App) — the `repo` scope sees every repository
 *      the user can access immediately after device-flow consent, with NO
 *      "install the app on repositories" step (zero-install UX mandate).
 *   2. "Enable Device Flow" CHECKED (OAuth App settings) — without it every
 *      device/code request fails.
 *
 * There is no token-expiration concept to configure: OAuth device-flow
 * tokens (`gho_…`) are long-lived by default and revocable by the user from
 * GitHub → Settings → Applications. (The old GitHub-App "user-to-server
 * token expiration" foot-gun no longer applies.)
 *
 * Override order: explicit option → GUTTERPRESS_GITHUB_CLIENT_ID env var → this
 * default (see {@link resolveGitHubClientId}). The env var exists so a
 * rotated registration can ship without a code change.
 *
 * Intentionally NOT exported from the public API — hosts resolve through
 * {@link resolveGitHubClientId}.
 */
const DEFAULT_GITHUB_CLIENT_ID = "Ov23lijTeMEmkkZW2Mlt";

/**
 * OAuth scope requested in the device flow. `repo` grants read/write to every
 * repository the user can access (public + private) — accepted as the
 * trade-off for the zero-install UX (ADR 0006 D1 amendment, 2026-06-10).
 */
const GITHUB_OAUTH_SCOPE = "repo";

/**
 * Client id resolution: explicit option → env var → registered default.
 * Empty/whitespace-only values at any layer are treated as unset (the packaged
 * desktop bakes `process.env.GUTTERPRESS_GITHUB_CLIENT_ID` in via a vite `define`,
 * which yields `""` when the secret is missing at build time).
 */
export function resolveGitHubClientId(explicit?: string): string {
  return (
    explicit?.trim() ||
    process.env.GUTTERPRESS_GITHUB_CLIENT_ID?.trim() ||
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

/**
 * All requests run under the shared deadline + friendly-error policy
 * (../fetch-timeout.ts): the 15s timeout is COMPOSED with any caller
 * cancellation signal (the desktop's device flow always passes one — the old
 * `signal ?? timeout` pattern dropped the timeout entirely, leaving the
 * "Connect GitHub" dialog spinning forever on a TCP stall), caller aborts
 * rethrow raw, and everything else maps to {@link OFFLINE_MESSAGE}.
 */
async function safeFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
): Promise<Response> {
  return withFetchTimeout(
    {
      timeoutMs: REQUEST_TIMEOUT_MS,
      signal: init.signal ?? undefined,
      offlineMessage: OFFLINE_MESSAGE,
    },
    (signal) => fetchImpl(url, { ...init, signal }),
  );
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

/** GitHub device-flow credential acquisition (ADR 0006 D1). */
export class GitHubAuthProvider {
  private readonly clientId: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(options: GitHubAuthProviderOptions = {}) {
    this.clientId = resolveGitHubClientId(options.clientId);
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleepImpl ?? defaultSleep;
  }

  async connect(callbacks: HostCallbacks): Promise<HostCredential> {
    const { signal } = callbacks;
    // 1. Request a device + user code.
    const codeRes = await safeFetch(this.fetchImpl, DEVICE_CODE_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({ client_id: this.clientId, scope: GITHUB_OAUTH_SCOPE }),
      signal,
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
        signal,
      });
      const poll = (await pollRes.json()) as TokenPollResponse;
      if (poll.access_token) {
        const username = await this.fetchUsername(poll.access_token);
        return {
          host: GITHUB_HOST,
          kind: "github-oauth",
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
