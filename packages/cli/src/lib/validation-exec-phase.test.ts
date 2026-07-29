/**
 * Tests for `--phase` resolution in `executeValidation` (UX review finding H4).
 *
 * The README documents `--phase pre | post | all (default: all)`, but
 * `validation-exec.ts` used to cast `args.phase` straight to `CheckPhase` with
 * no validation, and `registry.ts` filters checks with strict equality — so
 * every documented value except the internal `pre-build`/`post-build` matched
 * ZERO registered checks and the CLI printed "VALIDATION PASSED" with
 * `total: 0`. These tests lock:
 *
 *   1. The documented `pre`/`post`/`all` aliases resolve to real phase
 *      filtering (or "no filter" for "all") and actually run checks.
 *   2. An unrecognized `--phase` value throws `UsageError` — mirroring how
 *      `--format`/`--pdfx-flavor`/`--port` already reject bad values — rather
 *      than silently casting to a value nothing matches.
 *   3. A `--phase`/`--category` combination that matches zero registered
 *      checks throws `UsageError`, mirroring the existing unmatched
 *      `--only`/`--skip` selector guard in `registry.ts` — a filter that
 *      matches nothing must never be reported as a pass.
 */
import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { executeValidation } from "./validation-exec";
import { UsageError } from "./cli-args";

// Ensure check modules are registered (self-registering side-effect imports) —
// mirrors the pattern in checks.test.ts / policy.test.ts.
import "../checks/pdf/index";
import "../checks/source/index";
import "../checks/asset/index";
import "../checks/heuristic/index";

async function makeFixtureDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-phase-"));
  await writeFile(
    join(dir, "chapter-01.md"),
    "# Chapter One\n\nSome body text.\n"
  );
  return dir;
}

describe("executeValidation --phase alias resolution", () => {
  test("'pre' resolves to pre-build and actually runs pre-build checks", async () => {
    const dir = await makeFixtureDir();
    try {
      const execution = await executeValidation({ input: dir, phase: "pre" });
      expect(execution.runnerOptions.phase).toBe("pre-build");
      // Regression guard: previously "pre" was cast directly to CheckPhase,
      // matched no registered check (registry only knows "pre-build"), and
      // total was always 0 no matter what the fixture contained.
      expect(execution.report.summary.total).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("'post' resolves to post-build and actually runs post-build checks", async () => {
    const dir = await makeFixtureDir();
    try {
      const execution = await executeValidation({ input: dir, phase: "post" });
      expect(execution.runnerOptions.phase).toBe("post-build");
      expect(execution.report.summary.total).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("'all' runs both phases (no phase filter applied)", async () => {
    const dir = await makeFixtureDir();
    try {
      const execution = await executeValidation({ input: dir, phase: "all" });
      expect(execution.runnerOptions.phase).toBeUndefined();
      expect(execution.report.summary.total).toBeGreaterThan(0);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("canonical 'pre-build' / 'post-build' values keep working", async () => {
    const dir = await makeFixtureDir();
    try {
      const pre = await executeValidation({ input: dir, phase: "pre-build" });
      expect(pre.runnerOptions.phase).toBe("pre-build");
      const post = await executeValidation({ input: dir, phase: "post-build" });
      expect(post.runnerOptions.phase).toBe("post-build");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("aliases are case-insensitive and tolerate surrounding whitespace", async () => {
    const dir = await makeFixtureDir();
    try {
      const execution = await executeValidation({ input: dir, phase: " PRE " });
      expect(execution.runnerOptions.phase).toBe("pre-build");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("executeValidation --phase rejects unusable filters (H4 false-green fix)", () => {
  test("an unrecognized --phase value throws UsageError, not a silent cast", async () => {
    await expect(executeValidation({ phase: "bogus" })).rejects.toThrow(
      UsageError
    );
  });

  test("the UsageError message names the bad value", async () => {
    await expect(executeValidation({ phase: "bogus" })).rejects.toThrow(
      /bogus/
    );
  });

  test("--phase/--category combination matching zero checks throws UsageError, not a pass", async () => {
    const dir = await makeFixtureDir();
    try {
      // Every "pdf" category check is registered with phase: "post-build", so
      // requesting it under phase: "pre-build" must match nothing. Before the
      // fix this silently produced summary.total === 0 and "VALIDATION
      // PASSED"; now it must error instead.
      await expect(
        executeValidation({ input: dir, phase: "pre-build", category: "pdf" })
      ).rejects.toThrow(UsageError);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
