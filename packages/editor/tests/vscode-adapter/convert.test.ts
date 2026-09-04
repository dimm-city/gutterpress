import { describe, expect, test } from "bun:test";
import { StringEdit, StringReplacement, OffsetRange } from "@dimm-city/vscode-markdown-editor";
import { stringEditToSourceEdit } from "../../src/vscode-adapter/convert.ts";

/**
 * SFE-P1b Lane A — node-side (no browser) unit tests for the pure
 * `StringEdit` -> D3 `SourceEdit` conversion math (convert.ts). These prove
 * the offset/gap-filling arithmetic in isolation; tests/vscode-adapter/
 * browser.cases.btest.ts proves the same conversion is actually what the
 * adapter submits when driven by real `@vscode/markdown-editor` input in a
 * real browser (I-01: "Package declarations alone are insufficient").
 */

describe("stringEditToSourceEdit — single replacement", () => {
  test("a single insertion becomes an equal-offset [from,to) with the inserted text", () => {
    const original = "hello world";
    const edit = StringEdit.insert(5, ",");

    const result = stringEditToSourceEdit(original, edit, 3);

    expect(result).toEqual({ from: 5, to: 5, insert: ",", expectedVersion: 3 });
  });

  test("a single replacement becomes exactly that [from,to) + insert", () => {
    const original = "hello world";
    const edit = StringEdit.replace(new OffsetRange(6, 11), "there");

    const result = stringEditToSourceEdit(original, edit, 0);

    expect(result).toEqual({ from: 6, to: 11, insert: "there", expectedVersion: 0 });
  });

  test("a single deletion becomes an empty insert over the deleted range", () => {
    const original = "hello world";
    const edit = StringEdit.delete(new OffsetRange(5, 11));

    const result = stringEditToSourceEdit(original, edit, 7);

    expect(result).toEqual({ from: 5, to: 11, insert: "", expectedVersion: 7 });
  });

  test("a no-op empty StringEdit collapses to a zero-width no-op SourceEdit", () => {
    const result = stringEditToSourceEdit("anything", StringEdit.empty, 9);

    expect(result).toEqual({ from: 0, to: 0, insert: "", expectedVersion: 9 });
  });
});

describe("stringEditToSourceEdit — multi-replacement collapse (D3 'smallest safe common range')", () => {
  test("two disjoint replacements collapse into one range spanning first.start..last.end, preserving the untouched gap between them", () => {
    // "one two three four" -- replace "one" (0..3) with "1" and "three"
    // (8..13) with "3", leaving " two " (3..8) and " four" (13..18)
    // untouched.
    const original = "one two three four";
    const edit = StringEdit.single(StringReplacement.replace(new OffsetRange(0, 3), "1"));
    const multi = new StringEdit([
      StringReplacement.replace(new OffsetRange(0, 3), "1"),
      StringReplacement.replace(new OffsetRange(8, 13), "3"),
    ]);
    void edit; // (kept only to exercise StringEdit.single's shape above; unused otherwise)

    const result = stringEditToSourceEdit(original, multi, 2);

    // Combined range: [0, 13). Combined insert: "1" + " two " (unchanged
    // gap, original[3..8]) + "3".
    expect(result).toEqual({ from: 0, to: 13, insert: "1 two 3", expectedVersion: 2 });

    // Sanity: applying the combined SourceEdit to `original` must produce
    // exactly what applying the multi-replacement StringEdit produces —
    // the whole point of "smallest safe common range" is that it is
    // observably equivalent, not merely offset-plausible.
    const viaSourceEdit = original.slice(0, result.from) + result.insert + original.slice(result.to);
    expect(viaSourceEdit).toBe(multi.apply(original));
  });

  test("three replacements with unequal gaps collapse correctly and match StringEdit.apply", () => {
    const original = "aaaa bbbb cccc dddd eeee";
    const multi = new StringEdit([
      StringReplacement.replace(new OffsetRange(0, 4), "A"),
      StringReplacement.replace(new OffsetRange(10, 14), "C"),
      StringReplacement.replace(new OffsetRange(20, 24), "E"),
    ]);

    const result = stringEditToSourceEdit(original, multi, 1);

    expect(result.from).toBe(0);
    expect(result.to).toBe(24);
    const viaSourceEdit = original.slice(0, result.from) + result.insert + original.slice(result.to);
    expect(viaSourceEdit).toBe(multi.apply(original));
    expect(viaSourceEdit).toBe("A bbbb C dddd E");
  });

  test("adjacent (touching, non-overlapping) replacements collapse with an empty gap", () => {
    const original = "abcdef";
    const multi = new StringEdit([
      StringReplacement.replace(new OffsetRange(0, 2), "XX"),
      StringReplacement.replace(new OffsetRange(2, 4), "YY"),
    ]);

    const result = stringEditToSourceEdit(original, multi, 0);

    expect(result).toEqual({ from: 0, to: 4, insert: "XXYY", expectedVersion: 0 });
  });

  test("multi-replacement insert-only edits (zero-width ranges) preserve every untouched gap", () => {
    // Two multi-cursor insertions at offsets 0 and 5 in "hello", both
    // zero-width -- the combined range must still copy the untouched
    // "hello"[0..5] through as the gap between them.
    const original = "hello";
    const multi = new StringEdit([
      StringReplacement.insert(0, "["),
      StringReplacement.insert(5, "]"),
    ]);

    const result = stringEditToSourceEdit(original, multi, 4);

    expect(result).toEqual({ from: 0, to: 5, insert: "[hello]", expectedVersion: 4 });
  });
});
