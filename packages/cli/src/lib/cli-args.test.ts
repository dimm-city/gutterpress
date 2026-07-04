import { test, expect } from "bun:test";
import {
  UsageError,
  parseFormat,
  parsePdfxFlavor,
  resolvePort,
} from "./cli-args.ts";
import { NETWORK } from "../constants.ts";

// ── parseFormat ──────────────────────────────────────────────────────────────

test("parseFormat returns the supplied default for undefined/empty", () => {
  expect(parseFormat(undefined, { default: "pdf" })).toBe("pdf");
  expect(parseFormat("", { default: "html" })).toBe("html");
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

test("parsePdfxFlavor returns undefined for undefined/empty", () => {
  expect(parsePdfxFlavor(undefined, "pdfx")).toBeUndefined();
  expect(parsePdfxFlavor("", "pdfx")).toBeUndefined();
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

test("resolvePort defaults to NETWORK.DEFAULT_PORT when undefined/empty", () => {
  expect(resolvePort(undefined)).toBe(NETWORK.DEFAULT_PORT);
  expect(resolvePort("")).toBe(NETWORK.DEFAULT_PORT);
});

test("resolvePort passes through a normal port", () => {
  expect(resolvePort("8080")).toBe(8080);
});

// Regression for defect preview-port-zero-falsy: --port 0 (OS-assigned) must
// NOT be coerced to the default.
test("resolvePort('0') and resolvePort(0) yield 0", () => {
  expect(resolvePort("0")).toBe(0);
  expect(resolvePort(0)).toBe(0);
});

test("resolvePort throws a UsageError with exitCode 2 on invalid input", () => {
  for (const bad of ["abc", "-1", "NaN"]) {
    try {
      resolvePort(bad);
      throw new Error(`expected UsageError for ${bad}`);
    } catch (err) {
      expect(err).toBeInstanceOf(UsageError);
      expect((err as UsageError).exitCode).toBe(2);
      expect((err as UsageError).message).toBe(
        `Invalid --port value: "${bad}". Expected a non-negative number (0 = OS-assigned).`
      );
    }
  }
});
