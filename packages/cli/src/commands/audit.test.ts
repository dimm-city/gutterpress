/**
 * ARCH finding #49: command-level smoke test for `audit.ts`'s citty dispatch
 * — the hard-coded `category: "asset"` / `phase: "pre-build"` scope, the
 * positional/--input precedence (M46), and the exit-code contract.
 * `executeAndReport` is `spyOn`-stubbed so this never runs a real check
 * registry.
 */
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { runCommand } from "citty";
import path from "node:path";
import * as validationExecMod from "../lib/validation-exec.ts";
import type { ValidationExecutionArgs } from "../lib/validation-exec.ts";
import auditCommand from "./audit.ts";
import { EXIT_CODES } from "../lib/cli-args.ts";
import { stubProcessExit } from "../test-helpers/testkit.ts";

let execSpy: ReturnType<typeof spyOn> | undefined;
let exitSpy: ReturnType<typeof stubProcessExit> | undefined;

function stubExit(): void {
  exitSpy = stubProcessExit();
}

function stubExecuteAndReport(
  impl: (
    args: ValidationExecutionArgs,
    format?: "text" | "json"
  ) => Promise<{ ok: boolean; execution: unknown }>
): void {
  execSpy = spyOn(validationExecMod, "executeAndReport").mockImplementation(
    impl as unknown as typeof validationExecMod.executeAndReport
  );
}

afterEach(() => {
  execSpy?.mockRestore();
  exitSpy?.mockRestore();
  execSpy = undefined;
  exitSpy = undefined;
});

describe("audit command — fixed asset/pre-build scope and arg mapping", () => {
  test("always scopes to category: asset, phase: pre-build, regardless of input", async () => {
    let capturedArgs: ValidationExecutionArgs | undefined;
    stubExecuteAndReport(async (args) => {
      capturedArgs = args;
      return { ok: true, execution: {} };
    });

    await runCommand(auditCommand, { rawArgs: ["./assets-dir"] });

    expect(capturedArgs?.category).toBe("asset");
    expect(capturedArgs?.phase).toBe("pre-build");
  });

  test("positional dir is resolved to an absolute input path", async () => {
    let capturedArgs: ValidationExecutionArgs | undefined;
    stubExecuteAndReport(async (args) => {
      capturedArgs = args;
      return { ok: true, execution: {} };
    });

    await runCommand(auditCommand, { rawArgs: ["./assets-dir"] });

    expect(capturedArgs?.input).toBe(path.resolve("./assets-dir"));
  });

  test("--input overrides the positional dir", async () => {
    let capturedArgs: ValidationExecutionArgs | undefined;
    stubExecuteAndReport(async (args) => {
      capturedArgs = args;
      return { ok: true, execution: {} };
    });

    await runCommand(auditCommand, {
      rawArgs: ["./positional-dir", "--input", "./flag-dir"],
    });

    expect(capturedArgs?.input).toBe(path.resolve("./flag-dir"));
  });

  test("no positional/--input defaults input to cwd", async () => {
    let capturedArgs: ValidationExecutionArgs | undefined;
    stubExecuteAndReport(async (args) => {
      capturedArgs = args;
      return { ok: true, execution: {} };
    });

    await runCommand(auditCommand, { rawArgs: [] });

    expect(capturedArgs?.input).toBe(path.resolve("."));
  });

  test("--only/--skip/--manifest/--format reach executeAndReport", async () => {
    let capturedArgs: ValidationExecutionArgs | undefined;
    let capturedFormat: string | undefined;
    execSpy = spyOn(validationExecMod, "executeAndReport").mockImplementation((async (
      args: ValidationExecutionArgs,
      format?: "text" | "json"
    ) => {
      capturedArgs = args;
      capturedFormat = format;
      return { ok: true, execution: {} };
    }) as unknown as typeof validationExecMod.executeAndReport);

    await runCommand(auditCommand, {
      rawArgs: [
        ".",
        "--only",
        "asset.image-extension",
        "--skip",
        "asset.color-space",
        "--manifest",
        "/tmp/manifest.yaml",
        "--format",
        "json",
      ],
    });

    expect(capturedArgs?.only).toBe("asset.image-extension");
    expect(capturedArgs?.skip).toBe("asset.color-space");
    expect(capturedArgs?.manifest).toBe("/tmp/manifest.yaml");
    expect(capturedFormat).toBe("json");
  });
});

describe("audit command — exit-code contract", () => {
  test("ok: false exits with EXIT_CODES.FINDINGS", async () => {
    stubExit();
    stubExecuteAndReport(async () => ({ ok: false, execution: {} }));

    await expect(runCommand(auditCommand, { rawArgs: ["."] })).rejects.toThrow(
      new RegExp(`process\\.exit\\(${EXIT_CODES.FINDINGS}\\)`)
    );
  });

  test("ok: true never calls process.exit", async () => {
    stubExit();
    stubExecuteAndReport(async () => ({ ok: true, execution: {} }));

    await runCommand(auditCommand, { rawArgs: ["."] });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("an extra positional is a usage error before executeAndReport is ever called", async () => {
    stubExit();
    stubExecuteAndReport(async () => ({ ok: true, execution: {} }));

    await expect(runCommand(auditCommand, { rawArgs: ["a", "b"] })).rejects.toThrow(
      /process\.exit\(2\)/
    );
    expect(execSpy).not.toHaveBeenCalled();
  });
});
