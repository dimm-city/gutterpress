import { test, expect } from "bun:test";
import { GitHubAuthProvider, type DeviceCodeInfo } from "./github-auth";

const DEVICE_CODE_BODY = {
  device_code: "dev123",
  user_code: "ABCD-1234",
  verification_uri: "https://github.com/login/device",
  expires_in: 900,
  interval: 5,
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/**
 * Build a provider whose fetch returns scripted responses per URL pattern.
 * `tokenResponses` are consumed one per poll of login/oauth/access_token.
 */
function scriptedProvider(tokenResponses: unknown[], userBody: unknown = { login: "octocat" }) {
  const sleeps: number[] = [];
  const calls: string[] = [];
  let pollIndex = 0;
  const fetchImpl = (async (url: RequestInfo | URL) => {
    const u = String(url);
    calls.push(u);
    if (u.includes("login/device/code")) return jsonResponse(DEVICE_CODE_BODY);
    if (u.includes("login/oauth/access_token")) {
      const body = tokenResponses[Math.min(pollIndex, tokenResponses.length - 1)];
      pollIndex++;
      return jsonResponse(body);
    }
    if (u.includes("api.github.com/user")) return jsonResponse(userBody);
    throw new Error(`unexpected url ${u}`);
  }) as typeof fetch;
  const provider = new GitHubAuthProvider({
    clientId: "test-client-id",
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { provider, sleeps, calls };
}

test("happy path: device code surfaces via callback, token returned as credential", async () => {
  const { provider } = scriptedProvider([{ access_token: "ghu_tok" }]);
  let info: DeviceCodeInfo | null = null;
  const cred = await provider.connect({ onUserCode: (i) => (info = i) });
  expect(info!.userCode).toBe("ABCD-1234");
  expect(info!.verificationUri).toBe("https://github.com/login/device");
  expect(cred.host).toBe("github.com");
  expect(cred.kind).toBe("github-app");
  expect(cred.token).toBe("ghu_tok");
  expect(cred.username).toBe("octocat");
});

test("authorization_pending keeps polling until success", async () => {
  const { provider, sleeps } = scriptedProvider([
    { error: "authorization_pending" },
    { error: "authorization_pending" },
    { access_token: "ghu_tok" },
  ]);
  const cred = await provider.connect({ onUserCode: () => {} });
  expect(cred.token).toBe("ghu_tok");
  // Three polls → three sleeps at the server interval (5s).
  expect(sleeps).toEqual([5000, 5000, 5000]);
});

test("slow_down adds 5 seconds to the polling interval", async () => {
  const { provider, sleeps } = scriptedProvider([
    { error: "slow_down" },
    { access_token: "ghu_tok" },
  ]);
  await provider.connect({ onUserCode: () => {} });
  expect(sleeps[0]).toBe(5000);
  expect(sleeps[1]).toBe(10000); // 5s + 5s after slow_down
});

test("slow_down honors the server-sent interval as authoritative (RFC 8628 §3.5)", async () => {
  const { provider, sleeps } = scriptedProvider([
    { error: "slow_down", interval: 8 },
    { error: "slow_down", interval: 12 },
    { access_token: "ghu_tok" },
  ]);
  await provider.connect({ onUserCode: () => {} });
  // Initial 5s, then server interval + 5 each time: 8+5, 12+5.
  expect(sleeps).toEqual([5000, 13000, 17000]);
});

test("expired_token maps to a friendly retry message", async () => {
  const { provider } = scriptedProvider([{ error: "expired_token" }]);
  await expect(provider.connect({ onUserCode: () => {} })).rejects.toThrow(
    /code expired.*connect github again/i,
  );
});

test("access_denied maps to a friendly declined message", async () => {
  const { provider } = scriptedProvider([{ error: "access_denied" }]);
  await expect(provider.connect({ onUserCode: () => {} })).rejects.toThrow(
    /declined/i,
  );
});

test("abort signal cancels the flow with a friendly message", async () => {
  const controller = new AbortController();
  const { provider } = scriptedProvider([{ error: "authorization_pending" }]);
  const promise = provider.connect({
    onUserCode: () => controller.abort(),
    signal: controller.signal,
  });
  await expect(promise).rejects.toThrow(/canceled/i);
});

test("network failure maps to the offline message and never leaks internals", async () => {
  const provider = new GitHubAuthProvider({
    clientId: "test-client-id",
    fetchImpl: (async () => {
      throw new TypeError("fetch failed: ENOTFOUND github.com");
    }) as typeof fetch,
    sleepImpl: async () => {},
  });
  await expect(provider.connect({ onUserCode: () => {} })).rejects.toThrow(
    /couldn't reach github/i,
  );
});

test("validate returns true on 200, false on 401/403", async () => {
  const make = (status: number) =>
    new GitHubAuthProvider({
      clientId: "test-client-id",
      fetchImpl: (async () => new Response("{}", { status })) as typeof fetch,
    });
  const cred = {
    host: "github.com",
    kind: "github-app" as const,
    token: "t",
    createdAt: 0,
  };
  expect(await make(200).validate(cred)).toBe(true);
  expect(await make(401).validate(cred)).toBe(false);
  expect(await make(403).validate(cred)).toBe(false);
});

test("matches only github.com", () => {
  const { provider } = scriptedProvider([]);
  expect(provider.matches(new URL("https://github.com/o/r.git"))).toBe(true);
  expect(provider.matches(new URL("https://gitea.example.com/o/r.git"))).toBe(false);
});
