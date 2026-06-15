import { describe, expect, test } from "bun:test";
import { buildPreflightPayload, toPreflightMarkdown } from "./preflight";
import type { ValidationExecutionResult } from "@dimm-city/print-md-lib";

function makeExecution(overrides: Partial<ValidationExecutionResult> = {}): ValidationExecutionResult {
  return {
    config: {} as any,
    profile: undefined,
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
      profile: "dtrpg",
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

  test("markdown output includes status and summary", () => {
    const payload = buildPreflightPayload(makeExecution());
    const markdown = toPreflightMarkdown(payload);
    expect(markdown).toContain("# print-md preflight");
    expect(markdown).toContain("Status: **GO**");
  });
});
