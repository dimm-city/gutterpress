import { describe, expect, test } from "bun:test";
import { revisionNameFrom, revisionsShown } from "../../src/lib/revision-name";

describe("revisionNameFrom", () => {
  test("spaces become hyphens", () => {
    expect(revisionNameFrom("Second edition")).toBe("Second-edition");
    expect(revisionNameFrom("An editor's pass")).toBe("An-editor's-pass");
  });

  test("surrounding space is trimmed, and a run of spaces is one hyphen", () => {
    expect(revisionNameFrom("  Second   edition \n")).toBe("Second-edition");
  });

  test("a name with nothing in it stays empty", () => {
    expect(revisionNameFrom("   ")).toBe("");
  });
});

describe("revisionsShown", () => {
  const revisions = [
    { name: "Appendix", current: false },
    { name: "Editors-pass", current: false },
    { name: "main", current: true },
    { name: "Second-edition", current: false },
  ];

  test("the open revision comes first, the rest stay in the order given", () => {
    expect(revisionsShown(revisions, "").map((r) => r.name)).toEqual(["main", "Appendix", "Editors-pass", "Second-edition"]);
  });

  test("matches any part of a name, ignoring case and surrounding space", () => {
    expect(revisionsShown(revisions, " EDIT ").map((r) => r.name)).toEqual(["Editors-pass", "Second-edition"]);
    expect(revisionsShown(revisions, "a").map((r) => r.name)).toEqual(["main", "Appendix", "Editors-pass"]);
  });

  test("the open revision is filtered out like any other, and nothing matching is an empty list", () => {
    expect(revisionsShown(revisions, "pass").map((r) => r.name)).toEqual(["Editors-pass"]);
    expect(revisionsShown(revisions, "zzz")).toEqual([]);
  });

  test("the list it was given is left as it was", () => {
    const before = revisions.map((r) => r.name);
    revisionsShown(revisions, "");
    expect(revisions.map((r) => r.name)).toEqual(before);
  });
});
