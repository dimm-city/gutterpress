import { test, expect, describe } from "bun:test";
import { buildLineStarts, charRange } from "../../src/lib/editor/source-range";

// ── buildLineStarts ──────────────────────────────────────────────────────────

describe("buildLineStarts", () => {
  test("LF-only text", () => {
    const text = "a\nbb\nccc";
    // lines: "a" (0), "bb" (2), "ccc" (5)
    expect(buildLineStarts(text)).toEqual([0, 2, 5]);
  });

  test("CRLF text", () => {
    const text = "a\r\nbb\r\nccc";
    // "a" starts at 0 (len 1 + \r\n = 3) -> next line at 3
    // "bb" starts at 3 (len 2 + \r\n = 4) -> next line at 7
    expect(buildLineStarts(text)).toEqual([0, 3, 7]);
  });

  test("lone-CR text (old-Mac line endings) — must NOT collapse to one line", () => {
    const text = "a\rbb\rccc";
    expect(buildLineStarts(text)).toEqual([0, 2, 5]);
  });

  test("mixed line endings", () => {
    const text = "a\nbb\r\nccc\rd";
    // "a" (0) \n -> 2; "bb" (2) \r\n -> 6; "ccc" (6) \r -> 10; "d" (10)
    expect(buildLineStarts(text)).toEqual([0, 2, 6, 10]);
  });

  test("trailing newline adds a final (empty) line-start entry", () => {
    const text = "abc\n";
    expect(buildLineStarts(text)).toEqual([0, 4]);
  });

  test("no trailing newline — last line has no following entry beyond its own start", () => {
    const text = "abc";
    expect(buildLineStarts(text)).toEqual([0]);
  });

  test("empty string", () => {
    expect(buildLineStarts("")).toEqual([0]);
  });
});

// ── charRange ─────────────────────────────────────────────────────────────────

describe("charRange", () => {
  test("resolves a middle line range to its char offsets", () => {
    const text = "line0\nline1\nline2\n";
    const starts = buildLineStarts(text);
    // "line1\n" is lines [1, 2)
    expect(charRange(text, starts, [1, 2])).toEqual([6, 12]);
    expect(text.slice(6, 12)).toBe("line1\n");
  });

  test("clamps `to` at text.length for the last block with no trailing newline", () => {
    const text = "line0\nline1";
    const starts = buildLineStarts(text); // [0, 6]
    // block spans line 1 to EOF — "to" (2) is >= starts.length (2)
    expect(charRange(text, starts, [1, 2])).toEqual([6, text.length]);
    expect(text.slice(6, text.length)).toBe("line1");
  });

  test("clamps `to` well past starts.length the same way", () => {
    const text = "only-line";
    const starts = buildLineStarts(text); // [0]
    expect(charRange(text, starts, [0, 5])).toEqual([0, text.length]);
  });

  test("resolves the last item of a list (trailing newline retained)", () => {
    const text = "- a\n- b\n";
    const starts = buildLineStarts(text); // [0, 4, 8]
    // "- b\n" is line 1 -> [1, 2)
    expect(charRange(text, starts, [1, 2])).toEqual([4, 8]);
    expect(text.slice(4, 8)).toBe("- b\n");
  });

  test("resolves a block immediately followed by an @marker line", () => {
    const text = "paragraph text\n@section\nmore text\n";
    const starts = buildLineStarts(text); // [0, 15, 24, 34]
    // paragraph is line 0, ending right where @section begins (line 1)
    expect(charRange(text, starts, [0, 1])).toEqual([0, 15]);
    expect(text.slice(0, 15)).toBe("paragraph text\n");
  });

  test("resolves against CRLF text using CRLF-built line starts", () => {
    const text = "line0\r\nline1\r\nline2\r\n";
    const starts = buildLineStarts(text);
    expect(charRange(text, starts, [1, 2])).toEqual([7, 14]);
    expect(text.slice(7, 14)).toBe("line1\r\n");
  });

  test("resolves against lone-CR text using lone-CR-built line starts", () => {
    const text = "line0\rline1\rline2\r";
    const starts = buildLineStarts(text);
    expect(charRange(text, starts, [1, 2])).toEqual([6, 12]);
    expect(text.slice(6, 12)).toBe("line1\r");
  });

  test("throws on non-finite endpoints (NaN)", () => {
    const text = "a\nb\n";
    const starts = buildLineStarts(text);
    expect(() => charRange(text, starts, [Number.NaN, 1])).toThrow();
    expect(() => charRange(text, starts, [0, Number.NaN])).toThrow();
    expect(() => charRange(text, starts, [0, Number.POSITIVE_INFINITY])).toThrow();
  });

  test("throws on negative start", () => {
    const text = "a\nb\n";
    const starts = buildLineStarts(text);
    expect(() => charRange(text, starts, [-1, 1])).toThrow();
  });

  test("throws on inverted range (to < from)", () => {
    const text = "a\nb\n";
    const starts = buildLineStarts(text);
    expect(() => charRange(text, starts, [2, 1])).toThrow();
  });

  test("does not throw when from === to (zero-length range)", () => {
    const text = "a\nb\n";
    const starts = buildLineStarts(text);
    expect(() => charRange(text, starts, [1, 1])).not.toThrow();
  });
});
