// ──────────────────────────────────────────────────────────────────────────
// engine.test.ts — tests for updater/index.ts: zip path-traversal guard,
// checkForUpdate gates (downgrade / failed-version / compat), promoteStaged,
// rollback, and getStatus.
//
// Mocking strategy:
//   1. mock.module("electron") → app.getPath("userData") → per-test temp dir.
//   2. global.fetch is replaced per test group with a custom spy/stub.
//   3. Keypairs are generated in-test; verifyManifestSignature is called
//      with the correct public key so no stub of the verify layer is needed.
// ──────────────────────────────────────────────────────────────────────────

import { describe, expect, test, beforeEach, afterEach, afterAll } from "bun:test";
import { mock } from "bun:test";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { gzipSync } from "node:zlib";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";
// Real verify module, captured BEFORE any mock.module() of it below, so the
// file-level afterAll can restore it. mock.module() persists for the rest of
// the process — and leaks into OTHER test files (verify.test.ts) when bun
// test runs without --isolate. The function references are copied at load
// time (a plain `import * as ns` is a LIVE binding that bun rewrites when
// the mock lands, so the namespace object can't be used for restoration).
// Safe to import here: verify.js only uses node:crypto (no electron).
import { sha256Hex as realSha256Hex, verifyManifestSignature as realVerifyManifestSignature, verifyBundle as realVerifyBundle } from "../../electron/updater/verify.js";

const realVerifyExports = {
  sha256Hex: realSha256Hex,
  verifyManifestSignature: realVerifyManifestSignature,
  verifyBundle: realVerifyBundle,
};

afterAll(() => {
  mock.module("../../electron/updater/verify.js", () => realVerifyExports);
});

// ── Electron mock (MUST precede web-runtime / engine imports) ────────────

const electronMock = { userData: path.join(os.tmpdir(), "eng-test-default") };

mock.module("electron", () => ({
  app: {
    getPath: (key: string) => {
      if (key === "userData") return electronMock.userData;
      return path.join(os.tmpdir(), `eng-${key}`);
    },
  },
}));

// ── Imports (after mock) ─────────────────────────────────────────────────

const {
  checkForUpdate,
  downloadAndStage,
  promoteStaged,
  rollback,
  pruneVersions,
  getStatus,
  readStaged,
  writeStaged,
  clearStaged,
  WEB_UI_PACKAGE,
} = await import("../../electron/updater/index.js");

const {
  readPointer,
  writePointer,
  readState,
  writeState,
  ensureLayout,
  webRuntimeDir,
  readBaselineVersion,
} = await import("../../electron/updater/web-runtime.js");

const { DESKTOP_API } = await import("../../electron/updater/contract.js");

// ── Helpers ───────────────────────────────────────────────────────────────

/** Create a fresh temp dir and point userData at it. */
async function makeTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "eng-test-"));
  electronMock.userData = dir;
  return dir;
}

/** Remove a temp dir. */
async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

/** Generate an Ed25519 keypair and return PEM strings. */
function makeKeypair(): { publicKeyPem: string; privateKey: crypto.KeyObject } {
  const { privateKey, publicKey } = crypto.generateKeyPairSync("ed25519");
  return {
    publicKeyPem: publicKey.export({ type: "spki", format: "pem" }) as string,
    privateKey,
  };
}

/** Build a valid UpdateManifest object. */
function makeManifest(opts: {
  version: string;
  requiresDesktopApi?: number;
  sha256?: string;
  size?: number;
}) {
  const sha256 = opts.sha256 ?? "a".repeat(64);
  const size = opts.size ?? 100;
  return {
    schemaVersion: 1,
    kind: "web-ui-bundle",
    version: opts.version,
    requiresDesktopApi: opts.requiresDesktopApi ?? 1,
    releasedAt: "2026-06-04T00:00:00Z",
    assets: { bundle: { name: "web-ui-bundle.zip", sha256, size } },
  };
}

/** Sign manifestBytes with privateKey → base64 sig string. */
function signManifest(bytes: Buffer, privateKey: crypto.KeyObject): string {
  return crypto.sign(null, bytes, privateKey).toString("base64");
}

/** Build a valid adapter-node runtime zip buffer using fflate. */
function makeValidZipBuffer(): Buffer {
  const entries: Record<string, Uint8Array> = {
    "handler.js": new TextEncoder().encode("export const handler = () => new Response('ok');"),
    "client/app.js": new TextEncoder().encode("console.log('client');"),
    "server/index.js": new TextEncoder().encode("export const routes = [];"),
  };
  return Buffer.from(zipSync(entries));
}

/** Build a malicious zip with a path-traversal entry. */
function makeTraversalZipBuffer(): Buffer {
    const entries: Record<string, Uint8Array> = {
      "../escape.txt": new TextEncoder().encode("I escaped!"),
      "handler.js": new TextEncoder().encode("export const handler = () => new Response('ok');"),
      "client/app.js": new TextEncoder().encode("console.log('client');"),
      "server/index.js": new TextEncoder().encode("export const routes = [];"),
    };
  return Buffer.from(zipSync(entries));
}

type FetchResponse = {
  ok: boolean;
  status?: number;
  statusText?: string;
  json?: () => Promise<unknown>;
  arrayBuffer?: () => Promise<ArrayBuffer>;
  text?: () => Promise<string>;
};

/** Replace global fetch with a function that returns the given response map. */
function mockFetch(
  handler: (url: string) => FetchResponse
): () => void {
  const original = global.fetch;
  (global as unknown as Record<string, unknown>).fetch = async (url: string) => {
    const r = handler(url);
    return {
      ok: r.ok,
      status: r.status ?? (r.ok ? 200 : 400),
      statusText: r.statusText ?? (r.ok ? "OK" : "Bad Request"),
      json: r.json ?? (() => Promise.resolve(null)),
      arrayBuffer: r.arrayBuffer ?? (() => Promise.resolve(new ArrayBuffer(0))),
      text: r.text ?? (() => Promise.resolve("")),
    };
  };
  return () => {
    (global as unknown as Record<string, unknown>).fetch = original;
  };
}

// Helper to compute sha256 hex
function sha256Hex(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

function tarHeader(name: string, size: number): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name.slice(0, 100), 0, "utf8");
  header.write("0000777\0", 100, "ascii");
  header.write("0000000\0", 108, "ascii");
  header.write("0000000\0", 116, "ascii");
  header.write(size.toString(8).padStart(11, "0") + "\0", 124, "ascii");
  header.write("00000000000\0", 136, "ascii");
  header.fill(0x20, 148, 156);
  header[156] = "0".charCodeAt(0);
  header.write("ustar\0", 257, "ascii");
  header.write("00", 263, "ascii");
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i]!;
  header.write(sum.toString(8).padStart(6, "0") + "\0 ", 148, "ascii");
  return header;
}

function makeNpmTarball(files: Record<string, Buffer>): Buffer {
  const chunks: Buffer[] = [];
  for (const [name, bytes] of Object.entries(files)) {
    chunks.push(tarHeader(name, bytes.length));
    chunks.push(bytes);
    const rem = bytes.length % 512;
    if (rem !== 0) {
      chunks.push(Buffer.alloc(512 - rem, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0));
  return gzipSync(Buffer.concat(chunks));
}

function makeRegistryMetadata(version: string, tarball: Buffer, tarballUrl: string, channel: "stable" | "rc" | "beta" = "stable") {
  const distTags: Record<string, string> = {};
  if (channel === "stable") distTags.latest = version;
  if (channel === "rc") distTags.rc = version;
  if (channel === "beta") distTags.beta = version;
  return {
    "dist-tags": distTags,
    versions: {
      [version]: {
        version,
        dist: {
          tarball: tarballUrl,
          integrity: `sha512-${crypto.createHash("sha512").update(tarball).digest("base64")}`,
        },
      },
    },
  };
}

// ── readStaged / writeStaged / clearStaged ────────────────────────────────

describe("readStaged / writeStaged / clearStaged", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    await cleanupDir(tmpDir);
  });

  test("round-trips a staged pointer", async () => {
    await writeStaged({ version: "2.0.0", path: "/staged/2.0.0" });
    const s = await readStaged();
    expect(s).not.toBeNull();
    expect(s!.version).toBe("2.0.0");
    expect(s!.path).toBe("/staged/2.0.0");
  });

  test("readStaged returns null when no file exists", async () => {
    const s = await readStaged();
    expect(s).toBeNull();
  });

  test("clearStaged removes the staged.json file", async () => {
    await writeStaged({ version: "2.0.0", path: "/staged/2.0.0" });
    await clearStaged();
    const s = await readStaged();
    expect(s).toBeNull();
  });

  test("clearStaged does not throw when nothing is staged", async () => {
    await expect(clearStaged()).resolves.toBeUndefined();
  });
});

// ── promoteStaged ─────────────────────────────────────────────────────────

describe("promoteStaged", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    await cleanupDir(tmpDir);
  });

  test("returns promoted:false when nothing is staged", async () => {
    const result = await promoteStaged();
    expect(result.promoted).toBe(false);
  });

  test("promotes staged → current when staged has a valid runtime bundle", async () => {
    const bundleDir = path.join(tmpDir, "web-runtime", "versions", "3.0.0");
    await mkdir(path.join(bundleDir, "client"), { recursive: true });
    await mkdir(path.join(bundleDir, "server"), { recursive: true });
    await writeFile(path.join(bundleDir, "handler.js"), "export const handler = () => new Response('ok');", "utf8");
    await writeFile(path.join(bundleDir, "client", "app.js"), "console.log('client');", "utf8");
    await writeFile(path.join(bundleDir, "server", "index.js"), "export const routes = [];", "utf8");
    await writeStaged({ version: "3.0.0", path: bundleDir });

    const result = await promoteStaged();
    expect(result.promoted).toBe(true);
    expect(result.version).toBe("3.0.0");

    const current = await readPointer("current");
    expect(current!.version).toBe("3.0.0");
    const staged = await readStaged();
    expect(staged).toBeNull();
  });

  test("moves old current to previous on promote", async () => {
    // Set up initial current
    const v1Dir = path.join(tmpDir, "web-runtime", "versions", "1.0.0");
    await mkdir(path.join(v1Dir, "client"), { recursive: true });
    await mkdir(path.join(v1Dir, "server"), { recursive: true });
    await writeFile(path.join(v1Dir, "handler.js"), "export const handler = () => new Response('ok');", "utf8");
    await writeFile(path.join(v1Dir, "client", "app.js"), "console.log('client');", "utf8");
    await writeFile(path.join(v1Dir, "server", "index.js"), "export const routes = [];", "utf8");
    await writePointer("current", { version: "1.0.0", path: v1Dir });

    // Stage 2.0.0
    const v2Dir = path.join(tmpDir, "web-runtime", "versions", "2.0.0");
    await mkdir(path.join(v2Dir, "client"), { recursive: true });
    await mkdir(path.join(v2Dir, "server"), { recursive: true });
    await writeFile(path.join(v2Dir, "handler.js"), "export const handler = () => new Response('ok');", "utf8");
    await writeFile(path.join(v2Dir, "client", "app.js"), "console.log('client');", "utf8");
    await writeFile(path.join(v2Dir, "server", "index.js"), "export const routes = [];", "utf8");
    await writeStaged({ version: "2.0.0", path: v2Dir });

    await promoteStaged();

    const current = await readPointer("current");
    const previous = await readPointer("previous");
    expect(current!.version).toBe("2.0.0");
    expect(previous!.version).toBe("1.0.0");
  });

  test("clears staged after successful promote", async () => {
    const bundleDir = path.join(tmpDir, "web-runtime", "versions", "5.0.0");
    await mkdir(path.join(bundleDir, "client"), { recursive: true });
    await mkdir(path.join(bundleDir, "server"), { recursive: true });
    await writeFile(path.join(bundleDir, "handler.js"), "export const handler = () => new Response('ok');", "utf8");
    await writeFile(path.join(bundleDir, "client", "app.js"), "console.log('client');", "utf8");
    await writeFile(path.join(bundleDir, "server", "index.js"), "export const routes = [];", "utf8");
    await writeStaged({ version: "5.0.0", path: bundleDir });

    await promoteStaged();
    const staged = await readStaged();
    expect(staged).toBeNull();
  });

  test("returns promoted:false and clears staged when handler.js is missing", async () => {
    const bundleDir = path.join(tmpDir, "web-runtime", "versions", "4.0.0");
    await mkdir(path.join(bundleDir, "client"), { recursive: true });
    await mkdir(path.join(bundleDir, "server"), { recursive: true });
    // Intentionally no handler.js
    await writeFile(path.join(bundleDir, "client", "app.js"), "console.log('client');", "utf8");
    await writeFile(path.join(bundleDir, "server", "index.js"), "export const routes = [];", "utf8");
    await writeStaged({ version: "4.0.0", path: bundleDir });

    const result = await promoteStaged();
    expect(result.promoted).toBe(false);
    const staged = await readStaged();
    expect(staged).toBeNull();
  });
});

// ── rollback ──────────────────────────────────────────────────────────────

describe("rollback", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    await cleanupDir(tmpDir);
  });

  test("records failed version with an incrementing count", async () => {
    await writePointer("current", { version: "2.0.0", path: "/v2" });

    await rollback("crash on startup");

    const state = await readState();
    // Retry-aware: first failure is { reason, count: 1 }, not a permanent block.
    expect(state.failedVersions["2.0.0"]).toEqual({
      reason: "crash on startup",
      count: 1,
    });
  });

  test("restores previous as current when previous exists", async () => {
    await writePointer("current", { version: "2.0.0", path: "/v2" });
    await writePointer("previous", { version: "1.0.0", path: "/v1" });

    await rollback("bad render");

    const current = await readPointer("current");
    expect(current!.version).toBe("1.0.0");
  });

  test("removes current pointer when no previous exists", async () => {
    await writePointer("current", { version: "2.0.0", path: "/v2" });

    await rollback("fatal crash");

    const current = await readPointer("current");
    expect(current).toBeNull();
  });

  test("clears previous pointer after rollback", async () => {
    await writePointer("current", { version: "2.0.0", path: "/v2" });
    await writePointer("previous", { version: "1.0.0", path: "/v1" });

    await rollback("bad");

    const previous = await readPointer("previous");
    expect(previous).toBeNull();
  });

  test("returns true on success", async () => {
    const result = await rollback("test");
    expect(result).toBe(true);
  });
});

// ── pruneVersions ─────────────────────────────────────────────────────────

describe("pruneVersions", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    await cleanupDir(tmpDir);
  });

  test("removes stale version directories not in current or previous", async () => {
    const versionsDir = path.join(webRuntimeDir(), "versions");

    // Create version dirs
    const v1Dir = path.join(versionsDir, "1.0.0");
    const v2Dir = path.join(versionsDir, "2.0.0");
    const v3Dir = path.join(versionsDir, "3.0.0");
    await mkdir(v1Dir, { recursive: true });
    await mkdir(v2Dir, { recursive: true });
    await mkdir(v3Dir, { recursive: true });

    // current=2.0.0, previous=1.0.0 → 3.0.0 should be pruned
    await writePointer("current", { version: "2.0.0", path: v2Dir });
    await writePointer("previous", { version: "1.0.0", path: v1Dir });

    await pruneVersions();

    // v1 and v2 should remain
    const v1Exists = await stat(v1Dir).then(() => true).catch(() => false);
    const v2Exists = await stat(v2Dir).then(() => true).catch(() => false);
    const v3Exists = await stat(v3Dir).then(() => true).catch(() => false);
    expect(v1Exists).toBe(true);
    expect(v2Exists).toBe(true);
    expect(v3Exists).toBe(false);
  });

  test("does not throw when versions dir does not exist", async () => {
    // Ensure the versions dir doesn't exist
    const versionsDir = path.join(webRuntimeDir(), "versions");
    await rm(versionsDir, { recursive: true, force: true });
    await expect(pruneVersions()).resolves.toBeUndefined();
  });
});

// ── getStatus ─────────────────────────────────────────────────────────────

describe("getStatus", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    await cleanupDir(tmpDir);
  });

  test("returns valid status shape with null fields when no data exists", async () => {
    const status = await getStatus();
    expect(typeof status.currentVersion).toBe("string"); // at least "0.0.0"
    expect(status.stagedVersion).toBeNull();
    expect(status.phase).toBe("idle");
    expect(status.lastCheckAt).toBeNull();
    expect(status.error).toBeNull();
  });

  test("reports staged version when staged.json is present", async () => {
    await writeStaged({ version: "5.0.0", path: "/v5" });
    const status = await getStatus();
    expect(status.stagedVersion).toBe("5.0.0");
  });

  test("reports currentVersion from pointer", async () => {
    await writePointer("current", { version: "2.5.0", path: "/v2.5" });
    const status = await getStatus();
    expect(status.currentVersion).toBe("2.5.0");
  });
});

// ── zip path-traversal guard ──────────────────────────────────────────────
//
// Strategy: build a signed manifest + malicious zip in-test, mock fetch to
// return them, call downloadAndStage, and assert the operation is REJECTED.
// We sign the manifest with a test keypair and supply it as the publicKeyPem
// override via the verify module — HOWEVER, verifyManifestSignature in the
// engine is called with the hard-coded WEB_UI_PUBLIC_KEY from contract.ts, not
// with an override. To make the signature pass in tests we need to either:
//  (a) stub verifyManifestSignature, or
//  (b) patch WEB_UI_PUBLIC_KEY in contract.ts at test time.
//
// Bun's mock.module supports (a): we mock the verify module so signature
// always returns true, letting us test the traversal guard in isolation.
// ─────────────────────────────────────────────────────────────────────────

describe("downloadAndStage – zip path-traversal guard", () => {
  let tmpDir: string;
  let restoreFetch: (() => void) | null = null;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
    // Clear staged state from previous tests
    await clearStaged();
  });

  afterEach(async () => {
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    await cleanupDir(tmpDir);
  });

  function buildFetchHandlerForZip(zipBuffer: Buffer, version: string): (url: string) => FetchResponse {
    const manifestObj = makeManifest({
      version,
      sha256: sha256Hex(zipBuffer),
      size: zipBuffer.length,
    });
    const manifestBytes = Buffer.from(JSON.stringify(manifestObj));
    const { privateKey } = makeKeypair();
    const sig = signManifest(manifestBytes, privateKey);
    const registryMetaUrl = `https://registry.npmjs.org/${WEB_UI_PACKAGE}`;
    const tarballUrl = `https://registry.example.com/${version}.tgz`;
    const tarball = makeNpmTarball({
      "package/update-manifest.json": manifestBytes,
      "package/update-manifest.json.sig": Buffer.from(sig + "\n"),
      "package/web-ui-bundle.zip": zipBuffer,
    });
    const registryResponse = makeRegistryMetadata(version, tarball, tarballUrl);

    return (url: string): FetchResponse => {
      if (url === registryMetaUrl) {
        return {
          ok: true,
          json: () => Promise.resolve(registryResponse),
        };
      }
      if (url === tarballUrl) {
        return {
          ok: true,
          arrayBuffer: () => Promise.resolve(tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength) as ArrayBuffer),
        };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    };
  }

  // NOTE: Because the engine uses WEB_UI_PUBLIC_KEY from contract.ts (a
  // placeholder key), signature verification will fail in tests unless we also
  // mock the verify module or find another path. We test the traversal guard
  // by arranging for the fake manifest to sign correctly with a test key AND
  // mocking verifyManifestSignature to return true — the traversal guard lives
  // AFTER integrity verification, so the guard logic is exercised.
  //
  // We do this by mocking the verify module:
  test("rejects a zip containing a path-traversal entry (../escape.txt)", async () => {
    // Mock verifyManifestSignature to always return true for this test
    mock.module("../../electron/updater/verify.js", () => ({
      sha256Hex: (buf: Buffer | Uint8Array): string =>
        crypto.createHash("sha256").update(buf).digest("hex"),
      verifyManifestSignature: () => true,
      verifyBundle: (zipBytes: Buffer, expected: { sha256: string; size: number }) => {
        const actual = crypto.createHash("sha256").update(zipBytes).digest("hex");
        if (actual !== expected.sha256)
          return { ok: false, reason: `SHA-256 mismatch` };
        if (zipBytes.length !== expected.size)
          return { ok: false, reason: `size mismatch` };
        return { ok: true };
      },
    }));

    const maliciousZip = makeTraversalZipBuffer();
    const version = "99.0.1";
    restoreFetch = mockFetch(buildFetchHandlerForZip(maliciousZip, version));

    const result = await downloadAndStage(makeManifest({
      version,
      sha256: sha256Hex(maliciousZip),
      size: maliciousZip.length,
    }) as Parameters<typeof downloadAndStage>[0]);

    expect(result.staged).toBe(false);
    expect(result.reason).toContain("unsafe zip entry rejected");
    expect(result.reason).toContain("../escape.txt");

    // Verify no file escaped the staging dir
    const escapedFile = path.join(webRuntimeDir(), "..", "escape.txt");
    const escaped = await stat(escapedFile).then(() => true).catch(() => false);
    expect(escaped).toBe(false);
  });

  test("accepts a valid zip with handler.js, client/, and server/", async () => {
    mock.module("../../electron/updater/verify.js", () => ({
      sha256Hex: (buf: Buffer | Uint8Array): string =>
        crypto.createHash("sha256").update(buf).digest("hex"),
      verifyManifestSignature: () => true,
      verifyBundle: (zipBytes: Buffer, expected: { sha256: string; size: number }) => {
        const actual = crypto.createHash("sha256").update(zipBytes).digest("hex");
        if (actual !== expected.sha256)
          return { ok: false, reason: `SHA-256 mismatch` };
        if (zipBytes.length !== expected.size)
          return { ok: false, reason: `size mismatch` };
        return { ok: true };
      },
    }));

    const validZip = makeValidZipBuffer();
    const version = "99.1.0";
    restoreFetch = mockFetch(buildFetchHandlerForZip(validZip, version));

    const result = await downloadAndStage(makeManifest({
      version,
      sha256: sha256Hex(validZip),
      size: validZip.length,
    }) as Parameters<typeof downloadAndStage>[0]);

    expect(result.staged).toBe(true);

    // Verify staged.json was written
    const staged = await readStaged();
    expect(staged).not.toBeNull();
    expect(staged!.version).toBe(version);
  });
});

// ── checkForUpdate gates ──────────────────────────────────────────────────
//
// These tests mock npm registry responses and use a mocked verify layer.
// We test: newer → available; same/older → not available; failed version →
// skipped; requiresDesktopApi too high → blocked.
// ─────────────────────────────────────────────────────────────────────────

describe("checkForUpdate – gates", () => {
  let tmpDir: string;
  let restoreFetch: (() => void) | null = null;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    await cleanupDir(tmpDir);
  });

  const registryMetaUrl = `https://registry.npmjs.org/${WEB_UI_PACKAGE}`;

  function makeFetchForVersion(
    version: string,
    requiresDesktopApi = 1,
    channel: "stable" | "rc" | "beta" = "stable"
  ) {
    const manifestObj = makeManifest({ version, requiresDesktopApi });
    const manifestBytes = Buffer.from(JSON.stringify(manifestObj));
    const { privateKey } = makeKeypair();
    const sig = signManifest(manifestBytes, privateKey);
    const tarballUrl = `https://registry.example.com/${version}.tgz`;
    const zip = makeValidZipBuffer();
    const tarball = makeNpmTarball({
      "package/update-manifest.json": manifestBytes,
      "package/update-manifest.json.sig": Buffer.from(sig + "\n"),
      "package/web-ui-bundle.zip": zip,
    });
    const registryResponse = makeRegistryMetadata(version, tarball, tarballUrl, channel);

    return (url: string): FetchResponse => {
      if (url === registryMetaUrl) {
        return {
          ok: true,
          json: () => Promise.resolve(registryResponse),
        };
      }
      if (url === tarballUrl) {
        return {
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(
              tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength) as ArrayBuffer
            ),
        };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    };
  }

  // Always mock verifyManifestSignature to return true so we can test the
  // higher-level gates independently of the real key.
  function stubVerify() {
    mock.module("../../electron/updater/verify.js", () => ({
      sha256Hex: (buf: Buffer | Uint8Array): string =>
        crypto.createHash("sha256").update(buf).digest("hex"),
      verifyManifestSignature: () => true,
      verifyBundle: () => ({ ok: true }),
    }));
  }

  test("returns available manifest when a strictly newer version exists", async () => {
    stubVerify();
    // Ensure current version is 0.0.0 (no pointer file, baseline "0.0.0")
    restoreFetch = mockFetch(makeFetchForVersion("1.0.0"));

    const result = await checkForUpdate();
    expect(result.available).not.toBeNull();
    expect(result.available!.version).toBe("1.0.0");
  });

  test("returns available:null when newest == current version", async () => {
    stubVerify();
    // Write current pointer to "1.0.0"
    const v1Dir = path.join(webRuntimeDir(), "versions", "1.0.0");
    await mkdir(v1Dir, { recursive: true });
    await writePointer("current", { version: "1.0.0", path: v1Dir });

    restoreFetch = mockFetch(makeFetchForVersion("1.0.0"));

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("up to date");
  });

  test("returns available:null when newest is older than current version", async () => {
    stubVerify();
    const v2Dir = path.join(webRuntimeDir(), "versions", "2.0.0");
    await mkdir(v2Dir, { recursive: true });
    await writePointer("current", { version: "2.0.0", path: v2Dir });

    restoreFetch = mockFetch(makeFetchForVersion("1.0.0")); // older

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("up to date");
  });

  test("does NOT offer a published version <= the baked baseline when a stale OLDER pointer exists", async () => {
    // Regression: a promoted pointer left in userData that is OLDER than the
    // baked-in baseline (the desktop app shipped a newer UI than was last
    // hot-swapped) must NOT make the updater treat the loaded UI as the stale
    // pointer and re-pull an equal/older published bundle over it. The loaded
    // version is max(baseline, pointer); compare against THAT.
    stubVerify();
    const baseline = await readBaselineVersion();
    const staleDir = path.join(webRuntimeDir(), "versions", "0.0.1");
    await mkdir(staleDir, { recursive: true });
    await writePointer("current", { version: "0.0.1", path: staleDir });

    // Newest published == the baked baseline (newer than the stale 0.0.1 pointer
    // but NOT newer than what is actually loaded).
    restoreFetch = mockFetch(makeFetchForVersion(baseline));

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("up to date");
  });

  test("skips a version that is in state.failedVersions", async () => {
    stubVerify();
    // Mark 1.5.0 as failed
    const state = await readState();
    state.failedVersions["1.5.0"] = "crash";
    await writeState(state);

    restoreFetch = mockFetch(makeFetchForVersion("1.5.0"));

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("previously failed");
  });

  test("blocks when requiresDesktopApi > DESKTOP_API", async () => {
    stubVerify();
    restoreFetch = mockFetch(makeFetchForVersion("2.0.0", DESKTOP_API + 1));

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("needs newer app");
  });

  test("allows when requiresDesktopApi === DESKTOP_API", async () => {
    stubVerify();
    restoreFetch = mockFetch(makeFetchForVersion("3.0.0", DESKTOP_API));

    const result = await checkForUpdate();
    expect(result.available).not.toBeNull();
    expect(result.available!.requiresDesktopApi).toBe(DESKTOP_API);
  });

  test("returns available:null with reason when no package is found for the channel", async () => {
    stubVerify();
    restoreFetch = mockFetch((_url: string) => ({
      ok: true,
      json: () => Promise.resolve({ "dist-tags": {}, versions: {} }),
    }));

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("no web-ui package found");
  });

  test("returns available:null when npm registry returns non-200", async () => {
    stubVerify();
    restoreFetch = mockFetch((_url: string) => ({
      ok: false,
      status: 503,
      statusText: "Service Unavailable",
    }));

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    // Phase is error, reason is set
    expect(result.reason).toBeTruthy();
  });

  test("skips version below minimumSeenVersion (downgrade floor)", async () => {
    stubVerify();
    const state = await readState();
    state.minimumSeenVersion = "2.0.0";
    await writeState(state);

    restoreFetch = mockFetch(makeFetchForVersion("1.9.0")); // below floor

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("downgrade floor");
  });

  test("records lastCheckAt after check", async () => {
    stubVerify();
    restoreFetch = mockFetch(makeFetchForVersion("1.0.0"));
    await checkForUpdate();

    const state = await readState();
    expect(state.lastCheckAt).not.toBeNull();
    expect(typeof state.lastCheckAt).toBe("string");
  });
});

// ── PRINT_MD_UPDATER_FEED_URL override ────────────────────────────────────

describe("checkForUpdate – feed URL override", () => {
  let tmpDir: string;
  let restoreFetch: (() => void) | null = null;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    delete process.env.PRINT_MD_UPDATER_FEED_URL;
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    await cleanupDir(tmpDir);
  });

  test("fetches npm registry metadata from the override URL when set", async () => {
    mock.module("../../electron/updater/verify.js", () => ({
      sha256Hex: realSha256Hex,
      verifyManifestSignature: () => true,
      verifyBundle: () => ({ ok: true }),
    }));
    process.env.PRINT_MD_UPDATER_FEED_URL = "http://127.0.0.1:9/registry";

    const seen: string[] = [];
    const original = global.fetch;
    (global as unknown as Record<string, unknown>).fetch = async (url: string) => {
      seen.push(String(url));
      return {
        ok: true,
        status: 200,
        statusText: "OK",
        json: () => Promise.resolve({ "dist-tags": {}, versions: {} }),
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(0)),
        text: () => Promise.resolve(""),
      };
    };
    restoreFetch = () => {
      (global as unknown as Record<string, unknown>).fetch = original;
    };

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(seen[0]).toBe("http://127.0.0.1:9/registry");
    expect(seen[0]).not.toContain("api.github.com/repos");
  });
});

describe("checkForUpdate – channel selection", () => {
  let tmpDir: string;
  let restoreFetch: (() => void) | null = null;
  const registryMetaUrl = `https://registry.npmjs.org/${WEB_UI_PACKAGE}`;

  function makeFetchForVersion(
    version: string,
    channel: "stable" | "rc" | "beta"
  ) {
    const manifestObj = makeManifest({ version, requiresDesktopApi: 1 });
    const manifestBytes = Buffer.from(JSON.stringify(manifestObj));
    const { privateKey } = makeKeypair();
    const sig = signManifest(manifestBytes, privateKey);
    const tarballUrl = `https://registry.example.com/${version}.tgz`;
    const zip = makeValidZipBuffer();
    const tarball = makeNpmTarball({
      "package/update-manifest.json": manifestBytes,
      "package/update-manifest.json.sig": Buffer.from(sig + "\n"),
      "package/web-ui-bundle.zip": zip,
    });
    const registryResponse = makeRegistryMetadata(version, tarball, tarballUrl, channel);

    return (url: string): FetchResponse => {
      if (url === registryMetaUrl) {
        return {
          ok: true,
          json: () => Promise.resolve(registryResponse),
        };
      }
      if (url === tarballUrl) {
        return {
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(
              tarball.buffer.slice(tarball.byteOffset, tarball.byteOffset + tarball.byteLength) as ArrayBuffer
            ),
        };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    };
  }

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    delete process.env.PRINT_MD_UPDATER_CHANNEL;
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    await cleanupDir(tmpDir);
  });

  test("stable channel uses dist-tags.latest", async () => {
    mock.module("../../electron/updater/verify.js", () => ({
      sha256Hex: realSha256Hex,
      verifyManifestSignature: () => true,
      verifyBundle: () => ({ ok: true }),
    }));
    restoreFetch = mockFetch(makeFetchForVersion("4.0.0", "stable"));

    const result = await checkForUpdate("stable");
    expect(result.available?.version).toBe("4.0.0");
  });

  test("rc channel uses dist-tags.rc", async () => {
    mock.module("../../electron/updater/verify.js", () => ({
      sha256Hex: realSha256Hex,
      verifyManifestSignature: () => true,
      verifyBundle: () => ({ ok: true }),
    }));
    restoreFetch = mockFetch(makeFetchForVersion("4.1.0-rc.2", "rc"));

    const result = await checkForUpdate("rc");
    expect(result.available?.version).toBe("4.1.0-rc.2");
  });

  test("beta channel uses dist-tags.beta", async () => {
    mock.module("../../electron/updater/verify.js", () => ({
      sha256Hex: realSha256Hex,
      verifyManifestSignature: () => true,
      verifyBundle: () => ({ ok: true }),
    }));
    restoreFetch = mockFetch(makeFetchForVersion("4.2.0-beta.1", "beta"));

    const result = await checkForUpdate("beta");
    expect(result.available?.version).toBe("4.2.0-beta.1");
  });
});

// ── error surfacing: package problems set phase=error for getStatus() ─────

describe("checkForUpdate – package problem reasons surface via getStatus().error", () => {
  let tmpDir: string;
  let restoreFetch: (() => void) | null = null;

  beforeEach(async () => {
    tmpDir = await makeTempDir();
    await ensureLayout();
  });

  afterEach(async () => {
    if (restoreFetch) {
      restoreFetch();
      restoreFetch = null;
    }
    await cleanupDir(tmpDir);
  });

  const registryMetaUrl = `https://registry.npmjs.org/${WEB_UI_PACKAGE}`;

  test("a package tarball missing its manifest files reports phase=error", async () => {
    mock.module("../../electron/updater/verify.js", () => realVerifyExports);
    const zip = makeValidZipBuffer();
    const tarballUrl = "https://registry.example.com/bad.tgz";
    const badTarball = makeNpmTarball({
      "package/web-ui-bundle.zip": zip,
    });
    restoreFetch = mockFetch((url: string) => {
      if (url === registryMetaUrl) {
        return {
          ok: true,
          json: () =>
            Promise.resolve(
              makeRegistryMetadata("99.0.0", badTarball, tarballUrl)
            ),
        };
      }
      if (url === tarballUrl) {
        return {
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(
              badTarball.buffer.slice(
                badTarball.byteOffset,
                badTarball.byteOffset + badTarball.byteLength
              ) as ArrayBuffer
            ),
        };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    });

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("missing update-manifest.json");

    const status = await getStatus();
    expect(status.phase).toBe("error");
    expect(status.error).toContain("missing update-manifest.json");
  });

  test("a failed signature reports phase=error (fail closed, loudly)", async () => {
    // Real verify module + a signature from the WRONG key = verification fails.
    mock.module("../../electron/updater/verify.js", () => realVerifyExports);
    const manifestObj = makeManifest({ version: "99.0.0" });
    const manifestBytes = Buffer.from(JSON.stringify(manifestObj));
    const { privateKey } = makeKeypair(); // not the baked public key's pair
    const sig = signManifest(manifestBytes, privateKey);

    const tarballUrl = "https://registry.example.com/99.0.0.tgz";
    const zip = makeValidZipBuffer();
    const tarball = makeNpmTarball({
      "package/update-manifest.json": manifestBytes,
      "package/update-manifest.json.sig": Buffer.from(sig),
      "package/web-ui-bundle.zip": zip,
    });
    restoreFetch = mockFetch((url: string) => {
      if (url === registryMetaUrl) {
        return {
          ok: true,
          json: () => Promise.resolve(makeRegistryMetadata("99.0.0", tarball, tarballUrl)),
        };
      }
      if (url === tarballUrl) {
        return {
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(
              tarball.buffer.slice(
                tarball.byteOffset,
                tarball.byteOffset + tarball.byteLength
              ) as ArrayBuffer
            ),
        };
      }
      return { ok: false, status: 404, statusText: "Not Found" };
    });

    const result = await checkForUpdate();
    expect(result.available).toBeNull();

    const status = await getStatus();
    expect(status.phase).toBe("error");
    // Placeholder vs real key both fail closed; either diagnostic is honest.
    expect(status.error).toMatch(/signature verification failed|not configured/);
  });
});
