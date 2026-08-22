/**
 * RecoveryUiController — the repair-overlay state machine (2026-08-14
 * simplification: the guidance/confirm dialog surfaces are gone; repair is
 * one automatic pipeline behind the overlay's recovering/recovered states).
 */
import { expect, test } from "bun:test";
import { RecoveryUiController } from "../../src/lib/routes/recovery-ui-controller.svelte";
import type { SyncStatus } from "../../src/lib/platform/contract";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as sync-controller.test.ts).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

function status(overrides: Partial<SyncStatus>): SyncStatus {
  return {
    state: "idle",
    projectDir: "/proj",
    lastSyncAt: null,
    ...overrides,
  };
}

test("initial public rune state", () => {
  const ctrl = new RecoveryUiController();
  expect(ctrl.recoveryOverlayVisible).toBe(false);
  expect(ctrl.recoveryOverlayPhase).toBe("checking");
  expect(ctrl.recoveryOverlayState).toBe("recovering");
  expect(ctrl.recoveryBackupZipPath).toBeUndefined();
  expect(ctrl.recoveryLogFilePath).toBeNull();
});

test("recovering → overlay visible, phase from status, paths captured", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(
    status({
      state: "recovering",
      recovery: { phase: "repairing", risk: "none" },
      logFile: "/logs/op.log",
    }),
  );
  expect(ctrl.recoveryOverlayVisible).toBe(true);
  expect(ctrl.recoveryOverlayState).toBe("recovering");
  expect(ctrl.recoveryOverlayPhase).toBe("repairing");
  expect(ctrl.recoveryLogFilePath).toBe("/logs/op.log");
});

test("recovered → overlay success state; backup/log fall back to prior values", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(
    status({ state: "recovering", recovery: { phase: "repairing", risk: "none" }, logFile: "/l" }),
  );
  ctrl.applyStatus(status({ state: "recovered", backupZipPath: "/b/.git-damaged-x" }));
  expect(ctrl.recoveryOverlayVisible).toBe(true);
  expect(ctrl.recoveryOverlayState).toBe("recovered");
  expect(ctrl.recoveryBackupZipPath).toBe("/b/.git-damaged-x");
  expect(ctrl.recoveryLogFilePath).toBe("/l");
});

test("any non-syncing state hides a lingering overlay; syncing keeps it", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(status({ state: "recovering", recovery: { phase: "checking", risk: "none" } }));
  ctrl.applyStatus(status({ state: "syncing" }));
  expect(ctrl.recoveryOverlayVisible).toBe(true);
  ctrl.applyStatus(status({ state: "synced" }));
  expect(ctrl.recoveryOverlayVisible).toBe(false);
});

test("error hides the overlay (no guidance dialog exists any more)", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(status({ state: "recovering", recovery: { phase: "checking", risk: "none" } }));
  ctrl.applyStatus(status({ state: "error", message: "friendly copy" }));
  expect(ctrl.recoveryOverlayVisible).toBe(false);
});

test("dismissOverlay hides it", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(status({ state: "recovered" }));
  ctrl.dismissOverlay();
  expect(ctrl.recoveryOverlayVisible).toBe(false);
});
