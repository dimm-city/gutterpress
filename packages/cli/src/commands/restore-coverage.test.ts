/**
 * Every command that loads a book's plugins for a final artifact or a check
 * run restores the book's missing pinned extensions first, and fails the same
 * way when it cannot: the extension, the reason and how to retry, with the
 * pipeline exit code. The network here is down, so the reason is "offline".
 * (A non-connection failure's own wording is covered in
 * npm-plugin-installer.test.ts.) The restore lives in the shared seams (`loadBuildPlugins`
 * for builds and exports, `executeValidation` for check runs), so these run
 * the REAL pipelines up to that point — nothing is stubbed but the network.
 */
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { runCommand } from "citty";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import buildCommand from "./build.ts";
import preflightCommand from "./preflight.ts";
import validateCommand from "./validate.ts";
import { EXIT_CODES } from "../lib/cli-args.ts";
import { stubProcessExit } from "../test-helpers/testkit.ts";

let book: string;
let spies: Array<{ mockRestore(): void }> = [];
const errors: string[] = [];
let fetchSpy: ReturnType<typeof spyOn>;

beforeEach(async () => {
  book = await mkdtemp(path.join(tmpdir(), "gutterpress-restore-coverage-"));
  // A fresh clone: the manifest pins an extension whose downloaded copy is absent.
  await writeFile(path.join(book, "manifest.yaml"), "title: Clone\nextensions:\n  - gp-restore-missing@1.0.0\n", "utf8");
  await writeFile(path.join(book, "chapter.md"), "# Hello\n", "utf8");
  errors.length = 0;
  fetchSpy = spyOn(globalThis, "fetch").mockRejectedValue(new Error("ECONNREFUSED"));
  spies = [
    fetchSpy,
    stubProcessExit(),
    spyOn(console, "error").mockImplementation((...args) => void errors.push(args.join(" "))),
    spyOn(console, "log").mockImplementation(() => {}),
    spyOn(console, "warn").mockImplementation(() => {}),
  ];
});

afterEach(async () => {
  for (const spy of spies) spy.mockRestore();
  await rm(book, { recursive: true, force: true });
});

function expectRestoreFailure(): void {
  const message = errors.join("\n");
  expect(message).toContain("You appear to be offline");
  expect(message).toContain("gp-restore-missing@1.0.0 (pinned in manifest.yaml)");
  expect(message).toContain("Connect to the internet and try again");
}

const exitsWithPipeline = new RegExp(`process\\.exit\\(${EXIT_CODES.PIPELINE}\\)`);

describe("a failed restore stops the command with the pipeline exit code", () => {
  test("build", async () => {
    await expect(runCommand(buildCommand, { rawArgs: [book, "--format", "html"] })).rejects.toThrow(exitsWithPipeline);
    expectRestoreFailure();
  });

  test("build, even with pre-build validation off (the render itself loads the plugins)", async () => {
    await expect(
      runCommand(buildCommand, { rawArgs: [book, "--format", "html", "--skip-pre-validate"] }),
    ).rejects.toThrow(exitsWithPipeline);
    expectRestoreFailure();
  });

  test("validate", async () => {
    await expect(
      runCommand(validateCommand, { rawArgs: [book, "--category", "source"] }),
    ).rejects.toThrow(exitsWithPipeline);
    expectRestoreFailure();
  });

  test("validate --format json prints nothing on stdout for the failure", async () => {
    const out: string[] = [];
    const logSpy = spyOn(console, "log").mockImplementation((...args) => void out.push(args.join(" ")));
    try {
      await expect(
        runCommand(validateCommand, { rawArgs: [book, "--category", "source", "--format", "json"] }),
      ).rejects.toThrow(exitsWithPipeline);
    } finally {
      logSpy.mockRestore();
    }
    expect(out).toEqual([]);
    expectRestoreFailure();
  });

  test("preflight", async () => {
    const pdf = path.join(book, "book.pdf");
    await writeFile(pdf, "%PDF-1.4\n", "utf8");
    await expect(
      runCommand(preflightCommand, { rawArgs: [book, "--pdf", pdf] }),
    ).rejects.toThrow(exitsWithPipeline);
    expectRestoreFailure();
  });
});

describe("nothing is downloaded when there is nothing to restore", () => {
  test("validate of a book with only local, bundled and unpinned extensions never touches the network", async () => {
    await writeFile(
      path.join(book, "manifest.yaml"),
      "title: Plain\nextensions:\n  - markdown-it-mark\n  - ./local.js\n",
      "utf8",
    );
    await runCommand(validateCommand, { rawArgs: [book, "--category", "source"] }).catch(() => {});
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
