import { describe, expect, test } from "bun:test";
import { applyEdit } from "../../src/core/apply-edit.ts";
import type { DocumentSnapshot } from "../../src/core/contracts.ts";

/**
 * D1: "Source offsets are JavaScript/VS Code UTF-16 code-unit offsets."
 * apply-edit.ts implements this by construction — the splice IS
 * `text.slice(0, from) + insert + text.slice(to)` — so this corpus proves
 * that behavior directly against `String.prototype.slice` as the oracle,
 * across content whose code-unit length differs from its "visual"
 * character count: emoji (surrogate pairs), a combining-mark sequence, and
 * a multi-codepoint ZWJ family emoji.
 */

const GRINNING_FACE = "\u{1F600}"; // 😀 — one surrogate pair, 2 UTF-16 code units.
const E_ACUTE_COMBINING = "é"; // "é" as base + combining acute — 2 code units, 1 grapheme.
// A ZWJ family emoji: man + ZWJ + woman + ZWJ + girl — several surrogate
// pairs joined by U+200D, several code units, one rendered grapheme.
const FAMILY_ZWJ = "\u{1F468}‍\u{1F469}‍\u{1F467}";

function snap(text: string, version: number): DocumentSnapshot {
  return { text, version };
}

function assertSpliceMatchesSlice(text: string, from: number, to: number, insert: string) {
  const before = snap(text, 0);
  const result = applyEdit(before, { from, to, insert, expectedVersion: 0 });
  const expected = text.slice(0, from) + insert + text.slice(to);
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("unreachable");
  expect(result.snapshot.text).toBe(expected);
}

describe("applyEdit — UTF-16 corpus", () => {
  test("insert emoji before a surrogate pair boundary", () => {
    const text = `hi ${GRINNING_FACE} there`;
    assertSpliceMatchesSlice(text, 3, 3, GRINNING_FACE);
  });

  test("delete an entire surrogate pair by its 2-code-unit range", () => {
    const text = `pre${GRINNING_FACE}post`;
    // "pre" is 3 code units; the emoji occupies code units [3, 5).
    assertSpliceMatchesSlice(text, 3, 5, "");
  });

  test("edit that SPLITS a surrogate pair (offset lands between the high and low surrogate)", () => {
    const text = `x${GRINNING_FACE}y`; // code units: x [0], hi[1], lo[2], y[3]
    // from=1,to=2 removes only the high surrogate, leaving an unpaired low
    // surrogate — D3 does not forbid this; it is exactly what
    // String.prototype.slice would produce at these code-unit offsets.
    assertSpliceMatchesSlice(text, 1, 2, "");
  });

  test("insert directly between the high and low surrogate of a pair", () => {
    const text = `${GRINNING_FACE}`;
    assertSpliceMatchesSlice(text, 1, 1, "|");
  });

  test("replace across an emoji with plain text", () => {
    const text = `a${GRINNING_FACE}b${GRINNING_FACE}c`;
    // Replace from just after the first emoji through the middle "b".
    assertSpliceMatchesSlice(text, 3, 4, "XYZ");
  });

  test("combining-mark sequence: delete only the base character, leaving the combining mark", () => {
    const text = `${E_ACUTE_COMBINING}!`; // "e" + combining acute + "!"
    assertSpliceMatchesSlice(text, 0, 1, "");
  });

  test("combining-mark sequence: insert between base and combining mark", () => {
    const text = E_ACUTE_COMBINING;
    assertSpliceMatchesSlice(text, 1, 1, "X");
  });

  test("ZWJ family emoji: delete the whole sequence by its full code-unit length", () => {
    const text = `[${FAMILY_ZWJ}]`;
    assertSpliceMatchesSlice(text, 1, 1 + FAMILY_ZWJ.length, "");
  });

  test("ZWJ family emoji: edit that lands inside one of its surrogate pairs", () => {
    const text = FAMILY_ZWJ;
    // Cut into the middle of the sequence at an arbitrary interior offset
    // that does not align with a surrogate-pair or ZWJ boundary.
    assertSpliceMatchesSlice(text, 2, 5, "+");
  });

  test("mixed corpus string: several edits in sequence stay consistent with slice", () => {
    let text = `héllo ${GRINNING_FACE} ${FAMILY_ZWJ} world`;
    let version = 0;
    const before = snap(text, version);
    const r1 = applyEdit(before, { from: 0, to: 1, insert: "H", expectedVersion: version });
    expect(r1.ok).toBe(true);
    if (!r1.ok) throw new Error("unreachable");
    expect(r1.snapshot.text).toBe(text.slice(0, 0) + "H" + text.slice(1));
    text = r1.snapshot.text;
    version = r1.snapshot.version;

    const r2 = applyEdit(
      { text, version },
      { from: text.length, to: text.length, insert: "!", expectedVersion: version },
    );
    expect(r2.ok).toBe(true);
    if (!r2.ok) throw new Error("unreachable");
    expect(r2.snapshot.text).toBe(text + "!");
  });
});
