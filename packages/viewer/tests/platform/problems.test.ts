import { test, expect } from "bun:test";
import {
  closesPanelOnEscape,
  closesPanelOnSelect,
  friendlySource,
  groupProblems,
  MISSING_ASSETS_SOURCE,
  problemCounts,
  splitProblemMessage,
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

// M30: the missing-shared-asset-folder finding is a synthetic viewer source,
// not a CLI check — it still needs a friendly label like every other source.
test("friendlySource maps the missing-shared-assets synthetic source to 'Missing assets'", () => {
  expect(friendlySource(MISSING_ASSETS_SOURCE)).toBe("Missing assets");
});

// M32: markdownlint's writer-first message format is "<description> (<code>)"
// — split it so the panel can demote the code to secondary text.
test("splitProblemMessage splits a trailing rule-code suffix from the description", () => {
  expect(
    splitProblemMessage("Line length limit exceeded (MD013/line-length)"),
  ).toEqual({ text: "Line length limit exceeded", code: "MD013/line-length" });
});

test("splitProblemMessage passes plain messages through with code: null", () => {
  expect(splitProblemMessage("Image is missing alt text")).toEqual({
    text: "Image is missing alt text",
    code: null,
  });
  // Leading-jargon messages (checks not yet migrated to the trailing-suffix
  // convention) have no trailing "(...)" and are left untouched, not mangled.
  expect(splitProblemMessage("tagname-lowercase: Tag name must be lowercase")).toEqual({
    text: "tagname-lowercase: Tag name must be lowercase",
    code: null,
  });
});

// L9 regression fix: the compact overlay has no reachable toggle-strip to
// close it (the overlay itself covers the strip), so closing is driven by
// selecting a result or pressing Escape instead. These predicates are the
// shared decision logic — asserted directly so the fix is verified by
// behavior, not just by grepping the component's markup.
test("closesPanelOnSelect: only compact mode closes the panel on selection", () => {
  expect(closesPanelOnSelect(true)).toBe(true);
  expect(closesPanelOnSelect(false)).toBe(false);
});

test("closesPanelOnEscape: only Escape, while compact AND open, closes the panel", () => {
  expect(closesPanelOnEscape(true, true, "Escape")).toBe(true);
  // Not compact — the normal expanded panel isn't a covering overlay, so
  // Escape must not silently collapse it out from under an unrelated keypress.
  expect(closesPanelOnEscape(false, true, "Escape")).toBe(false);
  // Not open — nothing to close.
  expect(closesPanelOnEscape(true, false, "Escape")).toBe(false);
  // Any other key is ignored.
  expect(closesPanelOnEscape(true, true, "Enter")).toBe(false);
});

// M32: SOURCE_LABELS must cover every check the CLI actually registers under
// category "source" — keyed to the live registry (not a hand-copied id list)
// so a new check can't ship without a label silently rendering its raw id.
test("SOURCE_LABELS covers every registered source-category CLI check", async () => {
  const { getChecks } = await import("@dimm-city/print-md");
  const sourceChecks = getChecks({ category: "source" });
  // Guard against a false-pass if the registry ever failed to populate.
  expect(sourceChecks.length).toBeGreaterThan(0);
  for (const check of sourceChecks) {
    expect(friendlySource(check.id)).not.toBe(check.id);
  }
});
