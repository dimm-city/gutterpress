/**
 * POST /api/extension/versions and /api/extension/outdated (pre-release aware).
 *
 * `versions` feeds each npm row's version picker: every published version of
 * ONE package, newest first, pre-releases included (the SPA filters them by the
 * "Include pre-release versions" preference). `outdated` compares each pin
 * with npm's latest — or, with `includePrerelease`, the newest of any kind.
 *
 * The real lib runs; only the network is faked (a stubbed `globalThis.fetch`
 * answering the abbreviated packument), so nothing here can reach npm.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { registerHostServices, type HostServices } from "../../electron/server-bridge/host-services";
import { POST as outdatedRoute } from "../../src/routes/api/extension/outdated/+server";
import { POST as versionsRoute } from "../../src/routes/api/extension/versions/+server";
import { makeHostServices } from "../support/host-services-fake";
import { caught, request } from "../support/route-test-helpers";

const realFetch = globalThis.fetch;
let requested: string[];

/** A registry that knows `dimm-city-components` (latest = stable 1.1.0) and nothing else. */
function stubRegistry() {
  requested = [];
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requested.push(url);
    if (!url.endsWith("/dimm-city-components")) return new Response("not found", { status: 404 });
    const versions = Object.fromEntries(
      ["1.0.0", "1.2.0-alpha.1", "1.2.0-alpha.2", "1.1.0"].map((v) => [v, { name: "dimm-city-components", version: v }]),
    );
    return new Response(JSON.stringify({ name: "dimm-city-components", "dist-tags": { latest: "1.1.0" }, versions }));
  }) as typeof globalThis.fetch;
}

describe("POST /api/extension/versions", () => {
  beforeEach(stubRegistry);
  afterEach(() => {
    globalThis.fetch = realFetch;
  });
  const call = (body: unknown) => versionsRoute({ request: request(body) } as Parameters<typeof versionsRoute>[0]);

  test("returns every published version, newest first, pre-releases included", async () => {
    const response = await call({ name: "dimm-city-components" });
    expect(await response.json()).toEqual({
      ok: true,
      versions: ["1.2.0-alpha.2", "1.2.0-alpha.1", "1.1.0", "1.0.0"],
    });
    expect(requested).toHaveLength(1);
    expect(requested[0]).toContain("dimm-city-components");
  });

  test("a registry failure is data, not a 500", async () => {
    const response = await call({ name: "markdown-it-not-there" });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: false, message: 'npm package "markdown-it-not-there" was not found.' });
  });

  test("an offline registry is data too", async () => {
    globalThis.fetch = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof globalThis.fetch;
    const body = (await (await call({ name: "dimm-city-components" })).json()) as { ok: boolean; message: string };
    expect(body.ok).toBe(false);
    expect(body.message).toContain("Looking up dimm-city-components on npm failed (ECONNREFUSED)");
  });

  test("refuses anything but a bare npm package name, before any network call", async () => {
    for (const name of [undefined, "", "  ", 42, "dimm-city-components@1.0.0", "./plugins/x.js", "markdown-it-mark", "Not A Name"]) {
      expect((await caught(call({ name }))).status).toBe(400);
    }
    expect(requested).toEqual([]);
  });
});

describe("POST /api/extension/outdated", () => {
  let root: string;
  let projectDir: string;

  beforeEach(async () => {
    stubRegistry();
    root = await mkdtemp(path.join(tmpdir(), "Gutterpress-extension-outdated-"));
    projectDir = path.join(root, "project");
    await mkdir(projectDir, { recursive: true });
    await writeFile(path.join(projectDir, "manifest.yaml"), "extensions:\n  - dimm-city-components@1.0.0\n", "utf8");
    registerHostServices(makeHostServices({ fsGuard: { projectRoots: () => [projectDir] } }));
  });
  afterEach(async () => {
    globalThis.fetch = realFetch;
    registerHostServices(undefined as unknown as HostServices);
    await rm(root, { recursive: true, force: true });
  });
  const call = (body: unknown) => outdatedRoute({ request: request(body) } as Parameters<typeof outdatedRoute>[0]);

  test("compares with the latest dist-tag by default", async () => {
    const body = await (await call({ projectDir })).json();
    expect(body).toEqual({
      ok: true,
      checks: [{ use: "dimm-city-components@1.0.0", name: "dimm-city-components", current: "1.0.0", latest: "1.1.0", outdated: true }],
    });
  });

  test("compares with the newest version of any kind when includePrerelease is true", async () => {
    const body = (await (await call({ projectDir, includePrerelease: true })).json()) as { checks: Array<{ latest: string }> };
    expect(body.checks[0]!.latest).toBe("1.2.0-alpha.2");
  });

  test("only a literal true turns pre-releases on", async () => {
    const body = (await (await call({ projectDir, includePrerelease: "true" })).json()) as { checks: Array<{ latest: string }> };
    expect(body.checks[0]!.latest).toBe("1.1.0");
  });

  test("still refuses a directory outside the open book", async () => {
    const result = await caught(call({ projectDir: root }));
    expect(result.status).toBe(403);
  });
});
