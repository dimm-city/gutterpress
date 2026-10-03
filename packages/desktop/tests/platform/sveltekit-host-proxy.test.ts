/**
 * The app:// → loopback proxy's transport (electron/sveltekit-host.ts
 * `sendProxyRequest`). It is plain `node:http`, not Node's `fetch`: undici
 * abandons a request whose response headers take > 5 min and reports only
 * "TypeError: fetch failed" — which is what "Open book" from GitHub showed
 * when a clone ran long (0.11.10-alpha.3). These pin the transport's
 * contract against a live loopback server: bodies and headers round-trip
 * both ways, bodyless statuses don't throw, and a failure names its cause.
 *
 * Same electron mock superset as sveltekit-host-auth.test.ts (see its NOTE
 * on `bun test --isolate` and `mock.module("electron", …)`).
 */
import { test, expect, mock, afterEach } from "bun:test";
import { electronMock } from "../support/electron-mock";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

let capturedAppHandler: ((req: Request) => Promise<Response>) | null = null;
mock.module("electron", () =>
  electronMock({
    protocol: {
      handle: (scheme: string, cb: (req: Request) => Promise<Response>) => {
        if (scheme === "app") capturedAppHandler = cb;
      },
    },
  }),
);

const { sendProxyRequest, registerAppProtocol, __setSkServerPortForTests } = await import(
  "../../electron/sveltekit-host"
);

let server: Server | null = null;
afterEach(() => {
  __setSkServerPortForTests(null);
  server?.close();
  server = null;
});

async function listen(handler: Parameters<typeof createServer>[1]): Promise<number> {
  server = createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", () => resolve()));
  return (server.address() as AddressInfo).port;
}

test("a POST body, its headers and the JSON reply round-trip through the transport", async () => {
  const port = await listen((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      res.writeHead(201, { "content-type": "application/json", "x-echo-token": String(req.headers["x-gutterpress-token"]) });
      res.end(JSON.stringify({ method: req.method, path: req.url, body: JSON.parse(body), host: req.headers.host }));
    });
  });
  const res = await sendProxyRequest(
    new Request(`http://127.0.0.1:${port}/api/thing?x=1`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-gutterpress-token": "tok" },
      body: JSON.stringify({ hello: "world" }),
    }),
  );
  expect(res.status).toBe(201);
  expect(res.headers.get("content-type")).toBe("application/json");
  expect(res.headers.get("x-echo-token")).toBe("tok");
  const echoed = await res.json();
  expect(echoed).toMatchObject({ method: "POST", path: "/api/thing?x=1", body: { hello: "world" } });
  // The loopback server sees its own host, never the app:// one.
  expect(echoed.host).toBe(`127.0.0.1:${port}`);
});

test("a bodyless reply (204) is wrapped without throwing", async () => {
  const port = await listen((_req, res) => {
    res.writeHead(204);
    res.end();
  });
  const res = await sendProxyRequest(new Request(`http://127.0.0.1:${port}/api/noop`, { method: "POST", body: "{}" }));
  expect(res.status).toBe(204);
  expect(await res.text()).toBe("");
});

test("a reply that arrives slowly is still delivered (no client-side timeout)", async () => {
  const port = await listen((_req, res) => {
    setTimeout(() => {
      res.writeHead(200, { "content-type": "text/plain" });
      res.end("late");
    }, 300);
  });
  const res = await sendProxyRequest(new Request(`http://127.0.0.1:${port}/slow`));
  expect(await res.text()).toBe("late");
});

test("app:// handler's error page names the transport failure's cause, not just 'failed'", async () => {
  // A port nothing listens on: the loopback hop fails with ECONNREFUSED.
  const port = await listen(() => {});
  server!.close();
  server = null;
  registerAppProtocol("the-token");
  __setSkServerPortForTests(port);
  const res = await capturedAppHandler!(new Request("app://local/api/remote/clone-repository", { method: "POST", body: "{}" }));
  expect(res.status).toBe(502);
  expect(res.headers.get("content-type")).toContain("text/html");
  expect(await res.text()).toContain("ECONNREFUSED");
});
