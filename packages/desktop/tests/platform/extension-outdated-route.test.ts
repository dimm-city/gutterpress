/**
 * POST /api/extension/outdated: each npm pin against npm's latest — or, with
 * `includePrerelease`, the newest of any kind (the desktop asks for stable
 * versions; the option is the lib's, shared with `gutterpress ext outdated`).
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
import { makeHostServices } from "../support/host-services-fake";
import { caught, request } from "../support/route-test-helpers";

const realFetch = globalThis.fetch;

/** A registry that knows `dimm-city-components` (latest = stable 1.1.0) and nothing else. */
function stubRegistry() {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!url.endsWith("/dimm-city-components")) return new Response("not found", { status: 404 });
    const versions = Object.fromEntries(
      ["1.0.0", "1.2.0-alpha.1", "1.2.0-alpha.2", "1.1.0"].map((v) => [v, { name: "dimm-city-components", version: v }]),
    );
    return new Response(JSON.stringify({ name: "dimm-city-components", "dist-tags": { latest: "1.1.0" }, versions }));
  }) as typeof globalThis.fetch;
}

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
