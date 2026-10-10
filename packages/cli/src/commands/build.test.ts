/**
 * Command-level smoke tests for citty arg parsing → handler
 * dispatch. `runBuild` (the real pipeline — Chromium, ghostscript)
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
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import * as buildRunnerMod from "../lib/build-runner.ts";
import buildCommand from "./build.ts";
import { stubProcessExit } from "../test-helpers/testkit.ts";

let runBuildSpy: ReturnType<typeof spyOn> | undefined;
let exitSpy: ReturnType<typeof stubProcessExit> | undefined;
let consoleLogSpy: ReturnType<typeof spyOn> | undefined;

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
  consoleLogSpy?.mockRestore();
  runBuildSpy = undefined;
  exitSpy = undefined;
  consoleLogSpy = undefined;
});

describe("build command — citty arg parsing → runBuild dispatch", () => {
  test("maps positional input, --format, and --out onto runBuild's options", async () => {
    let captured: buildRunnerMod.BuildRunnerOptions | undefined;
    stubRunBuild(async (opts) => {
      captured = opts;
      return { pdfPath: "/fake/out.pdf", htmlPath: undefined };
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
      return { pdfPath: null, htmlPath: undefined };
    });

    await runCommand(buildCommand, { rawArgs: [] });

    expect(captured?.inputDir).toBe(path.resolve("."));
    expect(captured?.format).toBe("pdf"); // documented default
  });

  test("resolved format is the command's first output line", async () => {
    const lines: string[] = [];
    consoleLogSpy = spyOn(console, "log").mockImplementation((...args) => {
      lines.push(args.join(" "));
    });
    stubRunBuild(async () => ({ pdfPath: null, htmlPath: undefined }));

    await runCommand(buildCommand, { rawArgs: [] });

    expect(lines[0]).toContain("Format: pdf");
  });

  test("--out ending in .pdf splits into outDir + pdfFileOverride (splitOutPath wiring)", async () => {
    let captured: buildRunnerMod.BuildRunnerOptions | undefined;
    stubRunBuild(async (opts) => {
      captured = opts;
      return { pdfPath: "/tmp/out-dir/custom.pdf", htmlPath: undefined };
    });

    await runCommand(buildCommand, {
      rawArgs: [".", "--format", "pdf", "--out", "/tmp/out-dir/custom.pdf"],
    });

    expect(captured?.outDir).toBe("/tmp/out-dir");
    expect(captured?.pdfFileOverride).toBe(path.resolve("/tmp/out-dir/custom.pdf"));
  });

  test("boolean skip/allow flags and title/manifest/icc/pdfx-flavor all reach runBuild", async () => {
    let captured: buildRunnerMod.BuildRunnerOptions | undefined;
    stubRunBuild(async (opts) => {
      captured = opts;
      return { pdfPath: "/fake/out.pdfx", htmlPath: undefined };
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
        "--allow-shrink",
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
    expect(captured?.allowShrink).toBe(true);
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
    // --allow-shrink is opt-in: the over-wide-content check stays a hard error
    // unless the author asked for the shrink.
    expect(captured?.allowShrink).toBe(false);
    expect(captured?.stripAnnotations).toBeUndefined();
  });

  test("an invalid --format is a usage error (exit 2); runBuild is never called", async () => {
    stubExit();
    stubRunBuild(async () => ({ pdfPath: null, htmlPath: undefined }));

    await expect(
      runCommand(buildCommand, { rawArgs: [".", "--format", "docx"] })
    ).rejects.toThrow(/process\.exit\(2\)/);

    expect(runBuildSpy).not.toHaveBeenCalled();
  });

  test("an extra positional is a usage error (exit 2); runBuild is never called", async () => {
    stubExit();
    stubRunBuild(async () => ({ pdfPath: null, htmlPath: undefined }));

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

describe("build command — restoring pinned extensions before the build", () => {
  let book: string | undefined;
  let fetchSpy: ReturnType<typeof spyOn> | undefined;
  let errorSpy: ReturnType<typeof spyOn> | undefined;
  afterEach(async () => {
    fetchSpy?.mockRestore();
    errorSpy?.mockRestore();
    fetchSpy = errorSpy = undefined;
    if (book) await rm(book, { recursive: true, force: true });
    book = undefined;
  });

  /** A fresh clone: the manifest pins an extension whose downloaded copy is absent. */
  async function freshClone(): Promise<string> {
    book = await mkdtemp(path.join(tmpdir(), "gutterpress-build-restore-"));
    await writeFile(path.join(book, "manifest.yaml"), "title: Clone\nextensions:\n  - gp-restore-missing@1.0.0\n", "utf8");
    return book;
  }

  test("a failed restore fails the build fast: names the extension and why, says how to retry, never starts the build", async () => {
    const dir = await freshClone();
    stubExit();
    stubRunBuild(async () => ({ pdfPath: null, htmlPath: undefined }));
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
    const errors: string[] = [];
    errorSpy = spyOn(console, "error").mockImplementation((...args) => {
      errors.push(args.join(" "));
    });

    await expect(runCommand(buildCommand, { rawArgs: [dir, "--format", "html"] })).rejects.toThrow(/process\.exit\(3\)/);

    expect(runBuildSpy).not.toHaveBeenCalled();
    const message = errors.join("\n");
    expect(message).toContain("gp-restore-missing@1.0.0");
    expect(message).toContain("ECONNREFUSED");
    expect(message).toContain("run the command again");
    expect(message).toContain("gutterpress ext add gp-restore-missing@1.0.0");
  });

  test("a book with nothing to restore builds without touching the network", async () => {
    book = await mkdtemp(path.join(tmpdir(), "gutterpress-build-norestore-"));
    await writeFile(path.join(book, "manifest.yaml"), "title: Plain\nextensions:\n  - markdown-it-mark\n  - ./local.js\n", "utf8");
    stubRunBuild(async () => ({ pdfPath: null, htmlPath: undefined }));
    fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("the network must not be touched"));

    await runCommand(buildCommand, { rawArgs: [book, "--format", "html"] });

    expect(runBuildSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
