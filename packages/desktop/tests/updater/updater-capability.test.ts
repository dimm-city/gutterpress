import { afterEach, beforeEach, expect, test } from "bun:test";
import {
  applyUpdateNow,
  checkForUpdate,
  downloadUpdate,
  getUpdaterStatus,
  onUpdaterEvent,
} from "../../src/lib/update/updater-capability";

// SFE-P5b: replaces the `updater.*` slice of tests/platform/adapter.test.ts's
// "ElectronAdapter" delegation tests, now exercising the capability module
// directly — same real split it preserves: getStatus/check/download go
// through the HTTP route client (stubbed fetch, matching the old adapter
// test's own `globalThis.fetch` stub technique), applyNow/onEvent stay on
// the IPC bridge (stubbed window.electron, matching bridge.test.ts).

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  // @ts-expect-error test global
  globalThis.window = undefined;
});

test("getUpdaterStatus/checkForUpdate/downloadUpdate go through the HTTP route client, not the bridge", async () => {
  const calls: string[] = [];
  const status = { currentVersion: "1.0.0", stagedVersion: null, availableVersion: null, availableAction: null, phase: "idle", error: null };
  // @ts-expect-error test global
  globalThis.fetch = async (url: string) => {
    calls.push(url);
    return { ok: true, json: async () => status };
  };
  // No window.electron at all — proves these three never touch the bridge.
  await expect(getUpdaterStatus()).resolves.toEqual(status as never);
  await expect(checkForUpdate()).resolves.toEqual(status as never);
  await expect(downloadUpdate()).resolves.toEqual(status as never);
  expect(calls).toEqual([
    "/api/updater/get-status",
    "/api/updater/check",
    "/api/updater/download",
  ]);
});

test("applyUpdateNow/onUpdaterEvent delegate 1:1 to the bridge (live-BrowserWindow flush + push subscription)", async () => {
  const bridgeCalls: string[] = [];
  let eventHandler: ((event: unknown) => void) | null = null;
  // @ts-expect-error test global
  globalThis.window = {
    electron: {
      updater: {
        applyNow: async () => {
          bridgeCalls.push("applyNow");
          return { applied: true, version: "2.0.0" };
        },
        onEvent: (cb: (event: unknown) => void) => {
          bridgeCalls.push("onEvent");
          eventHandler = cb;
          return () => {
            if (eventHandler === cb) eventHandler = null;
          };
        },
      },
    },
  };

  await expect(applyUpdateNow()).resolves.toEqual({ applied: true, version: "2.0.0" });

  const seen: unknown[] = [];
  const off = onUpdaterEvent((event) => seen.push(event));
  eventHandler?.({ type: "available", version: "2.0.0", action: "download" });
  expect(seen).toEqual([{ type: "available", version: "2.0.0", action: "download" }]);
  off();
  expect(eventHandler).toBeNull();

  expect(bridgeCalls).toEqual(["applyNow", "onEvent"]);
});
