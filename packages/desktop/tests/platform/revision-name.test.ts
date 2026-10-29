import { describe, expect, test } from "bun:test";
import { revisionNameFrom } from "../../src/lib/revision-name";

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
