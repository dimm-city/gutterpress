// ──────────────────────────────────────────────────────────────────────────
// web-runtime.test.ts — tests for web-runtime.ts filesystem helpers.
//
// Strategy: mock.module("electron") FIRST (before any import of web-runtime),
// pointing app.getPath("userData") at a per-test OS temp directory so each
// test gets a clean slate without touching real user data.
// ──────────────────────────────────────────────────────────────────────────

import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { mock } from "bun:test";
import os from "node:os";
import path from "node:path";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";

// ── Electron mock — MUST be registered before web-runtime is imported ────

// We need a mutable reference so individual tests can change the userData path.
const electronMock = {
  userData: path.join(os.tmpdir(), "wr-test-default"),
};

mock.module("electron", () => ({
  app: {
    getPath: (key: string) => {
      if (key === "userData") return electronMock.userData;
      return path.join(os.tmpdir(), `electron-${key}`);
    },
  },
}));

// ── Import AFTER mock is registered ─────────────────────────────────────

const {
  readPointer,
  writePointer,
  readState,
  writeState,
  resolveWebRoot,
  resolveActive,
  ensureLayout,
  webRuntimeDir,
  bundledWebRoot,
  readBaselineVersion,
} = await import("../../electron/updater/web-runtime.js");

// ── Test helpers ─────────────────────────────────────────────────────────

async function withTempDir(fn: (tmpDir: string) => Promise<void>): Promise<void> {
  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "wr-test-"));
  electronMock.userData = tmpDir;
  try {
    await fn(tmpDir);
  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ── ensureLayout ─────────────────────────────────────────────────────────

describe("ensureLayout", () => {
  test("creates versions/ and downloads/ subdirs under web-runtime", async () => {
    await withTempDir(async (tmpDir) => {
      await ensureLayout();
      const webRuntime = path.join(tmpDir, "web-runtime");
      const { stat } = await import("node:fs/promises");
      const v = await stat(path.join(webRuntime, "versions"));
      const d = await stat(path.join(webRuntime, "downloads"));
      expect(v.isDirectory()).toBe(true);
      expect(d.isDirectory()).toBe(true);
    });
  });

  test("is idempotent — calling twice does not throw", async () => {
    await withTempDir(async () => {
      await ensureLayout();
      await ensureLayout(); // second call must not throw
    });
  });
});

// ── writePointer / readPointer round-trip ────────────────────────────────

describe("writePointer / readPointer", () => {
  test("round-trips a current pointer", async () => {
    await withTempDir(async () => {
      await writePointer("current", { version: "1.2.3", path: "/some/path" });
      const result = await readPointer("current");
      expect(result).not.toBeNull();
      expect(result!.version).toBe("1.2.3");
      expect(result!.path).toBe("/some/path");
    });
  });

  test("round-trips a previous pointer", async () => {
    await withTempDir(async () => {
      await writePointer("previous", { version: "1.0.0", path: "/old/path" });
      const result = await readPointer("previous");
      expect(result).not.toBeNull();
      expect(result!.version).toBe("1.0.0");
    });
  });

  test("readPointer returns null when file does not exist", async () => {
    await withTempDir(async () => {
      const result = await readPointer("current");
      expect(result).toBeNull();
    });
  });

  test("readPointer returns null for corrupt JSON", async () => {
    await withTempDir(async (tmpDir) => {
      const dir = path.join(tmpDir, "web-runtime");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "current.json"), "NOT_JSON{{{{", "utf8");
      const result = await readPointer("current");
      expect(result).toBeNull();
    });
  });

  test("readPointer returns null when JSON is valid but missing version", async () => {
    await withTempDir(async (tmpDir) => {
      const dir = path.join(tmpDir, "web-runtime");
      await mkdir(dir, { recursive: true });
      // Missing required fields
      await writeFile(path.join(dir, "current.json"), JSON.stringify({ foo: "bar" }), "utf8");
      const result = await readPointer("current");
      expect(result).toBeNull();
    });
  });

  test("readPointer returns null when version is a number (wrong type)", async () => {
    await withTempDir(async (tmpDir) => {
      const dir = path.join(tmpDir, "web-runtime");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "current.json"),
        JSON.stringify({ version: 123, path: "/some/path" }),
        "utf8"
      );
      const result = await readPointer("current");
      expect(result).toBeNull();
    });
  });

  test("overwriting a pointer replaces the previous value", async () => {
    await withTempDir(async () => {
      await writePointer("current", { version: "1.0.0", path: "/v1" });
      await writePointer("current", { version: "2.0.0", path: "/v2" });
      const result = await readPointer("current");
      expect(result!.version).toBe("2.0.0");
      expect(result!.path).toBe("/v2");
    });
  });
});

// ── readState / writeState ────────────────────────────────────────────────

describe("readState / writeState", () => {
  test("readState returns defaults when state.json does not exist", async () => {
    await withTempDir(async () => {
      const state = await readState();
      expect(state.schemaVersion).toBe(1);
      expect(state.currentVersion).toBeNull();
      expect(state.previousVersion).toBeNull();
      expect(state.minimumSeenVersion).toBeNull();
      expect(state.lastCheckAt).toBeNull();
      expect(state.lastHealthyVersion).toBeNull();
      expect(state.failedVersions).toEqual({});
    });
  });

  // readState's failedVersions guard must reject arrays (typeof [] === 'object'),
  // replacing a stored array with the default {} so downstream code can safely
  // treat it as a keyed map.
  test("failedVersions guard rejects arrays and falls back to {}", async () => {
    await withTempDir(async (tmpDir) => {
      const dir = path.join(tmpDir, "web-runtime");
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, "state.json"),
        JSON.stringify({ schemaVersion: 1, failedVersions: ["bad"] }),
        "utf8"
      );
      const state = await readState();
      expect(state.failedVersions).toEqual({});
      expect(Array.isArray(state.failedVersions)).toBe(false);
    });
  });

  test("readState merges stored fields with defaults", async () => {
    await withTempDir(async () => {
      await writeState({
        schemaVersion: 1,
        currentVersion: "1.5.0",
        previousVersion: "1.4.0",
        minimumSeenVersion: null,
        lastCheckAt: "2026-06-04T00:00:00Z",
        lastHealthyVersion: "1.4.0",
        failedVersions: {},
      });
      const state = await readState();
      expect(state.currentVersion).toBe("1.5.0");
      expect(state.previousVersion).toBe("1.4.0");
      expect(state.lastCheckAt).toBe("2026-06-04T00:00:00Z");
      expect(state.lastHealthyVersion).toBe("1.4.0");
    });
  });

  test("readState returns defaults when state.json is corrupt JSON", async () => {
    await withTempDir(async (tmpDir) => {
      const dir = path.join(tmpDir, "web-runtime");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "state.json"), "}{bad json", "utf8");
      const state = await readState();
      expect(state).toEqual({
        schemaVersion: 1,
        currentVersion: null,
        previousVersion: null,
        minimumSeenVersion: null,
        lastCheckAt: null,
        lastHealthyVersion: null,
        failedVersions: {},
      });
    });
  });

  test("failedVersions survives a round-trip", async () => {
    await withTempDir(async () => {
      await writeState({
        schemaVersion: 1,
        currentVersion: null,
        previousVersion: null,
        minimumSeenVersion: null,
        lastCheckAt: null,
        lastHealthyVersion: null,
        failedVersions: { "1.0.0": "crash on startup" },
      });
      const state = await readState();
      expect(state.failedVersions).toEqual({ "1.0.0": "crash on startup" });
    });
  });

  test("schemaVersion is always 1 after read (overrides stored value)", async () => {
    await withTempDir(async (tmpDir) => {
      const dir = path.join(tmpDir, "web-runtime");
      await mkdir(dir, { recursive: true });
      // Even if stored schemaVersion is wrong, readState forces it to 1.
      await writeFile(
        path.join(dir, "state.json"),
        JSON.stringify({ schemaVersion: 99, currentVersion: "2.0.0" }),
        "utf8"
      );
      const state = await readState();
      expect(state.schemaVersion).toBe(1);
    });
  });
});

// ── resolveWebRoot ────────────────────────────────────────────────────────

describe("resolveWebRoot", () => {
  test("falls back to bundledWebRoot() when no current pointer exists", async () => {
    await withTempDir(async () => {
      const result = await resolveWebRoot();
      expect(result).toBe(bundledWebRoot());
    });
  });

  test("returns pointer path when current.json points at a versions/ dir with index.html", async () => {
    await withTempDir(async (tmpDir) => {
      // Containment guard: the pointer is only honored inside web-runtime/versions/.
      // A promoted runtime is an extracted package: ui/ (SPA) + dist/index.js.
      const fakeRoot = path.join(tmpDir, "web-runtime", "versions", "3.0.0");
      await mkdir(path.join(fakeRoot, "ui"), { recursive: true });
      await mkdir(path.join(fakeRoot, "dist"), { recursive: true });
      await writeFile(path.join(fakeRoot, "ui", "index.html"), "<html></html>", "utf8");
      await writeFile(path.join(fakeRoot, "dist", "index.js"), "export {};", "utf8");

      await writePointer("current", { version: "3.0.0", path: fakeRoot });

      const result = await resolveWebRoot();
      expect(result).toBe(path.join(fakeRoot, "ui"));
    });
  });

  test("falls back to bundledWebRoot() when current pointer escapes versions/", async () => {
    await withTempDir(async (tmpDir) => {
      // A pointer outside web-runtime/versions/ (e.g. tampered) must be rejected
      // even if it has a valid index.html.
      const escapeRoot = path.join(tmpDir, "evil-bundle");
      await mkdir(escapeRoot, { recursive: true });
      await writeFile(path.join(escapeRoot, "index.html"), "<html></html>", "utf8");

      await writePointer("current", { version: "9.9.9", path: escapeRoot });

      const result = await resolveWebRoot();
      expect(result).toBe(bundledWebRoot());
    });
  });

  test("falls back to bundledWebRoot() when current pointer path has no index.html", async () => {
    await withTempDir(async (tmpDir) => {
      // Point at a real dir that exists but has no index.html
      const emptyDir = path.join(tmpDir, "empty-bundle");
      await mkdir(emptyDir, { recursive: true });

      await writePointer("current", { version: "3.0.0", path: emptyDir });

      const result = await resolveWebRoot();
      expect(result).toBe(bundledWebRoot());
    });
  });

  test("falls back to bundledWebRoot() when current pointer path does not exist", async () => {
    await withTempDir(async (tmpDir) => {
      // Point at a non-existent directory
      const missingDir = path.join(tmpDir, "does-not-exist", "bundle");

      await writePointer("current", { version: "3.0.0", path: missingDir });

      const result = await resolveWebRoot();
      expect(result).toBe(bundledWebRoot());
    });
  });

  test("ignores a promoted pointer NOT newer than the baked baseline (serves baked UI)", async () => {
    await withTempDir(async (tmpDir) => {
      // Regression: a stale promoted bundle (<= the shipped baseline) must never
      // shadow the freshly-built baked UI — the web-v0.2.3-shadows-0.3.0 bug.
      const baseline = await readBaselineVersion();
      const staleRoot = path.join(tmpDir, "web-runtime", "versions", baseline);
      await mkdir(staleRoot, { recursive: true });
      await writeFile(path.join(staleRoot, "index.html"), "<html>stale</html>", "utf8");
      await writePointer("current", { version: baseline, path: staleRoot });

      const result = await resolveWebRoot();
      expect(result).toBe(bundledWebRoot());
    });
  });

  test("serves a promoted pointer that IS strictly newer than the baked baseline", async () => {
    await withTempDir(async (tmpDir) => {
      const newerRoot = path.join(tmpDir, "web-runtime", "versions", "999.0.0");
      await mkdir(path.join(newerRoot, "ui"), { recursive: true });
      await mkdir(path.join(newerRoot, "dist"), { recursive: true });
      await writeFile(path.join(newerRoot, "ui", "index.html"), "<html>newer</html>", "utf8");
      await writeFile(path.join(newerRoot, "dist", "index.js"), "export {};", "utf8");
      await writePointer("current", { version: "999.0.0", path: newerRoot });

      const result = await resolveWebRoot();
      expect(result).toBe(path.join(newerRoot, "ui"));
    });
  });
});

// ── resolveActive (web root + library entry together) ──────────────────────

describe("resolveActive", () => {
  test("returns the promoted ui/ web root + dist/index.js lib entry when newer", async () => {
    await withTempDir(async (tmpDir) => {
      const root = path.join(tmpDir, "web-runtime", "versions", "999.0.0");
      await mkdir(path.join(root, "ui"), { recursive: true });
      await mkdir(path.join(root, "dist"), { recursive: true });
      await writeFile(path.join(root, "ui", "index.html"), "<html></html>", "utf8");
      await writeFile(path.join(root, "dist", "index.js"), "export {};", "utf8");
      await writePointer("current", { version: "999.0.0", path: root });

      const active = await resolveActive();
      expect(active.version).toBe("999.0.0");
      expect(active.webRoot).toBe(path.join(root, "ui"));
      expect(active.libEntry).toBe(path.join(root, "dist", "index.js"));
    });
  });

  test("falls back to the baked runtime (null libEntry) when nothing is promoted", async () => {
    await withTempDir(async () => {
      const active = await resolveActive();
      expect(active.webRoot).toBe(bundledWebRoot());
      expect(active.libEntry).toBeNull();
      expect(active.version).toBe(await readBaselineVersion());
    });
  });

  test("falls back wholesale when the engine half (dist/index.js) is missing", async () => {
    await withTempDir(async (tmpDir) => {
      // UI present but engine absent → never serve a mismatched ui+lib pair.
      const root = path.join(tmpDir, "web-runtime", "versions", "999.0.0");
      await mkdir(path.join(root, "ui"), { recursive: true });
      await writeFile(path.join(root, "ui", "index.html"), "<html></html>", "utf8");
      await writePointer("current", { version: "999.0.0", path: root });

      const active = await resolveActive();
      expect(active.webRoot).toBe(bundledWebRoot());
      expect(active.libEntry).toBeNull();
    });
  });
});

// ── webRuntimeDir ─────────────────────────────────────────────────────────

describe("webRuntimeDir", () => {
  test("returns userData/web-runtime", async () => {
    await withTempDir(async (tmpDir) => {
      expect(webRuntimeDir()).toBe(path.join(tmpDir, "web-runtime"));
    });
  });
});
