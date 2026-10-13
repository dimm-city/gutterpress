import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildIssueUrl, ISSUE_URL, LOG_TRIMMED_NOTE, MAX_ISSUE_URL, reportText } from "../../src/lib/issue-report";

const answers = {
  title: "PDF export stops",
  whatHappened: "It froze at 40%.",
  expected: "A PDF.",
  steps: "1. Open\n2. Export",
};
const bundle = { diagnostics: "## System\n- Gutterpress desktop 0.11.18", log: "line 1\nline 2" };

describe("buildIssueUrl", () => {
  test("fills every field of the bug template, log included", () => {
    const { url, logTrimmed } = buildIssueUrl(answers, bundle);
    const u = new URL(url);
    expect(`${u.origin}${u.pathname}`).toBe(ISSUE_URL);
    expect(u.searchParams.get("template")).toBe("bug_report.yml");
    expect(u.searchParams.get("title")).toBe("[Bug]: PDF export stops");
    expect(u.searchParams.get("what-happened")).toBe("It froze at 40%.");
    expect(u.searchParams.get("expected")).toBe("A PDF.");
    expect(u.searchParams.get("steps")).toBe("1. Open\n2. Export");
    expect(u.searchParams.get("diagnostics")).toBe(bundle.diagnostics);
    expect(u.searchParams.get("log")).toBe("line 1\nline 2");
    expect(logTrimmed).toBe(false);
  });

  test("blank answers are left out so the template's own defaults show", () => {
    const u = new URL(buildIssueUrl({ title: " ", whatHappened: "", expected: "", steps: "" }, bundle).url);
    expect(u.searchParams.has("title")).toBe(false);
    expect(u.searchParams.has("expected")).toBe(false);
  });

  test("a long log keeps its newest lines and says so, within the length limit", () => {
    const log = Array.from({ length: 400 }, (_, i) => `2026-10-13 line ${i} ${"x".repeat(40)}`).join("\n");
    const { url, logTrimmed } = buildIssueUrl(answers, { ...bundle, log });
    expect(url.length).toBeLessThanOrEqual(MAX_ISSUE_URL);
    expect(logTrimmed).toBe(true);
    const sent = new URL(url).searchParams.get("log")!;
    expect(sent.startsWith(LOG_TRIMMED_NOTE)).toBe(true);
    expect(sent.endsWith("line 399 " + "x".repeat(40))).toBe(true);
  });
});

test("the template has a field for every key the link sets", () => {
  const yml = readFileSync(new URL("../../../../.github/ISSUE_TEMPLATE/bug_report.yml", import.meta.url), "utf8");
  for (const id of ["what-happened", "expected", "steps", "diagnostics", "log"]) expect(yml).toContain(`id: ${id}\n`);
});

test("reportText puts the answers before the report", () => {
  const text = reportText({ ...answers, expected: "" }, "## System");
  expect(text).toStartWith("## Summary\nPDF export stops\n");
  expect(text).not.toContain("What did you expect?");
  expect(text.endsWith("## System")).toBe(true);
});
