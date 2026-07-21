import { test, expect, spyOn } from "bun:test";
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
  /** Parsed JSON bodies of POSTs, keyed by URL fragment, for request asserts. */
  const requestBodies: Array<{ url: string; body: Record<string, unknown> }> = [];
  let pollIndex = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push(u);
    if (init?.body) {
      requestBodies.push({ url: u, body: JSON.parse(String(init.body)) });
    }
    if (u.includes("login/device/code")) return jsonResponse(DEVICE_CODE_BODY);
    if (u.includes("login/oauth/access_token")) {
      const body = tokenResponses[Math.min(pollIndex, tokenResponses.length - 1)];
      pollIndex++;
      return jsonResponse(body);
    }
    if (u.includes("api.github.com/user")) return jsonResponse(userBody);
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
  const provider = new GitHubAuthProvider({
    clientId: "test-client-id",
    fetchImpl,
    sleepImpl: async (ms) => {
      sleeps.push(ms);
    },
  });
  return { provider, sleeps, calls, requestBodies };
}

test("happy path: device code surfaces via callback, token returned as credential", async () => {
  const { provider } = scriptedProvider([{ access_token: "gho_tok" }]);
  let info: DeviceCodeInfo | null = null;
  const cred = await provider.connect({ onUserCode: (i) => (info = i) });
  expect(info!.userCode).toBe("ABCD-1234");
  expect(info!.verificationUri).toBe("https://github.com/login/device");
  expect(cred.host).toBe("github.com");
  expect(cred.kind).toBe("github-oauth");
  expect(cred.token).toBe("gho_tok");
  expect(cred.username).toBe("octocat");
});

test("device/code request carries the client id and the repo scope (OAuth App model)", async () => {
  const { provider, requestBodies } = scriptedProvider([{ access_token: "gho_tok" }]);
  await provider.connect({ onUserCode: () => {} });
  const deviceCode = requestBodies.find((r) => r.url.includes("login/device/code"));
  expect(deviceCode!.body["client_id"]).toBe("test-client-id");
  expect(deviceCode!.body["scope"]).toBe("repo");
});

test("authorization_pending keeps polling until success", async () => {
  const { provider, sleeps } = scriptedProvider([
    { error: "authorization_pending" },
    { error: "authorization_pending" },
    { access_token: "gho_tok" },
  ]);
  const cred = await provider.connect({ onUserCode: () => {} });
  expect(cred.token).toBe("gho_tok");
  // Three polls → three sleeps at the server interval (5s).
  expect(sleeps).toEqual([5000, 5000, 5000]);
});

test("slow_down adds 5 seconds to the polling interval", async () => {
  const { provider, sleeps } = scriptedProvider([
    { error: "slow_down" },
    { access_token: "gho_tok" },
  ]);
  await provider.connect({ onUserCode: () => {} });
  expect(sleeps[0]).toBe(5000);
  expect(sleeps[1]).toBe(10000); // 5s + 5s after slow_down
});

test("slow_down honors the server-sent interval as authoritative (RFC 8628 §3.5)", async () => {
  const { provider, sleeps } = scriptedProvider([
    { error: "slow_down", interval: 8 },
    { error: "slow_down", interval: 12 },
    { access_token: "gho_tok" },
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

// --- safeFetch signal composition at the CALL SITE (guards against a revert
// to the old `init.signal ?? AbortSignal.timeout(...)` pattern, which handed
// the caller's RAW signal to fetch and silently dropped the timeout) -------

test("with a caller signal, fetch receives a COMPOSED signal (not the raw caller signal) that the caller's abort still aborts", async () => {
  const controller = new AbortController();
  let captured: AbortSignal | undefined;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("login/device/code")) {
      captured = init?.signal ?? undefined;
      return jsonResponse(DEVICE_CODE_BODY);
    }
    if (u.includes("login/oauth/access_token")) return jsonResponse({ access_token: "gho_tok" });
    if (u.includes("api.github.com/user")) return jsonResponse({ login: "octocat" });
    throw new Error(`unexpected url ${u}`);
  }) as unknown as typeof fetch;
  const provider = new GitHubAuthProvider({
    clientId: "test-client-id",
    fetchImpl,
    sleepImpl: async () => {},
  });
  await provider.connect({ onUserCode: () => {}, signal: controller.signal });

  expect(captured).toBeDefined();
  // The revert hands the caller's raw signal straight through — this is the
  // assertion that catches it.
  expect(captured).not.toBe(controller.signal);
  // ...but composition must preserve caller cancellation: aborting the
  // caller's controller aborts the signal fetch actually received.
  expect(captured!.aborted).toBe(false);
  controller.abort();
  expect(captured!.aborted).toBe(true);
});

test("with a caller signal present and fetch never settling, the composed timeout still rejects the call", async () => {
  // REQUEST_TIMEOUT_MS (15s) is not injectable at this seam, so the timeout
  // half of the composition is driven by stubbing AbortSignal.timeout to
  // return a signal we abort manually with a TimeoutError reason — exactly
  // what the real timer would do, minus the 15s wait.
  const callerController = new AbortController();
  const fakeTimeout = new AbortController();
  const requestedMs: number[] = [];
  const timeoutSpy = spyOn(AbortSignal, "timeout").mockImplementation(((ms: number) => {
    requestedMs.push(ms);
    return fakeTimeout.signal;
  }) as typeof AbortSignal.timeout);
  try {
    // Mimic real fetch: never settle on its own, reject with the signal's
    // reason once the signal it was HANDED aborts. Under the reverted
    // pattern the raw caller signal is handed through, the fake timeout
    // firing reaches nothing, and the call hangs.
    const fetchImpl = (async (_url: string | URL | Request, init?: RequestInit) => {
      const signal = init?.signal;
      return await new Promise<Response>((_resolve, reject) => {
        if (signal?.aborted) return reject(signal.reason);
        signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }) as unknown as typeof fetch;
    const provider = new GitHubAuthProvider({
      clientId: "test-client-id",
      fetchImpl,
      sleepImpl: async () => {},
    });
    const promise = provider.connect({
      onUserCode: () => {},
      signal: callerController.signal,
    });
    // Fire the "timeout" (the abort listener is registered synchronously
    // before connect() returns its promise; a pre-aborted signal is also
    // handled by the executor's `aborted` check).
    fakeTimeout.abort(
      Object.assign(new Error("The operation timed out."), { name: "TimeoutError" }),
    );
    // Race against a short real timer so a revert fails fast and explicitly
    // ("hung") instead of tripping the suite-level test timeout.
    const outcome = await Promise.race([
      promise.then(
        () => "resolved" as const,
        (e: unknown) => e,
      ),
      new Promise<"hung">((r) => setTimeout(() => r("hung"), 250)),
    ]);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toMatch(/couldn't reach github/i);
    // The composed deadline is the shared 15s request budget.
    expect(requestedMs[0]).toBe(15_000);
  } finally {
    timeoutSpy.mockRestore();
  }
});

test("network failure maps to the offline message and never leaks internals", async () => {
  const provider = new GitHubAuthProvider({
    clientId: "test-client-id",
    fetchImpl: (async () => {
      throw new TypeError("fetch failed: ENOTFOUND github.com");
    }) as unknown as typeof fetch,
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
      fetchImpl: (async () => new Response("{}", { status })) as unknown as typeof fetch,
    });
  const cred = {
    host: "github.com",
    kind: "github-oauth" as const,
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
