/**
 * ARCH finding #49: command-level smoke test for `lint.ts`'s citty dispatch —
 * specifically the "is the positional a manifest-bearing project directory,
 * or a CSS glob pattern?" branch (`filesArgIsManifestDir`), which is real
 * logic in the command handler itself, not just argument pass-through.
 * `runLint` is `spyOn`-stubbed so this never actually lints real CSS.
 */
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { runCommand } from "citty";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as lintRunnerMod from "../lib/lint-runner.ts";
import lintCommand from "./lint.ts";
import { EXIT_CODES } from "../lib/cli-args.ts";
import { stubProcessExit } from "../test-helpers/testkit.ts";

let runLintSpy: ReturnType<typeof spyOn> | undefined;
let exitSpy: ReturnType<typeof stubProcessExit> | undefined;

function stubExit(): void {
  exitSpy = stubProcessExit();
}

function stubRunLint(
  impl: (opts: lintRunnerMod.LintRunnerOptions) => Promise<lintRunnerMod.LintRunnerResult>
): void {
  runLintSpy = spyOn(lintRunnerMod, "runLint").mockImplementation(
    impl as unknown as typeof lintRunnerMod.runLint
  );
}

afterEach(() => {
  runLintSpy?.mockRestore();
  exitSpy?.mockRestore();
  runLintSpy = undefined;
  exitSpy = undefined;
});

describe("lint command — manifest-dir vs glob-pattern positional", () => {
  test("a positional directory containing manifest.yaml is treated as the project dir (manifest), not a files glob", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pmd-lint-cmd-dir-"));
    try {
      await writeFile(path.join(dir, "manifest.yaml"), "title: X\n", "utf-8");
      let captured: lintRunnerMod.LintRunnerOptions | undefined;
      stubRunLint(async (opts) => {
        captured = opts;
        return { ok: true, riskyCount: 0, filesLinted: 0 };
      });

      await runCommand(lintCommand, { rawArgs: [dir] });

      expect(captured?.files).toBeUndefined();
      expect(captured?.manifest).toBe(dir);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("a positional that is NOT a manifest-bearing directory is passed through as a files glob", async () => {
    let captured: lintRunnerMod.LintRunnerOptions | undefined;
    stubRunLint(async (opts) => {
      captured = opts;
      return { ok: true, riskyCount: 0, filesLinted: 0 };
    });

    await runCommand(lintCommand, { rawArgs: ["css/**/*.css"] });

    expect(captured?.files).toBe("css/**/*.css");
    expect(captured?.manifest).toBeUndefined();
  });

  test("a directory WITHOUT a manifest.yaml is passed through as a files glob (not treated as a project dir)", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pmd-lint-cmd-nodir-"));
    try {
      let captured: lintRunnerMod.LintRunnerOptions | undefined;
      stubRunLint(async (opts) => {
        captured = opts;
        return { ok: true, riskyCount: 0, filesLinted: 0 };
      });

      await runCommand(lintCommand, { rawArgs: [dir] });

      expect(captured?.files).toBe(dir);
      expect(captured?.manifest).toBeUndefined();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("explicit --manifest overrides the manifest-dir positional inference", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "pmd-lint-cmd-override-"));
    try {
      await writeFile(path.join(dir, "manifest.yaml"), "title: X\n", "utf-8");
      let captured: lintRunnerMod.LintRunnerOptions | undefined;
      stubRunLint(async (opts) => {
        captured = opts;
        return { ok: true, riskyCount: 0, filesLinted: 0 };
      });

      await runCommand(lintCommand, {
        rawArgs: [dir, "--manifest", "/explicit/manifest.yaml"],
      });

      expect(captured?.manifest).toBe("/explicit/manifest.yaml");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("lint command — exit-code contract (M47)", () => {
  test("findings (ok: false) exit with EXIT_CODES.FINDINGS (1), not a usage error", async () => {
    stubExit();
    stubRunLint(async () => ({ ok: false, riskyCount: 2, filesLinted: 1 }));

    await expect(runCommand(lintCommand, { rawArgs: ["css/**/*.css"] })).rejects.toThrow(
      new RegExp(`process\\.exit\\(${EXIT_CODES.FINDINGS}\\)`)
    );
  });

  test("a clean lint (ok: true) never calls process.exit", async () => {
    stubExit();
    stubRunLint(async () => ({ ok: true, riskyCount: 0, filesLinted: 3 }));

    await runCommand(lintCommand, { rawArgs: ["css/**/*.css"] });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("an extra positional is a usage error (exit 2); runLint is never called", async () => {
    stubExit();
    stubRunLint(async () => ({ ok: true, riskyCount: 0, filesLinted: 0 }));

    await expect(runCommand(lintCommand, { rawArgs: ["a", "b"] })).rejects.toThrow(
      /process\.exit\(2\)/
    );
    expect(runLintSpy).not.toHaveBeenCalled();
  });
});
