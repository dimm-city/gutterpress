/**
 * BUG 3 — preflight must not silently drop a pending auto-sync trigger.
 *
 * Context: the api:preview preflight IIFE in electron/main.ts holds the
 * single-flight lock (state.inFlight=true) while recover() runs. If runAutoSync
 * fires during that window it sets state.runAgain instead of syncing. After
 * preflight releases the lock, that pending runAgain must be honored — UNLESS
 * the terminal recovery state latches (conflict/blocked/failed), in which case
 * the latch intentionally suppresses it.
 *
 * The decision is extracted into the pure helper `decideRunAgainAfterPreflight`
 * in electron/recovery-bridge.ts so it can be unit-tested without Electron.
 * main.ts calls it; this test pins the contract.
 *
 * Contract:
 *   - Non-latching terminal states (recovered, retry_later) → a pending runAgain
 *     is HONORED ("run"); the dropped-trigger bug is fixed.
 *   - Latching terminal states (conflict, blocked, failed_*) → the latch
 *     suppresses runAgain ("suppress"); clearing the flag is intentional.
 *   - When runAgain was never set, nothing runs ("none") regardless of state.
 */

import { describe, test, expect } from "bun:test";
import { decideRunAgainAfterPreflight } from "../../electron/recovery-bridge";

describe("decideRunAgainAfterPreflight (BUG 3)", () => {
  // ── No pending trigger → never run, whatever the outcome ────────────────────
  test("runAgain=false → 'none' for every status (nothing was queued)", () => {
    for (const status of [
      "recovered",
      "retry_later",
      "needs_user",
      "blocked",
      "failed_no_changes_made",
      "failed_backup_available",
    ] as const) {
      expect(decideRunAgainAfterPreflight(status, false)).toBe("none");
    }
  });

  // ── Non-latching outcomes → honor the pending trigger (the actual bug fix) ───
  test("recovered + pending runAgain → 'run' (honor the queued sync)", () => {
    expect(decideRunAgainAfterPreflight("recovered", true)).toBe("run");
  });

  test("retry_later + pending runAgain → 'run' (NOT silently dropped)", () => {
    // This is the core BUG 3 regression: previously runAgain was only honored on
    // the 'recovered' branch, so a retry_later outcome dropped the queued sync.
    expect(decideRunAgainAfterPreflight("retry_later", true)).toBe("run");
  });

  // ── Latching outcomes → suppress (conflict-latch invariant) ─────────────────
  test("needs_user (conflict) + pending runAgain → 'suppress' (latch wins)", () => {
    expect(decideRunAgainAfterPreflight("needs_user", true)).toBe("suppress");
  });

  test("blocked + pending runAgain → 'suppress' (latch wins)", () => {
    expect(decideRunAgainAfterPreflight("blocked", true)).toBe("suppress");
  });

  test("failed_no_changes_made + pending runAgain → 'suppress'", () => {
    expect(decideRunAgainAfterPreflight("failed_no_changes_made", true)).toBe("suppress");
  });

  test("failed_backup_available + pending runAgain → 'suppress'", () => {
    expect(decideRunAgainAfterPreflight("failed_backup_available", true)).toBe("suppress");
  });

  // ── An unknown/forward-compat status defaults to the SAFE latch (suppress) ───
  test("unrecognized status + pending runAgain → 'suppress' (fail safe)", () => {
    // @ts-expect-error intentionally passing an out-of-contract status
    expect(decideRunAgainAfterPreflight("some_future_status", true)).toBe("suppress");
  });
});
