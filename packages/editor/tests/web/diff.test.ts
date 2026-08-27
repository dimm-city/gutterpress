import { describe, expect, test } from "bun:test";
import { computeMinimalEdit } from "../../src/web/diff.ts";

/**
 * Direct, pure-function coverage of `computeMinimalEdit`'s exact
 * `[from, to)` + `insert` output — the "typed input becomes a SourceEdit
 * with correct [from,to)+expectedVersion" behavior-table row. mount.test.ts
 * proves the end-to-end wiring (that this function's result actually
 * reaches `host.applyEdit` and the resulting text/version are correct);
 * THIS file is what proves the range itself is minimal, not merely
 * "correct resulting text" (which a naive "replace the whole string" diff
 * would also produce).
 */
describe("computeMinimalEdit", () => {
  test("a single character inserted in the middle produces a zero-width range at the insertion point", () => {
    const edit = computeMinimalEdit("hello world", "hello brave world", 7);
    expect(edit).toEqual({ from: 6, to: 6, insert: "brave ", expectedVersion: 7 });
  });

  test("a single character appended at the end produces from===to===oldLength", () => {
    const edit = computeMinimalEdit("abc", "abcd", 3);
    expect(edit).toEqual({ from: 3, to: 3, insert: "d", expectedVersion: 3 });
  });

  test("a single character prepended at the start produces from===to===0", () => {
    const edit = computeMinimalEdit("bc", "abc", 0);
    expect(edit).toEqual({ from: 0, to: 0, insert: "a", expectedVersion: 0 });
  });

  test("deleting a character in the middle produces an empty insert over the deleted range", () => {
    const edit = computeMinimalEdit("hello world", "hell world", 2);
    expect(edit).toEqual({ from: 4, to: 5, insert: "", expectedVersion: 2 });
  });

  test("deleting everything produces [0, oldLength) with an empty insert", () => {
    const edit = computeMinimalEdit("abc", "", 1);
    expect(edit).toEqual({ from: 0, to: 3, insert: "", expectedVersion: 1 });
  });

  test("inserting into an empty document produces [0, 0)", () => {
    const edit = computeMinimalEdit("", "abc", 0);
    expect(edit).toEqual({ from: 0, to: 0, insert: "abc", expectedVersion: 0 });
  });

  test("identical strings produce a true zero-length no-op edit", () => {
    const edit = computeMinimalEdit("same", "same", 9);
    expect(edit).toEqual({ from: 4, to: 4, insert: "", expectedVersion: 9 });
  });

  test("replacing the whole string with something disjoint spans the full old range", () => {
    const edit = computeMinimalEdit("abc", "xyz", 0);
    expect(edit).toEqual({ from: 0, to: 3, insert: "xyz", expectedVersion: 0 });
  });

  test("repeated-character growth does not let prefix/suffix scans overlap ('aaa' -> 'aaaa')", () => {
    // A naive unbounded prefix+suffix scan could claim 3 matching prefix
    // chars AND 3 matching suffix chars against a 3-char old string,
    // producing an invalid from>to or double-counted range. The bounded
    // scan (diff.ts's `maxSuffix = maxCommon - prefix`) must not do that.
    const edit = computeMinimalEdit("aaa", "aaaa", 0);
    expect(edit.from).toBeLessThanOrEqual(edit.to);
    expect(edit.to).toBeLessThanOrEqual(3);
    // Applying the edit must reconstruct newText exactly.
    const reconstructed = "aaa".slice(0, edit.from) + edit.insert + "aaa".slice(edit.to);
    expect(reconstructed).toBe("aaaa");
  });

  test("repeated-character shrink does not let prefix/suffix scans overlap ('aaaa' -> 'aaa')", () => {
    const edit = computeMinimalEdit("aaaa", "aaa", 0);
    expect(edit.from).toBeLessThanOrEqual(edit.to);
    expect(edit.to).toBeLessThanOrEqual(4);
    const reconstructed = "aaaa".slice(0, edit.from) + edit.insert + "aaaa".slice(edit.to);
    expect(reconstructed).toBe("aaa");
  });

  test("a surrogate-pair emoji inserted after plain text reconstructs exactly at UTF-16 code-unit offsets", () => {
    // "abc" -> "abc" + a surrogate-pair emoji + "def". The emoji is 2 UTF-16
    // code units; the edit must still reconstruct exactly via plain
    // String.prototype.slice (D1: offsets are UTF-16 code-unit offsets, and
    // apply-edit.ts's own contract: surrogate pairs are "neither
    // special-cased nor rejected").
    const oldText = "abcdef";
    const newText = "abc\u{1F600}def";
    const edit = computeMinimalEdit(oldText, newText, 4);
    const reconstructed = oldText.slice(0, edit.from) + edit.insert + oldText.slice(edit.to);
    expect(reconstructed).toBe(newText);
    expect(edit.insert).toBe("\u{1F600}");
  });

  test("expectedVersion is passed through unchanged", () => {
    const edit = computeMinimalEdit("a", "b", 42);
    expect(edit.expectedVersion).toBe(42);
  });
});
