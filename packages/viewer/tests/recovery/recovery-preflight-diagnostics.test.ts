/**
 * PHASE 3 — preflight must record a RICH structural diagnosis to the operation
 * LOG FILE before dispatching recover(), not just console.log a one-word kind.
 *
 * Two pure helpers make this testable without Electron:
 *   - preflightStructuralReason(kind) — the SINGLE health signal that drove
 *     classification, derived from the kind classifyFromHealth returned (a
 *     pure mapping — it cannot drift from the classifier's decision order).
 *   - buildPreflightDiagnostics(openedDir, repoDir, health, kind) — a flat,
 *     secret-free LogData record with every health boolean + repo-root facts.
 *
 * classifyFromHealth itself lives in the LIB (single source of truth shared
 * with the error-path classifier) — imported from cli source here, the same
 * way this file already imports resolveLogger.
 *
 * A third test proves the FILE actually receives the structural fields when the
 * lib's resolveLogger writes buildPreflightDiagnostics output (review test-gap
 * #2).
 */

import { describe, test, expect } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  preflightStructuralReason,
  buildPreflightDiagnostics,
  type RepoHealth,
} from "../../electron/recovery-bridge";
import { classifyFromHealth } from "@dimm-city/print-md";
import { resolveLogger } from "../../../cli/src/lib/remote-auth/operation-log.ts";

// A healthy repo: no structural condition.
const HEALTHY: RepoHealth = {
  hasGitDir: true,
  currentBranch: "main",
  isDetachedHead: false,
  hasStaleLock: false,
  hasInterruptedMerge: false,
  hasInterruptedRebase: false,
  hasInterruptedCherryPick: false,
  hasLocalChanges: false,
};

function h(overrides: Partial<RepoHealth>): RepoHealth {
  return { ...HEALTHY, ...overrides };
}

describe("preflightStructuralReason", () => {
  test("healthy repo → 'none'", () => {
    expect(preflightStructuralReason(classifyFromHealth(HEALTHY))).toBe("none");
  });

  test("missing git dir → health.missingGitDir", () => {
    expect(
      preflightStructuralReason(classifyFromHealth(h({ hasGitDir: false }))),
    ).toBe("health.missingGitDir");
  });

  test("stale lock past threshold → health.hasStaleLock", () => {
    expect(
      preflightStructuralReason(
        classifyFromHealth(h({ hasStaleLock: true, lockAgeMs: 200_000 })),
      ),
    ).toBe("health.hasStaleLock");
  });

  test("fresh lock (below threshold) is NOT a stale-lock reason", () => {
    // Below the shared STALE_LOCK_MIN_AGE_MS (120s): classifyFromHealth returns
    // null, so the reason must also be 'none' — they agree by construction.
    const health = h({ hasStaleLock: true, lockAgeMs: 1_000 });
    const kind = classifyFromHealth(health);
    expect(kind).toBeNull();
    expect(preflightStructuralReason(kind)).toBe("none");
  });

  test("interrupted merge → health.hasInterruptedMerge", () => {
    expect(
      preflightStructuralReason(classifyFromHealth(h({ hasInterruptedMerge: true }))),
    ).toBe("health.hasInterruptedMerge");
  });

  test("interrupted rebase → health.hasInterruptedRebase", () => {
    expect(
      preflightStructuralReason(classifyFromHealth(h({ hasInterruptedRebase: true }))),
    ).toBe("health.hasInterruptedRebase");
  });

  test("interrupted cherry-pick → health.hasInterruptedCherryPick", () => {
    expect(
      preflightStructuralReason(
        classifyFromHealth(h({ hasInterruptedCherryPick: true })),
      ),
    ).toBe("health.hasInterruptedCherryPick");
  });

  test("detached head → health.isDetachedHead", () => {
    expect(
      preflightStructuralReason(classifyFromHealth(h({ isDetachedHead: true }))),
    ).toBe("health.isDetachedHead");
  });

  // ── Ordering guard: rebase wins over detached head ──────────────────────────
  test("interrupted rebase AND detached head → names the rebase, not detached", () => {
    const health = h({ hasInterruptedRebase: true, isDetachedHead: true });
    const kind = classifyFromHealth(health);
    expect(kind).toBe("interrupted_rebase");
    expect(preflightStructuralReason(kind)).toBe("health.hasInterruptedRebase");
  });

  // ── Agreement matrix: reason ⇔ classifyFromHealth for every shape ───────────
  test("reason agrees with classifyFromHealth across a health matrix", () => {
    const matrix: RepoHealth[] = [
      HEALTHY,
      h({ hasGitDir: false }),
      h({ hasStaleLock: true, lockAgeMs: 200_000 }),
      h({ hasStaleLock: true, lockAgeMs: 1_000 }),
      h({ hasInterruptedMerge: true }),
      h({ hasInterruptedRebase: true }),
      h({ hasInterruptedCherryPick: true }),
      h({ isDetachedHead: true }),
      h({ hasInterruptedRebase: true, isDetachedHead: true }),
      h({ hasInterruptedCherryPick: true, isDetachedHead: true }),
      h({ hasStaleLock: true, lockAgeMs: 200_000, hasInterruptedMerge: true }),
    ];
    for (const health of matrix) {
      const kind = classifyFromHealth(health);
      const reason = preflightStructuralReason(kind);
      if (kind === null) {
        expect(reason).toBe("none");
      } else {
        // A recoverable kind must always name a concrete signal.
        expect(reason).not.toBe("none");
        expect(reason.startsWith("health.")).toBe(true);
      }
    }
  });
});

describe("buildPreflightDiagnostics", () => {
  test("includes every health boolean, kind, reason, and repo-root facts", () => {
    const health = h({ hasInterruptedRebase: true, hasLocalChanges: true });
    const kind = classifyFromHealth(health);
    const diag = buildPreflightDiagnostics("/a/opened", "/a/opened/repo", health, kind);

    expect(diag.openedDir).toBe("/a/opened");
    expect(diag.repoDir).toBe("/a/opened/repo");
    expect(diag.repoRootDiffers).toBe(true);
    expect(diag.kind).toBe("interrupted_rebase");
    expect(diag.reason).toBe("health.hasInterruptedRebase");
    expect(diag.hasGitDir).toBe(true);
    expect(diag.hasInterruptedMerge).toBe(false);
    expect(diag.hasInterruptedRebase).toBe(true);
    expect(diag.hasInterruptedCherryPick).toBe(false);
    expect(diag.hasStaleLock).toBe(false);
    expect(diag.isDetachedHead).toBe(false);
    expect(diag.hasLocalChanges).toBe(true);
  });

  test("repoRootDiffers is false when repoDir === openedDir; kind 'none' when null", () => {
    const diag = buildPreflightDiagnostics("/a/opened", "/a/opened", HEALTHY, null);
    expect(diag.repoRootDiffers).toBe(false);
    expect(diag.kind).toBe("none");
    expect(diag.reason).toBe("none");
  });
});

describe("preflight diagnostics reach the operation LOG FILE (end-to-end)", () => {
  test("resolveLogger writes structural fields with kind + reason", () => {
    const dir = mkdtempSync(path.join(tmpdir(), "preflight-log-"));
    const logFile = path.join(dir, "op.log");
    try {
      const health = h({ hasInterruptedRebase: true, hasLocalChanges: true });
      const kind = classifyFromHealth(health);
      const log = resolveLogger(logFile, "preflight");
      log.info(
        "detect",
        "structural condition detected on open",
        buildPreflightDiagnostics("/proj", "/proj", health, kind),
      );

      const contents = readFileSync(logFile, "utf8");
      expect(contents).toContain("preflight:");
      expect(contents).toContain("step=detect");
      expect(contents).toContain("hasInterruptedRebase=true");
      expect(contents).toContain("kind=interrupted_rebase");
      expect(contents).toContain("reason=health.hasInterruptedRebase");
      expect(contents).toContain("hasLocalChanges=true");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
