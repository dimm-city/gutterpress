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

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mock } from "bun:test";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { zipSync } from "fflate";

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
  GITHUB_REPO,
} = await import("../../electron/updater/index.js");

const { readPointer, writePointer, readState, writeState, ensureLayout, webRuntimeDir } =
  await import("../../electron/updater/web-runtime.js");

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

/** Build a valid (index.html + _app/init.js) zip buffer using fflate. */
function makeValidZipBuffer(): Buffer {
  const entries: Record<string, Uint8Array> = {
    "index.html": new TextEncoder().encode("<html><body>ok</body></html>"),
    "_app/init.js": new TextEncoder().encode("console.log('web-ui');"),
  };
  return Buffer.from(zipSync(entries));
}

/** Build a malicious zip with a path-traversal entry. */
function makeTraversalZipBuffer(): Buffer {
  const entries: Record<string, Uint8Array> = {
    "../escape.txt": new TextEncoder().encode("I escaped!"),
    "index.html": new TextEncoder().encode("<html></html>"),
    "_app/init.js": new TextEncoder().encode(""),
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

  test("promotes staged → current when staged has index.html", async () => {
    const bundleDir = path.join(tmpDir, "web-runtime", "versions", "3.0.0");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(path.join(bundleDir, "index.html"), "<html></html>", "utf8");
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
    await mkdir(v1Dir, { recursive: true });
    await writeFile(path.join(v1Dir, "index.html"), "<html></html>", "utf8");
    await writePointer("current", { version: "1.0.0", path: v1Dir });

    // Stage 2.0.0
    const v2Dir = path.join(tmpDir, "web-runtime", "versions", "2.0.0");
    await mkdir(v2Dir, { recursive: true });
    await writeFile(path.join(v2Dir, "index.html"), "<html></html>", "utf8");
    await writeStaged({ version: "2.0.0", path: v2Dir });

    await promoteStaged();

    const current = await readPointer("current");
    const previous = await readPointer("previous");
    expect(current!.version).toBe("2.0.0");
    expect(previous!.version).toBe("1.0.0");
  });

  test("clears staged after successful promote", async () => {
    const bundleDir = path.join(tmpDir, "web-runtime", "versions", "5.0.0");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(path.join(bundleDir, "index.html"), "<html></html>", "utf8");
    await writeStaged({ version: "5.0.0", path: bundleDir });

    await promoteStaged();
    const staged = await readStaged();
    expect(staged).toBeNull();
  });

  test("returns promoted:false and clears staged when index.html is missing", async () => {
    const bundleDir = path.join(tmpDir, "web-runtime", "versions", "4.0.0");
    await mkdir(bundleDir, { recursive: true });
    // Intentionally no index.html
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

    const ghReleasesUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases`;
    const manifestUrl = `https://github.example.com/releases/download/web-v${version}/update-manifest.json`;
    const sigUrl = `${manifestUrl}.sig`;
    const bundleUrl = `https://github.example.com/releases/download/web-v${version}/web-ui-bundle.zip`;

    const ghResponse = [
      {
        tag_name: `web-v${version}`,
        draft: false,
        prerelease: false,
        assets: [
          { name: "update-manifest.json", browser_download_url: manifestUrl },
          { name: "update-manifest.json.sig", browser_download_url: sigUrl },
          { name: "web-ui-bundle.zip", browser_download_url: bundleUrl },
        ],
      },
    ];

    return (url: string): FetchResponse => {
      if (url === ghReleasesUrl) {
        return {
          ok: true,
          json: () => Promise.resolve(ghResponse),
        };
      }
      if (url === manifestUrl) {
        return {
          ok: true,
          arrayBuffer: () => Promise.resolve(manifestBytes.buffer as ArrayBuffer),
        };
      }
      if (url === sigUrl) {
        return {
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(Buffer.from(sig + "\n").buffer as ArrayBuffer),
        };
      }
      if (url === bundleUrl) {
        return {
          ok: true,
          arrayBuffer: () => Promise.resolve(zipBuffer.buffer.slice(zipBuffer.byteOffset, zipBuffer.byteOffset + zipBuffer.byteLength) as ArrayBuffer),
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

  test("accepts a valid zip with index.html and _app/", async () => {
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
// These tests mock the GitHub API response and use a mocked verify layer.
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

  const ghReleasesUrl = `https://api.github.com/repos/${GITHUB_REPO}/releases`;

  function makeFetchForVersion(version: string, requiresDesktopApi = 1) {
    const manifestObj = makeManifest({ version, requiresDesktopApi });
    const manifestBytes = Buffer.from(JSON.stringify(manifestObj));
    const { privateKey } = makeKeypair();
    const sig = signManifest(manifestBytes, privateKey);

    const manifestUrl = `https://github.example.com/releases/web-v${version}/update-manifest.json`;
    const sigUrl = `${manifestUrl}.sig`;

    const releases = [
      {
        tag_name: `web-v${version}`,
        draft: false,
        prerelease: false,
        assets: [
          { name: "update-manifest.json", browser_download_url: manifestUrl },
          { name: "update-manifest.json.sig", browser_download_url: sigUrl },
        ],
      },
    ];

    return (url: string): FetchResponse => {
      if (url === ghReleasesUrl) {
        return { ok: true, json: () => Promise.resolve(releases) };
      }
      if (url === manifestUrl) {
        return {
          ok: true,
          arrayBuffer: () => Promise.resolve(manifestBytes.buffer.slice(manifestBytes.byteOffset, manifestBytes.byteOffset + manifestBytes.byteLength) as ArrayBuffer),
        };
      }
      if (url === sigUrl) {
        return {
          ok: true,
          arrayBuffer: () =>
            Promise.resolve(Buffer.from(sig + "\n").buffer.slice(0) as ArrayBuffer),
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

  test("returns available:null with reason when no web-v* releases found", async () => {
    stubVerify();
    restoreFetch = mockFetch((_url: string) => ({
      ok: true,
      json: () => Promise.resolve([]), // empty releases
    }));

    const result = await checkForUpdate();
    expect(result.available).toBeNull();
    expect(result.reason).toContain("no web-ui releases found");
  });

  test("returns available:null when GitHub returns non-200", async () => {
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
