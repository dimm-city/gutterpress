/**
 * Google OAuth loopback+PKCE auth provider for the `gdrive` publish provider
 * (#221, docs/gdrive-publish-plan.md D2/D3).
 *
 * OAuth 2.0 authorization-code flow for installed apps: bind an ephemeral
 * `node:http` listener on `127.0.0.1`, open the system browser at
 * `accounts.google.com` (PKCE S256 + random `state`), the user picks an
 * account and clicks Allow, Google redirects to the loopback with the code,
 * the lib exchanges it for tokens and serves a tiny "you're connected" page.
 * No code to type, nothing to paste — the loopback redirect is Google's own
 * documented flow for desktop apps (unlike GitHub, Google does not offer a
 * public device-flow client for `drive.file` without limited-input review).
 *
 * All network calls use injectable `fetch` (testability) with explicit
 * timeouts and author-friendly error mapping (../fetch-timeout.ts). Token
 * values (access token, refresh token, client secret) are never logged or
 * embedded in a thrown error message.
 *
 * ── Cloud Console registration settings this depends on (RELEASE BLOCKING —
 *    re-registering the OAuth client without matching these breaks connect
 *    for every user) ──────────────────────────────────────────────────────
 *
 *   1. OAuth consent screen (External), ONE scope:
 *        https://www.googleapis.com/auth/drive.file
 *      `drive.file` is Google's *non-sensitive* tier (confirmed against a
 *      real account, docs/gdrive-publish-plan.md Appendix B P13) — no
 *      restricted-scope verification, no CASA assessment. Not `openid`/
 *      `email` alongside it: the account email comes from Drive's about.get,
 *      and a second scope makes the consent screen granular (see
 *      GOOGLE_OAUTH_SCOPE below).
 *   2. OAuth client type: **Desktop app** (NOT "Web application"). Only a
 *      Desktop-app client accepts an un-registered ephemeral loopback
 *      `redirect_uri` (`http://127.0.0.1:<port>`) — a Web-application client
 *      requires every redirect URI to be pre-registered, which an
 *      OS-assigned port can never satisfy.
 *   3. Homepage + privacy policy URLs are required before the consent screen
 *      can be submitted for production (D11) — see PRIVACY.md.
 *   4. Publish the consent screen to **In production** once basic (brand)
 *      verification clears the "unverified app" interstitial. *Testing*
 *      mode works for development with two caveats: refresh tokens expire
 *      after ~7 days, and only ~100 test users are allowed. Verify current
 *      Google policy details at implementation time — they shift.
 *
 *   Unlike `github-auth.ts`'s device flow, Google's token endpoint requires
 *   a `client_secret` for Desktop-app clients EVEN WITH PKCE (confirmed live,
 *   Appendix B P2) — Google's own installed-app docs say this "secret" is
 *   not treated as confidential in this context, since PKCE + the loopback
 *   redirect + user consent are what actually secure the flow. See
 *   ADR 0011 for the full ruling; this amends — for Google only — the
 *   GitHub-scoped "never put a client secret in this codebase" note in
 *   github-auth.ts, which is unchanged for GitHub.
 */
import crypto from "node:crypto";
import http from "node:http";
import { FriendlyHttpError, withFetchTimeout } from "../fetch-timeout.ts";
import { openPath } from "../open-path.ts";
import type { HostCredential } from "../remote-auth/token-store.ts";
import { googleApiFailure, readGoogleApiError } from "./google-errors.ts";

/** Logical TokenStore host key for the stored refresh-token credential. */
export const GDRIVE_HOST = "gdrive";

/**
 * The ONE scope requested (D1): drive.file, Google's non-sensitive tier.
 * Deliberately not `openid email` alongside it: the account email that labels
 * the stored credential comes from Drive's own about.get (below), which needs
 * no sign-in scope — and requesting more than one scope turns Google's
 * consent screen granular, listing the Drive permission as a checkbox a user
 * can leave unticked and still finish sign-in. That produced a "connected"
 * account that answered 403 to every Drive call (0.10.5 bring-up). One scope
 * leaves nothing to untick.
 */
const GOOGLE_OAUTH_SCOPE = "https://www.googleapis.com/auth/drive.file";

const AUTHORIZATION_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
export const GOOGLE_REVOKE_ENDPOINT = "https://oauth2.googleapis.com/revoke";
// about.get is used (rather than the openidconnect userinfo endpoint) purely
// to fetch the account email for the credential label — it keeps every
// request this module makes inside the SAME fixed-host allowlist the Drive
// REST client (google-drive.ts, D7) enforces: accounts.google.com,
// oauth2.googleapis.com, www.googleapis.com. No 4th host needed.
const DRIVE_ABOUT_URL =
  "https://www.googleapis.com/drive/v3/about?fields=user(emailAddress)";

const REQUEST_TIMEOUT_MS = 15_000;
/** Overall deadline waiting for the browser redirect (D2: "~5 min"). */
const DEFAULT_FLOW_TIMEOUT_MS = 5 * 60_000;

export const OFFLINE_MESSAGE = "Couldn't reach Google. Check your connection and try again.";

/**
 * The Gutterpress production OAuth client — a Google **Desktop app** client,
 * registered and filled in by the maintainer on 2026-09-01 for 0.10.5
 * (docs/adr/0011-google-oauth-client-credentials.md). Its id and "secret"
 * are public by design: every installed Drive app ships them, and what
 * secures the flow is PKCE + the loopback redirect + the user's consent, not
 * secrecy of these values. Env-overridable through
 * GUTTERPRESS_GOOGLE_CLIENT_ID / GUTTERPRESS_GOOGLE_CLIENT_SECRET (the same
 * shape as DEFAULT_GITHUB_CLIENT_ID) in case the registration is rotated.
 * Blank both to ship a build with Google Drive publishing unconfigured — it
 * then fails connect immediately with GOOGLE_NOT_CONFIGURED_MESSAGE.
 */
const DEFAULT_GOOGLE_CLIENT_ID = "621278203862-2t35qditgvfh0pgosguqu2encf9c2h9j.apps.googleusercontent.com";
/** See {@link DEFAULT_GOOGLE_CLIENT_ID} — same policy. */
const DEFAULT_GOOGLE_CLIENT_SECRET = "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";

/**
 * Explicit option → env var → embedded default, where a value that is
 * PRESENT but empty means "no client" and does not fall through: with a real
 * client embedded below, that is the only way a build (or a test) can express
 * "Google Drive publishing unconfigured" without editing the constants. Only
 * an ABSENT (`undefined`) value falls through. This is the one place the
 * shape differs from `resolveGitHubClientId`, whose `||` chain never had a
 * blank-vs-absent distinction to draw.
 */
function resolveClientValue(explicit: string | undefined, env: string | undefined, embedded: string): string {
  if (explicit !== undefined) return explicit.trim();
  if (env !== undefined) return env.trim();
  return embedded;
}

/** Client id resolution — see {@link resolveClientValue}. */
export function resolveGoogleClientId(explicit?: string): string {
  return resolveClientValue(explicit, process.env.GUTTERPRESS_GOOGLE_CLIENT_ID, DEFAULT_GOOGLE_CLIENT_ID);
}

/** Client secret resolution — see {@link resolveClientValue}, and the module
 * header re: why a Google installed-app "secret" is safe to embed as a
 * default (ADR 0011) — this is deliberately NOT the GitHub rule. */
export function resolveGoogleClientSecret(explicit?: string): string {
  return resolveClientValue(explicit, process.env.GUTTERPRESS_GOOGLE_CLIENT_SECRET, DEFAULT_GOOGLE_CLIENT_SECRET);
}

/** Friendly, load-bearing product decision (see task brief): fail EARLY and
 * clearly when this build has no Google OAuth client configured, rather than
 * starting a loopback listener that can never complete an exchange. */
export const GOOGLE_NOT_CONFIGURED_MESSAGE =
  "Google Drive publishing isn't configured on this build yet. Set GUTTERPRESS_GOOGLE_CLIENT_ID and GUTTERPRESS_GOOGLE_CLIENT_SECRET to enable it.";

/** Resolve + require both Google OAuth client credentials, or throw the
 * friendly not-configured error. Shared by {@link GoogleAuthProvider.connect}
 * and the Drive client's token refresh (both need id+secret). */
export function requireGoogleClientCredentials(
  clientIdOpt?: string,
  clientSecretOpt?: string,
): { clientId: string; clientSecret: string } {
  const clientId = resolveGoogleClientId(clientIdOpt);
  const clientSecret = resolveGoogleClientSecret(clientSecretOpt);
  if (!clientId || !clientSecret) {
    throw new Error(GOOGLE_NOT_CONFIGURED_MESSAGE);
  }
  return { clientId, clientSecret };
}

/** D4: a revoked/expired refresh token maps to one friendly reconnect message. */
export const RECONNECT_MESSAGE =
  "Your Google Drive connection expired or was revoked. Connect Google Drive again.";

/** The one scope the provider needs — and the only one it requests (D1). */
export const DRIVE_FILE_SCOPE = "https://www.googleapis.com/auth/drive.file";

/**
 * Backstop for a token issued without the Drive scope. With a single scope
 * requested (see GOOGLE_OAUTH_SCOPE) Google's consent screen has nothing to
 * partially grant, so this should not happen — but Google's own guidance is
 * to read the token response's `scope` rather than assume, and a sign-in
 * that "succeeds" without Drive access would otherwise surface only as a
 * bare 403 on the author's first publish.
 */
export const DRIVE_PERMISSION_NOT_GRANTED_MESSAGE =
  "Google sign-in finished, but it didn't include the Google Drive permission, so Gutterpress can't create or see any files. Connect Google Drive again and allow it.";

/** Whether a token response's granted `scope` list includes `wanted`. An
 * ABSENT field is treated as unknown (true): Google always sends it, and if
 * it ever didn't, the about.get call right after connect still catches an
 * insufficient grant with Google's own reason (see `fetchEmail`). */
export function grantedScopesInclude(scope: string | undefined, wanted: string): boolean {
  if (scope === undefined) return true;
  return scope.split(/\s+/).includes(wanted);
}

/** Host-supplied callbacks for the interactive connect flow. There is no
 * "user code" to display (unlike the GitHub device flow) — just the URL the
 * browser was (or should be) sent to, and an optional cancellation signal. */
export interface GoogleHostCallbacks {
  /** Called once with the auth URL, so the host UI can show a "browser
   * didn't open? click here" fallback link while waiting. */
  onAuthUrl(url: string): void;
  /** Optional cancellation (user closed the dialog / pressed Ctrl+C). */
  signal?: AbortSignal;
}

export interface GoogleAuthProviderOptions {
  /** Explicit client id (overrides env + default). */
  clientId?: string;
  /** Explicit client secret (overrides env + default). */
  clientSecret?: string;
  /** Injectable fetch for tests. Defaults to global fetch. */
  fetchImpl?: typeof fetch;
  /** Opens the auth URL in the user's default browser. Defaults to the CLI's
   * `openPath()` (system browser opener). Tests inject a no-op so they never
   * spawn a real browser process. Failure to open is non-fatal — `onAuthUrl`
   * already handed the host UI the URL as a fallback link. */
  openBrowser?: (url: string) => Promise<void>;
  /** Overall deadline (ms) waiting for the browser redirect. Default 5 min. */
  timeoutMs?: number;
  /** Test-only: bind the loopback listener to this exact port instead of an
   * OS-assigned ephemeral one (0). Lets tests deterministically force a bind
   * failure (EADDRINUSE) by pre-binding the port themselves. Never set this
   * in production — an OS-assigned port is what makes the loopback flow work
   * without a fixed-port conflict. */
  port?: number;
}

function b64url(buf: Buffer): string {
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

/** PKCE S256 challenge derivation — exported as a pure helper so tests can
 * verify the verifier/challenge relationship independently of the flow. */
export function pkceChallengeFromVerifier(verifier: string): string {
  return b64url(crypto.createHash("sha256").update(verifier).digest());
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  /** Space-delimited scopes the user ACTUALLY granted — not necessarily what
   * was requested (Google's granular consent lets each one be unticked). */
  scope?: string;
  error?: string;
  error_description?: string;
}

async function safeFetch(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs = REQUEST_TIMEOUT_MS,
): Promise<Response> {
  return withFetchTimeout(
    { timeoutMs, signal: init.signal ?? undefined, offlineMessage: OFFLINE_MESSAGE },
    (signal) => fetchImpl(url, { ...init, signal }),
  );
}

/** Map a token-endpoint error body to a friendly, token-free message. Never
 * includes the raw error_description (which can echo request parameters). */
function friendlyTokenError(status: number, body: TokenResponse | undefined): Error {
  const code = body?.error;
  if (code === "invalid_grant") return new Error(RECONNECT_MESSAGE);
  if (code === "invalid_client") {
    return new Error(
      "Google rejected the app's sign-in credentials. This build's Google OAuth client id/secret may be misconfigured.",
    );
  }
  return new FriendlyHttpError(
    `Google sign-in failed (HTTP ${status}${code ? `: ${code}` : ""}). Please try again.`,
  );
}

/** Result of a successful loopback callback. */
interface CallbackResult {
  code: string;
}

const SUCCESS_HTML =
  '<html><body style="font:16px system-ui;padding:3rem"><h2>You\'re connected</h2><p>Return to Gutterpress — you can close this tab.</p></body></html>';
const FAILURE_HTML =
  '<html><body style="font:16px system-ui;padding:3rem"><h2>Sign-in didn\'t complete</h2><p>Return to Gutterpress and try again.</p></body></html>';

/** Bind the loopback listener and wait for exactly one callback request,
 * enforcing `state` and composing the flow deadline with the caller's
 * cancellation signal. The success page never contains token material. */
function waitForCallback(
  server: http.Server,
  expectedState: string,
  redirectUri: string,
  timeoutMs: number,
  signal: AbortSignal | undefined,
): Promise<CallbackResult> {
  return new Promise<CallbackResult>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      server.removeListener("request", onRequest);
      signal?.removeEventListener("abort", onAbort);
      server.close();
      // server.close() only stops accepting new connections — an idle
      // keep-alive socket (the browser's, or the 204 branch's speculative
      // probe) would otherwise linger until Node's default 5s
      // keepAliveTimeout, holding the CLI open after "success" is printed.
      server.closeIdleConnections();
    };
    const finishResolve = (value: CallbackResult) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    const finishReject = (err: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };
    const onRequest = (req: http.IncomingMessage, res: http.ServerResponse) => {
      let url: URL;
      try {
        url = new URL(req.url ?? "/", redirectUri);
      } catch {
        res.writeHead(400).end();
        return;
      }
      const err = url.searchParams.get("error");
      const gotState = url.searchParams.get("state");
      const code = url.searchParams.get("code");
      if (!err && !code) {
        // Neither a code nor an error — this isn't the OAuth redirect (a
        // browser preconnect/speculative probe, or someone hitting the
        // loopback port manually). Don't settle the flow on it; keep
        // waiting for the real callback.
        res.writeHead(204, { Connection: "close" }).end();
        return;
      }
      const fail = (message: string) => {
        res.writeHead(200, { "Content-Type": "text/html", Connection: "close" }).end(FAILURE_HTML);
        finishReject(new Error(message));
      };
      if (err) {
        fail("Google sign-in was declined. You can connect Google Drive again whenever you're ready.");
        return;
      }
      // Past this point !err held, so the `!err && !code` guard above
      // guarantees `code` is set — there is no third "neither" case here.
      if (gotState !== expectedState) {
        // Never proceed on a state mismatch — reject without exposing the
        // received value (could be forged/attacker-controlled input).
        fail("Google sign-in failed a security check (state mismatch). Connect Google Drive again.");
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html", Connection: "close" }).end(SUCCESS_HTML);
      finishResolve({ code: code as string });
    };
    const onAbort = () => finishReject(new Error("Google sign-in was canceled."));
    const timer = setTimeout(
      () =>
        finishReject(
          new Error(
            "Google sign-in timed out waiting for the browser. Try again, or use GDRIVE_REFRESH_TOKEN for headless/CI use.",
          ),
        ),
      timeoutMs,
    );
    server.on("request", onRequest);
    if (signal) {
      if (signal.aborted) return onAbort();
      signal.addEventListener("abort", onAbort, { once: true });
    }
  });
}

/** Google OAuth loopback+PKCE credential acquisition (D2/D3). */
export class GoogleAuthProvider {
  private readonly clientIdOpt: string | undefined;
  private readonly clientSecretOpt: string | undefined;
  private readonly fetchImpl: typeof fetch;
  private readonly openBrowser: (url: string) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly bindPort: number;

  constructor(options: GoogleAuthProviderOptions = {}) {
    this.clientIdOpt = options.clientId;
    this.clientSecretOpt = options.clientSecret;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.openBrowser = options.openBrowser ?? openPath;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FLOW_TIMEOUT_MS;
    this.bindPort = options.port ?? 0;
  }

  async connect(callbacks: GoogleHostCallbacks): Promise<HostCredential> {
    // Fail EARLY — before binding a listener nobody can ever complete — when
    // this build has no client configured (deliberate product decision).
    const { clientId, clientSecret } = requireGoogleClientCredentials(
      this.clientIdOpt,
      this.clientSecretOpt,
    );
    const { signal } = callbacks;

    const verifier = b64url(crypto.randomBytes(32));
    const state = b64url(crypto.randomBytes(16));
    const challenge = pkceChallengeFromVerifier(verifier);

    const server = http.createServer();
    await new Promise<void>((resolve, reject) => {
      const onListenError = (err: Error) => {
        reject(new Error(`Couldn't start the local sign-in listener: ${err.message}`));
      };
      server.once("error", onListenError);
      server.listen(this.bindPort, "127.0.0.1", () => {
        server.removeListener("error", onListenError);
        resolve();
      });
    });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const redirectUri = `http://127.0.0.1:${port}`;

    const authUrl =
      `${AUTHORIZATION_ENDPOINT}?` +
      new URLSearchParams({
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: GOOGLE_OAUTH_SCOPE,
        code_challenge: challenge,
        code_challenge_method: "S256",
        state,
        access_type: "offline",
        prompt: "consent",
      }).toString();

    callbacks.onAuthUrl(authUrl);
    // Best-effort; the URL was already handed to the host UI as a fallback.
    this.openBrowser(authUrl).catch(() => {});

    const { code } = await waitForCallback(server, state, redirectUri, this.timeoutMs, signal);

    const tokenRes = await safeFetch(this.fetchImpl, TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
      signal,
    });
    const tokenBody = (await tokenRes.json().catch(() => ({}))) as TokenResponse;
    if (!tokenRes.ok || !tokenBody.access_token) {
      throw friendlyTokenError(tokenRes.status, tokenBody);
    }
    if (!tokenBody.refresh_token) {
      // access_type=offline&prompt=consent should always mint one; if Google
      // ever doesn't, we have nothing durable to store.
      throw new Error(
        "Google didn't return a refresh token. Try connecting again — if this keeps happening, revoke Gutterpress's access at myaccount.google.com/permissions and reconnect.",
      );
    }
    // A token without the Drive scope is a successful sign-in that can never
    // publish. Refuse it here, before storing anything — and before the
    // about.get below, which would only report it as a generic 403. Nothing
    // is revoked: such a grant holds no Drive access, and prompt=consent
    // re-asks in full on the next attempt.
    if (!grantedScopesInclude(tokenBody.scope, DRIVE_FILE_SCOPE)) {
      throw new Error(DRIVE_PERMISSION_NOT_GRANTED_MESSAGE);
    }

    const email = await this.fetchEmail(tokenBody.access_token);

    return {
      host: GDRIVE_HOST,
      kind: "google-oauth",
      token: tokenBody.refresh_token,
      ...(email ? { username: email, label: `Google Drive — ${email}` } : { label: "Google Drive" }),
      createdAt: Date.now(),
    };
  }

  /**
   * Email lookup after auth, via Drive's `about.get` — which doubles as the
   * first real Drive API call the new token makes. A 401/403 answer here is
   * NOT best-effort: it means the token can't use the Drive API at all (the
   * common case is `accessNotConfigured` — the Drive API isn't enabled for
   * the OAuth client's Cloud project, ADR 0011), so storing the credential
   * would only defer the failure to the author's first publish, as a bare
   * "HTTP 403" with nothing to act on — exactly the trap the 0.10.5 bring-up
   * hit. Fail connect right here, with Google's reason, and store nothing.
   * Everything else (a network blip, a 5xx, a body without the field) stays
   * non-fatal, mirroring GitHubAuthProvider's fetchUsername precedent: the
   * email is only a label.
   */
  private async fetchEmail(accessToken: string): Promise<string | undefined> {
    let res: Response;
    try {
      res = await safeFetch(this.fetchImpl, DRIVE_ABOUT_URL, {
        method: "GET",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      return undefined;
    }
    if (res.status === 401 || res.status === 403) {
      throw googleApiFailure("Google Drive rejected the new connection", await readGoogleApiError(res));
    }
    if (!res.ok) return undefined;
    try {
      const body = (await res.json()) as { user?: { emailAddress?: string } };
      return body.user?.emailAddress;
    } catch {
      return undefined;
    }
  }
}

/** Best-effort revoke at Google (used by disconnect, D4/D6). Never throws —
 * a failed revoke must not block the local credential from being deleted. */
export async function revokeGoogleCredential(
  refreshToken: string,
  options: { fetchImpl?: typeof fetch } = {},
): Promise<void> {
  const fetchImpl = options.fetchImpl ?? fetch;
  try {
    await withFetchTimeout(
      { timeoutMs: 10_000, offlineMessage: OFFLINE_MESSAGE },
      (signal) =>
        fetchImpl(GOOGLE_REVOKE_ENDPOINT, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token: refreshToken }).toString(),
          signal,
        }),
    );
  } catch {
    // Best-effort — the caller deletes the local credential regardless.
  }
}
