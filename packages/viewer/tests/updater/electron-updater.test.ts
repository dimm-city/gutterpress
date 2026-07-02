// Unit tests for electron/updater.ts (the electron-updater wrapper — not to
// be confused with the unrelated tests/updater/*.ts files that predate this
// suite and cover project/recent-folder state).
//
// electron/updater.ts imports `app` from "electron" and `autoUpdater` from
// "electron-updater" at module scope. Neither is a real runtime under
// `bun test` (the "electron" package's default export outside an actual
// Electron process is just a path string, so `{ app }` destructures to
// `undefined`), so both are mocked via `mock.module` BEFORE the dynamic
// `import()` of updater.ts below. This file runs under `bun test --isolate`
// (see package.json's `test` script), so the mocked module registry is
// scoped to this file and cannot leak into other test files.

import { test, expect, mock } from "bun:test";
import { EventEmitter } from "node:events";

const fakeApp = {
  isPackaged: true,
  getVersion: () => "1.0.0",
  releaseSingleInstanceLock: () => {},
};

mock.module("electron", () => ({ app: fakeApp }));
// Only used to satisfy updater.ts's top-level `const { autoUpdater } =
// electronUpdater` destructure; every test supplies its own fake via
// initUpdater's `deps` param instead of touching this.
mock.module("electron-updater", () => ({ default: { autoUpdater: {} } }));

const {
  initUpdater,
  checkForUpdates,
  download,
  installNow,
  updaterSupported,
} = await import("../../electron/updater");

/** A minimal EventEmitter-based double for AutoUpdaterLike. */
class FakeAutoUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  checkCalls = 0;
  downloadCalls = 0;
  quitAndInstallCalls: Array<[boolean | undefined, boolean | undefined]> = [];
  checkImpl: () => Promise<{ downloadPromise?: Promise<unknown> } | null> = async () => null;
  downloadImpl: () => Promise<unknown> = async () => undefined;

  async checkForUpdates() {
    this.checkCalls++;
    return this.checkImpl();
  }
  async downloadUpdate() {
    this.downloadCalls++;
    return this.downloadImpl();
  }
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean) {
    this.quitAndInstallCalls.push([isSilent, isForceRunAfter]);
  }
}

/**
 * Ensure a Linux+AppImage environment is "supported" for a test body. `fn`
 * is always awaited before restoring the env var — the callback bodies below
 * are async and cross real `await` gaps, so a sync try/finally here would
 * restore the env var (deleting APPIMAGE) before the body's later awaits
 * (e.g. a call to download() after checkForUpdates()) ever run.
 */
async function withAppImage<T>(fn: () => T | Promise<T>): Promise<T> {
  const prev = process.env.APPIMAGE;
  process.env.APPIMAGE = "/fake/print-md.AppImage";
  try {
    return await fn();
  } finally {
    if (prev === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = prev;
  }
}

test("updaterSupported() is true on a packaged Linux AppImage build", async () => {
  await withAppImage(() => {
    expect(updaterSupported()).toBe(true);
  });
});

test("silent check: a network failure resets phase to idle, not error (H1)", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND github.com");
    };
    const events: unknown[] = [];
    initUpdater((e) => events.push(e), { autoUpdater: fake });

    const status = await checkForUpdates({ silent: true });

    expect(status.phase).toBe("idle");
    expect(status.error).toBeNull();
  });
});

test("user-initiated check: a failure latches phase error with a friendly message", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      throw new Error("boom, something internal broke");
    };
    initUpdater(() => {}, { autoUpdater: fake });

    const status = await checkForUpdates();

    expect(status.phase).toBe("error");
    // Friendly, not the raw "boom" string.
    expect(status.error).toBe(
      "Update check failed. You can download the latest version from GitHub.",
    );
  });
});

test("user-initiated check: a network failure also gets a friendly (but distinct) message", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    };
    initUpdater(() => {}, { autoUpdater: fake });

    const status = await checkForUpdates();

    expect(status.phase).toBe("error");
    expect(status.error).toBe(
      "Couldn't check for updates. Check your internet connection and try again.",
    );
  });
});

test("available -> download() -> staged event sequence", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
      return undefined;
    };
    const events: Array<{ type: string; version?: string }> = [];
    initUpdater((e) => events.push(e), { autoUpdater: fake });

    const afterCheck = await checkForUpdates();
    expect(afterCheck.phase).toBe("available");
    expect(afterCheck.availableVersion).toBe("2.0.0");
    expect(events.some((e) => e.type === "available" && e.version === "2.0.0")).toBe(true);
    // M1: a found update must NOT auto-download.
    expect(fake.downloadCalls).toBe(0);

    const afterDownload = await download();
    expect(afterDownload.phase).toBe("staged");
    expect(afterDownload.stagedVersion).toBe("2.0.0");
    expect(events.some((e) => e.type === "staged" && e.version === "2.0.0")).toBe(true);

    const installResult = installNow();
    expect(installResult).toEqual({ applied: true, version: "2.0.0" });
    expect(fake.quitAndInstallCalls).toEqual([[false, true]]);
  });
});

test("concurrent checkForUpdates() calls share one in-flight run", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    let resolveCheck: (() => void) | null = null;
    fake.checkImpl = () =>
      new Promise((resolve) => {
        resolveCheck = () => resolve(null);
      });
    initUpdater(() => {}, { autoUpdater: fake });

    const p1 = checkForUpdates({ silent: true });
    const p2 = checkForUpdates({ silent: true });
    // Give the microtask queue a turn so both calls have entered
    // checkForUpdates() before the underlying check resolves.
    await Promise.resolve();
    expect(fake.checkCalls).toBe(1);
    resolveCheck?.();
    await Promise.all([p1, p2]);
    expect(fake.checkCalls).toBe(1);
  });
});

test("non-AppImage Linux is unsupported and a manual check reports the GitHub-download hint", async () => {
  const prev = process.env.APPIMAGE;
  delete process.env.APPIMAGE;
  try {
    // Only meaningful on Linux; this suite runs under Linux CI/dev per the
    // project's platform (see CLAUDE.md environment notes), but guard the
    // assertion so the test degrades gracefully if that ever changes.
    if (process.platform !== "linux") return;
    expect(updaterSupported()).toBe(false);

    const fake = new FakeAutoUpdater();
    initUpdater(() => {}, { autoUpdater: fake });

    const status = await checkForUpdates();

    expect(status.phase).toBe("error");
    expect(status.error).toBe(
      "Automatic updates aren't available for this install — download the latest release from GitHub.",
    );
    expect(fake.checkCalls).toBe(0);
  } finally {
    if (prev === undefined) delete process.env.APPIMAGE;
    else process.env.APPIMAGE = prev;
  }
});
