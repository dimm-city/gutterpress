import { test, expect } from "bun:test";
import {
  GoogleAuthProvider,
  pkceChallengeFromVerifier,
  GOOGLE_NOT_CONFIGURED_MESSAGE,
} from "./google-auth";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface Harness {
  provider: GoogleAuthProvider;
  requests: Array<{ url: string; body?: Record<string, string> }>;
}

/** A provider whose token/about fetches are scripted, with a real
 * `node:http` loopback listener underneath (NOT mocked) — the tests below
 * drive it with real `fetch()` calls simulating the browser redirect. */
function scriptedProvider(
  opts: {
    tokenResponse?: unknown;
    tokenStatus?: number;
    aboutBody?: unknown;
    clientSecret?: string;
    timeoutMs?: number;
  } = {},
): Harness {
  const requests: Array<{ url: string; body?: Record<string, string> }> = [];
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    let body: Record<string, string> | undefined;
    if (init?.body) {
      body = Object.fromEntries(new URLSearchParams(String(init.body)));
    }
    requests.push({ url: u, body });
    if (u.includes("oauth2.googleapis.com/token")) {
      return jsonResponse(
        opts.tokenResponse ?? {
          access_token: "test-access-token",
          refresh_token: "sensitive-refresh-value",
          expires_in: 3599,
        },
        opts.tokenStatus ?? 200,
      );
    }
    if (u.includes("drive/v3/about")) {
      return jsonResponse(opts.aboutBody ?? { user: { emailAddress: "author@example.com" } });
    }
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
  const provider = new GoogleAuthProvider({
    clientId: "test-client-id",
    clientSecret: opts.clientSecret ?? "test-client-secret",
    fetchImpl,
    openBrowser: async () => {}, // never actually spawn a browser in tests
    ...(opts.timeoutMs !== undefined ? { timeoutMs: opts.timeoutMs } : {}),
  });
  return { provider, requests };
}

/** Start connect() and resolve once onAuthUrl fires, without racing the
 * listener's async `listen()` startup. */
async function captureAuthUrl(provider: GoogleAuthProvider, signal?: AbortSignal) {
  let resolveUrl!: (u: string) => void;
  const urlPromise = new Promise<string>((res) => {
    resolveUrl = res;
  });
  const donePromise = provider.connect({
    onAuthUrl: (u) => resolveUrl(u),
    ...(signal ? { signal } : {}),
  });
  // Mark the promise "handled" immediately so a natural race between the
  // caller's redirect fetch() and this rejection can't trip Bun's
  // unhandled-rejection detection before the caller attaches its own
  // assertion below.
  donePromise.catch(() => {});
  const authUrl = await urlPromise;
  return { authUrl, donePromise };
}

test("happy path: real loopback listener + real fetch redirect completes the flow, PKCE verifier matches the challenge", async () => {
  const { provider, requests } = scriptedProvider();
  const { authUrl, donePromise } = await captureAuthUrl(provider);
  const parsed = new URL(authUrl);

  expect(parsed.origin).toBe("https://accounts.google.com");
  expect(parsed.pathname).toBe("/o/oauth2/v2/auth");
  expect(parsed.searchParams.get("code_challenge_method")).toBe("S256");
  expect(parsed.searchParams.get("access_type")).toBe("offline");
  expect(parsed.searchParams.get("prompt")).toBe("consent");
  expect(parsed.searchParams.get("scope")).toBe(
    "https://www.googleapis.com/auth/drive.file openid email",
  );
  const state = parsed.searchParams.get("state")!;
  const redirectUri = parsed.searchParams.get("redirect_uri")!;
  expect(redirectUri).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);

  // Drive the REAL loopback listener with a real fetch() request, exactly as
  // the browser would after the user clicks Allow.
  const res = await fetch(`${redirectUri}/?code=fake-auth-code&state=${state}`);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("connected");

  const cred = await donePromise;
  expect(cred.host).toBe("gdrive");
  expect(cred.kind).toBe("google-oauth");
  expect(cred.token).toBe("sensitive-refresh-value"); // the REFRESH token is what's stored, D4
  expect(cred.username).toBe("author@example.com");
  expect(cred.label).toBe("Google Drive — author@example.com");

  const tokenReq = requests.find((r) => r.url.includes("oauth2.googleapis.com/token"));
  expect(tokenReq?.body?.client_id).toBe("test-client-id");
  expect(tokenReq?.body?.client_secret).toBe("test-client-secret");
  expect(tokenReq?.body?.code).toBe("fake-auth-code");
  expect(tokenReq?.body?.grant_type).toBe("authorization_code");

  // PKCE correctness: the challenge sent in the auth URL is really the
  // sha256(verifier) of the verifier sent to the token endpoint.
  const challenge = parsed.searchParams.get("code_challenge")!;
  const verifier = tokenReq?.body?.code_verifier ?? "";
  expect(verifier.length).toBeGreaterThan(20);
  expect(pkceChallengeFromVerifier(verifier)).toBe(challenge);
});

test("a mismatched state is REJECTED and the token endpoint is never called (never proceeds)", async () => {
  const { provider, requests } = scriptedProvider();
  const { authUrl, donePromise } = await captureAuthUrl(provider);
  const parsed = new URL(authUrl);
  const redirectUri = parsed.searchParams.get("redirect_uri")!;

  await fetch(`${redirectUri}/?code=fake-auth-code&state=an-attacker-controlled-state`);

  await expect(donePromise).rejects.toThrow(/security check|state mismatch/i);
  expect(requests.some((r) => r.url.includes("oauth2.googleapis.com/token"))).toBe(false);
});

test("the correct state IS accepted (state round-trips through a real redirect)", async () => {
  const { provider } = scriptedProvider();
  const { authUrl, donePromise } = await captureAuthUrl(provider);
  const parsed = new URL(authUrl);
  const redirectUri = parsed.searchParams.get("redirect_uri")!;
  const state = parsed.searchParams.get("state")!;
  await fetch(`${redirectUri}/?code=fake-auth-code&state=${state}`);
  const cred = await donePromise;
  expect(cred.token).toBe("sensitive-refresh-value");
});

test("error= query param (the user declined consent) is rejected with a friendly message", async () => {
  const { provider, requests } = scriptedProvider();
  const { authUrl, donePromise } = await captureAuthUrl(provider);
  const parsed = new URL(authUrl);
  const redirectUri = parsed.searchParams.get("redirect_uri")!;
  const state = parsed.searchParams.get("state")!;

  await fetch(`${redirectUri}/?error=access_denied&state=${state}`);

  await expect(donePromise).rejects.toThrow(/declined/i);
  expect(requests.length).toBe(0);
});

test("cancel via AbortSignal rejects the flow with a friendly message", async () => {
  const controller = new AbortController();
  const { provider } = scriptedProvider();
  const { donePromise } = await captureAuthUrl(provider, controller.signal);
  controller.abort();
  await expect(donePromise).rejects.toThrow(/canceled/i);
});

test("an already-aborted signal rejects immediately without waiting", async () => {
  const controller = new AbortController();
  controller.abort();
  const { provider } = scriptedProvider();
  const { donePromise } = await captureAuthUrl(provider, controller.signal);
  await expect(donePromise).rejects.toThrow(/canceled/i);
});

test("a fired deadline (browser never redirects) rejects with a friendly timeout message", async () => {
  const { provider } = scriptedProvider({ timeoutMs: 30 });
  const { donePromise } = await captureAuthUrl(provider);
  await expect(donePromise).rejects.toThrow(/timed out/i);
});

test("connect() fails EARLY — no listener bound at all — when no client id/secret is configured", async () => {
  let fetchCalled = false;
  const provider = new GoogleAuthProvider({
    clientId: "",
    clientSecret: "",
    fetchImpl: (async () => {
      fetchCalled = true;
      throw new Error("should never fetch");
    }) as unknown as typeof fetch,
    openBrowser: async () => {},
  });
  let urlShown = false;
  await expect(
    provider.connect({ onAuthUrl: () => (urlShown = true) }),
  ).rejects.toThrow(GOOGLE_NOT_CONFIGURED_MESSAGE);
  expect(urlShown).toBe(false);
  expect(fetchCalled).toBe(false);
});

test("connect() fails early when only the client id (no secret) is configured — Google requires both for a Desktop client", async () => {
  const provider = new GoogleAuthProvider({
    clientId: "has-an-id",
    clientSecret: "",
    fetchImpl: (async () => {
      throw new Error("should never fetch");
    }) as unknown as typeof fetch,
    openBrowser: async () => {},
  });
  await expect(provider.connect({ onAuthUrl: () => {} })).rejects.toThrow(
    GOOGLE_NOT_CONFIGURED_MESSAGE,
  );
});

test("no thrown error message anywhere contains the client secret or the refresh token value", async () => {
  const SECRET = "CLIENT-SECRET-MUST-NOT-LEAK-ANYWHERE";
  const messages: string[] = [];

  // Case 1: state mismatch.
  {
    const { provider } = scriptedProvider({ clientSecret: SECRET });
    const { authUrl, donePromise } = await captureAuthUrl(provider);
    const parsed = new URL(authUrl);
    await fetch(`${parsed.searchParams.get("redirect_uri")}/?code=x&state=WRONG`);
    await donePromise.catch((e: Error) => messages.push(e.message));
  }

  // Case 2: consent declined.
  {
    const { provider } = scriptedProvider({ clientSecret: SECRET });
    const { authUrl, donePromise } = await captureAuthUrl(provider);
    const parsed = new URL(authUrl);
    const redirectUri = parsed.searchParams.get("redirect_uri")!;
    const state = parsed.searchParams.get("state")!;
    await fetch(`${redirectUri}/?error=access_denied&state=${state}`);
    await donePromise.catch((e: Error) => messages.push(e.message));
  }

  // Case 3: the token endpoint rejects the exchange (invalid_client).
  {
    const { provider } = scriptedProvider({
      clientSecret: SECRET,
      tokenResponse: { error: "invalid_client" },
      tokenStatus: 400,
    });
    const { authUrl, donePromise } = await captureAuthUrl(provider);
    const parsed = new URL(authUrl);
    const redirectUri = parsed.searchParams.get("redirect_uri")!;
    const state = parsed.searchParams.get("state")!;
    await fetch(`${redirectUri}/?code=x&state=${state}`);
    await donePromise.catch((e: Error) => messages.push(e.message));
  }

  expect(messages.length).toBe(3);
  for (const m of messages) {
    expect(m).not.toContain(SECRET);
    expect(m).not.toContain("sensitive-refresh-value");
    expect(m).not.toContain("test-access-token");
  }
});

test("a missing refresh_token in the token response is a hard failure (D4 requires one to store)", async () => {
  const { provider } = scriptedProvider({
    tokenResponse: { access_token: "at-only", expires_in: 3599 },
  });
  const { authUrl, donePromise } = await captureAuthUrl(provider);
  const parsed = new URL(authUrl);
  const redirectUri = parsed.searchParams.get("redirect_uri")!;
  const state = parsed.searchParams.get("state")!;
  await fetch(`${redirectUri}/?code=x&state=${state}`);
  await expect(donePromise).rejects.toThrow(/refresh token/i);
});

test("email lookup failure is non-fatal — connect still succeeds without a labeled email", async () => {
  const { provider } = scriptedProvider({ aboutBody: {} });
  const { authUrl, donePromise } = await captureAuthUrl(provider);
  const parsed = new URL(authUrl);
  const redirectUri = parsed.searchParams.get("redirect_uri")!;
  const state = parsed.searchParams.get("state")!;
  await fetch(`${redirectUri}/?code=x&state=${state}`);
  const cred = await donePromise;
  expect(cred.token).toBe("sensitive-refresh-value");
  expect(cred.username).toBeUndefined();
  expect(cred.label).toBe("Google Drive");
});
