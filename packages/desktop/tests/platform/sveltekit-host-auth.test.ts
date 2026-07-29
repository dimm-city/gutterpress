/**
 * Regression tests for P1 review (PR #98) finding #2: the adapter-node HTTP
 * bridge (electron/sveltekit-host.ts) had no caller authentication — any
 * local process that discovered the OS-assigned loopback port could call the
 * same privileged `src/routes/api/**\/+server.ts` routes the renderer uses
 * (fs, git, GitHub token, ...) — and the app:// protocol handler proxied
 * requests to that server regardless of `url.host`, so `app://evil/...`
 * reached the privileged routes exactly like `app://local/...` did.
 *
 * Pre-fix (commit 2a3726d, `git show 2a3726d:packages/desktop/electron/sveltekit-host.ts`):
 *   - `createServer(handler)` wired the raw SvelteKit handler straight to
 *     `node:http`'s createServer with no auth check at all — any request that
 *     reached the port got a real response.
 *   - `registerAppProtocol()` computed `targetUrl` from `url.pathname + url.search`
 *     only; `url.host`/`url.hostname` was never read or checked, so a request
 *     for ANY app:// host was proxied to the loopback server unconditionally.
 *
 * The fix (electron/sveltekit-host.ts):
 *   - `isAuthorizedRequest` / `withTokenAuth` — the loopback server now
 *     rejects (401) any request lacking the `x-gutterpress-token` header, or
 *     carrying the wrong value.
 *   - `registerAppProtocol` now rejects (404) any app:// request whose host
 *     isn't exactly "local", before ever constructing a proxy request.
 *   - `buildProxyRequest` injects the session bearer token into every request
 *     the app:// handler forwards to the loopback server.
 *
 * main.ts mints the per-session token (node:crypto `randomBytes`) once at
 * process start and passes it to both `startSvelteKitServer` and
 * `registerAppProtocol` — see the `skAuthToken` constant in main.ts.
 */
import { test, expect, mock, afterEach } from "bun:test";
import { electronMock } from "../support/electron-mock";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

// Same electron mock superset as tests/platform/sveltekit-host.test.ts (see its
// NOTE on `bun test --isolate` not fully sandboxing `mock.module("electron", …)`
// registrations between files that all touch the "electron" specifier — keep
// this in sync with that file's superset). Extended with a real `protocol.handle`
// so registerAppProtocol's registered callback can be captured and invoked
// directly, the same way Electron itself would invoke it per app:// request.
let capturedAppHandler: ((req: Request) => Promise<Response>) | null = null;
mock.module("electron", () =>
  electronMock({
    // Real protocol.handle so registerAppProtocol's callback can be captured
    // and invoked directly, the way Electron would per app:// request.
    protocol: {
      handle: (scheme: string, cb: (req: Request) => Promise<Response>) => {
        if (scheme === "app") capturedAppHandler = cb;
      },
    },
  }),
);

const {
  isAuthorizedRequest,
  withTokenAuth,
  buildProxyRequest,
  registerAppProtocol,
  __setSkServerPortForTests,
} = await import("../../electron/sveltekit-host");

afterEach(() => {
  __setSkServerPortForTests(null);
});

// ── isAuthorizedRequest: pure header-check ──────────────────────────────────

test("isAuthorizedRequest is false when the token header is absent", () => {
  expect(isAuthorizedRequest({}, "secret")).toBe(false);
});

test("isAuthorizedRequest is false when the token header doesn't match", () => {
  expect(isAuthorizedRequest({ "x-gutterpress-token": "wrong" }, "secret")).toBe(false);
});

test("isAuthorizedRequest is true when the token header matches exactly", () => {
  expect(isAuthorizedRequest({ "x-gutterpress-token": "secret" }, "secret")).toBe(true);
});

// ── withTokenAuth: the loopback server itself rejects unauthenticated callers
//    (finding #2a) — exercised against a REAL node:http server so this proves
//    the exploit ("any local process that discovers the port") is closed. ──

test("FINDING #2a repro: a request to the loopback server with no token is rejected (401), never reaching the handler", async () => {
  let handlerCalled = false;
  const server = createServer(
    withTokenAuth((_req, res) => {
      handlerCalled = true;
      res.statusCode = 200;
      res.end("ok");
    }, "correct-token"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    // Simulates "any local process discovering the loopback port" (no header
    // at all) — this is exactly the pre-fix vulnerable request shape.
    const res = await fetch(`http://127.0.0.1:${port}/api/fs/read`);
    expect(res.status).toBe(401);
    expect(handlerCalled).toBe(false);
  } finally {
    server.close();
  }
});

test("a request to the loopback server with the WRONG token is also rejected (401)", async () => {
  const server = createServer(
    withTokenAuth((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    }, "correct-token"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fs/read`, {
      headers: { "x-gutterpress-token": "guessed-wrong" },
    });
    expect(res.status).toBe(401);
  } finally {
    server.close();
  }
});

test("a request to the loopback server WITH the correct token reaches the real handler", async () => {
  const server = createServer(
    withTokenAuth((_req, res) => {
      res.statusCode = 200;
      res.end("ok");
    }, "correct-token"),
  );
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/fs/read`, {
      headers: { "x-gutterpress-token": "correct-token" },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  } finally {
    server.close();
  }
});

// ── buildProxyRequest: the app:// handler injects the token on the way out ──

test("buildProxyRequest rewrites the target to the loopback port and injects the bearer token header", () => {
  const incoming = new Request("app://local/api/foo?x=1", { method: "GET" });
  const proxied = buildProxyRequest(incoming, 54321, "the-token");
  expect(proxied.url).toBe("http://127.0.0.1:54321/api/foo?x=1");
  expect(proxied.headers.get("x-gutterpress-token")).toBe("the-token");
});

// ── registerAppProtocol: host validation (finding #2b) ──────────────────────

test("FINDING #2b repro: app:// handler rejects a non-'local' host (app://evil/...) with 404 and never proxies it", async () => {
  registerAppProtocol("the-token");
  expect(capturedAppHandler).not.toBeNull();

  const originalFetch = globalThis.fetch;
  let fetchWasCalled = false;
  globalThis.fetch = (async (...args: Parameters<typeof fetch>) => {
    fetchWasCalled = true;
    return originalFetch(...args);
  }) as typeof fetch;

  try {
    // Even with the server "up" (a live port), an untrusted host must never
    // reach the proxy — pre-fix, this exact request WOULD have been forwarded
    // to the privileged loopback server, since url.host was never checked.
    __setSkServerPortForTests(65535);
    const res = await capturedAppHandler!(new Request("app://evil/api/fs/read"));
    expect(res.status).toBe(404);
    expect(fetchWasCalled).toBe(false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("app:// handler accepts host 'local' and forwards the token header to the loopback server", async () => {
  // A fake loopback server standing in for the real adapter-node handler:
  // echoes back whether it saw the correct token.
  const server = createServer((req, res) => {
    const ok = req.headers["x-gutterpress-token"] === "the-token";
    res.statusCode = ok ? 200 : 401;
    res.end(ok ? "authorized" : "unauthorized");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  registerAppProtocol("the-token");
  expect(capturedAppHandler).not.toBeNull();
  __setSkServerPortForTests(port);

  try {
    const res = await capturedAppHandler!(new Request("app://local/api/whoami"));
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("authorized");
  } finally {
    server.close();
  }
});

test("app:// handler still returns 503 (startup page, no proxy attempt) for host 'local' before the server has started", async () => {
  registerAppProtocol("the-token");
  __setSkServerPortForTests(null);
  const res = await capturedAppHandler!(new Request("app://local/"));
  expect(res.status).toBe(503);
});
