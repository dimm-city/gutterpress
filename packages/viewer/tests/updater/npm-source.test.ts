import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { resolveCandidate } from "../../electron/updater/npm-source.ts";

// Fixture registry: serves a packument for @dimm-city/print-md. Exercises the
// real check path via the PRINT_MD_UPDATER_FEED_URL override (no network).
let server: Server;
let base: string;
let packument: unknown;

beforeAll(async () => {
  server = createServer((_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(packument));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server address");
  base = `http://127.0.0.1:${addr.port}`;
  process.env.PRINT_MD_UPDATER_FEED_URL = base;
});

afterAll(() => {
  delete process.env.PRINT_MD_UPDATER_FEED_URL;
  server?.close();
});

describe("resolveCandidate from the npm registry", () => {
  test("resolves the stable (latest) dist-tag with tarball + integrity + compat", async () => {
    packument = {
      "dist-tags": { latest: "0.6.0", next: "0.7.0-rc.1" },
      versions: {
        "0.6.0": {
          version: "0.6.0",
          dist: { tarball: `${base}/t/0.6.0.tgz`, integrity: "sha512-AAAA" },
          printmd: { requiresDesktopApi: 2 },
        },
        "0.7.0-rc.1": {
          version: "0.7.0-rc.1",
          dist: { tarball: `${base}/t/0.7.0.tgz`, integrity: "sha512-BBBB" },
        },
      },
    };
    const { candidate } = await resolveCandidate("stable");
    expect(candidate).toEqual({
      version: "0.6.0",
      tarball: `${base}/t/0.6.0.tgz`,
      integrity: "sha512-AAAA",
      requiresDesktopApi: 2,
    });
  });

  test("beta channel resolves the 'next' dist-tag; requiresDesktopApi defaults to 0", async () => {
    const { candidate } = await resolveCandidate("beta");
    expect(candidate?.version).toBe("0.7.0-rc.1");
    expect(candidate?.requiresDesktopApi).toBe(0);
  });

  test("returns null with a reason when the channel has no dist-tag", async () => {
    packument = { "dist-tags": { latest: "1.0.0" }, versions: {} };
    const { candidate, reason } = await resolveCandidate("beta");
    expect(candidate).toBeNull();
    expect(reason).toContain("next");
  });

  test("returns null when the version metadata is incomplete", async () => {
    packument = {
      "dist-tags": { latest: "1.0.0" },
      versions: { "1.0.0": { version: "1.0.0", dist: { tarball: "x" } } }, // no integrity
    };
    const { candidate, reason } = await resolveCandidate("stable");
    expect(candidate).toBeNull();
    expect(reason).toContain("incomplete");
  });
});
