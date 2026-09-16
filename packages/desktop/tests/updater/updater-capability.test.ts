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
// directly. SFE-P5c4: getStatus/check/download joined applyNow/onEvent on
// the IPC bridge (ARCH review #8's HTTP+IPC fan-out collapsed to one
// transport) — every member below now delegates 1:1 to `window.electron`,
// no `fetch` involved. Repair round 1: getStatus/check/download gained the
// same `call()` scrub every other capability module uses (run rule 2), and
// with it moved from a plain function to `async function` — the SYNCHRONOUS
// off-host throw the test below used to pin is now a rejected promise.

afterEach(() => {
  // @ts-expect-error test global
  globalThis.window = undefined;
});

test("getUpdaterStatus/checkForUpdate/downloadUpdate delegate 1:1 to the bridge, not fetch", async () => {
  const status = { currentVersion: "1.0.0", stagedVersion: null, availableVersion: null, availableAction: null, phase: "idle", error: null };
  const bridgeCalls: string[] = [];
  // @ts-expect-error test global
  globalThis.window = {
    electron: {
      updater: {
        getStatus: async () => {
          bridgeCalls.push("getStatus");
          return status;
        },
        check: async () => {
          bridgeCalls.push("check");
          return status;
        },
        download: async () => {
          bridgeCalls.push("download");
          return status;
        },
      },
    },
  };
  await expect(getUpdaterStatus()).resolves.toEqual(status as never);
  await expect(checkForUpdate()).resolves.toEqual(status as never);
  await expect(downloadUpdate()).resolves.toEqual(status as never);
  expect(bridgeCalls).toEqual(["getStatus", "check", "download"]);
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

test("getUpdaterStatus/checkForUpdate/downloadUpdate reject without a desktop host (no fetch fallback)", async () => {
  // bridge() throws SYNCHRONOUSLY (fail loudly, not partially — SFE-P5a/P5b),
  // but these three are `async function` forwarders (repair round 1, so the
  // shared `call()` scrub can wrap the rejection) — an async function body
  // converts a synchronous throw into a REJECTED PROMISE, so callers that
  // `.catch()`/`await`-in-`try` (e.g. `+page.svelte`'s
  // `getDoctorDiagnostics().then().catch()` sibling) see it consistently.
  await expect(getUpdaterStatus()).rejects.toThrow(/desktop host required/);
  await expect(checkForUpdate()).rejects.toThrow(/desktop host required/);
  await expect(downloadUpdate()).rejects.toThrow(/desktop host required/);
});

test("getUpdaterStatus/checkForUpdate/downloadUpdate scrub the Electron IPC transport prefix off a rejection", async () => {
  const reject = () => Promise.reject(new Error("Error invoking remote method 'updater:check': Error: Updater hooks not registered"));
  // @ts-expect-error test global
  globalThis.window = {
    electron: {
      updater: { getStatus: reject, check: reject, download: reject },
    },
  };
  await expect(getUpdaterStatus()).rejects.toThrow("Updater hooks not registered");
  await expect(checkForUpdate()).rejects.toThrow("Updater hooks not registered");
  await expect(downloadUpdate()).rejects.toThrow("Updater hooks not registered");
});
