import { describe, expect, test } from "bun:test";
import { suggestRepositoryName } from "../../src/lib/backup-repo-name";

describe("suggestRepositoryName", () => {
  test("hyphenates a title into a lowercase name", () => {
    expect(suggestRepositoryName("The Field Guide to Moths")).toBe("the-field-guide-to-moths");
  });
  test("drops accents and punctuation", () => {
    expect(suggestRepositoryName("  Café Noir: A Story!  ")).toBe("cafe-noir-a-story");
  });
  test("falls back when nothing usable is left", () => {
    expect(suggestRepositoryName("")).toBe("my-book");
    expect(suggestRepositoryName(undefined)).toBe("my-book");
    expect(suggestRepositoryName("日本語")).toBe("my-book");
  });
  test("stays within GitHub's length limit", () => {
    expect(suggestRepositoryName("a".repeat(150)).length).toBe(100);
  });
});
