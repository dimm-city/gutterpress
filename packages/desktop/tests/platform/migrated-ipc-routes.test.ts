/**
 * ARCH review #8 — "narrow IPC bridge" cleanup:
 *
 *  1. sync:setAutoSync, remote:cloneRepository, remote:resolveSyncConflicts,
 *     updater:getStatus/check/download were plain request/response IPC
 *     channels despite their remote: and updater: siblings already being
 *     server routes. These tests exercise the ROUTE versions (factory-level:
 *     validate() + hooks wiring + the 503/400 envelopes), not electron/main.ts
 *     directly.
 *  2. fs:watchFolder's dead route + the dead api.fs.watchFolder/unwatchFolder,
 *     api.app.flushDone, and api.status() client wrappers are gone — grep
 *     assertions lock that (the IPC path stays the live one for watchFolder;
 *     app:flushDone stays IPC for the reason documented at its call site).
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
import { POST as setAutoSyncRoute } from "../../src/routes/api/sync/set-auto-sync/+server";
import { POST as cloneRepositoryRoute } from "../../src/routes/api/remote/clone-repository/+server";
import { GET as updaterGetStatusRoute } from "../../src/routes/api/updater/get-status/+server";
import { POST as updaterCheckRoute } from "../../src/routes/api/updater/check/+server";
import { POST as updaterDownloadRoute } from "../../src/routes/api/updater/download/+server";

function request(body?: unknown): Request {
  return body === undefined
    ? new Request("http://local.test")
    : new Request("http://local.test", {
        method: "POST",
        body: JSON.stringify(body),
        headers: { "content-type": "application/json" },
      });
}

async function caught(p: Promise<unknown>): Promise<{ status: number; message: unknown }> {
  try {
    await p;
    throw new Error("expected the promise to reject, but it resolved");
  } catch (e) {
    if (!isHttpError(e)) throw e;
    return { status: e.status, message: (e.body as { message?: unknown }).message };
  }
}

/**
 * The shared base fake, with remote/sync/updater defaulting to "not
 * registered" (undefined) — each describe block below overrides the ONE it's
 * testing per-test; the 503 tests rely on this default.
 *
 * `fsGuard` models an OPEN project at `/abs/project`: `remote/*` routes now
 * confine their `projectDir` to the host-owned `projectRoots()` allow-list
 * (2026-07-29 audit), so these tests have to say which project is open before
 * they can exercise anything downstream of that check. The containment check
 * canonicalizes lexically for a path that doesn't exist on disk, so the
 * synthetic `/abs/project` works without touching the filesystem.
 * Out-of-project rejection itself is covered in route-scoping.test.ts.
 */
function baseServices(): HostServices {
  return makeHostServices({
    remote: undefined,
    sync: undefined,
    updater: undefined,
    fsGuard: { projectRoots: () => ["/abs/project"], readOnlyRoots: () => [] as string[] },
  });
}

afterEach(() => {
  // Fully UN-register (not just reset to an all-hooks-missing fake) — bun's
  // test file execution order is not alphabetical/deterministic, and
  // `__gutterpressHost__` is one process-wide globalThis key (host-services.ts),
  // so leaving even a "safe" fake object registered here would leak into
  // host-services.test.ts's "returns null before registration" assertion
  // if that file happens to run after this one.
  registerHostServices(undefined as unknown as HostServices);
});

// ── sync/set-auto-sync ───────────────────────────────────────────────────────

describe("POST /api/sync/set-auto-sync", () => {
  test("400 when enabled is not a boolean", async () => {
    registerHostServices({ ...baseServices(), sync: { setAutoSync: async () => ({ ok: true, autoSync: true }) } });
    const { status, message } = await caught(setAutoSyncRoute({ request: request({ enabled: "yes" }) } as never));
    expect(status).toBe(400);
    expect(message).toBe("sync:setAutoSync requires a boolean");
  });

  test("503 when sync hooks are not registered", async () => {
    registerHostServices(baseServices());
    const { status, message } = await caught(setAutoSyncRoute({ request: request({ enabled: true }) } as never));
    expect(status).toBe(503);
    expect(message).toBe("Sync settings hooks not registered");
  });

  test("calls hooks.setAutoSync with the validated boolean and returns its result", async () => {
    const calls: boolean[] = [];
    registerHostServices({
      ...baseServices(),
      sync: {
        setAutoSync: async (enabled: boolean) => {
          calls.push(enabled);
          return { ok: true, autoSync: enabled };
        },
      },
    });
    const res = await setAutoSyncRoute({ request: request({ enabled: false }) } as never);
    expect(await res.json()).toEqual({ ok: true, autoSync: false });
    expect(calls).toEqual([false]);
  });
});

// ── remote/clone-repository ──────────────────────────────────────────────────

describe("POST /api/remote/clone-repository", () => {
  const remoteBase = { loadLib: async () => ({}), tokenStore: {} as never, GITHUB_HOST: "github.com" };

  test("400 when url is missing", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, cloneRepository: async () => ({ projectDir: "/x" }), resolveSyncConflicts: async () => { throw new Error("unused"); } } as never,
    });
    const { status, message } = await caught(
      cloneRepositoryRoute({ request: request({ parentDir: "/abs" }) } as never),
    );
    expect(status).toBe(400);
    expect(message).toBe("remote:cloneRepository requires { url, parentDir, folderName }");
  });

  test("400 when parentDir is relative", async () => {
    registerHostServices({
      ...baseServices(),
      remote: { ...remoteBase, cloneRepository: async () => ({ projectDir: "/x" }), resolveSyncConflicts: async () => { throw new Error("unused"); } } as never,
    });
    const { status } = await caught(
      cloneRepositoryRoute({ request: request({ url: "https://x/y.git", parentDir: "rel" }) } as never),
    );
    expect(status).toBe(400);
  });

  test("503 when remote hooks are not registered", async () => {
    registerHostServices(baseServices());
    const { status, message } = await caught(
      cloneRepositoryRoute({ request: request({ url: "https://x/y.git", parentDir: "/abs" }) } as never),
    );
    expect(status).toBe(503);
    expect(message).toBe("Remote hooks not available");
  });

  test("calls hooks.cloneRepository with the validated body and returns its result", async () => {
    const calls: unknown[] = [];
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        cloneRepository: async (args: unknown) => {
          calls.push(args);
          return { projectDir: "/abs/my-repo" };
        },
        resolveSyncConflicts: async () => { throw new Error("unused"); },
      } as never,
    });
    const res = await cloneRepositoryRoute({
      request: request({ url: "https://x/y.git", parentDir: "/abs", folderName: "my-repo" }),
    } as never);
    expect(await res.json()).toEqual({ projectDir: "/abs/my-repo" });
    expect(calls).toEqual([{ url: "https://x/y.git", parentDir: "/abs", folderName: "my-repo" }]);
  });

  test("a hooks.cloneRepository rejection is sanitized (handleRemoteErrors), not left raw", async () => {
    registerHostServices({
      ...baseServices(),
      remote: {
        ...remoteBase,
        cloneRepository: async () => {
          throw new Error("some internal isomorphic-git stack trace detail");
        },
        resolveSyncConflicts: async () => { throw new Error("unused"); },
      } as never,
    });
    const { status, message } = await caught(
      cloneRepositoryRoute({ request: request({ url: "https://x/y.git", parentDir: "/abs" }) } as never),
    );
    expect(status).toBe(500);
    expect(message).toBe(
      "The online repository operation could not be completed. See the app log for details.",
    );
  });
});

// ── updater/get-status, updater/check, updater/download ─────────────────────

describe("updater server routes", () => {
  test("get-status: 503 when updater hooks are not registered", async () => {
    registerHostServices(baseServices());
    const { status, message } = await caught(updaterGetStatusRoute({ request: request() } as never));
    expect(status).toBe(503);
    expect(message).toBe("Updater hooks not registered");
  });

  test("get-status: calls hooks.getStatus and returns its result", async () => {
    const fakeStatus = { currentVersion: "1.0.0", stagedVersion: null, availableVersion: null, availableAction: null, phase: "idle", error: null };
    registerHostServices({
      ...baseServices(),
      updater: { getStatus: () => fakeStatus, check: async () => fakeStatus, download: async () => fakeStatus },
    });
    const res = await updaterGetStatusRoute({ request: request() } as never);
    expect(await res.json()).toEqual(fakeStatus);
  });

  test("check: calls hooks.check (the non-silent, user-initiated form)", async () => {
    let calls = 0;
    const fakeStatus = { currentVersion: "1.0.0", stagedVersion: null, availableVersion: "1.1.0", availableAction: "download" as const, phase: "available", error: null };
    registerHostServices({
      ...baseServices(),
      updater: {
        getStatus: () => fakeStatus,
        check: async () => {
          calls++;
          return fakeStatus;
        },
        download: async () => fakeStatus,
      },
    });
    const res = await updaterCheckRoute({ request: request({}) } as never);
    expect(await res.json()).toEqual(fakeStatus);
    expect(calls).toBe(1);
  });

  test("download: calls hooks.download and returns its result", async () => {
    const fakeStatus = { currentVersion: "1.0.0", stagedVersion: "1.1.0", availableVersion: null, availableAction: null, phase: "staged", error: null };
    registerHostServices({
      ...baseServices(),
      updater: { getStatus: () => fakeStatus, check: async () => fakeStatus, download: async () => fakeStatus },
    });
    const res = await updaterDownloadRoute({ request: request({}) } as never);
    expect(await res.json()).toEqual(fakeStatus);
  });
});

// ── Deleted dead duplicates (ARCH review #8) ─────────────────────────────────

describe("dead fs:watchFolder route + dead client wrappers are gone", () => {
  test("the /api/fs/watch-folder and /api/fs/unwatch-folder route folders no longer exist", async () => {
    for (const rel of ["src/routes/api/fs/watch-folder/+server.ts", "src/routes/api/fs/unwatch-folder/+server.ts"]) {
      const p = path.resolve(__dirname, "../..", rel);
      await expect(readFile(p, "utf-8")).rejects.toThrow();
    }
  });

  test("api.ts no longer exposes fs.watchFolder/unwatchFolder, app.flushDone, or a top-level status()", async () => {
    const src = await readFile(path.resolve(__dirname, "../../src/lib/api.ts"), "utf-8");
    expect(src).not.toMatch(/watchFolder:\s*\(/);
    expect(src).not.toMatch(/unwatchFolder:\s*\(/);
    expect(src).not.toMatch(/flushDone:\s*\(/);
    expect(src).not.toMatch(/^\s*status:\s*\(\)\s*=>/m);
    // The routes/wrappers they backed are gone; api.fs.watchFolder's sibling
    // (statFile) must still be present — proves this isn't a wholesale
    // deletion of the fs namespace.
    expect(src).toMatch(/statFile:\s*\(/);
  });

  test("preload.ts no longer registers the migrated IPC channels", async () => {
    const src = await readFile(path.resolve(__dirname, "../../electron/preload.ts"), "utf-8");
    for (const channel of [
      '"updater:getStatus"',
      '"updater:check"',
      '"updater:download"',
      '"sync:setAutoSync"',
      '"remote:cloneRepository"',
      '"remote:resolveSyncConflicts"',
    ]) {
      expect(src).not.toContain(channel);
    }
    // The push channels + the live-BrowserWindow applyNow call stay.
    expect(src).toContain('"updater:applyNow"');
    expect(src).toContain('"remote:cloneProgress"');
    expect(src).toContain('"sync:status"');
  });

  test("main.ts no longer registers secureHandle for the migrated channels", async () => {
    const src = await readFile(path.resolve(__dirname, "../../electron/main.ts"), "utf-8");
    for (const channel of [
      'secureHandle("updater:getStatus"',
      'secureHandle("updater:check"',
      'secureHandle("updater:download"',
      'secureHandle("sync:setAutoSync"',
      'secureHandle("remote:cloneRepository"',
      'secureHandle("remote:resolveSyncConflicts"',
    ]) {
      expect(src).not.toContain(channel);
    }
    // fs:watchFolder/unwatchFolder and updater:applyNow stay IPC.
    expect(src).toContain('secureHandle("fs:watchFolder"');
    expect(src).toContain('secureHandle("fs:unwatchFolder"');
    expect(src).toContain('secureHandle("updater:applyNow"');
  });
});
