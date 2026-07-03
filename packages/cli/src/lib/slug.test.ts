import { describe, test, expect } from "bun:test";
import { slugify } from "./slug";

describe("slugify", () => {
  test("lowercases and collapses non-alphanumerics to single hyphens", () => {
    expect(slugify("My First Book")).toBe("my-first-book");
    expect(slugify("Hello   World!!")).toBe("hello-world");
    expect(slugify("a/b\\c")).toBe("a-b-c");
  });

  test("strips diacritics via NFKD normalisation", () => {
    expect(slugify("Café Déjà")).toBe("cafe-deja");
  });

  test("trims leading and trailing hyphens", () => {
    expect(slugify("  --Hello--  ")).toBe("hello");
    expect(slugify("!!!wrapped!!!")).toBe("wrapped");
  });

  test("returns '' by default when the input has no usable characters", () => {
    expect(slugify("")).toBe("");
    expect(slugify("!!!")).toBe("");
    expect(slugify("   ")).toBe("");
  });

  test("returns the supplied fallback for otherwise-empty input", () => {
    expect(slugify("!!!", "theme")).toBe("theme");
    expect(slugify("", "theme")).toBe("theme");
  });

  test("the fallback is only used when the slug would be empty", () => {
    expect(slugify("Real Name", "theme")).toBe("real-name");
  });
});
