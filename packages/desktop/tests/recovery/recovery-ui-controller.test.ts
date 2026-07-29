import { expect, test } from "bun:test";
// The module under test does not exist yet — this import is the design contract
// (TDD red). It will resolve once the extraction lands.
import { RecoveryUiController } from "../../src/lib/routes/recovery-ui-controller.svelte";
import type {
  ManualGuidanceInfo,
  RecoveryConfirmRequest,
  SyncStatus,
} from "../../src/lib/platform/contract";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// sync-controller.test / page-nav-controller.test / export-controller.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

const GUIDANCE: ManualGuidanceInfo = {
  userSummary: "Something went wrong syncing.",
  recommendedNextStep: "Try reconnecting.",
  recommendedAction: "Reconnect",
  recommendedActionKey: "reconnect",
};

/** Build a SyncStatus fixture with sensible defaults. */
function status(over: Partial<SyncStatus> & Pick<SyncStatus, "state">): SyncStatus {
  return {
    projectDir: "/proj",
    lastSyncAt: null,
    ...over,
  } as SyncStatus;
}

// ── initial state ─────────────────────────────────────────────────────────────

test("initial public rune state matches the +page.svelte defaults", () => {
  const ctrl = new RecoveryUiController();
  expect(ctrl.recoveryOverlayVisible).toBe(false);
  expect(ctrl.recoveryOverlayPhase).toBe("checking");
  expect(ctrl.recoveryOverlayState).toBe("recovering");
  expect(ctrl.recoveryBackupZipPath).toBe(undefined);
  expect(ctrl.recoveryLogFilePath).toBe(null);
  expect(ctrl.recoveryGuidanceOpen).toBe(false);
  expect(ctrl.recoveryGuidance).toBe(undefined);
  expect(ctrl.recoveryGuidanceBackupPath).toBe(null);
  expect(ctrl.recoveryGuidanceLogPath).toBe(null);
  expect(ctrl.recoveryConfirmOpen).toBe(false);
  expect(ctrl.recoveryConfirmRequest).toBe(undefined);
});

// ── applyStatus: recovering ────────────────────────────────────────────────────

test("applyStatus recovering -> overlay visible, state recovering, phase from status, guidance forced closed", () => {
  const ctrl = new RecoveryUiController();
  // Pre-open guidance so we can prove recovering forces it closed.
  ctrl.recoveryGuidanceOpen = true;
  ctrl.applyStatus(
    status({
      state: "recovering",
      recovery: { phase: "repairing", risk: "low" },
      backupZipPath: "/backups/a.zip",
      logFile: "/logs/a.log",
    }),
  );
  expect(ctrl.recoveryOverlayVisible).toBe(true);
  expect(ctrl.recoveryOverlayState).toBe("recovering");
  expect(ctrl.recoveryOverlayPhase).toBe("repairing");
  expect(ctrl.recoveryBackupZipPath).toBe("/backups/a.zip");
  expect(ctrl.recoveryLogFilePath).toBe("/logs/a.log");
  expect(ctrl.recoveryGuidanceOpen).toBe(false);
});

test("applyStatus recovering -> phase falls back to 'checking' and log to null when absent", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(status({ state: "recovering", backupZipPath: "/b.zip" }));
  expect(ctrl.recoveryOverlayPhase).toBe("checking");
  expect(ctrl.recoveryBackupZipPath).toBe("/b.zip");
  expect(ctrl.recoveryLogFilePath).toBe(null);
});

// ── applyStatus: recovered ─────────────────────────────────────────────────────

test("applyStatus recovered -> overlay visible, state recovered, captures backup/log", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(
    status({
      state: "recovered",
      backupZipPath: "/backups/r.zip",
      logFile: "/logs/r.log",
    }),
  );
  expect(ctrl.recoveryOverlayVisible).toBe(true);
  expect(ctrl.recoveryOverlayState).toBe("recovered");
  expect(ctrl.recoveryBackupZipPath).toBe("/backups/r.zip");
  expect(ctrl.recoveryLogFilePath).toBe("/logs/r.log");
});

test("applyStatus recovered -> backup/log fall back to prior values when absent", () => {
  const ctrl = new RecoveryUiController();
  // A prior recovering pass seeded backup/log.
  ctrl.applyStatus(
    status({
      state: "recovering",
      recovery: { phase: "backup", risk: "none" },
      backupZipPath: "/prior.zip",
      logFile: "/prior.log",
    }),
  );
  // recovered without its own backup/log keeps the prior values.
  ctrl.applyStatus(status({ state: "recovered" }));
  expect(ctrl.recoveryOverlayState).toBe("recovered");
  expect(ctrl.recoveryBackupZipPath).toBe("/prior.zip");
  expect(ctrl.recoveryLogFilePath).toBe("/prior.log");
});

// ── applyStatus: error + guidance ───────────────────────────────────────────────

test("applyStatus error+guidance -> overlay hidden, guidance populated + open, paths captured", () => {
  const ctrl = new RecoveryUiController();
  ctrl.recoveryOverlayVisible = true;
  ctrl.applyStatus(
    status({
      state: "error",
      guidance: GUIDANCE,
      backupZipPath: "/e.zip",
      logFile: "/e.log",
    }),
  );
  expect(ctrl.recoveryOverlayVisible).toBe(false);
  expect(ctrl.recoveryGuidance).toBe(GUIDANCE);
  expect(ctrl.recoveryGuidanceBackupPath).toBe("/e.zip");
  expect(ctrl.recoveryGuidanceLogPath).toBe("/e.log");
  expect(ctrl.recoveryGuidanceOpen).toBe(true);
});

test("applyStatus error+guidance -> backup/log null when absent", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(status({ state: "error", guidance: GUIDANCE }));
  expect(ctrl.recoveryGuidanceBackupPath).toBe(null);
  expect(ctrl.recoveryGuidanceLogPath).toBe(null);
  expect(ctrl.recoveryGuidanceOpen).toBe(true);
});

test("applyStatus error WITHOUT guidance falls through to the else branch (overlay hidden)", () => {
  const ctrl = new RecoveryUiController();
  ctrl.recoveryOverlayVisible = true;
  ctrl.applyStatus(status({ state: "error" }));
  expect(ctrl.recoveryOverlayVisible).toBe(false);
  expect(ctrl.recoveryGuidanceOpen).toBe(false);
});

// ── applyStatus: else branch (hide overlay unless syncing) ──────────────────────

test("applyStatus syncing -> overlay is NOT hidden", () => {
  const ctrl = new RecoveryUiController();
  // Overlay showing from a previous recovery cycle.
  ctrl.applyStatus(
    status({ state: "recovering", recovery: { phase: "checking", risk: "none" } }),
  );
  expect(ctrl.recoveryOverlayVisible).toBe(true);
  ctrl.applyStatus(status({ state: "syncing" }));
  expect(ctrl.recoveryOverlayVisible).toBe(true);
});

test("applyStatus synced -> overlay hidden", () => {
  const ctrl = new RecoveryUiController();
  ctrl.applyStatus(
    status({ state: "recovering", recovery: { phase: "checking", risk: "none" } }),
  );
  ctrl.applyStatus(status({ state: "synced" }));
  expect(ctrl.recoveryOverlayVisible).toBe(false);
});

test("applyStatus idle -> overlay hidden", () => {
  const ctrl = new RecoveryUiController();
  ctrl.recoveryOverlayVisible = true;
  ctrl.applyStatus(status({ state: "idle" }));
  expect(ctrl.recoveryOverlayVisible).toBe(false);
});

// ── applyConfirm ────────────────────────────────────────────────────────────────

test("applyConfirm sets the request and opens the confirm dialog", () => {
  const ctrl = new RecoveryUiController();
  const req: RecoveryConfirmRequest = {
    requestId: "r1",
    projectDir: "/proj",
    confirmation: {
      repair: "reset",
      risk: "medium",
      summary: "This will change local files.",
      backupZipPath: "/c.zip",
      willChangeLocalFiles: true,
      willChangeGitMetadata: false,
      willChangeRemote: false,
      canBeUndoneFromBackup: true,
    },
  };
  ctrl.applyConfirm(req);
  expect(ctrl.recoveryConfirmRequest).toBe(req);
  expect(ctrl.recoveryConfirmOpen).toBe(true);
});

// ── dismissOverlay ──────────────────────────────────────────────────────────────

test("dismissOverlay clears overlay visibility", () => {
  const ctrl = new RecoveryUiController();
  ctrl.recoveryOverlayVisible = true;
  ctrl.dismissOverlay();
  expect(ctrl.recoveryOverlayVisible).toBe(false);
});
