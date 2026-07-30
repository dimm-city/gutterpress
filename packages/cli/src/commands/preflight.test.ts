import { describe, expect, test } from "bun:test";
import { buildPreflightPayload, toPreflightMarkdown } from "./preflight";
import type { ValidationExecutionResult } from "../index.ts";

function makeExecution(overrides: Partial<ValidationExecutionResult> = {}): ValidationExecutionResult {
  return {
    config: {} as any,
    targets: [],
    context: {
      config: {} as any,
      inputDir: "/tmp/input",
      outputDir: "/tmp/output",
      pdfPath: "/tmp/book.pdf",
    },
    runnerOptions: {},
    tools: {
      available: ["qpdf"],
      missing: [],
      skippedChecks: [],
      toolToChecks: new Map(),
    },
    report: {
      results: [],
      errors: [],
      warnings: [],
      infos: [],
      passed: ["pdf.structure.qpdf"],
      summary: {
        total: 1,
        errors: 0,
        warnings: 0,
        infos: 0,
        passed: 1,
      },
    },
    ...overrides,
  };
}

describe("preflight payload", () => {
  test("status is GO when no issues", () => {
    const payload = buildPreflightPayload(makeExecution());
    expect(payload.status).toBe("GO");
  });

  test("status is NO-GO when errors exist", () => {
    const execution = makeExecution({
      report: {
        results: [{ checkId: "x", severity: "error", message: "bad" }],
        errors: [{ checkId: "x", severity: "error", message: "bad" }],
        warnings: [],
        infos: [],
        passed: [],
        summary: { total: 1, errors: 1, warnings: 0, infos: 0, passed: 0 },
      },
    });
    const payload = buildPreflightPayload(execution);
    expect(payload.status).toBe("NO-GO");
  });

  test("dtrpg required check skip produces NO-GO", () => {
    const execution = makeExecution({
      targets: ["dtrpg"],
      tools: {
        available: [],
        missing: ["qpdf"],
        skippedChecks: ["pdf.structure.qpdf"],
        toolToChecks: new Map([["qpdf", ["pdf.structure.qpdf"]]]),
      },
      report: {
        results: [],
        errors: [],
        warnings: [],
        infos: [],
        passed: [],
        summary: { total: 4, errors: 0, warnings: 0, infos: 0, passed: 0 },
      },
    });

    const payload = buildPreflightPayload(execution);
    expect(payload.status).toBe("NO-GO");
    expect(payload.requiredChecks.find((c) => c.id === "pdf.structure.qpdf")?.status).toBe("skipped");
  });

  test("required checks are listed per target; a target-tagged failure only marks its own target", () => {
    const failure = {
      checkId: "pdf.print.pdfx-markers",
      severity: "error" as const,
      message: "no PDF/X markers",
      target: "dtrpg",
    };
    const execution = makeExecution({
      targets: ["dtrpg", "itch"],
      report: {
        results: [failure],
        errors: [failure],
        warnings: [],
        infos: [],
        passed: ["pdf.structure.qpdf", "pdf.print.embedded-fonts", "pdf.print.pdfx-metadata"],
        summary: { total: 4, errors: 1, warnings: 0, infos: 0, passed: 3 },
      },
    });

    const rows = buildPreflightPayload(execution).requiredChecks;
    expect(rows.filter((r) => r.target === "dtrpg")).toHaveLength(4);
    expect(
      rows.find((r) => r.target === "dtrpg" && r.id === "pdf.print.pdfx-markers")?.status
    ).toBe("fail");
    // itch never requires PDF/X markers, so the dtrpg-tagged failure must not
    // bleed into its rows — both of its required checks passed.
    const itchRows = rows.filter((r) => r.target === "itch");
    expect(itchRows.map((r) => r.id).sort()).toEqual([
      "pdf.print.embedded-fonts",
      "pdf.structure.qpdf",
    ]);
    expect(itchRows.every((r) => r.status === "pass")).toBe(true);
  });

  test("markdown output includes status, targets, and summary", () => {
    const payload = buildPreflightPayload(makeExecution());
    const markdown = toPreflightMarkdown(payload);
    expect(markdown).toContain("# gutterpress preflight");
    expect(markdown).toContain("Status: **GO**");
    expect(markdown).toContain("- Targets: none");
  });
});
