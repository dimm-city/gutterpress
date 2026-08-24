import { expect, test } from "bun:test";
import { shouldReconcileAfterSync } from "../../src/lib/sync-status";
import type { SyncStatus } from "../../src/lib/platform/contract";

function status(state: SyncStatus["state"], filesChanged?: boolean): SyncStatus {
  return {
    state,
    projectDir: "/book",
    lastSyncAt: "2026-06-30T00:00:00.000Z",
    ...(filesChanged !== undefined ? { filesChanged } : {}),
  };
}

test("completed sync statuses request editor reconciliation when files changed", () => {
  expect(shouldReconcileAfterSync(status("synced", true))).toBe(true);
  expect(shouldReconcileAfterSync(status("offline", true))).toBe(true);
  expect(shouldReconcileAfterSync(status("auth", true))).toBe(true);
  expect(shouldReconcileAfterSync(status("error", true))).toBe(true);
  expect(shouldReconcileAfterSync(status("recovered", true))).toBe(true);
});

test("sync statuses without local file changes do not reconcile open buffers", () => {
  expect(shouldReconcileAfterSync(status("synced"))).toBe(false);
  expect(shouldReconcileAfterSync(status("syncing", true))).toBe(false);
  expect(shouldReconcileAfterSync(status("recovering", true))).toBe(false);
  expect(shouldReconcileAfterSync(status("conflict", true))).toBe(false);
});
