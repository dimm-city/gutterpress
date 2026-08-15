/**
 * postResolveLatchAction — the conflict-latch decision after a
 * resolveSyncConflicts outcome (2026-08 field incident).
 *
 * The hook in electron/main.ts used to unlatch + re-arm auto-sync
 * UNCONDITIONALLY after resolveConflicts returned — even for error/auth/
 * conflict outcomes — against its own "after successful resolution" comment.
 * The decision now lives in this pure, exhaustive function so the invariant
 * is testable without booting Electron.
 */
import { describe, expect, test } from "bun:test";

import { postResolveLatchAction } from "../../electron/server-bridge/remote-hooks";

describe("postResolveLatchAction", () => {
  test("resolved outcomes resume auto-sync", () => {
    expect(postResolveLatchAction("synced")).toBe("resume");
    expect(postResolveLatchAction("up-to-date")).toBe("resume");
  });

  test("a fresh conflict re-latches with the new state", () => {
    // The online copy moved again mid-decision: the dialog re-renders from
    // the returned outcome, and the latch must be re-armed with the FRESH ids
    // so the pill and the dialog agree.
    expect(postResolveLatchAction("conflict")).toBe("relatch");
  });

  test("failed outcomes hold the latch — auto-sync must not churn behind the open dialog", () => {
    expect(postResolveLatchAction("auth")).toBe("hold");
    expect(postResolveLatchAction("offline")).toBe("hold");
    expect(postResolveLatchAction("error")).toBe("hold");
  });
});
