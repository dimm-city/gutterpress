// Unit tests for electron/updater.ts (the electron-updater wrapper — not to
// be confused with the unrelated tests/updater/*.ts files that predate this
// suite and cover project/recent-folder state).
//
// electron/updater.ts imports `app` from "electron" and `autoUpdater` from
// "electron-updater" at module scope. Neither is a real runtime under
// `bun test` (importing the real "electron" package outside an actual
// Electron process throws while trying to locate/download the Electron
// binary — see getElectronPath() in node_modules/electron/index.js), so
// both are mocked via `mock.module` BEFORE the dynamic `import()` of
// updater.ts below.
//
// `--isolate` scopes SOME state per file, but NOT `mock.module("electron", …)`
// registrations across files that all touch the "electron" specifier —
// whichever such suite's registration ends up "live" for a given
// `bun test --isolate` invocation serves every other suite's static
// `from "electron"` imports too. So this mock (like every other
// electron-mocking suite: tests/platform/pdf-export.test.ts,
// tests/platform/sveltekit-host.test.ts, tests/platform/credential-store.test.ts)
// provides the SAME superset of keys every electron/*.ts production module
// statically imports from "electron" (app.getPath/isPackaged/getVersion/
// releaseSingleInstanceLock, protocol, BrowserWindow, safeStorage), not just
// the ones electron/updater.ts itself needs. Keep this superset in sync with
// any new `from "electron"` import added to electron/*.ts.

import { test, expect, mock } from "bun:test";
import { EventEmitter } from "node:events";

const fakeApp = {
  isPackaged: true,
  getVersion: () => "1.0.0",
  releaseSingleInstanceLock: () => {},
  getPath: () => "/tmp/print-md-test-userdata",
};

mock.module("electron", () => ({
  app: fakeApp,
  protocol: {},
  BrowserWindow: class {},
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from(s, "utf8"),
    decryptString: (b: Buffer) => Buffer.from(b).toString("utf8"),
  },
}));
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
  shouldBackgroundCheck,
} = await import("../../electron/updater");

/** A minimal EventEmitter-based double for AutoUpdaterLike. */
class FakeAutoUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
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
    // The failed check must not consume the focus-recheck throttle window —
    // coming back online must allow an immediate retry.
    expect(shouldBackgroundCheck()).toBe(true);
  });
});

test("a successful silent check DOES consume the focus-recheck throttle window", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-not-available");
      return null;
    };
    initUpdater(() => {}, { autoUpdater: fake });

    await checkForUpdates({ silent: true });

    expect(shouldBackgroundCheck()).toBe(false);
  });
});

test("each check applies the current prerelease update preference", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    const valuesAtCheck: boolean[] = [];
    let includePrereleases = false;
    fake.checkImpl = async () => {
      valuesAtCheck.push(fake.allowPrerelease);
      fake.emit("update-not-available");
      return null;
    };
    initUpdater(() => {}, {
      autoUpdater: fake,
      readAllowPrerelease: () => includePrereleases,
    });

    await checkForUpdates();
    includePrereleases = true;
    await checkForUpdates();

    expect(valuesAtCheck).toEqual([false, true]);
  });
});

test("download failure reports a download-flavored friendly message, not a check one", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      throw new Error("net::ERR_CONNECTION_RESET");
    };
    initUpdater(() => {}, { autoUpdater: fake });

    await checkForUpdates();
    const status = await download();

    expect(status.phase).toBe("error");
    expect(status.error).toBe(
      "Couldn't download the update. Check your internet connection and try again.",
    );
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
