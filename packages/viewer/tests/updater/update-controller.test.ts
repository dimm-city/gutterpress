import { expect, mock, test } from "bun:test";

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

const platform = {
  updater: {
    getStatus: async () => status,
    check: async () => status,
    download: async () => status,
    applyNow: async () => applyResult,
    onEvent: (cb: (event: Record<string, unknown>) => void) => {
      eventHandler = cb;
      return () => {
        if (eventHandler === cb) eventHandler = null;
      };
    },
  },
};

mock.module("$lib/platform", () => ({
  getPlatform: () => platform,
  isDesktop: () => true,
}));

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
