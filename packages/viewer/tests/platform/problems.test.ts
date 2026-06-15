import { test, expect } from "bun:test";
import {
  friendlySource,
  groupProblems,
  problemCounts,
} from "../../src/lib/problems";
import type { ProblemEntry } from "../../src/lib/platform/contract";

const make = (over: Partial<ProblemEntry>): ProblemEntry => ({
  severity: "warning",
  message: "msg",
  source: "source.stylelint",
  ...over,
});

test("problemCounts: badge = errors + warnings; infos listed separately", () => {
  const counts = problemCounts([
    make({ severity: "error" }),
    make({ severity: "error" }),
    make({ severity: "warning" }),
    make({ severity: "info" }),
  ]);
  expect(counts).toEqual({ errors: 2, warnings: 1, infos: 1, badge: 3 });
  expect(problemCounts([])).toEqual({ errors: 0, warnings: 0, infos: 0, badge: 0 });
});

test("friendlySource maps known check ids to plain language, passes unknown through", () => {
  expect(friendlySource("source.links.local-refs")).toBe("Broken link");
  expect(friendlySource("source.stylelint")).toBe("Print-safety (CSS)");
  expect(friendlySource("source.accessibility.alt-text")).toBe("Image description");
  expect(friendlySource("some.future.check")).toBe("some.future.check");
});

test("groupProblems groups by file, sorts groups by name and entries by line", () => {
  const groups = groupProblems([
    make({ file: "b.md", filePath: "/p/b.md", line: 9 }),
    make({ file: "a.md", filePath: "/p/a.md", line: 12 }),
    make({ file: "b.md", filePath: "/p/b.md", line: 2, severity: "error" }),
    make({ message: "project-level finding" }), // no file
  ]);
  expect(groups.map((g) => g.file)).toEqual(["a.md", "b.md", "Project"]);
  const b = groups[1]!;
  expect(b.entries.map((e) => e.line)).toEqual([2, 9]);
  // Project-level group renders last and keeps its entries.
  expect(groups[2]!.entries[0]!.message).toBe("project-level finding");
  expect(groups[2]!.filePath).toBeUndefined();
});

test("groupProblems: same line sorts errors before warnings before infos", () => {
  const groups = groupProblems([
    make({ file: "a.md", line: 3, severity: "info" }),
    make({ file: "a.md", line: 3, severity: "error" }),
    make({ file: "a.md", line: 3, severity: "warning" }),
  ]);
  expect(groups[0]!.entries.map((e) => e.severity)).toEqual([
    "error",
    "warning",
    "info",
  ]);
});
