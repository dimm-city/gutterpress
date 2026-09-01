/**
 * ARCH review #8 — "narrow IPC bridge" cleanup:
 *
 *  1. updater:getStatus/check/download were plain request/response IPC
 *     channels despite their remote:/sync: siblings already being server
 *     routes. These tests exercise the ROUTE versions (factory-level:
 *     validate() + hooks wiring + the 503/400 envelopes), not electron/main.ts
 *     directly. sync:setAutoSync and remote:cloneRepository were the same
 *     kind of exception — SFE-P5c3 reversed that framing (D10: converge on
 *     typed IPC) and restored the WHOLE `remote`/`sync`/`publish` group to
 *     IPC; their route-level coverage moved to `remote-ipc.test.ts`/
 *     `publish-ipc.test.ts`, which exercise `electron/api/remote.ts`/
 *     `publish.ts` directly (the routes themselves are deleted).
 *  2. fs:watchFolder's dead route + the dead api.fs.watchFolder/unwatchFolder,
 *     api.app.flushDone, and api.status() client wrappers are gone — grep
 *     assertions lock that (the IPC path stays the live one for watchFolder;
 *     app:flushDone stays IPC for the reason documented at its call site).
 */
import { afterEach, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { isHttpError } from "@sveltejs/kit";
import {
  registerHostServices,
  type HostServices,
} from "../../electron/server-bridge/host-services";
import { makeHostServices } from "../support/host-services-fake";
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
 * The shared base fake, with updater defaulting to "not registered"
 * (undefined) — the 503 test relies on this default. remote/sync route-level
 * coverage moved to `remote-ipc.test.ts`/`publish-ipc.test.ts` (SFE-P5c3:
 * those routes are deleted, restored to IPC).
 */
function baseServices(): HostServices {
  return makeHostServices({ updater: undefined });
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
    // SFE-P5c1: fs/dialog/shell/log/app moved wholesale to typed IPC —
    // `statFile` (fs's own sibling this test used to pin as "still there,
    // proving the earlier cleanup wasn't a wholesale deletion") is gone from
    // api.ts NOW, on purpose, along with the rest of those five namespaces.
    // See migrated-ipc-routes.test.ts's own header for the ARCH review #8
    // scope this describe block still covers (updater, the last plain
    // request/response exception); the fs/dialog/shell/log/app IPC
    // migration itself is covered by fs-capability.test.ts /
    // dialog-capability.test.ts / app-lifecycle-capability.test.ts.
    expect(src).not.toMatch(/statFile:\s*\(/);
    expect(src).not.toContain("dialog: {");
    expect(src).not.toContain("shell: {");
    expect(src).not.toContain("log: {");
    expect(src).not.toMatch(/^\s*app:\s*\{/m);
  });

  test("preload.ts exposes the fs/dialog/shell/log/app IPC channels api.ts no longer carries", async () => {
    const src = await readFile(path.resolve(__dirname, "../../electron/preload.ts"), "utf-8");
    for (const channel of [
      '"fs:readFile"',
      '"fs:writeFile"',
      '"fs:statFile"',
      '"fs:listDir"',
      '"fs:createFile"',
      '"fs:createFolder"',
      '"fs:rename"',
      '"fs:delete"',
      '"dialog:openDirectory"',
      '"dialog:savePdf"',
      '"dialog:pickImageFile"',
      '"dialog:pickImageFiles"',
      '"shell:openExternal"',
      '"shell:showInFolder"',
      '"log:read"',
      '"log:list"',
      '"app:getDesktopPrefs"',
      '"app:setSettings"',
      '"app:appImageIntegrationStatus"',
    ]) {
      expect(src).toContain(channel);
    }
  });

  test("preload.ts no longer registers the migrated (still-HTTP) IPC channels", async () => {
    const src = await readFile(path.resolve(__dirname, "../../electron/preload.ts"), "utf-8");
    for (const channel of [
      '"updater:getStatus"',
      '"updater:check"',
      '"updater:download"',
      // Dead — removed before this run (sync always converges); never on IPC.
      '"remote:resolveSyncConflicts"',
    ]) {
      expect(src).not.toContain(channel);
    }
    // The push channels + the live-BrowserWindow applyNow call stay.
    expect(src).toContain('"updater:applyNow"');
    expect(src).toContain('"remote:cloneProgress"');
    expect(src).toContain('"sync:status"');
    // sync:setAutoSync / remote:cloneRepository — SFE-P5c3: restored to IPC
    // (the whole remote/sync/publish group), so these ARE present again.
    expect(src).toContain('"sync:setAutoSync"');
    expect(src).toContain('"remote:cloneRepository"');
  });

  test("main.ts no longer registers secureHandle for updater (still HTTP) or dead channels", async () => {
    const src = await readFile(path.resolve(__dirname, "../../electron/main.ts"), "utf-8");
    for (const channel of [
      'secureHandle("updater:getStatus"',
      'secureHandle("updater:check"',
      'secureHandle("updater:download"',
      'secureHandle("remote:resolveSyncConflicts"',
    ]) {
      expect(src).not.toContain(channel);
    }
    // fs:watchFolder/unwatchFolder and updater:applyNow stay IPC.
    expect(src).toContain('secureHandle("fs:watchFolder"');
    expect(src).toContain('secureHandle("fs:unwatchFolder"');
    expect(src).toContain('secureHandle("updater:applyNow"');
    // sync:setAutoSync / remote:cloneRepository — SFE-P5c3: restored to IPC.
    expect(src).toContain('secureHandle("sync:setAutoSync"');
    expect(src).toContain('secureHandle("remote:cloneRepository"');
  });
});
