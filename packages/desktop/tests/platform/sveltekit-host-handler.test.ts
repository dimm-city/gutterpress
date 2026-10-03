/**
 * The app:// handler (electron/sveltekit-host.ts registerAppProtocol): serves
 * build/client files from disk, hands everything else to the SvelteKit
 * Server in-process, and never reaches outside build/client. Driven the way
 * Electron drives it — the callback registered with protocol.handle is
 * captured and invoked per request — against a fake Server and a temp
 * client dir (the __setHostForTests seam), so no SvelteKit build is needed.
 *
 * Same electron mock superset as sveltekit-host.test.ts (see its NOTE on
 * `bun test --isolate` and `mock.module("electron", …)`).
 */
import { test, expect, mock, afterEach, beforeEach } from "bun:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { electronMock } from "../support/electron-mock";

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

const { registerAppProtocol, resolveClientFile, __setHostForTests } = await import(
  "../../electron/sveltekit-host"
);

let clientDir: string;
/** Every request the fake Server was handed. */
let responded: Request[] = [];

beforeEach(() => {
  clientDir = mkdtempSync(path.join(tmpdir(), "gp-client-"));
  mkdirSync(path.join(clientDir, "_app"));
  writeFileSync(path.join(clientDir, "_app", "start.js"), "console.log('spa')");
  writeFileSync(path.join(clientDir, "favicon.svg"), "<svg/>");
  responded = [];
  __setHostForTests({
    clientDir,
    server: {
      respond: async (req) => {
        responded.push(req);
        return new Response(JSON.stringify({ path: new URL(req.url).pathname }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
    },
  });
  registerAppProtocol();
});

afterEach(() => {
  __setHostForTests(null);
  rmSync(clientDir, { recursive: true, force: true });
});

test("a path naming a build/client file is served from disk, not routed", async () => {
  // The electron mock's net.fetch reads the file: URL it is given.
  const res = await capturedAppHandler!(new Request("app://local/_app/start.js"));
  expect(res.status).toBe(200);
  expect(await res.text()).toBe("console.log('spa')");
  expect(responded).toHaveLength(0);
});

test("the SPA shell and API routes go to Server.respond() with the app:// request as-is", async () => {
  for (const url of ["app://local/", "app://local/api/status", "app://local/api/remote/clone-repository"]) {
    const res = await capturedAppHandler!(new Request(url, { method: url.includes("/api/") ? "POST" : "GET" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ path: new URL(url).pathname });
  }
  expect(responded.map((r) => r.url)).toEqual([
    "app://local/",
    "app://local/api/status",
    "app://local/api/remote/clone-repository",
  ]);
});

test("a directory under build/client is not a file: it is routed, not served", async () => {
  const res = await capturedAppHandler!(new Request("app://local/_app"));
  expect(await res.json()).toEqual({ path: "/_app" });
});

test("resolveClientFile never leaves build/client", async () => {
  const outside = path.join(path.dirname(clientDir), "outside.txt");
  writeFileSync(outside, "secret");
  try {
    expect(await resolveClientFile(clientDir, "/../outside.txt")).toBeNull();
    expect(await resolveClientFile(clientDir, "/%2e%2e/outside.txt")).toBeNull();
    expect(await resolveClientFile(clientDir, "/_app/../../outside.txt")).toBeNull();
    expect(await resolveClientFile(clientDir, "/%ZZ")).toBeNull(); // malformed escape
    expect(await resolveClientFile(clientDir, "/favicon.svg")).toBe(path.join(clientDir, "favicon.svg"));
  } finally {
    rmSync(outside, { force: true });
  }
});

test("a non-'local' host is rejected (404) and never routed", async () => {
  const res = await capturedAppHandler!(new Request("app://evil/api/status"));
  expect(res.status).toBe(404);
  expect(responded).toHaveLength(0);
});

test("before the server has loaded, every app:// request gets the 503 startup page", async () => {
  __setHostForTests(null);
  const res = await capturedAppHandler!(new Request("app://local/"));
  expect(res.status).toBe(503);
  expect(await res.text()).toContain("still starting");
});

test("a Server.respond() throw becomes the 500 page naming the cause", async () => {
  __setHostForTests({
    clientDir,
    server: {
      respond: async () => {
        throw new Error("boom", { cause: new Error("ECONNRESET-ish") });
      },
    },
  });
  const res = await capturedAppHandler!(new Request("app://local/api/x", { method: "POST" }));
  expect(res.status).toBe(500);
  const text = await res.text();
  expect(text).toContain("boom");
  expect(text).toContain("ECONNRESET-ish");
});
