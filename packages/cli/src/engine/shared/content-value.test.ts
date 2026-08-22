import { describe, expect, test } from "bun:test";
import {
  evaluate,
  formatCounter,
  needsMeasurement,
  parseContent,
} from "./content-value.ts";

describe("parseContent", () => {
  test("literals and counters", () => {
    expect(parseContent(`counter(page) " of " counter(pages)`)).toEqual([
      { type: "counter", name: "page", style: "decimal" },
      { type: "literal", value: " of " },
      { type: "counter", name: "pages", style: "decimal" },
    ]);
  });

  test("string() with position keyword", () => {
    expect(parseContent(`string(chapter-title, first)`)).toEqual([
      { type: "string", name: "chapter-title", which: "first" },
    ]);
  });

  test("target-counter with attr(href url)", () => {
    expect(parseContent(`" (p. " target-counter(attr(href url), page) ")"`)).toEqual([
      { type: "literal", value: " (p. " },
      { type: "target-counter", url: "attr(href url)", counter: "page", style: "decimal" },
      { type: "literal", value: ")" },
    ]);
  });

  test("escaped quotes and parens inside literals", () => {
    expect(parseContent(`"a \\"b\\" (c)" counter(page)`)[0]).toEqual({
      type: "literal",
      value: `a "b" (c)`,
    });
  });
});

describe("evaluate", () => {
  const ctx = {
    page: 7,
    pages: 42,
    strings: (n: string) => (n === "chapter-title" ? "The Gutters" : undefined),
    targetPage: (url: string) => (url === "#ch2" ? 19 : undefined),
    targetText: (url: string) => (url === "#ch2" ? "Creature Codex" : undefined),
    attr: (n: string) => (n === "href" ? "#ch2" : undefined),
  };

  test("page numbering", () => {
    expect(evaluate(`counter(page) " / " counter(pages)`, ctx)).toBe("7 / 42");
  });

  test("running string", () => {
    expect(evaluate(`string(chapter-title) " · " counter(page)`, ctx)).toBe(
      "The Gutters · 7",
    );
  });

  test("cross-reference", () => {
    expect(evaluate(`" (p. " target-counter(attr(href url), page) ")"`, ctx)).toBe(
      " (p. 19)",
    );
    expect(evaluate(`target-text(attr(href url))`, ctx)).toBe("Creature Codex");
  });

  test("unresolved target degrades to '?', never throws", () => {
    expect(evaluate(`target-counter("#nope", page)`, ctx)).toBe("?");
  });

  test("missing string is empty, not 'undefined'", () => {
    expect(evaluate(`string(nope)`, ctx)).toBe("");
  });
});

describe("counter styles", () => {
  test("roman/alpha/leading-zero", () => {
    expect(formatCounter(4, "lower-roman")).toBe("iv");
    expect(formatCounter(1987, "upper-roman")).toBe("MCMLXXXVII");
    expect(formatCounter(27, "lower-alpha")).toBe("aa");
    expect(formatCounter(3, "decimal-leading-zero")).toBe("03");
    expect(formatCounter(12, "decimal-leading-zero")).toBe("12");
  });
});

describe("tier routing", () => {
  test("only measurement-dependent constructs demand Tier 3", () => {
    expect(needsMeasurement(`counter(page)`)).toBe(false);
    expect(needsMeasurement(`string(chapter-title)`)).toBe(false);
    expect(needsMeasurement(`target-counter(attr(href url), page)`)).toBe(true);
    expect(needsMeasurement(`leader(".") counter(page)`)).toBe(true);
  });
});
