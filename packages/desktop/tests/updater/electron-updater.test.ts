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
import { electronMock } from "../support/electron-mock";

// Keep getVersion mutable so semver ordering can be tested without replacing
// the already-imported Electron module between test cases.
let mockedAppVersion = "1.0.0";
let releaseLockCalls = 0;
let requestLockCalls = 0;
let requestLockResult = true;
let quitCalls = 0;
let electronUpdaterQuitHook: (() => void) | null = null;
const nativeAutoUpdater = new EventEmitter();
mock.module("electron", () =>
  electronMock({
    autoUpdater: nativeAutoUpdater,
    app: {
      getVersion: () => mockedAppVersion,
      releaseSingleInstanceLock: () => {
        releaseLockCalls++;
      },
      requestSingleInstanceLock: () => {
        requestLockCalls++;
        return requestLockResult;
      },
      quit: () => {
        quitCalls++;
        electronUpdaterQuitHook?.();
      },
    },
  }),
);
// Only used to satisfy updater.ts's top-level `const { autoUpdater } =
// electronUpdater` destructure; every test supplies its own fake via
// initUpdater's `deps` param instead of touching this.
mock.module("electron-updater", () => ({ default: { autoUpdater: {} } }));

const {
  initUpdater,
  checkForUpdates,
  download,
  installNow,
  getStatus,
  updaterSupported,
  shouldBackgroundCheck,
} = await import("../../electron/updater");

/** A minimal EventEmitter-based double for AutoUpdaterLike. */
class FakeAutoUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = false;
  allowPrerelease = false;
  _channel: string | null = null;
  checkCalls = 0;
  downloadCalls = 0;
  quitAndInstallCalls: Array<[boolean | undefined, boolean | undefined]> = [];
  quitAndInstallImpl: (() => void) | null = null;
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
    if (this.quitAndInstallImpl) this.quitAndInstallImpl();
    else setImmediate(() => nativeAutoUpdater.emit("before-quit-for-update"));
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
  process.env.APPIMAGE = "/fake/Gutterpress.AppImage";
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

test("each check applies the current update-channel preference", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    const valuesAtCheck: Array<{ allowPrerelease: boolean; channel: string | null }> = [];
    let channel: "stable" | "beta" | "alpha" = "stable";
    fake.checkImpl = async () => {
      valuesAtCheck.push({ allowPrerelease: fake.allowPrerelease, channel: fake._channel });
      fake.emit("update-not-available");
      return null;
    };
    initUpdater(() => {}, {
      autoUpdater: fake,
      readUpdateChannel: () => channel,
    });

    await checkForUpdates();
    channel = "beta";
    await checkForUpdates();
    channel = "alpha";
    await checkForUpdates();
    // A beta→stable switch must reset the channel to null: electron-updater's
    // stable path fetches `<channel>.yml` when a channel is set, which the
    // GitHub provider never publishes — the check would fail with no fallback.
    channel = "stable";
    await checkForUpdates();

    expect(valuesAtCheck).toEqual([
      { allowPrerelease: false, channel: null },
      { allowPrerelease: true, channel: "beta" },
      { allowPrerelease: true, channel: "alpha" },
      { allowPrerelease: false, channel: null },
    ]);
  });
});

test("an unknown stored channel value is treated as stable, never a custom channel", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake._channel = "beta"; // left over from an earlier beta-channel check
    let applied: { allowPrerelease: boolean; channel: string | null } | null = null;
    fake.checkImpl = async () => {
      applied = { allowPrerelease: fake.allowPrerelease, channel: fake._channel };
      fake.emit("update-not-available");
      return null;
    };
    initUpdater(() => {}, {
      autoUpdater: fake,
      // A hand-edited settings file can hold anything; "rc" as a custom
      // channel would strand the user (electron-updater only matches it
      // against identical prerelease ids).
      readUpdateChannel: () => "rc" as unknown as "stable",
    });

    await checkForUpdates();

    expect(applied).toEqual({ allowPrerelease: false, channel: null });
  });
});

test("download failure reports a friendly message and remains available for retry", async () => {
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

    expect(status.phase).toBe("available");
    expect(status.availableVersion).toBe("2.0.0");
    expect(status.availableAction).toBe("download");
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

test("failed silent and manual re-checks preserve an available update action", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    initUpdater(() => {}, { autoUpdater: fake });
    await checkForUpdates();

    fake.checkImpl = async () => {
      throw new Error("net::ERR_INTERNET_DISCONNECTED");
    };
    const silent = await checkForUpdates({ silent: true });
    expect(silent.phase).toBe("available");
    expect(silent.availableVersion).toBe("2.0.0");
    expect(silent.availableAction).toBe("download");
    expect(silent.error).toBeNull();

    fake.checkImpl = async () => {
      throw new Error("feed parse failed");
    };
    const manual = await checkForUpdates();
    expect(manual.phase).toBe("available");
    expect(manual.availableVersion).toBe("2.0.0");
    expect(manual.availableAction).toBe("download");
    expect(manual.error).toBe(
      "Update check failed. You can download the latest version from GitHub.",
    );
  });
});

test("failed silent and manual re-checks preserve a staged update action", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    initUpdater(() => {}, { autoUpdater: fake });
    await checkForUpdates();
    await download();

    fake.checkImpl = async () => {
      throw new Error("getaddrinfo ENOTFOUND github.com");
    };
    const silent = await checkForUpdates({ silent: true });
    expect(silent.phase).toBe("staged");
    expect(silent.stagedVersion).toBe("2.0.0");
    expect(silent.error).toBeNull();

    fake.checkImpl = async () => {
      throw new Error("invalid update metadata");
    };
    const manual = await checkForUpdates();
    expect(manual.phase).toBe("staged");
    expect(manual.stagedVersion).toBe("2.0.0");
    expect(manual.error).toBe(
      "Update check failed. You can download the latest version from GitHub.",
    );
  });
});

test("a failed check cannot restore older state over a newer staged transition", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    initUpdater(() => {}, { autoUpdater: fake });
    await checkForUpdates();

    fake.checkImpl = async () => {
      fake.emit("update-downloaded", { version: "3.0.0" });
      const error = new Error("late check failure");
      fake.emit("error", error);
      throw error;
    };
    const status = await checkForUpdates();

    expect(status.phase).toBe("staged");
    expect(status.stagedVersion).toBe("3.0.0");
    expect(status.availableVersion).toBeNull();
    expect(status.error).toBeNull();
  });
});

test("a deferred failed check cannot corrupt a real completed download", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    initUpdater(() => {}, { autoUpdater: fake });
    await checkForUpdates();

    let rejectCheck!: (error: Error) => void;
    const deferredCheck = new Promise<never>((_resolve, reject) => {
      rejectCheck = reject;
    });
    fake.checkImpl = () => deferredCheck;
    const checking = checkForUpdates({ silent: true });

    const downloaded = await download();
    expect(downloaded.phase).toBe("staged");
    expect(downloaded.stagedVersion).toBe("2.0.0");

    const error = new Error("deferred check failed");
    fake.emit("error", error);
    rejectCheck(error);
    const status = await checking;

    expect(status.phase).toBe("staged");
    expect(status.stagedVersion).toBe("2.0.0");
    expect(status.error).toBeNull();
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
    initUpdater((e) => events.push(e), {
      autoUpdater: fake,
      prepareToInstall: async () => true,
    });

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

    const installResult = await installNow();
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

test("a failed download action can be retried without another check", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    let attempts = 0;
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      attempts++;
      if (attempts === 1) throw new Error("net::ERR_CONNECTION_RESET");
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    initUpdater(() => {}, { autoUpdater: fake });

    await checkForUpdates();
    const failed = await download();
    const retried = await download();

    expect(failed.phase).toBe("available");
    expect(failed.error).not.toBeNull();
    expect(retried.phase).toBe("staged");
    expect(retried.error).toBeNull();
    expect(fake.downloadCalls).toBe(2);
  });
});

test("Restart & Update never releases the lock or installs when renderer flush fails", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    const fake = new FakeAutoUpdater();
    let flushSucceeds = false;
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    initUpdater(() => {}, {
      autoUpdater: fake,
      prepareToInstall: async () => flushSucceeds,
    });
    await checkForUpdates();
    await download();

    const blocked = await installNow();
    expect(blocked.applied).toBe(false);
    expect(blocked.error).toContain("changes could not be saved");
    expect(releaseLockCalls).toBe(0);
    expect(requestLockCalls).toBe(0);
    expect(fake.quitAndInstallCalls).toEqual([]);

    flushSucceeds = true;
    expect(await installNow()).toEqual({ applied: true, version: "2.0.0" });
    expect(releaseLockCalls).toBe(1);
    expect(requestLockCalls).toBe(0);
    expect(fake.quitAndInstallCalls).toEqual([[false, true]]);
  });
});

test("a synchronous quitAndInstall throw reports install failure and reacquires the lock", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    requestLockResult = true;
    quitCalls = 0;
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    fake.quitAndInstallImpl = () => {
      throw new Error("installer exploded");
    };
    initUpdater(() => {}, {
      autoUpdater: fake,
      prepareToInstall: async () => true,
      installStartTimeoutMs: 20,
    });
    await checkForUpdates();
    await download();

    const result = await installNow();

    expect(result).toEqual({
      applied: false,
      error: "The update installer could not start. Try Restart & Update again.",
    });
    expect(getStatus().phase).toBe("staged");
    expect(getStatus().stagedVersion).toBe("2.0.0");
    expect(releaseLockCalls).toBe(1);
    expect(requestLockCalls).toBe(1);
    expect(quitCalls).toBe(0);
  });
});

test("lock-loss quit disables electron-updater's automatic installer retry", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    requestLockResult = false;
    quitCalls = 0;
    try {
      const fake = new FakeAutoUpdater();
      fake.checkImpl = async () => {
        fake.emit("update-available", { version: "2.0.0" });
        return null;
      };
      fake.downloadImpl = async () => {
        fake.emit("update-downloaded", { version: "2.0.0" });
      };
      fake.quitAndInstallImpl = () => {
        throw new Error("installer exploded");
      };
      electronUpdaterQuitHook = () => {
        if (fake.autoInstallOnAppQuit) fake.quitAndInstall(false, false);
      };
      initUpdater(() => {}, {
        autoUpdater: fake,
        prepareToInstall: async () => true,
      });
      await checkForUpdates();
      await download();

      const result = await installNow();

      expect(result.applied).toBe(false);
      expect(releaseLockCalls).toBe(1);
      expect(requestLockCalls).toBe(1);
      expect(quitCalls).toBe(1);
      expect(fake.autoInstallOnAppQuit).toBe(false);
      expect(fake.quitAndInstallCalls).toEqual([[false, true]]);
    } finally {
      electronUpdaterQuitHook = null;
      requestLockResult = true;
    }
  });
});

test("an asynchronous updater error is classified as install failure and restores the lock", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    fake.quitAndInstallImpl = () => {
      queueMicrotask(() => fake.emit("error", new Error("spawn EACCES")));
    };
    initUpdater(() => {}, {
      autoUpdater: fake,
      prepareToInstall: async () => true,
      installStartTimeoutMs: 20,
    });
    await checkForUpdates();
    await download();

    const result = await installNow();

    expect(result).toEqual({
      applied: false,
      error: "The update installer could not start because this account does not have permission.",
    });
    expect(getStatus().phase).toBe("staged");
    expect(getStatus().error).toContain("does not have permission");
    expect(releaseLockCalls).toBe(1);
    expect(requestLockCalls).toBe(1);
  });
});

test("quitAndInstall returning without a start signal does not claim success", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    fake.quitAndInstallImpl = () => {};
    initUpdater(() => {}, {
      autoUpdater: fake,
      prepareToInstall: async () => true,
      installStartTimeoutMs: 1,
    });
    await checkForUpdates();
    await download();

    const result = await installNow();

    expect(result.applied).toBe(false);
    expect(result.error).toContain("installer could not start");
    expect(releaseLockCalls).toBe(1);
    expect(requestLockCalls).toBe(1);
  });
});

test("install timeout starts after synchronous installer work returns", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    fake.quitAndInstallImpl = () => {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
      setImmediate(() => nativeAutoUpdater.emit("before-quit-for-update"));
    };
    initUpdater(() => {}, {
      autoUpdater: fake,
      prepareToInstall: async () => true,
      installStartTimeoutMs: 5,
    });
    await checkForUpdates();
    await download();

    const result = await installNow();

    expect(result).toEqual({ applied: true, version: "2.0.0" });
    expect(requestLockCalls).toBe(0);
  });
});

test("a missing staged installer is cleared and exposed as a fresh download action", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    requestLockResult = true;
    const events: Array<{ type: string; version?: string; action?: string }> = [];
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    fake.quitAndInstallImpl = () => {
      throw new Error("No update filepath");
    };
    initUpdater((event) => events.push(event), {
      autoUpdater: fake,
      prepareToInstall: async () => true,
    });
    await checkForUpdates();
    await download();

    const result = await installNow();
    const failedStatus = getStatus();

    expect(result).toEqual({
      applied: false,
      error: "The downloaded update is no longer available. Check for updates and download it again.",
    });
    expect(failedStatus.phase).toBe("available");
    expect(failedStatus.stagedVersion).toBeNull();
    expect(failedStatus.availableVersion).toBe("2.0.0");
    expect(failedStatus.availableAction).toBe("download");
    expect(events.at(-1)).toEqual({
      type: "available",
      version: "2.0.0",
      action: "download",
    });

    const recovered = await download();
    expect(recovered.phase).toBe("staged");
    expect(recovered.stagedVersion).toBe("2.0.0");
    expect(fake.downloadCalls).toBe(2);
  });
});

test("concurrent Apply calls share one flush and one installer attempt", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    let prepareCalls = 0;
    let releasePrepare!: () => void;
    const prepareGate = new Promise<void>((resolve) => {
      releasePrepare = resolve;
    });
    initUpdater(() => {}, {
      autoUpdater: fake,
      prepareToInstall: async () => {
        prepareCalls++;
        await prepareGate;
        return true;
      },
      installStartTimeoutMs: 100,
    });
    await checkForUpdates();
    await download();

    const first = installNow();
    const second = installNow();
    expect(second).toBe(first);
    releasePrepare();
    const [a, b] = await Promise.all([first, second]);

    expect(a).toEqual({ applied: true, version: "2.0.0" });
    expect(b).toEqual(a);
    expect(prepareCalls).toBe(1);
    expect(fake.quitAndInstallCalls).toHaveLength(1);
    expect(releaseLockCalls).toBe(1);
    expect(requestLockCalls).toBe(0);
  });
});

test("successful install waits for before-quit-for-update and leaves the lock released", async () => {
  await withAppImage(async () => {
    releaseLockCalls = 0;
    requestLockCalls = 0;
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      fake.emit("update-downloaded", { version: "2.0.0" });
    };
    initUpdater(() => {}, {
      autoUpdater: fake,
      prepareToInstall: async () => true,
      installStartTimeoutMs: 100,
    });
    await checkForUpdates();
    await download();

    const result = await installNow();

    expect(result).toEqual({ applied: true, version: "2.0.0" });
    expect(fake.quitAndInstallCalls).toEqual([[false, true]]);
    expect(releaseLockCalls).toBe(1);
    expect(requestLockCalls).toBe(0);
  });
});

test("macOS check uses GitHub semver ordering and never initializes electron-updater", async () => {
  mockedAppVersion = "1.9.0";
  try {
    const fake = new FakeAutoUpdater();
    const requests: Array<{ url: string; headers: Record<string, string>; signal: AbortSignal }> = [];
    const events: Array<{ type: string; version?: string; action?: string }> = [];
    initUpdater((event) => events.push(event), {
      autoUpdater: fake,
      platform: "darwin",
      fetch: async (url, init) => {
        requests.push({ url, headers: init.headers, signal: init.signal });
        return {
          ok: true,
          status: 200,
          json: async () => ({ tag_name: "v1.10.0" }),
        };
      },
    });

    expect(updaterSupported()).toBe(true);
    const status = await checkForUpdates({ silent: true });

    expect(status.phase).toBe("available");
    expect(status.availableVersion).toBe("1.10.0");
    expect(status.availableAction).toBe("open-release");
    expect(events).toContainEqual({
      type: "available",
      version: "1.10.0",
      action: "open-release",
    });
    expect(requests).toHaveLength(1);
    expect(requests[0]?.url).toBe(
      "https://api.github.com/repos/dimm-city/gutterpress/releases/latest",
    );
    expect(requests[0]?.headers["User-Agent"]).toBe("gutterpress/1.9.0");
    expect(requests[0]?.signal).toBeInstanceOf(AbortSignal);
    expect(fake.checkCalls).toBe(0);
    expect(fake.autoDownload).toBe(true);
    expect(fake.listenerCount("update-available")).toBe(0);
  } finally {
    mockedAppVersion = "1.0.0";
  }
});

test("macOS no-update result is idle and emits the existing up-to-date event", async () => {
  const fake = new FakeAutoUpdater();
  const events: Array<{ type: string }> = [];
  initUpdater((event) => events.push(event), {
    autoUpdater: fake,
    platform: "darwin",
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v1.0.0" }),
    }),
  });

  const status = await checkForUpdates();

  expect(status.phase).toBe("idle");
  expect(status.availableVersion).toBeNull();
  expect(status.availableAction).toBeNull();
  expect(status.error).toBeNull();
  expect(events).toContainEqual({ type: "uptodate" });
  expect(fake.checkCalls).toBe(0);
});

test("macOS GitHub lookup honors beta/alpha/stable channel filtering", async () => {
  mockedAppVersion = "1.0.0";
  let channel: "stable" | "beta" | "alpha" = "beta";
  const requests: string[] = [];
  const fake = new FakeAutoUpdater();
  initUpdater(() => {}, {
    autoUpdater: fake,
    platform: "darwin",
    readUpdateChannel: () => channel,
    fetch: async (url) => {
      requests.push(url);
      return {
        ok: true,
        status: 200,
        json: async () =>
          url.includes("?per_page=")
            ? [
                { tag_name: "v4.0.0-alpha.1" },
                { tag_name: "v3.0.0-beta.2" },
                { tag_name: "v2.5.0" },
              ]
            : { tag_name: "v2.5.0" },
      };
    },
  });

  const beta = await checkForUpdates();
  channel = "alpha";
  const alpha = await checkForUpdates();
  channel = "stable";
  const stable = await checkForUpdates();

  expect(beta.availableVersion).toBe("3.0.0-beta.2");
  expect(alpha.availableVersion).toBe("4.0.0-alpha.1");
  expect(stable.availableVersion).toBe("2.5.0");
  expect(requests).toEqual([
    "https://api.github.com/repos/dimm-city/gutterpress/releases?per_page=100",
    "https://api.github.com/repos/dimm-city/gutterpress/releases?per_page=100",
    "https://api.github.com/repos/dimm-city/gutterpress/releases/latest",
  ]);
});

test("silent macOS offline and rate-limited checks stay non-fatal with correct throttling", async () => {
  const offlineFake = new FakeAutoUpdater();
  initUpdater(() => {}, {
    autoUpdater: offlineFake,
    platform: "darwin",
    fetch: async () => {
      throw new Error("fetch failed");
    },
  });

  const offline = await checkForUpdates({ silent: true });
  expect(offline.phase).toBe("idle");
  expect(offline.error).toBeNull();
  expect(shouldBackgroundCheck()).toBe(true);

  const manualOffline = await checkForUpdates();
  expect(manualOffline.phase).toBe("error");
  expect(manualOffline.error).toBe(
    "Couldn't check for updates. Check your internet connection and try again.",
  );

  const rateLimitedFake = new FakeAutoUpdater();
  initUpdater(() => {}, {
    autoUpdater: rateLimitedFake,
    platform: "darwin",
    fetch: async () => ({
      ok: false,
      status: 403,
      json: async () => ({}),
    }),
  });

  const silentRateLimit = await checkForUpdates({ silent: true });
  expect(silentRateLimit.phase).toBe("idle");
  expect(silentRateLimit.error).toBeNull();
  expect(shouldBackgroundCheck()).toBe(false);

  const manualRateLimit = await checkForUpdates();
  expect(manualRateLimit.phase).toBe("error");
  expect(manualRateLimit.error).toBe(
    "Update checks are temporarily limited by GitHub. Try again later.",
  );
});

test("macOS download action opens GitHub and can never stage or install", async () => {
  const fake = new FakeAutoUpdater();
  const opened: string[] = [];
  initUpdater(() => {}, {
    autoUpdater: fake,
    platform: "darwin",
    fetch: async () => ({
      ok: true,
      status: 200,
      json: async () => ({ tag_name: "v2.0.0" }),
    }),
    openExternal: async (url) => {
      opened.push(url);
    },
  });

  await checkForUpdates();
  const status = await download();
  const installResult = await installNow();

  expect(opened).toEqual([
    "https://github.com/dimm-city/gutterpress/releases/tag/v2.0.0",
  ]);
  expect(status.phase).toBe("available");
  expect(status.availableAction).toBe("open-release");
  expect(fake.downloadCalls).toBe(0);
  expect(installResult).toEqual({ applied: false });
  expect(fake.quitAndInstallCalls).toHaveLength(0);
});

// ── Rate limiting is one condition, not one per platform ──────────────────
// GitHub's unauthenticated limit is 60 requests/hour per IP, shared with
// everything else on the machine. The app's own REST calls (the check-only
// macOS path) already classify a 403/429 as rate limiting. On Windows/Linux
// electron-updater's provider makes the request itself and surfaces only a
// message string — so the raw string has to be classified the same way, or
// the identical condition names itself on one platform and reads as a bare
// "Update check failed" on the other.
const RATE_LIMIT_MESSAGE =
  "Update checks are temporarily limited by GitHub. Try again later.";
const RATE_LIMIT_MESSAGE_DOWNLOAD =
  "Update downloads are temporarily limited by GitHub. Try again later.";

test("user-initiated check: an electron-updater rate-limit error names the throttling", async () => {
  await withAppImage(async () => {
    for (const raw of [
      "HttpError: 403 rate limit exceeded",
      'Cannot download "https://api.github.com/repos/dimm-city/gutterpress/releases/latest", HTTP 403',
      "HttpError: 429 Too Many Requests",
    ]) {
      const fake = new FakeAutoUpdater();
      fake.checkImpl = async () => {
        throw new Error(raw);
      };
      initUpdater(() => {}, { autoUpdater: fake });

      const status = await checkForUpdates();

      expect(status.phase).toBe("error");
      expect(status.error).toBe(RATE_LIMIT_MESSAGE);
    }
  });
});

test("silent check: an electron-updater rate-limit error stays quiet and keeps the throttle window", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      throw new Error("HttpError: 403 rate limit exceeded");
    };
    initUpdater(() => {}, { autoUpdater: fake });

    const status = await checkForUpdates({ silent: true });

    // Exactly what the macOS path already does with a GitHubRateLimitError: a
    // background check never latches a banner, and the completed-check
    // timestamp stands so focus events cannot hammer a throttled endpoint.
    expect(status.phase).toBe("idle");
    expect(status.error).toBeNull();
    expect(shouldBackgroundCheck()).toBe(false);
  });
});

test("download failure: a rate-limit error names the throttling too", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      fake.emit("update-available", { version: "2.0.0" });
      return null;
    };
    fake.downloadImpl = async () => {
      throw new Error('Cannot download "https://api.github.com/…", HTTP 403');
    };
    initUpdater(() => {}, { autoUpdater: fake });

    await checkForUpdates();
    const status = await download();

    expect(status.phase).toBe("available");
    expect(status.error).toBe(RATE_LIMIT_MESSAGE_DOWNLOAD);
  });
});

test("a failed check records the raw error for diagnostics", async () => {
  await withAppImage(async () => {
    const fake = new FakeAutoUpdater();
    fake.checkImpl = async () => {
      throw new Error("HttpError: 403 rate limit exceeded");
    };
    initUpdater(() => {}, { autoUpdater: fake });

    const logged: string[] = [];
    const realConsoleError = console.error;
    console.error = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    try {
      await checkForUpdates();
    } finally {
      console.error = realConsoleError;
    }

    // The author only ever sees the friendly message. Without the raw string
    // recorded in the main process, a failed check cannot be diagnosed after
    // the fact — which is exactly how the incident behind this change ended
    // unresolved.
    expect(
      logged.some((line) => line.includes("HttpError: 403 rate limit exceeded")),
    ).toBe(true);
  });
});
