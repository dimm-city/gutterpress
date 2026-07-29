import { test, expect } from "bun:test";
import {
  EXIT_CODES,
  UsageError,
  parseFormat,
  parsePdfxFlavor,
  rejectExtraPositionals,
  rejectUnknownFlags,
  resolvePort,
} from "./cli-args.ts";
import { BuildError } from "./build-error.ts";
import { NETWORK } from "../constants.ts";

// ── parseFormat ──────────────────────────────────────────────────────────────

test("parseFormat returns the supplied default only when omitted", () => {
  expect(parseFormat(undefined, { default: "pdf" })).toBe("pdf");
  expect(() => parseFormat("", { default: "html" })).toThrow(
    "--format requires a value"
  );
});

test("parseFormat passes through valid formats", () => {
  expect(parseFormat("html", { default: "pdf" })).toBe("html");
  expect(parseFormat("pdf", { default: "html" })).toBe("pdf");
  expect(parseFormat("pdfx", { default: "html" })).toBe("pdfx");
});

test("parseFormat throws a UsageError with exitCode 2 on bad input", () => {
  try {
    parseFormat("docx", { default: "pdf" });
    throw new Error("expected UsageError");
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
    expect((err as UsageError).message).toBe(
      'Invalid --format value: "docx". Expected "html", "pdf", or "pdfx".'
    );
  }
});

// ── parsePdfxFlavor ──────────────────────────────────────────────────────────

test("parsePdfxFlavor returns undefined only when omitted", () => {
  expect(parsePdfxFlavor(undefined, "pdfx")).toBeUndefined();
  expect(() => parsePdfxFlavor("", "pdfx")).toThrow(
    "--pdfx-flavor requires a value"
  );
});

test("parsePdfxFlavor passes through valid flavors when format is pdfx", () => {
  expect(parsePdfxFlavor("x1a", "pdfx")).toBe("x1a");
  expect(parsePdfxFlavor("x3", "pdfx")).toBe("x3");
});

test("parsePdfxFlavor throws when format is not pdfx", () => {
  try {
    parsePdfxFlavor("x1a", "pdf");
    throw new Error("expected UsageError");
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
    expect((err as UsageError).message).toBe(
      "--pdfx-flavor is only valid with --format pdfx (got --format pdf)."
    );
  }
});

test("parsePdfxFlavor throws on an invalid flavor value", () => {
  try {
    parsePdfxFlavor("x9", "pdfx");
    throw new Error("expected UsageError");
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(2);
    expect((err as UsageError).message).toBe(
      'Invalid --pdfx-flavor value: "x9". Expected "x1a" or "x3".'
    );
  }
});

// ── resolvePort ──────────────────────────────────────────────────────────────

test("resolvePort defaults only when omitted", () => {
  expect(resolvePort(undefined)).toBe(NETWORK.DEFAULT_PORT);
  expect(() => resolvePort("")).toThrow("--port requires a value");
});

test("resolvePort accepts the Node port boundaries and a normal port", () => {
  expect(resolvePort("0")).toBe(0);
  expect(resolvePort("8080")).toBe(8080);
  expect(resolvePort("65535")).toBe(65535);
});

// Regression for defect preview-port-zero-falsy: --port 0 (OS-assigned) must
// NOT be coerced to the default.
test("resolvePort('0') and resolvePort(0) yield 0", () => {
  expect(resolvePort("0")).toBe(0);
  expect(resolvePort(0)).toBe(0);
});

test("resolvePort throws a UsageError with exitCode 2 outside the finite integer Node range", () => {
  for (const bad of ["abc", "-1", "1.5", "65536", "Infinity", "NaN", null, true]) {
    try {
      resolvePort(bad);
      throw new Error(`expected UsageError for ${bad}`);
    } catch (err) {
      expect(err).toBeInstanceOf(UsageError);
      expect((err as UsageError).exitCode).toBe(2);
      expect((err as UsageError).message).toBe(
        `Invalid --port value: "${bad}". Expected an integer from 0 to 65535 (0 = OS-assigned).`
      );
    }
  }
});

// ── EXIT_CODES contract (M47) ───────────────────────────────────────────────

test("EXIT_CODES defines the one contract: 0 clean / 1 findings / 2 usage / 3 pipeline", () => {
  expect(EXIT_CODES.OK).toBe(0);
  expect(EXIT_CODES.FINDINGS).toBe(1);
  expect(EXIT_CODES.USAGE).toBe(2);
  expect(EXIT_CODES.PIPELINE).toBe(3);
});

test("UsageError defaults to EXIT_CODES.USAGE (2)", () => {
  expect(new UsageError("bad flag").exitCode).toBe(EXIT_CODES.USAGE);
});

test("BuildError defaults to EXIT_CODES.PIPELINE (3), distinct from UsageError's default", () => {
  const err = new BuildError("pipeline blew up");
  expect(err.exitCode).toBe(EXIT_CODES.PIPELINE);
  expect(err.exitCode).not.toBe(new UsageError("bad flag").exitCode);
});

test("BuildError still honors an explicit exit code (e.g. a findings-style gate failure)", () => {
  expect(new BuildError("pre-build validation failed", EXIT_CODES.FINDINGS).exitCode).toBe(1);
});

// ── rejectExtraPositionals (M46) ────────────────────────────────────────────

test("rejectExtraPositionals allows exactly the declared count", () => {
  expect(() => rejectExtraPositionals(["a"], 1, "build")).not.toThrow();
  expect(() => rejectExtraPositionals([], 1, "build")).not.toThrow();
  expect(() => rejectExtraPositionals(undefined, 1, "build")).not.toThrow();
});

test("rejectExtraPositionals throws a UsageError naming the command on extras", () => {
  try {
    rejectExtraPositionals(["a", "b"], 1, "build");
    throw new Error("expected UsageError");
  } catch (err) {
    expect(err).toBeInstanceOf(UsageError);
    expect((err as UsageError).exitCode).toBe(EXIT_CODES.USAGE);
    expect((err as UsageError).message).toContain("gutterpress build");
    expect((err as UsageError).message).toContain("b");
  }
});

// ── rejectUnknownFlags (C7) ──────────────────────────────────────────────────

const testCommandArgs = {
  input: { type: "positional" },
  format: { type: "string" },
  output: { type: "string", alias: "o" },
  "dry-run": { type: "boolean" },
  watch: { type: "boolean", default: true },
  open: { type: "boolean", default: true },
  verbose: { type: "boolean", alias: "v" },
  alpha: { type: "boolean", alias: "a" },
  beta: { type: "boolean", alias: "b" },
} as const;

test("rejectUnknownFlags accepts declared flags, aliases, negation, and camel-case spellings", () => {
  expect(() =>
    rejectUnknownFlags(
      [".", "--format=html", "--dryRun", "--no-watch", "--no-open", "-v"],
      testCommandArgs,
      "preview"
    )
  ).not.toThrow();
});

test("rejectUnknownFlags rejects an unknown long option as a UsageError", () => {
  expect(() =>
    rejectUnknownFlags(
      [".", "--formt", "html"],
      testCommandArgs,
      "build"
    )
  ).toThrow(/gutterpress build: unknown option --formt/);
});

test("rejectUnknownFlags does not mistake a positional argument name for a flag", () => {
  expect(() =>
    rejectUnknownFlags(
      ["--input", "book"],
      testCommandArgs,
      "build"
    )
  ).toThrow(/unknown option --input/);
});

test("rejectUnknownFlags rejects missing long-option values", () => {
  for (const rawArgs of [
    ["--format"],
    ["--format="],
    ["--format", "--open"],
    ["--format", "--"],
  ]) {
    expect(() =>
      rejectUnknownFlags(rawArgs, testCommandArgs, "build")
    ).toThrow(/option --format requires a value/);
  }
});

test("rejectUnknownFlags accepts inline, aliased, and dash-prefixed string values", () => {
  expect(() =>
    rejectUnknownFlags(
      [
        "--format=html",
        "--output",
        "-2",
        "--output",
        "--draft.pdf",
        "--output",
        "-draft.pdf",
        "--o=inline",
        "-oattached",
      ],
      testCommandArgs,
      "build"
    )
  ).not.toThrow();
});

test("rejectUnknownFlags treats only declared options as missing-value boundaries", () => {
  expect(() =>
    rejectUnknownFlags(["--output", "--dry-run"], testCommandArgs, "build")
  ).toThrow(/option --output requires a value/);
  expect(() =>
    rejectUnknownFlags(["--output", "-v"], testCommandArgs, "build")
  ).toThrow(/option --output requires a value/);
  expect(() =>
    rejectUnknownFlags(["--unknown"], testCommandArgs, "build")
  ).toThrow(/unknown option --unknown/);
});

test("rejectUnknownFlags supports grouped short booleans and value aliases", () => {
  expect(() =>
    rejectUnknownFlags(["-abv", "-abo", "file.pdf"], testCommandArgs, "build")
  ).not.toThrow();
  expect(() =>
    rejectUnknownFlags(["-abo"], testCommandArgs, "build")
  ).toThrow(/option -o requires a value/);
  expect(() =>
    rejectUnknownFlags(["-o="], testCommandArgs, "build")
  ).toThrow(/option -o requires a value/);
});

test("rejectUnknownFlags stops option parsing after --", () => {
  expect(() =>
    rejectUnknownFlags(
      ["--format", "html", "--", "--also-positional"],
      testCommandArgs,
      "build"
    )
  ).not.toThrow();
});

test("rejectUnknownFlags rejects unknown short and negated options", () => {
  expect(() =>
    rejectUnknownFlags(["-x"], testCommandArgs, "build")
  ).toThrow(/unknown option -x/);
  expect(() =>
    rejectUnknownFlags(["--no-format"], testCommandArgs, "build")
  ).toThrow(/unknown option --no-format/);
});
