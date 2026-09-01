import { afterAll, expect, spyOn, test } from "bun:test";
import * as platformModule from "$lib/platform";
import * as updaterCapability from "$lib/update/updater-capability";

(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

let eventHandler: ((event: Record<string, unknown>) => void) | null = null;
let status = {
  currentVersion: "1.0.0",
  stagedVersion: null as string | null,
  availableVersion: "2.0.0" as string | null,
  availableAction: "download" as "download" | "open-release" | null,
  phase: "available",
  error: null as string | null,
};
let applyResult: { applied: boolean; version?: string; error?: string } = { applied: false };

// WHY spyOn + mockRestore, NOT mock.module: `mock.module()` replaces the
// module in Bun's SHARED, process-wide resolution registry, keyed by the
// RESOLVED file path — "$lib/platform" here and the relative
// "../../src/lib/platform/index" that tests/platform/adapter.test.ts and
// tests/recovery/platform-recovery-seam.test.ts import both resolve to the
// same absolute src/lib/platform/index.ts. The previous `mock.module`
// substitution here was therefore visible to every later test file, not just
// this one, and `bun test --isolate` does NOT sandbox it (same caveat already
// called out for `mock.module("electron", …)` in tests/platform/
// app-protocol.test.ts and friends).
//
// Wrapping the old `mock.module` in `afterAll(() => mock.restore())` was
// tried first and does NOT fix this: verified by reproduction that the
// pollution still reaches a second file even when that file imports the
// exact same "$lib/platform" specifier this one mocked. `mock.restore()` is
// documented for undoing `spyOn`; it is not a reliable way to reverse a
// `mock.module` registry substitution for this module in this codebase.
// `spyOn` avoids the whole class of problem: it patches the live export
// bindings on the REAL module object that every other file's named imports
// are already bound to (no registry substitution, no missing exports), so
// `mockRestore()` in `afterAll` hands the real implementation back
// deterministically. Same discipline
// packages/cli/src/checks/pdf/structured-check-result.test.ts documents.
//
// SFE-P5b: `update-controller.svelte.ts` no longer calls `getPlatform()` —
// it imports the five updater-capability functions directly — so this test
// now spies on THAT module instead, same spyOn/mockRestore discipline,
// following the "capability modules or the bridge accessor" migration the
// run specification calls for. `isDesktop()` is still spied on `$lib/platform`
// (its real implementation, re-exported from `./bridge`, is unchanged).
spyOn(updaterCapability, "getUpdaterStatus").mockImplementation(async () => status);
spyOn(updaterCapability, "checkForUpdate").mockImplementation(async () => status);
spyOn(updaterCapability, "downloadUpdate").mockImplementation(async () => status);
spyOn(updaterCapability, "applyUpdateNow").mockImplementation(async () => applyResult);
spyOn(updaterCapability, "onUpdaterEvent").mockImplementation(
  (cb: (event: Record<string, unknown>) => void) => {
    eventHandler = cb;
    return () => {
      if (eventHandler === cb) eventHandler = null;
    };
  },
);
spyOn(platformModule, "isDesktop").mockImplementation(() => true);

afterAll(() => {
  (updaterCapability.getUpdaterStatus as unknown as { mockRestore: () => void }).mockRestore();
  (updaterCapability.checkForUpdate as unknown as { mockRestore: () => void }).mockRestore();
  (updaterCapability.downloadUpdate as unknown as { mockRestore: () => void }).mockRestore();
  (updaterCapability.applyUpdateNow as unknown as { mockRestore: () => void }).mockRestore();
  (updaterCapability.onUpdaterEvent as unknown as { mockRestore: () => void }).mockRestore();
  (platformModule.isDesktop as unknown as { mockRestore: () => void }).mockRestore();
});

const { UpdateController } = await import("../../src/lib/update/update-controller.svelte");

test("uptodate clears a stale available banner in renderer state", async () => {
  status = {
    currentVersion: "1.0.0",
    stagedVersion: null,
    availableVersion: "2.0.0",
    availableAction: "download",
    phase: "available",
    error: null,
  };
  const controller = new UpdateController(() => null);
  const off = controller.init();
  await Promise.resolve();
  await Promise.resolve();
  expect(controller.availableVersion).toBe("2.0.0");

  eventHandler?.({ type: "uptodate" });

  expect(controller.availableVersion).toBeNull();
  expect(controller.availableAction).toBeNull();
  off?.();
});

test("failed updater actions retain retryable renderer state", async () => {
  const errors: string[] = [];
  const controller = new UpdateController(() => ({ error: (message) => errors.push(message) }));
  controller.availableVersion = "2.0.0";
  controller.availableAction = "download";
  status = {
    currentVersion: "1.0.0",
    stagedVersion: null,
    availableVersion: "2.0.0",
    availableAction: "download",
    phase: "available",
    error: "Download failed. Try again.",
  };

  await controller.download();

  expect(controller.availableVersion).toBe("2.0.0");
  expect(controller.availableAction).toBe("download");
  expect(errors).toContain("Download failed. Try again.");

  controller.readyVersion = "2.0.0";
  status = {
    currentVersion: "1.0.0",
    stagedVersion: "2.0.0",
    availableVersion: null,
    availableAction: null,
    phase: "staged",
    error: "Save failed. Try again.",
  };
  applyResult = { applied: false, error: "Save failed. Try again." };
  await controller.applyNow();
  expect(controller.readyVersion).toBe("2.0.0");
  expect(errors).toContain("Save failed. Try again.");
});

test("missing installer failure clears ready state and exposes download recovery", async () => {
  const errors: string[] = [];
  const controller = new UpdateController(() => ({ error: (message) => errors.push(message) }));
  controller.readyVersion = "2.0.0";
  status = {
    currentVersion: "1.0.0",
    stagedVersion: null,
    availableVersion: "2.0.0",
    availableAction: "download",
    phase: "available",
    error: "The downloaded update is no longer available. Check for updates and download it again.",
  };
  applyResult = { applied: false, error: status.error };

  await controller.applyNow();

  expect(controller.readyVersion).toBeNull();
  expect(controller.availableVersion).toBe("2.0.0");
  expect(controller.availableAction).toBe("download");
  expect(controller.bannerDismissed).toBe(false);
  expect(errors).toContain(status.error);
});

test("failed re-check feedback does not clear available or staged banner actions", async () => {
  const errors: string[] = [];
  const controller = new UpdateController(() => ({ error: (message) => errors.push(message) }));
  status = {
    currentVersion: "1.0.0",
    stagedVersion: null,
    availableVersion: "2.0.0",
    availableAction: "download",
    phase: "available",
    error: "Update check failed. Try again.",
  };

  await controller.check();
  expect(controller.availableVersion).toBe("2.0.0");
  expect(controller.availableAction).toBe("download");
  expect(errors).toContain("Update check failed. Try again.");

  status = {
    currentVersion: "1.0.0",
    stagedVersion: "2.0.0",
    availableVersion: null,
    availableAction: null,
    phase: "staged",
    error: "Update check failed again.",
  };
  await controller.check();
  expect(controller.readyVersion).toBe("2.0.0");
  expect(errors).toContain("Update check failed again.");
});
