/**
 * ARCH finding #49: command-level smoke tests for citty arg parsing → handler
 * dispatch. `runBuild` (the real pipeline — Chromium, Paged.js, ghostscript)
 * is `spyOn`-stubbed so these tests never touch a real browser; they only
 * verify `build.ts` maps citty's parsed args into `runBuild`'s options shape
 * correctly, and that the UsageError/BuildError → exit-code contract holds.
 *
 * `citty`'s own `runCommand(cmd, { rawArgs })` performs the REAL argv parsing
 * (the same parser the compiled binary uses), so this exercises the actual
 * citty → handler wiring, not a hand-rolled args object. `process.exit` is
 * replaced with `testkit.ts`'s `stubProcessExit()` (throws a
 * `ProcessExitSignal` instead of killing the test worker) — mirroring how a
 * real `process.exit()` would abort execution at that point.
 *
 * cli-contract.test.ts already covers the E2E subprocess behavior (real exit
 * codes, real stderr) for the usage-error paths; this file adds the
 * complementary in-process coverage citty-contract tests can't get cheaply:
 * exact `runBuild` call-argument shape on the happy path.
 */
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { runCommand } from "citty";
import path from "node:path";
import * as buildRunnerMod from "../lib/build-runner.ts";
import buildCommand from "./build.ts";
import { stubProcessExit } from "../test-helpers/testkit.ts";

let runBuildSpy: ReturnType<typeof spyOn> | undefined;
let exitSpy: ReturnType<typeof stubProcessExit> | undefined;

function stubExit(): void {
  exitSpy = stubProcessExit();
}

function stubRunBuild(
  impl: (opts: buildRunnerMod.BuildRunnerOptions) => Promise<Partial<buildRunnerMod.BuildRunnerResult>>
): void {
  runBuildSpy = spyOn(buildRunnerMod, "runBuild").mockImplementation(
    impl as unknown as typeof buildRunnerMod.runBuild
  );
}

afterEach(() => {
  runBuildSpy?.mockRestore();
  exitSpy?.mockRestore();
  runBuildSpy = undefined;
  exitSpy = undefined;
});

describe("build command — citty arg parsing → runBuild dispatch", () => {
  test("maps positional input, --format, and --out onto runBuild's options", async () => {
    let captured: buildRunnerMod.BuildRunnerOptions | undefined;
    stubRunBuild(async (opts) => {
      captured = opts;
      return { pdfPath: "/fake/out.pdf", htmlPath: null };
    });

    await runCommand(buildCommand, {
      rawArgs: ["/tmp/my-book", "--format", "html", "--out", "/tmp/out-dir"],
    });

    expect(captured?.inputDir).toBe(path.resolve("/tmp/my-book"));
    expect(captured?.format).toBe("html");
    expect(captured?.outDir).toBe("/tmp/out-dir");
    expect(captured?.pdfFileOverride).toBeNull();
  });

  test("input defaults to cwd when no positional is given", async () => {
    let captured: buildRunnerMod.BuildRunnerOptions | undefined;
    stubRunBuild(async (opts) => {
      captured = opts;
      return { pdfPath: null, htmlPath: null };
    });

    await runCommand(buildCommand, { rawArgs: [] });

    expect(captured?.inputDir).toBe(path.resolve("."));
    expect(captured?.format).toBe("pdf"); // documented default
  });

  test("--out ending in .pdf splits into outDir + pdfFileOverride (splitOutPath wiring)", async () => {
    let captured: buildRunnerMod.BuildRunnerOptions | undefined;
    stubRunBuild(async (opts) => {
      captured = opts;
      return { pdfPath: "/tmp/out-dir/custom.pdf", htmlPath: null };
    });

    await runCommand(buildCommand, {
      rawArgs: [".", "--format", "pdf", "--out", "/tmp/out-dir/custom.pdf"],
    });

    expect(captured?.outDir).toBe("/tmp/out-dir");
    expect(captured?.pdfFileOverride).toBe(path.resolve("/tmp/out-dir/custom.pdf"));
  });

  test("boolean skip flags and title/manifest/icc/pdfx-flavor all reach runBuild", async () => {
    let captured: buildRunnerMod.BuildRunnerOptions | undefined;
    stubRunBuild(async (opts) => {
      captured = opts;
      return { pdfPath: "/fake/out.pdfx", htmlPath: null };
    });

    await runCommand(buildCommand, {
      rawArgs: [
        ".",
        "--format",
        "pdfx",
        "--pdfx-flavor",
        "x3",
        "--icc",
        "/profiles/x3.icc",
        "--title",
        "My Book",
        "--manifest",
        "/tmp/manifest.yaml",
        "--skip-lint",
        "--skip-pre-validate",
        "--skip-post-validate",
        "--strip-annotations",
      ],
    });

    expect(captured?.pdfxFlavor).toBe("x3");
    expect(captured?.iccPath).toBe("/profiles/x3.icc");
    expect(captured?.title).toBe("My Book");
    expect(captured?.manifestPath).toBe("/tmp/manifest.yaml");
    expect(captured?.skipLint).toBe(true);
    expect(captured?.skipPreValidate).toBe(true);
    expect(captured?.skipPostValidate).toBe(true);
    expect(captured?.stripAnnotations).toBe(true);
  });

  test("skip flags default to false when omitted", async () => {
    let captured: buildRunnerMod.BuildRunnerOptions | undefined;
    stubRunBuild(async (opts) => {
      captured = opts;
      return { pdfPath: null, htmlPath: "/fake/out.html" };
    });

    await runCommand(buildCommand, { rawArgs: [".", "--format", "html"] });

    expect(captured?.skipLint).toBe(false);
    expect(captured?.skipPreValidate).toBe(false);
    expect(captured?.skipPostValidate).toBe(false);
    expect(captured?.stripAnnotations).toBeUndefined();
  });

  test("an invalid --format is a usage error (exit 2); runBuild is never called", async () => {
    stubExit();
    stubRunBuild(async () => ({ pdfPath: null, htmlPath: null }));

    await expect(
      runCommand(buildCommand, { rawArgs: [".", "--format", "docx"] })
    ).rejects.toThrow(/process\.exit\(2\)/);

    expect(runBuildSpy).not.toHaveBeenCalled();
  });

  test("an extra positional is a usage error (exit 2); runBuild is never called", async () => {
    stubExit();
    stubRunBuild(async () => ({ pdfPath: null, htmlPath: null }));

    await expect(runCommand(buildCommand, { rawArgs: ["a", "b"] })).rejects.toThrow(
      /process\.exit\(2\)/
    );
    expect(runBuildSpy).not.toHaveBeenCalled();
  });

  test("a BuildError thrown by runBuild exits with the error's own exitCode (3=PIPELINE by default)", async () => {
    stubExit();
    stubRunBuild(async () => {
      throw new buildRunnerMod.BuildError("pipeline exploded");
    });

    await expect(runCommand(buildCommand, { rawArgs: ["."] })).rejects.toThrow(
      /process\.exit\(3\)/
    );
  });

  test("an unrelated thrown error propagates instead of being swallowed into an exit code", async () => {
    stubExit();
    stubRunBuild(async () => {
      throw new TypeError("something unrelated broke");
    });

    await expect(runCommand(buildCommand, { rawArgs: ["."] })).rejects.toThrow(
      "something unrelated broke"
    );
    expect(exitSpy).not.toHaveBeenCalled();
  });
});
