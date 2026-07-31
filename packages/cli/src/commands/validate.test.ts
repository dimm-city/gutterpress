/**
 * ARCH finding #49: command-level smoke test for `validate.ts`'s citty
 * dispatch — positional-vs-`--input` precedence (M46), arg mapping onto
 * `executeAndReport`, and the exit-code contract. `executeAndReport` is
 * `spyOn`-stubbed so this never runs a real check registry.
 */
import { describe, test, expect, spyOn, afterEach } from "bun:test";
import { runCommand } from "citty";
import * as validationExecMod from "../lib/validation-exec.ts";
import type { ValidationExecutionArgs } from "../lib/validation-exec.ts";
import validateCommand from "./validate.ts";
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

describe("validate command — positional/--input precedence (M46) and arg mapping", () => {
  test("positional dir sets the source input when --input is absent", async () => {
    let capturedArgs: ValidationExecutionArgs | undefined;
    stubExecuteAndReport(async (args) => {
      capturedArgs = args;
      return { ok: true, execution: {} };
    });

    await runCommand(validateCommand, { rawArgs: ["./my-book"] });

    expect(capturedArgs?.input).toBe("./my-book");
  });

  test("--input overrides the positional dir", async () => {
    let capturedArgs: ValidationExecutionArgs | undefined;
    stubExecuteAndReport(async (args) => {
      capturedArgs = args;
      return { ok: true, execution: {} };
    });

    await runCommand(validateCommand, { rawArgs: ["./positional-dir", "--input", "./flag-dir"] });

    expect(capturedArgs?.input).toBe("./flag-dir");
  });

  test("category/only/skip/phase/target/pdf/manifest all reach executeAndReport", async () => {
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

    await runCommand(validateCommand, {
      rawArgs: [
        ".",
        "--pdf",
        "/tmp/book.pdf",
        "--manifest",
        "/tmp/manifest.yaml",
        "--category",
        "pdf,asset",
        "--only",
        "pdf.structure.qpdf",
        "--skip",
        "asset.image-extension",
        "--phase",
        "post",
        "--target",
        "dtrpg,itch",
        "--format",
        "json",
      ],
    });

    expect(capturedArgs?.pdf).toBe("/tmp/book.pdf");
    expect(capturedArgs?.manifest).toBe("/tmp/manifest.yaml");
    expect(capturedArgs?.category).toBe("pdf,asset");
    expect(capturedArgs?.only).toBe("pdf.structure.qpdf");
    expect(capturedArgs?.skip).toBe("asset.image-extension");
    expect(capturedArgs?.phase).toBe("post");
    expect(capturedArgs?.target).toBe("dtrpg,itch");
    expect(capturedFormat).toBe("json");
  });

  test("format defaults to text when --format is omitted", async () => {
    let capturedFormat: string | undefined;
    execSpy = spyOn(validationExecMod, "executeAndReport").mockImplementation((async (
      _args: ValidationExecutionArgs,
      format?: "text" | "json"
    ) => {
      capturedFormat = format;
      return { ok: true, execution: {} };
    }) as unknown as typeof validationExecMod.executeAndReport);

    await runCommand(validateCommand, { rawArgs: ["."] });

    expect(capturedFormat).toBe("text");
  });
});

describe("validate command — exit-code contract", () => {
  test("ok: false exits with EXIT_CODES.FINDINGS", async () => {
    stubExit();
    stubExecuteAndReport(async () => ({ ok: false, execution: {} }));

    await expect(runCommand(validateCommand, { rawArgs: ["."] })).rejects.toThrow(
      new RegExp(`process\\.exit\\(${EXIT_CODES.FINDINGS}\\)`)
    );
  });

  test("ok: true never calls process.exit", async () => {
    stubExit();
    stubExecuteAndReport(async () => ({ ok: true, execution: {} }));

    await runCommand(validateCommand, { rawArgs: ["."] });

    expect(exitSpy).not.toHaveBeenCalled();
  });

  test("a thrown UsageError from executeAndReport exits with the error's own code", async () => {
    stubExit();
    const { UsageError } = await import("../lib/cli-args.ts");
    execSpy = spyOn(validationExecMod, "executeAndReport").mockImplementation((async () => {
      throw new UsageError("bogus --phase value", 2);
    }) as unknown as typeof validationExecMod.executeAndReport);

    await expect(runCommand(validateCommand, { rawArgs: ["."] })).rejects.toThrow(
      /process\.exit\(2\)/
    );
  });

  test("an unrecognized thrown error still maps onto EXIT_CODES.USAGE (validate's catch-all)", async () => {
    stubExit();
    execSpy = spyOn(validationExecMod, "executeAndReport").mockImplementation((async () => {
      throw new Error("unexpected failure, not a UsageError");
    }) as unknown as typeof validationExecMod.executeAndReport);

    await expect(runCommand(validateCommand, { rawArgs: ["."] })).rejects.toThrow(
      new RegExp(`process\\.exit\\(${EXIT_CODES.USAGE}\\)`)
    );
  });

  test("an extra positional is a usage error before executeAndReport is ever called", async () => {
    stubExit();
    stubExecuteAndReport(async () => ({ ok: true, execution: {} }));

    await expect(runCommand(validateCommand, { rawArgs: ["a", "b"] })).rejects.toThrow(
      /process\.exit\(2\)/
    );
    expect(execSpy).not.toHaveBeenCalled();
  });
});
