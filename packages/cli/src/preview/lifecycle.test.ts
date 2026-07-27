/**
 * ARC finding #49: `preview/lifecycle.ts` (232 lines — startup validation,
 * temp-dir setup with orphan reaping, restart, and the graceful-shutdown
 * state machine) had no direct tests.
 *
 * `previewServer` is always a hand-built stub satisfying the `PreviewServer`
 * interface (never a real `node:http` listener) — these tests cover the
 * lifecycle STATE MACHINE (validate → init → restart → shutdown, idempotency,
 * error containment), not the HTTP/WebSocket server itself (see
 * `http-server.test.ts`). `noWatch: true` is used throughout so `startFileWatcher`
 * never spins up a real chokidar watcher.
 */
import { describe, test, expect, mock } from "bun:test";
import { mkdtemp, mkdir, writeFile, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validateInputPath,
  initializePreviewDirectories,
  initializeConfiguration,
  restartPreview,
  shutdownServer,
} from "./lifecycle";
import { resolveConfig } from "../lib/manifest";
import type { ServerState } from "./server-context";
import type { PreviewServerOptions } from "../types";
import type { PreviewServer } from "./http-server";

// Mirrors the private constants in lifecycle.ts (TEMP_DIR_BASE / PID_FILE_NAME)
// — not exported, so re-derived here for the orphan-cleanup fixtures.
const TEMP_DIR_BASE = path.join(tmpdir(), "print-md-preview");
const PID_FILE_NAME = ".print-md.pid";

function makeOptions(overrides: Partial<PreviewServerOptions> = {}): PreviewServerOptions {
  return {
    port: 3000,
    host: "127.0.0.1",
    verbose: false,
    noWatch: true,
    openBrowser: false,
    ...overrides,
  };
}

function makeStubServer(): PreviewServer & {
  closeCalls: number;
  broadcastReloadCalls: number;
} {
  const stub = {
    port: 3000,
    closeCalls: 0,
    broadcastReloadCalls: 0,
    async close() {
      stub.closeCalls++;
    },
    broadcastReload() {
      stub.broadcastReloadCalls++;
    },
    broadcastCssUpdate() {},
    broadcastContentUpdate() {},
  };
  return stub;
}

function makeState(overrides: Partial<ServerState> = {}): ServerState {
  return {
    currentInputPath: "",
    currentWatcher: null,
    rebuildTimer: null,
    isRebuilding: false,
    previewServer: null,
    isShuttingDown: false,
    tempDir: "",
    config: resolveConfig({}, {}),
    options: makeOptions(),
    ...overrides,
  };
}

// ── validateInputPath ───────────────────────────────────────────────────────

describe("validateInputPath", () => {
  test("empty input is a no-op (no-input / viewer folder-picker mode)", async () => {
    await expect(validateInputPath("")).resolves.toBeUndefined();
  });

  test("an existing directory resolves without throwing", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-validate-"));
    try {
      await expect(validateInputPath(dir)).resolves.toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a nonexistent path throws naming the path", async () => {
    const missing = path.join(tmpdir(), "pmd-lifecycle-does-not-exist-" + Date.now());
    await expect(validateInputPath(missing)).rejects.toThrow(
      `Input path not found: ${missing}`
    );
  });
});

// ── initializePreviewDirectories ────────────────────────────────────────────

describe("initializePreviewDirectories", () => {
  test("creates a temp dir holding ONLY the PID file — no source copy (serve-in-place)", async () => {
    // A real project with content exists on disk here, but is deliberately
    // never passed to initializePreviewDirectories — the function no longer
    // takes an inputPath/config at all. Serve-in-place means the temp dir is
    // never a mirror of the project: http-server.ts reads project files
    // straight from the project directory for every non-book.html request,
    // so the ONLY things print-md itself ever writes into the temp dir are
    // book.html (written later by generateAndWriteHtml) and the PID marker.
    const projectDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-input-"));
    let tempDir: string | undefined;
    try {
      await writeFile(path.join(projectDir, "chapter-01.md"), "# Hello\n", "utf-8");

      tempDir = await initializePreviewDirectories();

      expect(tempDir.startsWith(TEMP_DIR_BASE)).toBe(true);
      const entries = await readdir(tempDir);
      expect(entries).toEqual([PID_FILE_NAME]);
      const pidRaw = await readFile(path.join(tempDir, PID_FILE_NAME), "utf-8");
      expect(pidRaw.trim()).toBe(String(process.pid));
    } finally {
      await rm(projectDir, { recursive: true, force: true });
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("reaps orphan temp dirs whose recorded PID is no longer alive", async () => {
    await mkdir(TEMP_DIR_BASE, { recursive: true });
    const deadDir = path.join(TEMP_DIR_BASE, "pmd-orphan-dead-" + Date.now());
    await mkdir(deadDir, { recursive: true });
    // pid <= 0 is unconditionally treated as "not alive" by isProcessAlive —
    // deterministic, no reliance on real PID reuse timing.
    await writeFile(path.join(deadDir, PID_FILE_NAME), "-1\n", "utf-8");

    let tempDir: string | undefined;
    try {
      tempDir = await initializePreviewDirectories();

      const stillThere = await stat(deadDir).then(
        () => true,
        () => false
      );
      expect(stillThere).toBe(false);
    } finally {
      await rm(deadDir, { recursive: true, force: true });
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("does NOT reap a temp dir whose recorded PID is this (alive) test process", async () => {
    await mkdir(TEMP_DIR_BASE, { recursive: true });
    const aliveDir = path.join(TEMP_DIR_BASE, "pmd-orphan-alive-" + Date.now());
    await mkdir(aliveDir, { recursive: true });
    await writeFile(path.join(aliveDir, PID_FILE_NAME), `${process.pid}\n`, "utf-8");

    let tempDir: string | undefined;
    try {
      tempDir = await initializePreviewDirectories();

      const stillThere = await stat(aliveDir).then(
        () => true,
        () => false
      );
      expect(stillThere).toBe(true);
    } finally {
      await rm(aliveDir, { recursive: true, force: true });
      if (tempDir) await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ── initializeConfiguration ─────────────────────────────────────────────────

describe("initializeConfiguration", () => {
  test("empty input returns the default resolved config (no manifest load)", async () => {
    const config = await initializeConfiguration("");
    expect(config).toEqual(resolveConfig({}, {}));
  });

  test("loads and resolves the manifest at the given input directory", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-config-"));
    try {
      await writeFile(path.join(dir, "manifest.yaml"), "title: My Custom Title\n", "utf-8");
      const config = await initializeConfiguration(dir);
      expect(config.title).toBe("My Custom Title");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a non-empty input directory without a manifest keeps preview's default config", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-no-manifest-"));
    try {
      await writeFile(path.join(dir, "chapter-01.md"), "# Loose chapter\n", "utf-8");
      const config = await initializeConfiguration(dir);
      expect(config).toEqual(resolveConfig({}, {}));
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── restartPreview ───────────────────────────────────────────────────────────

describe("restartPreview", () => {
  test("repoints currentInputPath, regenerates book.html, and broadcasts a reload", async () => {
    const oldInputDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-old-"));
    const newInputDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-new-"));
    const tempDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-temp-"));
    try {
      await writeFile(path.join(oldInputDir, "chapter-01.md"), "# Old\n", "utf-8");
      await writeFile(path.join(newInputDir, "chapter-01.md"), "# Brand New Chapter\n", "utf-8");

      const stubServer = makeStubServer();
      const state = makeState({
        currentInputPath: oldInputDir,
        tempDir,
        previewServer: stubServer,
        options: makeOptions({ noWatch: true }),
      });

      await restartPreview(newInputDir, state);

      expect(state.currentInputPath).toBe(newInputDir);
      const html = await readFile(path.join(tempDir, "book.html"), "utf-8");
      expect(html).toContain("Brand New Chapter");
      expect(stubServer.broadcastReloadCalls).toBe(1);
      // noWatch: true means startFileWatcher never installs a real chokidar
      // watcher — the state machine must not fake one either.
      expect(state.currentWatcher).toBeNull();
    } finally {
      await rm(oldInputDir, { recursive: true, force: true });
      await rm(newInputDir, { recursive: true, force: true });
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("stops the previous watcher before restarting", async () => {
    const oldInputDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-old-"));
    const newInputDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-new-"));
    const tempDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-temp-"));
    try {
      await writeFile(path.join(oldInputDir, "chapter-01.md"), "# Old\n", "utf-8");
      await writeFile(path.join(newInputDir, "chapter-01.md"), "# New\n", "utf-8");

      let closeCalls = 0;
      const fakeWatcher = { close: mock(async () => { closeCalls++; }) };
      const state = makeState({
        currentInputPath: oldInputDir,
        tempDir,
        previewServer: makeStubServer(),
        currentWatcher: fakeWatcher as unknown as ServerState["currentWatcher"],
        options: makeOptions({ noWatch: true }),
      });

      await restartPreview(newInputDir, state);

      expect(closeCalls).toBe(1);
    } finally {
      await rm(oldInputDir, { recursive: true, force: true });
      await rm(newInputDir, { recursive: true, force: true });
      await rm(tempDir, { recursive: true, force: true });
    }
  });

  test("updates state.config from the new directory's manifest", async () => {
    const oldInputDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-old-"));
    const newInputDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-new-"));
    const tempDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-restart-temp-"));
    try {
      await writeFile(path.join(oldInputDir, "chapter-01.md"), "# Old\n", "utf-8");
      await writeFile(path.join(newInputDir, "manifest.yaml"), "title: Retitled\n", "utf-8");
      await writeFile(path.join(newInputDir, "chapter-01.md"), "# New\n", "utf-8");

      const state = makeState({
        currentInputPath: oldInputDir,
        tempDir,
        previewServer: makeStubServer(),
        options: makeOptions({ noWatch: true }),
      });

      await restartPreview(newInputDir, state);

      expect(state.config.title).toBe("Retitled");
    } finally {
      await rm(oldInputDir, { recursive: true, force: true });
      await rm(newInputDir, { recursive: true, force: true });
      await rm(tempDir, { recursive: true, force: true });
    }
  });
});

// ── shutdownServer ───────────────────────────────────────────────────────────

describe("shutdownServer", () => {
  test("closes the preview server and removes the temp dir", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-shutdown-"));
    const stubServer = makeStubServer();
    const state = makeState({ tempDir, previewServer: stubServer });

    await shutdownServer(state);

    expect(stubServer.closeCalls).toBe(1);
    const stillThere = await stat(tempDir).then(
      () => true,
      () => false
    );
    expect(stillThere).toBe(false);
  });

  test("is idempotent: a second call is a no-op (isShuttingDown guard)", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-shutdown-idem-"));
    const stubServer = makeStubServer();
    const state = makeState({ tempDir, previewServer: stubServer });

    await shutdownServer(state);
    expect(state.isShuttingDown).toBe(true);
    await shutdownServer(state);

    expect(stubServer.closeCalls).toBe(1);
  });

  test("removes the temp dir even when there is no previewServer yet", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-shutdown-noserver-"));
    const state = makeState({ tempDir, previewServer: null });

    await expect(shutdownServer(state)).resolves.toBeUndefined();

    const stillThere = await stat(tempDir).then(
      () => true,
      () => false
    );
    expect(stillThere).toBe(false);
  });

  test("a throwing stopFileWatcher does not prevent temp-dir cleanup", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-shutdown-watcher-throws-"));
    const fakeWatcher = {
      close: mock(async () => {
        throw new Error("simulated chokidar close failure");
      }),
    };
    const state = makeState({
      tempDir,
      previewServer: makeStubServer(),
      currentWatcher: fakeWatcher as unknown as ServerState["currentWatcher"],
    });

    await expect(shutdownServer(state)).resolves.toBeUndefined();

    const stillThere = await stat(tempDir).then(
      () => true,
      () => false
    );
    expect(stillThere).toBe(false);
  });

  test("a previewServer.close() that hangs forever does not block cleanup past its internal timeout", async () => {
    const tempDir = await mkdtemp(path.join(tmpdir(), "pmd-lifecycle-shutdown-hang-"));
    const hangingServer: PreviewServer = {
      port: 3000,
      close: () => new Promise<void>(() => {}), // never resolves
      broadcastReload() {},
      broadcastCssUpdate() {},
      broadcastContentUpdate() {},
    };
    const state = makeState({ tempDir, previewServer: hangingServer });

    // withTimeout's internal budget is 2000ms per step; give it headroom.
    await expect(shutdownServer(state)).resolves.toBeUndefined();

    const stillThere = await stat(tempDir).then(
      () => true,
      () => false
    );
    expect(stillThere).toBe(false);
  }, 5000);
});
