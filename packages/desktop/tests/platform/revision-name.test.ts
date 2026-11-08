import { describe, expect, test } from "bun:test";
import { draftLabels, draftName, revisionsShown } from "../../src/lib/revision-name";

describe("draft names", () => {
  test("only main is the Main draft; others read as typed, master included", () => {
    expect(draftName("main")).toBe("Main draft");
    expect(draftName("master")).toBe("master");
    expect(draftName("Second-edition")).toBe("Second edition");
  });
  test("two drafts that would read the same get their stored names", () => {
    const l = draftLabels(["Second-edition", "Second edition", "main"]);
    expect(l.get("Second-edition")).toBe("Second edition (Second-edition)");
    expect(l.get("Second edition")).toBe("Second edition (Second edition)");
    expect(l.get("main")).toBe("Main draft");
  });
  test("Find a draft matches the displayed name as well as the stored one", () => {
    const rs = [{ name: "main", current: true }, { name: "Second-edition", current: false }];
    expect(revisionsShown(rs, "main draft").map((r) => r.name)).toEqual(["main"]);
    expect(revisionsShown(rs, "second edition").map((r) => r.name)).toEqual(["Second-edition"]);
    expect(revisionsShown(rs, "second-ed").map((r) => r.name)).toEqual(["Second-edition"]);
  });
});
