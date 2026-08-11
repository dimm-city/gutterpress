import { describe, expect, test } from "bun:test";
import {
  extract,
  parseDeclarations,
  parseMargin,
  parseSize,
  resolvePage,
  splitTopLevel,
  toPt,
} from "./gcpm-extract.ts";

const BOOK_CSS = `
/* the exact stylesheet from §6 of the proposal */
@page {
  size: 6in 9in;
  bleed: 0.125in;
  marks: crop;
  margin: 0.75in 0.5in 0.75in 0.625in;
  @bottom-center { content: counter(page); font-size: 9pt; }
}

@page :left  { margin: 0.75in 0.375in 0.75in 0.625in; }
@page :right { margin: 0.75in 0.625in 0.75in 0.375in; }

h1 {
  break-before: page;
  page: chapter;
  string-set: chapter-title content();
}

@page chapter {
  @top-right { content: string(chapter-title); font-size: 8pt; }
}

a.xref::after {
  content: " (p. " target-counter(attr(href url), page) ")";
}
`;

describe("gcpm-extract", () => {
  const model = extract(BOOK_CSS);

  test("finds every @page rule incl. named and pseudo variants", () => {
    expect(model.pageRules.map((r) => r.raw)).toEqual([
      "@page",
      "@page :left",
      "@page :right",
      "@page chapter",
    ]);
    expect(model.pageRules[1]!.pseudos).toEqual(["left"]);
    expect(model.pageRules[3]!.name).toBe("chapter");
  });

  test("keeps the descriptors CSSOM drops", () => {
    expect(model.pageRules[0]!.decls.bleed).toBe("0.125in");
    expect(model.pageRules[0]!.decls.marks).toBe("crop");
  });

  test("captures margin boxes with their declarations", () => {
    expect(model.pageRules[0]!.marginBoxes["@bottom-center"]).toEqual({
      content: "counter(page)",
      "font-size": "9pt",
    });
    expect(model.pageRules[3]!.marginBoxes["@top-right"]!.content).toBe(
      "string(chapter-title)",
    );
  });

  test("captures string-set, page assignment, breaks and xrefs", () => {
    expect(model.stringSets).toEqual([
      { selector: "h1", name: "chapter-title", value: "content()" },
    ]);
    expect(model.pageAssignments).toEqual([{ selector: "h1", page: "chapter" }]);
    expect(model.breaks).toEqual([
      { selector: "h1", prop: "break-before", value: "page" },
    ]);
    expect(model.xrefs[0]).toMatchObject({
      selector: "a.xref::after",
      fn: "target-counter",
    });
    expect(model.pageNames).toEqual(["chapter"]);
  });

  test("multiple string-set entries on one declaration", () => {
    const m = extract(`h2 { string-set: sect content(text), short attr(data-short); }`);
    expect(m.stringSets).toEqual([
      { selector: "h2", name: "sect", value: "content(text)" },
      { selector: "h2", name: "short", value: "attr(data-short)" },
    ]);
  });

  test("string() inside content is detected as a GCPM construct", () => {
    const m = extract(`@page x { @top-left { content: string(t) " — " counter(page); } }`);
    expect(m.pageRules[0]!.marginBoxes["@top-left"]!.content).toContain("string(t)");
  });

  test("descends into @media/@supports/@layer", () => {
    const m = extract(`@media print { @page { size: A4; } h1 { string-set: t content(); } }`);
    expect(m.pageRules).toHaveLength(1);
    expect(m.stringSets).toHaveLength(1);
  });

  test("ignores comments, strings with braces, and unrelated at-rules", () => {
    const m = extract(`
      /* @page { size: 1in 1in } */
      @font-face { font-family: X; src: url("a{b}.woff2"); }
      p::before { content: "} @page {"; }
      @page { size: 5in 8in; }
    `);
    expect(m.pageRules).toHaveLength(1);
    expect(m.pageRules[0]!.decls.size).toBe("5in 8in");
  });

  test("does not mistake a selector containing 'page' for an @page rule", () => {
    const m = extract(`.page-header { color: red; }`);
    expect(m.pageRules).toHaveLength(0);
  });
});

describe("geometry", () => {
  test("unit conversion", () => {
    expect(toPt("1in")).toBe(72);
    expect(toPt("0.125in")).toBe(9);
    expect(toPt("12pt")).toBe(12);
    expect(toPt("96px")).toBe(72);
    expect(toPt("25.4mm")).toBeCloseTo(72, 5);
    expect(toPt("banana")).toBeUndefined();
  });

  test("size keywords, one-value and landscape", () => {
    expect(parseSize("6in 9in")).toEqual({ width: 432, height: 648 });
    expect(parseSize("5in")).toEqual({ width: 360, height: 360 });
    expect(parseSize("A4")!.width).toBeCloseTo(595.28, 1);
    const l = parseSize("A4 landscape")!;
    expect(l.width).toBeGreaterThan(l.height);
  });

  test("margin shorthand expansion", () => {
    expect(parseMargin("1in")).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
    expect(parseMargin("1in 2in")).toEqual({ top: 72, right: 144, bottom: 72, left: 144 });
    expect(parseMargin("0.75in 0.5in 0.75in 0.625in")).toEqual({
      top: 54,
      right: 36,
      bottom: 54,
      left: 45,
    });
  });

  test("resolvePage cascades unnamed -> named -> pseudo", () => {
    const model = extract(BOOK_CSS);
    const base = resolvePage(model);
    expect(base.geometry.width).toBe(432);
    expect(base.geometry.bleed).toBe(9);
    expect(base.geometry.marks).toEqual(["crop"]);
    expect(base.geometry.margin.left).toBe(45);

    const left = resolvePage(model, { pseudos: ["left"] });
    expect(left.geometry.margin.right).toBe(27); // 0.375in
    expect(left.geometry.margin.left).toBe(45); // 0.625in

    const chapter = resolvePage(model, { name: "chapter", pseudos: ["right"] });
    expect(chapter.marginBoxes["@top-right"]!.content).toBe("string(chapter-title)");
    expect(chapter.marginBoxes["@bottom-center"]!.content).toBe("counter(page)");
    // `@page :right { margin: .75in .625in .75in .375in }` -> right 45, left 27
    expect(chapter.geometry.margin.right).toBe(45);
    expect(chapter.geometry.margin.left).toBe(27);
  });

  test("named page does not leak into the default context", () => {
    const model = extract(`@page { size: 6in 9in } @page cover { size: 8in 8in }`);
    expect(resolvePage(model).geometry.width).toBe(432);
    expect(resolvePage(model, { name: "cover" }).geometry.width).toBe(576);
  });
});

describe("scanner primitives", () => {
  test("parseDeclarations handles functions, strings and !important", () => {
    const d = parseDeclarations(
      `content: "a; b" counter(page, decimal); margin : 1in 2in !important ;`,
    );
    expect(d.content).toBe(`"a; b" counter(page, decimal)`);
    expect(d.margin).toBe("1in 2in");
  });

  test("parseDeclarations strips a comment trailing the PREVIOUS declaration, not just its own", () => {
    // Regression: `push()` only skipped comments while scanning for the next
    // `;`, it never stripped them from the chunk it pushed — so `--y` here
    // was captured as the property name `/* note */\n  --y`, silently
    // dropping `--y` from the map. Caught via a real book's `--page-margin`.
    const d = parseDeclarations(`--x: 1in; /* note */\n  --y: 2in;`);
    expect(d).toEqual({ "--x": "1in", "--y": "2in" });
  });

  test("splitTopLevel respects nesting", () => {
    expect(splitTopLevel(`a content(), b target-counter(attr(href url), page)`, ",")).toEqual([
      "a content()",
      "b target-counter(attr(href url), page)",
    ]);
  });
});

describe("margin cascade (regression: full-bleed cover)", () => {
  // `@page cover { margin: 0 }` must beat `@page :right { margin-left: .75in }`:
  // the named rule is stronger, so resolving the merged map afterwards (apply
  // shorthand, then apply longhands) inverts the cascade and insets the cover.
  const css = `
    @page { size: 8.5in 11in; margin: 0.875in 0.875in 1in; }
    @page :left  { margin-left: 1in;    margin-right: 0.75in; }
    @page :right { margin-left: 0.75in; margin-right: 1in; }
    @page cover  { margin: 0; }
  `;
  const model = extract(css);

  test("a named shorthand beats a weaker rule's longhand", () => {
    const cover = resolvePage(model, { name: "cover", pseudos: ["right"] });
    expect(cover.geometry.margin).toEqual({ top: 0, right: 0, bottom: 0, left: 0 });
  });

  test("…and the pseudo-page longhands still apply to unnamed pages", () => {
    const recto = resolvePage(model, { pseudos: ["right"] });
    expect(recto.geometry.margin).toEqual({ top: 63, right: 72, bottom: 72, left: 54 });
  });

  test("a longhand after a shorthand inside the SAME rule still wins", () => {
    const m = extract(`@page { margin: 1in; margin-left: 2in; }`);
    expect(resolvePage(m).geometry.margin).toEqual({
      top: 72, right: 72, bottom: 72, left: 144,
    });
  });
});

describe("var() in @page geometry (§−1a: never fail silently)", () => {
  test("size: var(--x) resolves to the :root value, not the Letter fallback", () => {
    const model = extract(`
      :root { --trim: 6in 9in; }
      @page { size: var(--trim); }
    `);
    expect(resolvePage(model).geometry.width).toBe(432);
    expect(resolvePage(model).geometry.height).toBe(648);
  });

  test("margin: var(--x) resolves from :root and the shrink guard sees the real margin", () => {
    const model = extract(`
      :root { --m: 1in; }
      @page { size: 6in 9in; margin: var(--m); }
    `);
    const { geometry } = resolvePage(model);
    expect(geometry.margin).toEqual({ top: 72, right: 72, bottom: 72, left: 72 });
  });

  test("var(--x, fallback) uses the fallback when --x is undefined", () => {
    const model = extract(`@page { size: 6in 9in; margin: var(--undefined-margin, 0.75in); }`);
    expect(resolvePage(model).geometry.margin).toEqual({
      top: 54, right: 54, bottom: 54, left: 54,
    });
  });

  test("var(--x, fallback) prefers the :root value over the fallback when both exist", () => {
    const model = extract(`
      :root { --binding-margin: 1in; }
      @page { size: 6in 9in; margin: var(--binding-margin, 0.75in); }
    `);
    expect(resolvePage(model).geometry.margin).toEqual({
      top: 72, right: 72, bottom: 72, left: 72,
    });
  });

  test("an unresolvable var() hard-errors with the declaration and a fix hint", () => {
    expect(() =>
      extract(`@page { size: var(--undefined-trim); }`),
    ).toThrow(/--undefined-trim.*not defined at :root/s);
  });

  test("an unresolvable var() in margin also hard-errors (never silently disables the guard)", () => {
    expect(() => extract(`@page { margin: var(--nope); }`)).toThrow(/:root/);
  });

  test("a fallback containing a nested var() is rejected, not resolved", () => {
    expect(() =>
      extract(`@page { margin: var(--a, var(--b, 1in)); }`),
    ).toThrow(/another var\(\)/);
  });

  test("var() in a descriptor this engine doesn't read (e.g. background) is left untouched", () => {
    const model = extract(`@page { background: var(--cover-art); size: 6in 9in; }`);
    expect(model.pageRules[0]!.decls.background).toBe("var(--cover-art)");
  });

  test("a var() defined by a LATER stylesheet still resolves (sheets are concatenated)", () => {
    const model = extract(`@page { size: 6in 9in; margin: var(--m); }\n:root { --m: 0.75in; }`);
    expect(resolvePage(model).geometry.margin.left).toBe(54);
  });

  test("var() resolves in a NAMED page rule with a pseudo (@page chapter:left)", () => {
    const model = extract(`
      :root { --binding: 0.9in; }
      @page { size: 6in 9in; margin: 0.5in; }
      @page chapter:left { margin: var(--binding); }
    `);
    const g = resolvePage(model, { name: "chapter", pseudos: ["left"] }).geometry;
    expect(g.margin).toEqual({ top: 64.8, right: 64.8, bottom: 64.8, left: 64.8 });
  });

  test("only ONE dimension of `size` given as a var still resolves", () => {
    const model = extract(`:root { --w: 6in; }\n@page { size: var(--w) 9in; }`);
    const g = resolvePage(model).geometry;
    expect([g.width, g.height]).toEqual([432, 648]);
  });

  // The resolution half is not enough on its own: these three all RESOLVE and
  // then fall through this file's lenient parsers to Letter / 0pt margins —
  // the silent-wrong-geometry §−1a exists to kill. They must hard-error.
  test("a var() resolving to an empty custom property does not silently become Letter", () => {
    expect(() => extract(`:root { --trim: ; }\n@page { size: var(--trim); }`)).toThrow(
      /resolves to ``, which is empty/,
    );
  });

  test("a var() resolving to a non-size does not silently become Letter", () => {
    expect(() => extract(`:root { --trim: banana; }\n@page { size: var(--trim); }`)).toThrow(
      /not a page size/,
    );
  });

  test("a var() inside calc() in margin does not silently become a 0pt margin", () => {
    expect(() =>
      extract(`:root { --m: 0.5in; }\n@page { size: 6in 9in; margin: calc(var(--m) + 12pt); }`),
    ).toThrow(/cannot read as a length/);
  });

  test("a var() resolving to a non-length margin does not silently become 0pt", () => {
    expect(() =>
      extract(`:root { --m: banana; }\n@page { size: 6in 9in; margin: var(--m); }`),
    ).toThrow(/cannot read as a length/);
  });

  test("`bleed: auto` via var() stays valid (it is not a length, and must not error)", () => {
    const model = extract(`:root { --b: auto; }\n@page { size: 6in 9in; bleed: var(--b); }`);
    expect(resolvePage(model).geometry.bleed).toBe(0);
  });
});
