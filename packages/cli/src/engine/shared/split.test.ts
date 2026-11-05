import { describe, expect, test } from "bun:test";
import {
  chooseWordBreak,
  describeSplit,
  firstCrossingUnit,
  pickPerScope,
  pullBack,
  pullBackWord,
  reserveFrom,
  shortOfReserve,
  sameWords,
  spanPages,
  wordsOf,
} from "./split.ts";

describe("firstCrossingUnit", () => {
  test("is the first unit that reaches a later page than the card start", () => {
    expect(firstCrossingUnit(3, [3, 3, 4, 4])).toBe(2);
  });
  test("is -1 when every unit sits on the start page", () => {
    expect(firstCrossingUnit(3, [3, 3])).toBe(-1);
  });
  test("is 0 when the first unit already crosses", () => {
    expect(firstCrossingUnit(0, [1, 1])).toBe(0);
  });
});

describe("pullBack", () => {
  test("keeps one unit fewer", () => expect(pullBack(4)).toBe(3));
  test("gives up rather than leave an empty head", () => {
    expect(pullBack(1)).toBeNull();
    expect(pullBack(0)).toBeNull();
  });
});

describe("pickPerScope", () => {
  test("takes the first spanning card of each scope, in one pass", () => {
    const cards = [
      { scope: "a", spans: false },
      { scope: "a", spans: true },
      { scope: "a", spans: true },
      { scope: "b", spans: true },
      { scope: "c", spans: false },
    ];
    expect(pickPerScope(cards)).toEqual([1, 3]);
  });
  test("nothing spans, nothing is picked", () => {
    expect(pickPerScope([{ scope: "a", spans: false }])).toEqual([]);
  });
});

describe("words", () => {
  test("whitespace does not count", () => {
    expect(sameWords(wordsOf("a  b\n c"), wordsOf(" a b c "))).toBe(true);
  });
  test("a changed, lost or reordered word does", () => {
    expect(sameWords(wordsOf("a b c"), wordsOf("a b"))).toBe(false);
    expect(sameWords(wordsOf("a b c"), wordsOf("a c b"))).toBe(false);
  });
});

describe("spanPages", () => {
  test("counts pages from the first card's start to the last card's end", () => {
    expect(spanPages([[2, 3], [3, 5]])).toBe(4);
    expect(spanPages([])).toBe(0);
  });
});

describe("describeSplit", () => {
  test("names the breaks, the page growth and the scopes that grew", () => {
    const line = describeSplit([{ n: 0, unit: 2, kind: "block" }], {
      pagesBefore: 10,
      pagesAfter: 11,
      passes: 2,
      kinds: { block: 1 },
      scopes: [
        { scope: "p1", before: 3, after: 4 },
        { scope: "p2", before: 2, after: 2 },
      ],
    });
    expect(line).toContain("1 break(s) (1 block)");
    expect(line).toContain("10pp -> 11pp (+1)");
    expect(line).toContain("p1 3->4");
    expect(line).not.toContain("p2");
  });
});

/** words laid out `perLine` to a line, on pages that hold `linesPerPage` lines */
function laid(total: number, perLine: number, linesPerPage: number) {
  return Array.from({ length: total }, (_, i) => {
    const line = Math.floor(i / perLine) + 1;
    return { line, lastPage: Math.floor((line - 1) / linesPerPage) };
  });
}

describe("chooseWordBreak", () => {
  test("cuts before the first word that is not wholly on the start page", () => {
    // 10 lines of 4 words, 6 lines to a page: the 7th line starts the next page
    expect(chooseWordBreak(laid(40, 4, 6), 0)).toBe(24);
  });
  test("keeps two lines after the cut: a lone last line comes along", () => {
    // 7 lines, the 7th on the next page: cut moves up a line
    expect(chooseWordBreak(laid(28, 4, 6), 0)).toBe(20);
  });
  test("keeps two lines before the cut, else the whole paragraph moves", () => {
    // starts on the last line of its page
    expect(chooseWordBreak(laid(40, 4, 1), 0)).toBeNull();
  });
  test("a paragraph wholly on the start page has no cut", () => {
    expect(chooseWordBreak(laid(8, 4, 6), 0)).toBeNull();
  });
  test("a word that wraps across the boundary moves whole", () => {
    const w = laid(24, 4, 6);
    w[19] = { line: 5, lastPage: 1 }; // the last word of line 5 breaks at a hyphen onto the next page
    expect(chooseWordBreak(w, 0)).toBe(19);
  });
});

describe("pullBackWord", () => {
  test("moves the cut to the start of the head's last line", () => {
    expect(pullBackWord([1, 1, 2, 2, 3, 3, 3])).toBe(4);
  });
  test("leaves two lines or gives up", () => {
    expect(pullBackWord([1, 1, 2, 2])).toBeNull();
    expect(pullBackWord([])).toBeNull();
  });
});

describe("reserve", () => {
  test("reads an absolute CSS length in px", () => {
    expect(reserveFrom("20px")).toBe(20);
    expect(reserveFrom("15pt")).toBeCloseTo(20);
    expect(reserveFrom("0.25in")).toBe(24);
    expect(reserveFrom("10")).toBe(10);
  });
  test("is 0 when absent or not a length", () => {
    expect(reserveFrom(null)).toBe(0);
    expect(reserveFrom("2em")).toBe(0);
    expect(reserveFrom("big")).toBe(0);
  });
  test("a part is short of it when less room is left below the box", () => {
    expect(shortOfReserve(19, 20)).toBe(true);
    expect(shortOfReserve(20, 20)).toBe(false);
    expect(shortOfReserve(0, 0)).toBe(false);
  });
});
