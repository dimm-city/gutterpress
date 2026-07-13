/**
 * Tests for `--category` validation and the phase/category zero-match guard
 * (UX review finding #13, a residual of the earlier H4 `--phase` fix).
 *
 * `validation-exec.ts` cast every `--category` CSV entry straight to
 * `CheckCategory` with `s as CheckCategory` — no validation, mirroring the
 * exact bug shape H4 fixed for `--phase`. Worse, the zero-match guard added
 * for H4 only ran inside the `if (typeof args.phase === "string" ...)` branch
 * AND only when `resolvePhaseArg` returned a truthy value — so it was
 * bypassed whenever:
 *
 *   1. `--phase` was not given at all and a phase was auto-selected from
 *      `--pdf`/`--input` (the guard block was never entered), or
 *   2. `--phase all` was given explicitly (`resolvePhaseArg("all")` returns
 *      `undefined`, so the inner `if (phase)` was falsy and skipped the
 *      guard).
 *
 * In both cases an unknown or zero-matching `--category` silently ran ZERO
 * checks and the CLI reported "VALIDATION PASSED" with `total: 0` — a
 * false-green result. These tests lock:
 *
 *   1. An unrecognized `--category` value throws `UsageError` (mirrors
 *      `resolvePhaseArg`), regardless of `--phase`.
 *   2. A valid category that matches zero checks under an AUTO-SELECTED
 *      phase (no `--phase` given) throws `UsageError`, not a silent pass.
 *   3. An unknown category combined with explicit `--phase all` throws
 *      `UsageError`, not a silent pass.
 *
 * Uses the REAL check registry (not stubbed) — mirrors
 * validation-exec-phase.test.ts, since the guard being tested reads the real
 * registry via `getChecks`/`getKnownCategories`.
 */
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeValidation } from "./validation-exec";
import { UsageError } from "./cli-args";

// Ensure check modules are registered (self-registering side-effect imports).
import "../checks/pdf/index";
import "../checks/source/index";
import "../checks/asset/index";
import "../checks/heuristic/index";

async function makeFixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "print-md-category-"));
  await writeFile(
    join(dir, "chapter-01.md"),
    "# Chapter One\n\nSome body text.\n"
  );
  return dir;
}

describe("executeValidation --category rejects unusable filters (finding #13)", () => {
  test("an unrecognized --category value throws UsageError, not a silent cast", async () => {
    const dir = await makeFixtureDir();
    try {
      await expect(
        executeValidation({ input: dir, category: "bogus" })
      ).rejects.toThrow(UsageError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("the UsageError message names the bad category value", async () => {
    const dir = await makeFixtureDir();
    try {
      await expect(
        executeValidation({ input: dir, category: "bogus" })
      ).rejects.toThrow(/bogus/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("an unknown category in a mixed CSV throws, naming only the bad entry", async () => {
    const dir = await makeFixtureDir();
    try {
      await expect(
        executeValidation({ input: dir, category: "source,bogus" })
      ).rejects.toThrow(/bogus/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test(
    "unknown --category with explicit --phase all throws UsageError, " +
      "not a false-green PASS (regression: guard used to skip when " +
      'resolvePhaseArg("all") returned undefined)',
    async () => {
      const dir = await makeFixtureDir();
      try {
        await expect(
          executeValidation({ input: dir, phase: "all", category: "bogus" })
        ).rejects.toThrow(UsageError);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );

  test(
    "a valid category that matches zero checks under an AUTO-SELECTED " +
      "phase throws UsageError, not a false-green PASS (regression: the " +
      "guard used to only run when --phase was explicitly passed)",
    async () => {
      const dir = await makeFixtureDir();
      try {
        // No --phase given: --input alone auto-selects phase "pre-build".
        // Every "pdf" category check is registered with phase "post-build",
        // so this combination legitimately matches zero registered checks.
        // Before the fix, this silently produced summary.total === 0 and
        // "VALIDATION PASSED" because the guard block was never entered when
        // args.phase was absent.
        await expect(
          executeValidation({ input: dir, category: "pdf" })
        ).rejects.toThrow(UsageError);
      } finally {
        await rm(dir, { recursive: true, force: true });
      }
    }
  );

  test("valid categories still parse into runnerOptions.category as before", async () => {
    const dir = await makeFixtureDir();
    try {
      const execution = await executeValidation({
        input: dir,
        category: "source, asset",
      });
      expect(execution.runnerOptions.category).toEqual(["source", "asset"]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
