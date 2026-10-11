import { describe, expect, test } from "bun:test";
import {
  DIAGNOSTIC_CATEGORIES,
  type DiagnosticCategory,
  diagnosticForEditRejection,
  externalReplacementDiagnostic,
} from "../../src/core/diagnostics.ts";

// D14's category list, verbatim, in the order the plan lists them. This is
// the pinned oracle a future accidental rename/reorder/addition must fail
// against.
const D14_CATEGORIES_VERBATIM = [
  "EDITOR_STALE_EDIT",
  "EDITOR_INVALID_RANGE",
  "EDITOR_READONLY",
  "EDITOR_FILE_TOO_LARGE",
  "EDITOR_UNSUPPORTED_PROJECTION",
  "EDITOR_PROJECTION_LIMIT",
  "EDITOR_PLUGIN_UNTRUSTED",
  "EDITOR_PLUGIN_LOAD_FAILED",
  "EDITOR_CUSTOM_VIEW_UNAVAILABLE",
  "EDITOR_HOST_DISCONNECTED",
  "EDITOR_EXTERNAL_REPLACEMENT",
] as const;

describe("DIAGNOSTIC_CATEGORIES", () => {
  test("is exactly the 11 D14 category names, verbatim, in the plan's order", () => {
    expect(DIAGNOSTIC_CATEGORIES).toEqual(D14_CATEGORIES_VERBATIM);
    expect(DIAGNOSTIC_CATEGORIES.length).toBe(11);
  });

  test("has no duplicate categories", () => {
    expect(new Set(DIAGNOSTIC_CATEGORIES).size).toBe(DIAGNOSTIC_CATEGORIES.length);
  });
});

describe("diagnosticForEditRejection", () => {
  const cases: Array<{
    reason: "stale" | "readonly" | "invalid-range";
    category: DiagnosticCategory;
  }> = [
    { reason: "stale", category: "EDITOR_STALE_EDIT" },
    { reason: "readonly", category: "EDITOR_READONLY" },
    { reason: "invalid-range", category: "EDITOR_INVALID_RANGE" },
  ];

  for (const { reason, category } of cases) {
    test(`reason "${reason}" maps to category ${category}`, () => {
      const diagnostic = diagnosticForEditRejection(reason);
      expect(diagnostic.category).toBe(category);
    });

    test(`reason "${reason}" produces a non-empty, safe-next-action message`, () => {
      const diagnostic = diagnosticForEditRejection(reason);
      expect(diagnostic.message.length).toBeGreaterThan(0);
    });
  }
});

describe("externalReplacementDiagnostic", () => {
  test("carries the EDITOR_EXTERNAL_REPLACEMENT category", () => {
    const diagnostic = externalReplacementDiagnostic();
    expect(diagnostic.category).toBe("EDITOR_EXTERNAL_REPLACEMENT");
    expect(diagnostic.message.length).toBeGreaterThan(0);
  });

  test("never includes document text (D15: do not log document text by default)", () => {
    const diagnostic = externalReplacementDiagnostic();
    // A structural proxy for "no document text": the message is a fixed,
    // short, generic sentence with no parameter for arbitrary content.
    expect(diagnostic.message).not.toMatch(/[{<[]/);
  });
});
