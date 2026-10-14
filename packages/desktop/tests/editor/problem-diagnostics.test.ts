import { describe, expect, test } from "bun:test";
import { Text } from "@codemirror/state";
import { LIVE_CSS_SOURCES, problemDiagnostics } from "../../src/lib/editor/problem-diagnostics";
import type { ProblemEntry } from "../../src/lib/platform/dtos";

const doc = Text.of(["# Title", "", "A paragraph with a problem.", "last"]);
const FILE = "/book/chapter-01.md";

function entry(over: Partial<ProblemEntry>): ProblemEntry {
  return {
    filePath: FILE,
    line: 3,
    severity: "warning",
    message: "Something is wrong here.",
    source: "source.markdownlint",
    ...over,
  };
}

describe("problemDiagnostics", () => {
  test("marks the whole reported line, with severity, message and the check's label", () => {
    expect(problemDiagnostics(doc, [entry({ column: 5 })], FILE)).toEqual([
      {
        from: doc.line(3).from,
        to: doc.line(3).to,
        severity: "warning",
        message: "Something is wrong here.",
        source: "Markdown style",
      },
    ]);
  });

  test("keeps only the open file's entries that point at a line in the buffer", () => {
    const problems = [
      entry({ filePath: "/book/chapter-02.md" }),
      entry({ line: undefined }),
      entry({ line: 99 }),
      entry({ filePath: undefined }),
      entry({ line: 1, severity: "error" }),
    ];
    const diagnostics = problemDiagnostics(doc, problems, FILE);
    expect(diagnostics.map((d) => [d.from, d.severity])).toEqual([[0, "error"]]);
  });

  test("nothing open, nothing marked", () => {
    expect(problemDiagnostics(doc, [entry({})], null)).toEqual([]);
  });

  test("a CSS file skips what its live linter already reports", () => {
    const problems = [
      entry({ source: "source.stylelint" }),
      entry({ source: "source.css-ownership" }),
    ];
    const diagnostics = problemDiagnostics(doc, problems, FILE, LIVE_CSS_SOURCES);
    expect(diagnostics.map((d) => d.source)).toEqual(["CSS ownership"]);
  });
});
