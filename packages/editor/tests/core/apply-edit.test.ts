import { describe, expect, test } from "bun:test";
import { applyEdit } from "../../src/core/apply-edit.ts";
import type { DocumentSnapshot } from "../../src/core/contracts.ts";

function snap(text: string, version: number): DocumentSnapshot {
  return { text, version };
}

describe("applyEdit — accepted edit", () => {
  test("splices [from, to) and increments version by exactly 1", () => {
    const before = snap("hello world", 0);
    const result = applyEdit(before, { from: 6, to: 11, insert: "there", expectedVersion: 0 });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("unreachable");
    expect(result.snapshot.text).toBe("hello there");
    expect(result.snapshot.version).toBe(1);
  });

  test("pure insert at from === to (no deletion)", () => {
    const before = snap("ac", 5);
    const result = applyEdit(before, { from: 1, to: 1, insert: "b", expectedVersion: 5 });
    expect(result).toEqual({ ok: true, snapshot: { text: "abc", version: 6 } });
  });

  test("pure deletion with empty insert", () => {
    const before = snap("abc", 0);
    const result = applyEdit(before, { from: 1, to: 2, insert: "", expectedVersion: 0 });
    expect(result).toEqual({ ok: true, snapshot: { text: "ac", version: 1 } });
  });

  test("edit spanning the whole document", () => {
    const before = snap("old", 2);
    const result = applyEdit(before, { from: 0, to: 3, insert: "new", expectedVersion: 2 });
    expect(result).toEqual({ ok: true, snapshot: { text: "new", version: 3 } });
  });

  test("from === to === text.length appends at the end", () => {
    const before = snap("abc", 0);
    const result = applyEdit(before, { from: 3, to: 3, insert: "d", expectedVersion: 0 });
    expect(result).toEqual({ ok: true, snapshot: { text: "abcd", version: 1 } });
  });

  test("original snapshot object is not mutated by an accepted edit", () => {
    const before = snap("abc", 0);
    const result = applyEdit(before, { from: 0, to: 1, insert: "X", expectedVersion: 0 });
    expect(before).toEqual({ text: "abc", version: 0 });
    expect(result.ok).toBe(true);
  });
});

describe("applyEdit — stale edit", () => {
  test("expectedVersion mismatch rejects with reason 'stale' and the CURRENT snapshot unchanged", () => {
    const before = snap("hello", 3);
    const result = applyEdit(before, { from: 0, to: 5, insert: "bye", expectedVersion: 2 });
    expect(result).toEqual({ ok: false, reason: "stale", snapshot: before });
  });

  test("stale edit changes zero bytes", () => {
    const before = snap("unchanged", 10);
    applyEdit(before, { from: 0, to: 9, insert: "gone", expectedVersion: 9 });
    expect(before.text).toBe("unchanged");
    expect(before.version).toBe(10);
  });

  test("expectedVersion ahead of current version is also stale, not accepted", () => {
    const before = snap("x", 1);
    const result = applyEdit(before, { from: 0, to: 1, insert: "y", expectedVersion: 2 });
    expect(result).toEqual({ ok: false, reason: "stale", snapshot: before });
  });
});

describe("applyEdit — invalid range", () => {
  const before = snap("abcdef", 0); // length 6

  test("from > to", () => {
    const result = applyEdit(before, { from: 3, to: 1, insert: "x", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("to > text.length", () => {
    const result = applyEdit(before, { from: 0, to: 7, insert: "x", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("negative from", () => {
    const result = applyEdit(before, { from: -1, to: 2, insert: "x", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("negative to", () => {
    const result = applyEdit(before, { from: 0, to: -2, insert: "x", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("NaN from", () => {
    const result = applyEdit(before, { from: Number.NaN, to: 2, insert: "x", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("NaN to", () => {
    const result = applyEdit(before, { from: 0, to: Number.NaN, insert: "x", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("non-integer (fractional) from", () => {
    const result = applyEdit(before, { from: 1.5, to: 2, insert: "x", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("non-integer (fractional) to", () => {
    const result = applyEdit(before, { from: 0, to: 2.5, insert: "x", expectedVersion: 0 });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("non-finite (+Infinity) to", () => {
    const result = applyEdit(before, {
      from: 0,
      to: Number.POSITIVE_INFINITY,
      insert: "x",
      expectedVersion: 0,
    });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("non-finite (-Infinity) from", () => {
    const result = applyEdit(before, {
      from: Number.NEGATIVE_INFINITY,
      to: 2,
      insert: "x",
      expectedVersion: 0,
    });
    expect(result).toEqual({ ok: false, reason: "invalid-range", snapshot: before });
  });

  test("empty document: only from=0,to=0 is valid", () => {
    const empty = snap("", 0);
    const invalid = applyEdit(empty, { from: 0, to: 1, insert: "x", expectedVersion: 0 });
    expect(invalid).toEqual({ ok: false, reason: "invalid-range", snapshot: empty });
    const valid = applyEdit(empty, { from: 0, to: 0, insert: "x", expectedVersion: 0 });
    expect(valid).toEqual({ ok: true, snapshot: { text: "x", version: 1 } });
  });
});

describe("applyEdit — readonly host", () => {
  test("rejects with reason 'readonly' and the current snapshot unchanged", () => {
    const before = snap("locked", 4);
    const result = applyEdit(
      before,
      { from: 0, to: 6, insert: "open", expectedVersion: 4 },
      { readonly: true },
    );
    expect(result).toEqual({ ok: false, reason: "readonly", snapshot: before });
  });

  test("readonly:false behaves identically to omitting options", () => {
    const before = snap("abc", 0);
    const withFalse = applyEdit(
      before,
      { from: 0, to: 1, insert: "X", expectedVersion: 0 },
      { readonly: false },
    );
    const withoutOption = applyEdit(before, { from: 0, to: 1, insert: "X", expectedVersion: 0 });
    expect(withFalse).toEqual(withoutOption);
  });
});

describe("applyEdit — binding check order (readonly -> stale -> invalid-range)", () => {
  test("readonly wins over an otherwise-stale edit", () => {
    const before = snap("abc", 5);
    // expectedVersion is wrong (stale) AND the host is readonly.
    const result = applyEdit(
      before,
      { from: 0, to: 3, insert: "x", expectedVersion: 1 },
      { readonly: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("readonly");
  });

  test("readonly wins over an otherwise-invalid-range edit", () => {
    const before = snap("abc", 0);
    // Range is invalid (to > length) AND the host is readonly.
    const result = applyEdit(
      before,
      { from: 0, to: 99, insert: "x", expectedVersion: 0 },
      { readonly: true },
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("readonly");
  });

  test("stale wins over an otherwise-invalid-range edit", () => {
    const before = snap("abc", 3);
    // expectedVersion is wrong AND the range is invalid (to > length).
    const result = applyEdit(before, { from: 0, to: 99, insert: "x", expectedVersion: 0 });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("unreachable");
    expect(result.reason).toBe("stale");
  });
});
