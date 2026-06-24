import { describe, expect, test } from "bun:test";
import { resolveConfig } from "./manifest";
import {
  applyDtrpgPdfDefaults,
  applyValidationProfile,
} from "./validation-profile";

describe("validation profile behavior", () => {
  test("default dtrpg pdf defaults are injected only when absent", () => {
    const base = resolveConfig(
      {},
      {
        validate: {
          checks: {
            "pdf.structure.qpdf": false,
          },
        },
      }
    );

    const next = applyDtrpgPdfDefaults(base);

    expect(next.validate.checks["pdf.structure.qpdf"]).toBe(false);
    expect(next.validate.checks["pdf.print.pdfx-markers"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });

  test("dtrpg profile lock forces strict checks and tac threshold", () => {
    const base = resolveConfig(
      {},
      {
        ink: { maxTac: 300 },
        pdfx: { flavor: "x3" },
        validate: {
          checks: {
            "pdf.structure.qpdf": false,
          },
        },
      }
    );

    const locked = applyValidationProfile(base, "dtrpg");

    expect(locked.ink.maxTac).toBe(240);
    expect(locked.pdfx.flavor).toBe("x1a");
    expect(locked.validate.checks["pdf.structure.qpdf"]).toEqual({
      enabled: true,
      severity: "error",
    });
  });
});
