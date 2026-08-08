import { describe, expect, test } from "bun:test";
import {
  counterStyleName,
  generatedContentCss,
  cssQuote,
  isRectoVersoBreak,
  MARGIN_BOX_BG_PROP,
  marginBandBoxes,
  marginVarDecls,
  pageCounterValues,
  parseWhich,
  planRectoBlanks,
  restartedPageValues,
  stringSymbols,
  stringValueAt,
  toFolioPage,
  wantsRecto,
} from "./synthesis.ts";
import { formatCounter } from "./content-value.ts";

describe("planRectoBlanks", () => {
  test("no sites, no blanks", () => {
    expect(planRectoBlanks([])).toEqual([]);
  });

  test("chapter already on a recto needs nothing", () => {
    expect(planRectoBlanks([{ page: 3, wantsRecto: true }])).toEqual([false]);
  });

  test("chapter on a verso gets a blank", () => {
    expect(planRectoBlanks([{ page: 2, wantsRecto: true }])).toEqual([true]);
  });

  test("each inserted blank shifts every later site by one", () => {
    // ch1 on p2 (verso, wants recto -> blank, now p3), ch2 measured on p4
    // (with the shift it is EFFECTIVELY p5, a recto -> no blank)
    expect(
      planRectoBlanks([
        { page: 2, wantsRecto: true },
        { page: 4, wantsRecto: true },
      ]),
    ).toEqual([true, false]);
  });

  test("cascading shifts: the s10 book", () => {
    // front matter p1; CH2 measured p2 (verso -> blank, lands p3);
    // CH3 measured p4 -> effective p5 (recto) -> no blank. 6 pages total.
    expect(
      planRectoBlanks([
        { page: 2, wantsRecto: true },
        { page: 4, wantsRecto: true },
      ]),
    ).toEqual([true, false]);
    // and the converse phase: CH2 on p3 (fine), CH3 on p4 -> blank
    expect(
      planRectoBlanks([
        { page: 3, wantsRecto: true },
        { page: 4, wantsRecto: true },
      ]),
    ).toEqual([false, true]);
  });

  test("verso starts invert the parity test", () => {
    expect(planRectoBlanks([{ page: 3, wantsRecto: false }])).toEqual([true]);
    expect(planRectoBlanks([{ page: 2, wantsRecto: false }])).toEqual([false]);
  });

  test("unmeasured sites (page 0) are skipped and do not shift", () => {
    expect(
      planRectoBlanks([
        { page: 0, wantsRecto: true },
        { page: 2, wantsRecto: true },
      ]),
    ).toEqual([false, true]);
  });

  test("declaration classification", () => {
    expect(isRectoVersoBreak({ prop: "break-before", value: "right" })).toBe(true);
    expect(isRectoVersoBreak({ prop: "break-before", value: " recto " })).toBe(true);
    expect(isRectoVersoBreak({ prop: "break-before", value: "page" })).toBe(false);
    expect(isRectoVersoBreak({ prop: "break-after", value: "right" })).toBe(false);
    expect(wantsRecto("right")).toBe(true);
    expect(wantsRecto("verso")).toBe(false);
  });
});

describe("pageCounterValues — front-matter -> body folio restart (MIGRATION.md gap #1)", () => {
  test("no restart declared: identity, 1..N", () => {
    expect(pageCounterValues([], 5)).toEqual([1, 2, 3, 4, 5]);
  });

  test("one restart: roman-shaped front matter, arabic body from 1", () => {
    // 4pp front matter, body restarts to 1 on page 5, 6 total pages
    expect(pageCounterValues([{ page: 5, start: 1 }], 6)).toEqual([1, 2, 3, 4, 1, 2]);
    // formatted with the author's own counter-style per segment (a separate
    // concern this function deliberately leaves to the caller)
    const values = pageCounterValues([{ page: 5, start: 1 }], 6);
    expect(values.slice(0, 4).map((v) => formatCounter(v, "lower-roman"))).toEqual([
      "i",
      "ii",
      "iii",
      "iv",
    ]);
    expect(values.slice(4).map((v) => formatCounter(v, "decimal"))).toEqual(["1", "2"]);
  });

  test("multiple restarts: front matter, body, appendix all restart", () => {
    // p1-3 front matter (1,2,3), p4-6 body restarts to 1, p7-8 appendix
    // restarts to 1 again (e.g. a new counter-style for appendix folios)
    expect(
      pageCounterValues(
        [
          { page: 4, start: 1 },
          { page: 7, start: 1 },
        ],
        8,
      ),
    ).toEqual([1, 2, 3, 1, 2, 3, 1, 2]);
  });

  test("restart to a non-1 value (e.g. continuing a prior volume)", () => {
    expect(pageCounterValues([{ page: 3, start: 100 }], 5)).toEqual([1, 2, 100, 101, 102]);
  });

  test("two resets on the same page: last one (document order) wins", () => {
    expect(
      pageCounterValues(
        [
          { page: 3, start: 1 },
          { page: 3, start: 50 },
        ],
        4,
      ),
    ).toEqual([1, 2, 50, 51]);
  });

  test("page <= 0 is ignored (unmatched/unmeasured element)", () => {
    expect(pageCounterValues([{ page: 0, start: 1 }], 3)).toEqual([1, 2, 3]);
  });

  test("interaction with recto/verso blank insertion: the reset page must be the POST-blank page", () => {
    // A chapter opener wants recto and also restarts the counter. Measured
    // clean (no blanks) it lands on page 4 (even -> verso); planRectoBlanks
    // says insert a blank so it moves to page 5. pageCounterValues must be
    // fed the FINAL (post-blank) page, or the restart lands one page early
    // and the blank page itself gets the wrong (post-restart) number.
    const clean = { page: 4, wantsRecto: true };
    const plan = planRectoBlanks([clean]);
    expect(plan).toEqual([true]); // blank needed: 4 is even (verso)

    // pre-blank (WRONG): restart appears to land on page 4 — the blank page
    // (now page 4) would incorrectly read "1", and the chapter's own first
    // page (page 5) would read "2".
    const wrong = pageCounterValues([{ page: clean.page, start: 1 }], 6);
    expect(wrong).toEqual([1, 2, 3, 1, 2, 3]);

    // post-blank (CORRECT): the blank is inserted at page 4, shifting the
    // chapter (and its restart) to page 5 — page 4 keeps front-matter
    // numbering, page 5 is where "1" belongs.
    const shifted = clean.page + (plan[0] ? 1 : 0);
    const correct = pageCounterValues([{ page: shifted, start: 1 }], 6);
    expect(correct).toEqual([1, 2, 3, 4, 1, 2]);
  });
});

describe("restartedPageValues — resetSites + measured pageMap -> pageCounterValues (F1/F3)", () => {
  test("no reset sites: null (caller falls back to the raw physical page)", () => {
    expect(restartedPageValues([], { a: 1 }, 5)).toBeNull();
  });

  test("resolves resetSites against the measured id->page map", () => {
    // front matter 4pp, restart element measured on physical page 5:
    // pages 1-4 keep their physical numbers, then the restart counts 1, 2.
    // Hand-computed — NOT asserted against pageCounterValues (which this
    // function calls through), so a bug in either function fails here.
    const result = restartedPageValues([{ id: "ch1", start: 1 }], { ch1: 5 }, 6);
    expect(result).toEqual([1, 2, 3, 4, 1, 2]);
  });

  test("an id absent from the map (unmeasured) is dropped, like pageCounterValues' page<=0", () => {
    expect(restartedPageValues([{ id: "missing", start: 1 }], {}, 4)).toBeNull();
  });
});

describe("toFolioPage — physical page -> the folio it actually prints (F3)", () => {
  test("no restart in play: identity", () => {
    expect(toFolioPage(7, null)).toBe(7);
  });

  test("restarted: looks up the physical page's restarted value", () => {
    const values = pageCounterValues([{ page: 5, start: 1 }], 6); // [1,2,3,4,1,2]
    expect(toFolioPage(1, values)).toBe(1);
    expect(toFolioPage(4, values)).toBe(4);
    expect(toFolioPage(5, values)).toBe(1); // the restart itself
    expect(toFolioPage(6, values)).toBe(2);
  });

  test("a target-counter() reference and the target page's own folio must agree", () => {
    // this is the F3 contract: whatever pageValues[physical-1] the target
    // page's own margin box prints, target-counter() pointing AT that page
    // must resolve to the exact same value.
    const pageCount = 6;
    const values = pageCounterValues([{ page: 5, start: 1 }], pageCount);
    for (let physical = 1; physical <= pageCount; physical++) {
      expect(toFolioPage(physical, values)).toBe(values[physical - 1]!);
    }
  });

  test("out-of-range physical page falls back to the raw number", () => {
    const values = pageCounterValues([{ page: 2, start: 1 }], 3);
    expect(toFolioPage(99, values)).toBe(99);
  });
});

describe("stringValueAt — GCPM string() position semantics", () => {
  // chapter titles: ch1 set on p2, ch2 set on p5, two h2s set on p5 too
  const entries = [
    { page: 2, value: "One" },
    { page: 5, value: "Two" },
    { page: 5, value: "Two-B" },
  ];

  test("first: first assignment on the page, else carry", () => {
    expect(stringValueAt(entries, 1, "first")).toBe("");
    expect(stringValueAt(entries, 2, "first")).toBe("One");
    expect(stringValueAt(entries, 3, "first")).toBe("One");
    expect(stringValueAt(entries, 5, "first")).toBe("Two");
    expect(stringValueAt(entries, 6, "first")).toBe("Two-B");
  });

  test("start: value in effect at the top of the page", () => {
    expect(stringValueAt(entries, 2, "start")).toBe("");
    expect(stringValueAt(entries, 3, "start")).toBe("One");
    expect(stringValueAt(entries, 5, "start")).toBe("One");
    expect(stringValueAt(entries, 6, "start")).toBe("Two-B");
  });

  test("last: last assignment on the page, else carry", () => {
    expect(stringValueAt(entries, 5, "last")).toBe("Two-B");
    expect(stringValueAt(entries, 2, "last")).toBe("One");
    expect(stringValueAt(entries, 4, "last")).toBe("One");
  });

  test("first-except: empty on assignment pages (the opener idiom)", () => {
    expect(stringValueAt(entries, 2, "first-except")).toBe("");
    expect(stringValueAt(entries, 3, "first-except")).toBe("One");
    expect(stringValueAt(entries, 5, "first-except")).toBe("");
    expect(stringValueAt(entries, 6, "first-except")).toBe("Two-B");
  });

  test("symbols sample every page", () => {
    expect(stringSymbols(entries, 6, "first")).toEqual([
      "", "One", "One", "One", "Two", "Two-B",
    ]);
    expect(stringSymbols(entries, 6, "first-except")).toEqual([
      "", "", "One", "One", "", "Two-B",
    ]);
  });

  test("which parsing defaults to first", () => {
    expect(parseWhich(undefined)).toBe("first");
    expect(parseWhich(" last ")).toBe("last");
    expect(parseWhich("bogus")).toBe("first");
  });
});

describe("css emission helpers", () => {
  test("cssQuote escapes quotes and backslashes", () => {
    expect(cssQuote(`a "b" \\ c`)).toBe(`"a \\"b\\" \\\\ c"`);
  });

  test("counter-style names are stable and collision-free", () => {
    expect(counterStyleName("chapter-title", "first")).toBe("folio-chapter-title");
    expect(counterStyleName("chapter-title", "last")).toBe("folio-chapter-title--last");
  });
});

describe("generatedContentCss — out-specifying the author (Chrome 151 regression)", () => {
  test("reuses the author's selector so the override always wins", () => {
    const css = generatedContentCss(["a.xref::after"]);
    expect(css).toContain("a.xref[data-folio-after]::after { content: attr(data-folio-after); }");
  });

  test("handles selector lists, :before, and single-colon pseudos", () => {
    const css = generatedContentCss(["a.x::after, a.y::after", "p.note:before"]);
    expect(css).toContain("a.x[data-folio-after]::after");
    expect(css).toContain("a.y[data-folio-after]::after");
    expect(css).toContain("p.note[data-folio-before]:before");
  });

  test("always keeps the bare fallback rules", () => {
    const css = generatedContentCss([]);
    expect(css).toContain("[data-folio-after]::after { content: attr(data-folio-after); }");
    expect(css).toContain("[data-folio-before]::before { content: attr(data-folio-before); }");
  });

  test("ignores selectors with no ::after/::before to target", () => {
    expect(generatedContentCss(["div.plain"]).split("\n")).toHaveLength(2);
  });
});

describe("marginVarDecls (#10)", () => {
  test("emits --gp-margin-* in pt, one per side", () => {
    expect(marginVarDecls({ top: 36, right: 54, bottom: 36, left: 54 })).toEqual({
      "--gp-margin-top": "36pt",
      "--gp-margin-right": "54pt",
      "--gp-margin-bottom": "36pt",
      "--gp-margin-left": "54pt",
    });
  });
});

describe("marginBandBoxes (#8) — opt-in margin-band background synthesis", () => {
  test("no --gp-margin-box-background declared -> no synthesis", () => {
    expect(marginBandBoxes({}, [])).toEqual([]);
  });

  test("declared -> every margin box the author did not declare themselves", () => {
    const boxes = marginBandBoxes({ [MARGIN_BOX_BG_PROP]: "url(texture.png)" }, []);
    expect(boxes).toHaveLength(16);
    expect(boxes).toContain("@top-center");
    expect(boxes).toContain("@bottom-right-corner");
  });

  test("skips boxes the author already declared, whatever they put in them", () => {
    const boxes = marginBandBoxes(
      { [MARGIN_BOX_BG_PROP]: "red" },
      ["@top-center", "@bottom-left"],
    );
    expect(boxes).not.toContain("@top-center");
    expect(boxes).not.toContain("@bottom-left");
    expect(boxes).toHaveLength(14);
  });
});
