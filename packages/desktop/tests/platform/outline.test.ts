import { test, expect } from "bun:test";
// RED: this module does not exist yet — extraction pending.
import { activeOutlineIndexForLine } from "../../src/lib/routes/outline";
import type { OutlineEntry } from "../../src/lib/preview-client";

// activeOutlineIndexForLine is the pure port of +page.svelte's
// updateActiveOutline loop: find the deepest heading whose sourceLine is
// non-null and <= line, breaking at the first sourceLine > line. Entries with
// a null sourceLine are skipped (they neither advance the index nor break).
// The caller keeps the `if (outline.length === 0) return;` guard, so the
// helper is only ever invoked for non-empty outlines. Pure function — no node
// imports (§8), no ambient state.

let seq = 0;
function entry(sourceLine: number | null): OutlineEntry {
  const i = seq++;
  return {
    level: 1,
    text: `h${i}`,
    id: `id${i}`,
    sourceLine,
    chapter: null,
    page: 1,
    index: i,
  };
}

// The exact loop the helper must reproduce, used as an oracle.
function reference(outline: OutlineEntry[], line: number): number {
  let idx = 0;
  for (let i = 0; i < outline.length; i++) {
    const sl = outline[i].sourceLine;
    if (sl != null && sl <= line) idx = i;
    else if (sl != null && sl > line) break;
  }
  return idx;
}

test("line before the first heading -> 0", () => {
  const outline = [entry(5), entry(10), entry(15)];
  expect(activeOutlineIndexForLine(outline, 1)).toBe(0);
});

test("line exactly on a heading sourceLine -> that index", () => {
  const outline = [entry(5), entry(10), entry(15)];
  expect(activeOutlineIndexForLine(outline, 10)).toBe(1);
});

test("line between two headings -> the lower one", () => {
  const outline = [entry(5), entry(10), entry(15)];
  expect(activeOutlineIndexForLine(outline, 12)).toBe(1);
});

test("line past the last heading -> last index", () => {
  const outline = [entry(5), entry(10), entry(15)];
  expect(activeOutlineIndexForLine(outline, 100)).toBe(2);
});

test("null sourceLine entries are skipped (don't advance idx, don't break)", () => {
  // index 1 has a null sourceLine and sits before a later matching heading;
  // it must not stop the scan nor become the active index.
  const outline = [entry(5), entry(null), entry(10)];
  expect(activeOutlineIndexForLine(outline, 100)).toBe(2);
});

test("null-then-value sequence resolves to the value heading, then breaks", () => {
  const outline = [entry(null), entry(5), entry(10)];
  expect(activeOutlineIndexForLine(outline, 7)).toBe(1);
});

test("matches the current loop for a representative fixture across many lines", () => {
  const outline = [
    entry(2),
    entry(null),
    entry(6),
    entry(6),
    entry(11),
    entry(null),
    entry(20),
  ];
  for (let line = 0; line <= 25; line++) {
    expect(activeOutlineIndexForLine(outline, line)).toBe(reference(outline, line));
  }
});
