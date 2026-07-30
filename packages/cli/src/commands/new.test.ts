/**
 * ARCH finding #49: command-level smoke test for `new.ts`'s citty dispatch —
 * arg-to-`scaffoldProject`-options mapping, the unknown-`--template` guard,
 * and the `CreateProjectError.code` → exit-code mapping (M47: `scaffold-io`
 * is a pipeline failure (3); every other code is a usage error (2)).
 * `scaffoldProject` is `spyOn`-stubbed so this never touches disk or git.
 */
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { runCommand } from "citty";
import path from "node:path";
import * as scaffoldMod from "../lib/project-scaffold.ts";
import type { CreateProjectOptions, CreateProjectError } from "../lib/project-scaffold.ts";
import newCommand from "./new.ts";
import { EXIT_CODES } from "../lib/cli-args.ts";
import { stubProcessExit } from "../test-helpers/testkit.ts";

function makeCreateProjectError(
  code: CreateProjectError["code"],
  message: string
): CreateProjectError {
  const err = new Error(message) as CreateProjectError;
  err.code = code;
  return err;
}

let scaffoldSpy: ReturnType<typeof spyOn> | undefined;
let exitSpy: ReturnType<typeof stubProcessExit> | undefined;
let consoleErrorSpy: ReturnType<typeof spyOn> | undefined;
let consoleLogSpy: ReturnType<typeof spyOn> | undefined;

function stubExit(): void {
  exitSpy = stubProcessExit();
}

function stubScaffold(
  impl: (opts: CreateProjectOptions) => Promise<scaffoldMod.CreateProjectResult>
): void {
  scaffoldSpy = spyOn(scaffoldMod, "scaffoldProject").mockImplementation(
    impl as unknown as typeof scaffoldMod.scaffoldProject
  );
}

function fakeResult(overrides: Partial<scaffoldMod.CreateProjectResult> = {}) {
  return {
    projectDir: "/tmp/parent/my-project",
    manifestPath: "/tmp/parent/my-project/manifest.yaml",
    openFile: "/tmp/parent/my-project/chapter-01.md",
    versionHistory: "local-git" as const,
    ...overrides,
  };
}

afterEach(() => {
  scaffoldSpy?.mockRestore();
  exitSpy?.mockRestore();
  consoleErrorSpy?.mockRestore();
  consoleLogSpy?.mockRestore();
  scaffoldSpy = undefined;
  exitSpy = undefined;
  consoleErrorSpy = undefined;
  consoleLogSpy = undefined;
});

describe("new command — arg mapping onto scaffoldProject", () => {
  test("name, author, dir, folder, and --no-git map onto CreateProjectOptions", async () => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: CreateProjectOptions | undefined;
    stubScaffold(async (opts) => {
      captured = opts;
      return fakeResult({ versionHistory: "none" });
    });

    await runCommand(newCommand, {
      rawArgs: [
        "My First Book",
        "--author",
        "Jane Author",
        "--dir",
        "/tmp/parent",
        "--folder",
        "custom-folder",
        "--no-git",
      ],
    });

    expect(captured?.name).toBe("My First Book");
    expect(captured?.author).toBe("Jane Author");
    expect(captured?.parentDir).toBe(path.resolve("/tmp/parent"));
    expect(captured?.folderName).toBe("custom-folder");
    expect(captured?.versionHistory).toBe("none");
  });

  test("--git defaults true: versionHistory is local-git when --no-git is absent", async () => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: CreateProjectOptions | undefined;
    stubScaffold(async (opts) => {
      captured = opts;
      return fakeResult();
    });

    await runCommand(newCommand, { rawArgs: ["My Book"] });

    expect(captured?.versionHistory).toBe("local-git");
  });

  test("--dir defaults to cwd when omitted", async () => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: CreateProjectOptions | undefined;
    stubScaffold(async (opts) => {
      captured = opts;
      return fakeResult();
    });

    await runCommand(newCommand, { rawArgs: ["My Book"] });

    expect(captured?.parentDir).toBe(process.cwd());
  });

  test("a known --template value is passed through", async () => {
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    let captured: CreateProjectOptions | undefined;
    stubScaffold(async (opts) => {
      captured = opts;
      return fakeResult();
    });

    await runCommand(newCommand, { rawArgs: ["My Book", "--template", "zine"] });

    expect(captured?.template).toBe("zine");
  });
});

describe("new command — validation and exit codes", () => {
  test("an unknown --template errors (exit 2) before scaffoldProject is called", async () => {
    stubExit();
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    stubScaffold(async () => fakeResult());

    await expect(
      runCommand(newCommand, { rawArgs: ["My Book", "--template", "not-a-real-template"] })
    ).rejects.toThrow(new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`));
    expect(scaffoldSpy).not.toHaveBeenCalled();
  });

  test("a missing required name positional is a usage error before scaffoldProject runs", async () => {
    stubExit();
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    stubScaffold(async () => fakeResult());

    await expect(runCommand(newCommand, { rawArgs: [] })).rejects.toThrow();
    expect(scaffoldSpy).not.toHaveBeenCalled();
  });

  test("an extra positional is a usage error (exit 2); scaffoldProject is never called", async () => {
    stubExit();
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    stubScaffold(async () => fakeResult());

    await expect(
      runCommand(newCommand, { rawArgs: ["Name", "Extra"] })
    ).rejects.toThrow(/process\.exit\(2\)/);
    expect(scaffoldSpy).not.toHaveBeenCalled();
  });

  test("CreateProjectError code 'scaffold-io' maps to EXIT_CODES.PIPELINE (3)", async () => {
    stubExit();
    consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
    stubScaffold(async () => {
      throw makeCreateProjectError("scaffold-io", "disk write failed");
    });

    await expect(runCommand(newCommand, { rawArgs: ["My Book"] })).rejects.toThrow(
      new RegExp(`process\\.exit\\(${EXIT_CODES.PIPELINE}\\)`)
    );
  });

  test.each(["target-exists", "invalid-name", "parent-not-writable"] as const)(
    "CreateProjectError code '%s' maps to EXIT_CODES.USAGE (2)",
    async (code) => {
      stubExit();
      consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
      stubScaffold(async () => {
        throw makeCreateProjectError(code, `simulated ${code}`);
      });

      await expect(runCommand(newCommand, { rawArgs: ["My Book"] })).rejects.toThrow(
        new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`)
      );
    }
  );

  test("success never calls process.exit", async () => {
    stubExit();
    consoleLogSpy = spyOn(console, "log").mockImplementation(() => {});
    stubScaffold(async () => fakeResult());

    await runCommand(newCommand, { rawArgs: ["My Book"] });

    expect(exitSpy).not.toHaveBeenCalled();
  });
});
