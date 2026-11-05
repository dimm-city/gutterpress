import { describe, expect, test } from "bun:test";
import {
  describeSplit,
  firstCrossingUnit,
  pickPerScope,
  pullBack,
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
