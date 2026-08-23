import { describe, test, expect } from "bun:test";
import { buildTocTree, ancestorKeysForActive, tocPageLabel } from "../../src/lib/routes/toc-tree";
import type { OutlineEntry } from "../../src/lib/preview-client";

/** Minimal OutlineEntry factory — only `level` and `index` drive the tree. */
function h(level: number, index: number): OutlineEntry {
  return {
    level,
    text: `h${level}#${index}`,
    id: null,
    sourceLine: null,
    chapter: null,
    page: index + 1,
    index,
  };
}

/** Shape a TocNode tree down to [key, [children…]] for compact assertions. */
function shape(nodes: ReturnType<typeof buildTocTree>): unknown {
  return nodes.map((n) => [n.key, shape(n.children)]);
}

describe("buildTocTree — derive nesting from heading levels", () => {
  test("a flat list of same-level headings are all roots", () => {
    const tree = buildTocTree([h(1, 0), h(1, 1), h(1, 2)]);
    expect(shape(tree)).toEqual([
      ["0", []],
      ["1", []],
      ["2", []],
    ]);
  });

  test("h1 > h2 > h3 nests into a chain", () => {
    const tree = buildTocTree([h(1, 0), h(2, 1), h(3, 2)]);
    expect(shape(tree)).toEqual([["0", [["1", [["2", []]]]]]]);
  });

  test("siblings and re-ascending levels attach to the right parent", () => {
    // h1#0 { h2#1 { h3#2 }, h2#3 }, h1#4 { h2#5 }
    const tree = buildTocTree([h(1, 0), h(2, 1), h(3, 2), h(2, 3), h(1, 4), h(2, 5)]);
    expect(shape(tree)).toEqual([
      ["0", [["1", [["2", []]]], ["3", []]]],
      ["4", [["5", []]]],
    ]);
  });

  test("a level jump (h1 -> h3, no h2) nests under the nearest smaller level", () => {
    const tree = buildTocTree([h(1, 0), h(3, 1)]);
    expect(shape(tree)).toEqual([["0", [["1", []]]]]);
  });

  test("a leading deep heading with no smaller ancestor is a root", () => {
    const tree = buildTocTree([h(3, 0), h(4, 1)]);
    expect(shape(tree)).toEqual([["0", [["1", []]]]]);
  });

  test("keys are the stable outline index, not array position", () => {
    const tree = buildTocTree([h(1, 7), h(2, 12)]);
    expect(tree[0].key).toBe("7");
    expect(tree[0].children[0].key).toBe("12");
  });

  test("empty outline yields no roots", () => {
    expect(buildTocTree([])).toEqual([]);
  });
});

describe("ancestorKeysForActive — reveal the branch containing the cursor", () => {
  const outline = [h(1, 0), h(2, 1), h(3, 2), h(2, 3), h(1, 4), h(2, 5)];

  test("a deep active item returns its ancestors nearest-first", () => {
    expect(ancestorKeysForActive(outline, 2)).toEqual(["1", "0"]);
  });

  test("a second-chapter item returns only its own chapter ancestor", () => {
    expect(ancestorKeysForActive(outline, 5)).toEqual(["4"]);
  });

  test("a top-level active item has no ancestors", () => {
    expect(ancestorKeysForActive(outline, 0)).toEqual([]);
    expect(ancestorKeysForActive(outline, 4)).toEqual([]);
  });

  test("a level jump still collects the real ancestor", () => {
    expect(ancestorKeysForActive([h(1, 0), h(3, 1)], 1)).toEqual(["0"]);
  });

  test("an out-of-range index is safe", () => {
    expect(ancestorKeysForActive(outline, -1)).toEqual([]);
    expect(ancestorKeysForActive(outline, 99)).toEqual([]);
  });
});

describe("tocPageLabel — an unmeasured page is never a silent blank", () => {
  test("a measured page renders as its number", () => {
    expect(tocPageLabel(1)).toBe("1");
    expect(tocPageLabel(197)).toBe("197");
  });

  test("0 — the preview bridge's 'pageOf() found no fragmentainer' answer — renders an em dash", () => {
    // Regression: `{entry.page || ""}` printed nothing here, so a heading whose
    // page could not be measured was indistinguishable from a row with no page
    // column at all (observed on a real book: one chapter heading blank while
    // every sibling carried a number).
    expect(tocPageLabel(0)).toBe("—");
  });

  test("a missing or nonsense page is honest too, never a blank", () => {
    expect(tocPageLabel(undefined)).toBe("—");
    expect(tocPageLabel(null)).toBe("—");
    expect(tocPageLabel(Number.NaN)).toBe("—");
    expect(tocPageLabel(-1)).toBe("—");
  });
});
