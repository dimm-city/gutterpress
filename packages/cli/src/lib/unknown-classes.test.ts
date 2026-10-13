import { describe, expect, test } from "bun:test";
import type Token from "markdown-it/lib/token.mjs";
import { addCssClasses, classesInTokens, nearestKnownClass } from "./unknown-classes";

const classesOf = (css: string): string[] => {
  const names = new Set<string>();
  addCssClasses(css, names);
  return [...names].sort();
};

describe("addCssClasses", () => {
  test("reads classes from selector lists, pseudos, :is(), nesting, @scope and escapes", () => {
    expect(
      classesOf(
        ".a, .b:hover > .c::before { x: y } :is(.d, .e) .f { x: y } .g { & .h { x: y } } @scope (.i) to (.j) { .k { x: y } } .sm\\:flex { x: y }"
      )
    ).toEqual(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "sm:flex"]);
  });

  test("ignores attribute selectors, strings, comments and numbers", () => {
    expect(
      classesOf('/* .nope */ a[href$=".pdf"] { content: ".str"; margin: 0.5em } img[alt~=\'.x\'].real { x: y }')
    ).toEqual(["real"]);
  });

  test("unparseable CSS still contributes what a text scan finds", () => {
    expect(classesOf(".ok { color: red")).toContain("ok");
  });
});

describe("classesInTokens", () => {
  const tok = (attrs: Array<[string, string]> | null, extra: Partial<Token> = {}): Token =>
    ({ attrs, children: null, map: null, meta: null, ...extra }) as unknown as Token;

  test("counts classes across tokens and inline children, skipping gp-*, structural and counter classes", () => {
    const uses = classesInTokens([
      tok([["class", "section hilite gp-left chapter-3"]], { meta: { line: 4 } }),
      tok(null, { map: [9, 10], children: [tok([["class", "hilite"]]), tok([["class", "other"]])] as Token[] }),
    ]);
    expect([...uses]).toEqual([
      ["hilite", { line: 4, count: 2 }],
      ["other", { line: 10, count: 1 }],
    ]);
  });
});

describe("nearestKnownClass", () => {
  const known = new Set(["panel", "dc-avoid-split", "fig-left"]);
  test("suggests within one edit for short names and two for longer ones", () => {
    expect(nearestKnownClass("pannel", known)).toBe("panel");
    expect(nearestKnownClass("dc-avoid-splt", known)).toBe("dc-avoid-split");
    expect(nearestKnownClass("fig-lft", known)).toBe("fig-left");
    expect(nearestKnownClass("zebra", known)).toBeNull();
    expect(nearestKnownClass("panel", known)).toBeNull();
  });
});
