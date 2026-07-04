/**
 * The CLI PDF summary lines (Max TAC / Fonts / Rasterized pages) must be derived
 * from structured CheckResult `code` / `data` fields — NOT by string-matching
 * the human-readable `message`. Rewording a check message must not change the
 * summary numbers.
 */
import { describe, test, expect } from "bun:test";
import { buildPdfSummaryLines } from "./validation-exec";
import type { CheckResult } from "../checks/types";

describe("buildPdfSummaryLines reads structured fields, not message text", () => {
  test("Max TAC line reads data.maxTac regardless of message wording", () => {
    const results: CheckResult[] = [
      {
        checkId: "pdf.print.ink-coverage",
        severity: "warning",
        message: "completely unrelated wording that mentions no percentage",
        code: "ink-coverage-exceeded",
        data: { maxTac: 355.5, offendingCount: 4 },
      },
    ];
    expect(buildPdfSummaryLines(results)).toContain("Max TAC: 355.5% (high!)");
  });

  test("changing message strings does not change the summary output", () => {
    const base = {
      checkId: "pdf.print.ink-coverage",
      severity: "warning" as const,
      code: "ink-coverage-exceeded",
      data: { maxTac: 300 },
    };
    const rasterBase = {
      checkId: "pdf.print.rasterized-pages",
      severity: "warning" as const,
      code: "rasterized-pages-detected",
      data: { pages: [3, 7] },
    };

    const a = buildPdfSummaryLines([
      { ...base, message: "wording A" },
      { ...rasterBase, message: "wording A" },
    ]);
    const b = buildPdfSummaryLines([
      { ...base, message: "totally different wording B with 999%" },
      { ...rasterBase, message: "reworded raster line" },
    ]);
    expect(a).toEqual(b);
    expect(a).toContain("Max TAC: 300.0% (high!)");
    expect(a).toContain("Rasterized pages: 3, 7");
  });

  test("rasterized pages line reads data.pages", () => {
    const results: CheckResult[] = [
      {
        checkId: "pdf.print.rasterized-pages",
        severity: "warning",
        message: "reworded",
        code: "rasterized-pages-detected",
        data: { pages: [2, 5, 8] },
      },
    ];
    expect(buildPdfSummaryLines(results)).toContain(
      "Rasterized pages: 2, 5, 8"
    );
  });

  test("a font issue result suppresses the 'all embedded' line", () => {
    const results: CheckResult[] = [
      {
        checkId: "pdf.print.embedded-fonts",
        severity: "warning",
        message: "reworded no-fonts message",
        code: "no-fonts",
      },
    ];
    expect(buildPdfSummaryLines(results)).not.toContain("Fonts: all embedded");
  });

  test("no PDF-check results produce no summary lines", () => {
    expect(buildPdfSummaryLines([])).toEqual([]);
  });
});
