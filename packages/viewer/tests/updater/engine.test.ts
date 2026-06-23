// ──────────────────────────────────────────────────────────────────────────
// engine.test.ts — end-to-end tests for the npm-sourced runtime updater.
//
// Strategy:
//   1. mock.module("electron") FIRST so app.getPath("userData") is a per-test
//      temp dir (clean slate, never touches real user data).
//   2. Stand up a fixture npm registry (packument + tarball endpoints) and point
//      the updater at it via PRINT_MD_UPDATER_FEED_URL. Tarballs are REAL gzipped
//      USTAR archives and integrity is the REAL sha512 — the override does not
//      weaken verification, it only redirects the feed. The full
//      check→download→verify→extract→stage→promote→rollback path runs for real.
// ──────────────────────────────────────────────────────────────────────────

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { gzipSync } from "fflate";

const electronMock = { userData: path.join(os.tmpdir(), "eng-test-default") };
mock.module("electron", () => ({
  app: {
    getPath: (key: string) =>
      key === "userData" ? electronMock.userData : path.join(os.tmpdir(), `electron-${key}`),
  },
}));

// Import AFTER the electron mock is registered.
const {
  checkForUpdate,
  downloadAndStage,
  promoteStaged,
  rollback,
  pruneVersions,
  getStatus,
  readStaged,
} = await import("../../electron/updater/index.ts");
const { readPointer, readState, writeState, readBaselineVersion, webRuntimeDir } =
  await import("../../electron/updater/web-runtime.ts");

// ── Fixture npm registry ──────────────────────────────────────────────────

let server: Server;
let base: string;
let packument: unknown;
const tarballs = new Map<string, Uint8Array>();

function tarBlock(name: string, body: Uint8Array): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  header.set(enc.encode(name.slice(0, 100)), 0);
  header.set(enc.encode(body.length.toString(8).padStart(11, "0")), 124);
  header[156] = "0".charCodeAt(0);
  const data = new Uint8Array(Math.ceil(body.length / 512) * 512);
  data.set(body);
  return new Uint8Array([...header, ...data]);
}

function buildTgz(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const blocks: number[] = [];
  for (const [name, contents] of Object.entries(files)) {
    blocks.push(...tarBlock(name, enc.encode(contents)));
  }
  blocks.push(...new Uint8Array(1024));
  return gzipSync(new Uint8Array(blocks));
}

const ssri = (bytes: Uint8Array) =>
  `sha512-${createHash("sha512").update(bytes).digest("base64")}`;

interface PublishOpts {
  requiresDesktopApi?: number;
  files?: Record<string, string>;
  integrityOverride?: string;
}

/** Build + register a tarball and return its version metadata for the packument. */
function publish(version: string, opts: PublishOpts = {}) {
  const files = opts.files ?? {
    "package/package.json": JSON.stringify({ name: "@dimm-city/print-md", version }),
    "package/dist/index.js": `export const VERSION = ${JSON.stringify(version)};`,
    "package/ui/index.html": `<!doctype html><title>${version}</title>`,
  };
  const tgz = buildTgz(files);
  tarballs.set(version, tgz);
  return {
    version,
    dist: {
      tarball: `${base}/t/${encodeURIComponent(version)}.tgz`,
      integrity: opts.integrityOverride ?? ssri(tgz),
    },
    ...(opts.requiresDesktopApi !== undefined
      ? { printmd: { requiresDesktopApi: opts.requiresDesktopApi } }
      : {}),
  };
}

function setRegistry(
  distTags: Record<string, string>,
  versions: Array<{ version: string }>,
) {
  packument = {
    "dist-tags": distTags,
    versions: Object.fromEntries(versions.map((m) => [m.version, m])),
  };
}

let BASE = "0.0.0";
const NEWER = "999.0.0";

beforeAll(async () => {
  server = createServer((req, res) => {
    const url = req.url ?? "";
    if (url.startsWith("/t/")) {
      const version = decodeURIComponent(url.slice(3).replace(/\.tgz$/, ""));
      const tgz = tarballs.get(version);
      if (!tgz) {
        res.statusCode = 404;
        res.end("not found");
        return;
      }
      res.setHeader("content-type", "application/octet-stream");
      res.end(Buffer.from(tgz));
      return;
    }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(packument));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("no server address");
  base = `http://127.0.0.1:${addr.port}`;
  process.env.PRINT_MD_UPDATER_FEED_URL = base;
  BASE = await readBaselineVersion(); // baked baseline (real build/update-manifest.json)
});

afterAll(() => {
  delete process.env.PRINT_MD_UPDATER_FEED_URL;
  server?.close();
});

beforeEach(async () => {
  electronMock.userData = await mkdtemp(path.join(os.tmpdir(), "eng-"));
  tarballs.clear();
  packument = { "dist-tags": {}, versions: {} };
});

afterEach(async () => {
  await rm(electronMock.userData, { recursive: true, force: true }).catch(() => {});
});

async function isFile(p: string): Promise<boolean> {
  try {
    return (await stat(p)).isFile();
  } catch {
    return false;
  }
}

// ── checkForUpdate ─────────────────────────────────────────────────────────

describe("checkForUpdate", () => {
  test("returns the candidate when the latest version is newer", async () => {
    setRegistry({ latest: NEWER }, [publish(NEWER, { requiresDesktopApi: 2 })]);
    const { available } = await checkForUpdate();
    expect(available?.version).toBe(NEWER);
    expect(available?.requiresDesktopApi).toBe(2);
    expect(available?.integrity).toMatch(/^sha512-/);
  });

  test("'already up to date' when latest <= baseline", async () => {
    setRegistry({ latest: BASE }, [publish(BASE)]);
    const { available, reason } = await checkForUpdate();
    expect(available).toBeNull();
    expect(reason).toBe("already up to date");
  });

  test("'needs newer app' when requiresDesktopApi exceeds the shell", async () => {
    setRegistry({ latest: NEWER }, [publish(NEWER, { requiresDesktopApi: 99 })]);
    const { available, reason } = await checkForUpdate();
    expect(available).toBeNull();
    expect(reason).toBe("needs newer app");
  });

  test("respects the downgrade floor (minimumSeenVersion)", async () => {
    const state = await readState();
    state.minimumSeenVersion = NEWER;
    await writeState(state);
    setRegistry({ latest: NEWER }, [publish(NEWER)]);
    const { available, reason } = await checkForUpdate();
    expect(available).toBeNull();
    expect(reason).toBe("version below downgrade floor");
  });

  test("skips a version blocklisted by repeated health failures", async () => {
    const state = await readState();
    state.failedVersions[NEWER] = { reason: "bad", count: 2 };
    await writeState(state);
    setRegistry({ latest: NEWER }, [publish(NEWER)]);
    const { available, reason } = await checkForUpdate();
    expect(available).toBeNull();
    expect(reason).toBe("version previously failed");
  });

  test("benign null when the channel has no published version", async () => {
    setRegistry({}, []);
    const { available, reason } = await checkForUpdate();
    expect(available).toBeNull();
    expect(reason).toContain("latest");
  });
});

// ── downloadAndStage ───────────────────────────────────────────────────────

describe("downloadAndStage", () => {
  test("downloads, verifies integrity, and stages dist/ + ui/", async () => {
    setRegistry({ latest: NEWER }, [publish(NEWER)]);
    const { available } = await checkForUpdate();
    const res = await downloadAndStage(available!);
    expect(res.staged).toBe(true);

    const dir = path.join(webRuntimeDir(), "versions", NEWER);
    expect(await isFile(path.join(dir, "dist", "index.js"))).toBe(true);
    expect(await isFile(path.join(dir, "ui", "index.html"))).toBe(true);
    expect((await readStaged())?.version).toBe(NEWER);
  });

  test("skips the unused cli.js and .d.ts entries", async () => {
    setRegistry({ latest: NEWER }, [
      publish(NEWER, {
        files: {
          "package/package.json": JSON.stringify({ name: "@dimm-city/print-md", version: NEWER }),
          "package/dist/index.js": "export const x = 1;",
          "package/dist/index.d.ts": "export declare const x: number;",
          "package/dist/cli.js": "#!/usr/bin/env node",
          "package/ui/index.html": "<!doctype html>",
        },
      }),
    ]);
    const { available } = await checkForUpdate();
    await downloadAndStage(available!);
    const dir = path.join(webRuntimeDir(), "versions", NEWER);
    expect(await isFile(path.join(dir, "dist", "index.js"))).toBe(true);
    expect(await isFile(path.join(dir, "dist", "cli.js"))).toBe(false);
    expect(await isFile(path.join(dir, "dist", "index.d.ts"))).toBe(false);
  });

  test("rejects a tarball whose bytes do not match the registry integrity", async () => {
    setRegistry({ latest: NEWER }, [publish(NEWER, { integrityOverride: "sha512-AAAA" })]);
    const { available } = await checkForUpdate();
    const res = await downloadAndStage(available!);
    expect(res.staged).toBe(false);
    expect(res.reason).toContain("integrity");
    expect(await readStaged()).toBeNull();
  });

  test("rejects a package missing dist/index.js or ui/index.html", async () => {
    setRegistry({ latest: NEWER }, [
      publish(NEWER, {
        files: {
          "package/package.json": JSON.stringify({ name: "@dimm-city/print-md", version: NEWER }),
          "package/dist/index.js": "export const x = 1;", // no ui/
        },
      }),
    ]);
    const { available } = await checkForUpdate();
    const res = await downloadAndStage(available!);
    expect(res.staged).toBe(false);
    expect(res.reason).toContain("missing");
  });
});

// ── promote / rollback / status / prune ─────────────────────────────────────

describe("promote → status → rollback", () => {
  async function stage(version: string) {
    setRegistry({ latest: version }, [publish(version)]);
    const { available } = await checkForUpdate();
    expect(available?.version).toBe(version);
    expect((await downloadAndStage(available!)).staged).toBe(true);
  }

  test("promoteStaged sets current and getStatus reports it", async () => {
    await stage(NEWER);
    const { promoted, version } = await promoteStaged();
    expect(promoted).toBe(true);
    expect(version).toBe(NEWER);
    expect((await readPointer("current"))?.version).toBe(NEWER);
    expect((await getStatus()).currentVersion).toBe(NEWER);
    expect(await readStaged()).toBeNull();
  });

  test("a second promote moves current→previous", async () => {
    await stage("999.0.0");
    await promoteStaged();
    await stage("999.1.0");
    await promoteStaged();
    expect((await readPointer("current"))?.version).toBe("999.1.0");
    expect((await readPointer("previous"))?.version).toBe("999.0.0");
  });

  test("rollback restores previous and records the failure", async () => {
    await stage("999.0.0");
    await promoteStaged();
    await stage("999.1.0");
    await promoteStaged();

    expect(await rollback("probe failed")).toBe(true);
    expect((await readPointer("current"))?.version).toBe("999.0.0");
    const state = await readState();
    expect(state.failedVersions["999.1.0"]).toBeDefined();
  });

  test("rollback with no previous drops the current pointer (→ baked runtime)", async () => {
    await stage(NEWER);
    await promoteStaged();
    expect(await rollback("probe failed")).toBe(true);
    expect(await readPointer("current")).toBeNull();
    expect((await getStatus()).currentVersion).toBe(BASE);
  });

  test("pruneVersions removes version dirs that are not current/previous", async () => {
    await stage(NEWER);
    await promoteStaged();
    const stray = path.join(webRuntimeDir(), "versions", "0.0.1");
    await mkdir(stray, { recursive: true });

    await pruneVersions();
    expect(await stat(stray).then(() => true).catch(() => false)).toBe(false);
    expect(
      await stat(path.join(webRuntimeDir(), "versions", NEWER))
        .then((s) => s.isDirectory())
        .catch(() => false),
    ).toBe(true);
  });
});
