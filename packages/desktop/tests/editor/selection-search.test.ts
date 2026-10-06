import { test, expect, describe } from "bun:test";
import {
  normalizeForSearch,
  findUniqueRange,
  hasAmbiguousTypography,
  hasBacktickOrLinkSyntax,
  touchesStructuralSyntax,
  hasSameDelimiter,
  wrapDelimiter,
  locateSelectionInSource,
} from "../../src/lib/editor/selection-search";

/**
 * selection-search.ts (inline-editing plan §4.6, PR 4) — rendered-text →
 * markdown-source matching for the selection-formatting menu row.
 *
 * The typographer reverse-map fixtures below are derived directly from
 * reading `markdown-it@14.3.0`'s `lib/rules_core/replacements.mjs` and
 * `lib/rules_core/smartquotes.mjs` against this project's renderer options
 * (`html:true, linkify:true, typographer:true`, default `quotes:"“”‘’"` —
 * see `packages/cli/src/lib/markdown/renderer.ts`).
 */

// ── indexMap round-trip helper ──────────────────────────────────────────────

/** Every entry in `indexMap` must be a valid offset into `raw` (0..raw.length
 *  inclusive), and `indexMap.length` must be exactly `normalized.length + 1`. */
function assertValidIndexMap(raw: string, result: { normalized: string; indexMap: number[] }) {
  expect(result.indexMap.length).toBe(result.normalized.length + 1);
  for (const offset of result.indexMap) {
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThanOrEqual(raw.length);
  }
  expect(result.indexMap[result.indexMap.length - 1]).toBe(raw.length);
}

// ── normalizeForSearch — whitespace ────────────────────────────────────────

describe("normalizeForSearch — whitespace collapse", () => {
  test("collapses a run of spaces/tabs to one space", () => {
    const r = normalizeForSearch("a   b\t\tc", { stripDelimiters: false });
    expect(r.normalized).toBe("a b c");
    assertValidIndexMap("a   b\t\tc", r);
  });

  test("collapses a hard-wrapped source line break to a single space", () => {
    const raw = "a phrase\nspanning a line break";
    const r = normalizeForSearch(raw, { stripDelimiters: false });
    expect(r.normalized).toBe("a phrase spanning a line break");
    assertValidIndexMap(raw, r);
  });

  test("collapses leading indentation on a continuation line", () => {
    const raw = "a phrase\n    spanning here";
    const r = normalizeForSearch(raw, { stripDelimiters: false });
    expect(r.normalized).toBe("a phrase spanning here");
    assertValidIndexMap(raw, r);
  });

  test("CRLF and lone-CR runs collapse like LF", () => {
    const r1 = normalizeForSearch("a\r\nb", { stripDelimiters: false });
    expect(r1.normalized).toBe("a b");
    const r2 = normalizeForSearch("a\rb", { stripDelimiters: false });
    expect(r2.normalized).toBe("a b");
  });

  test("a trailing newline collapses to a single trailing space", () => {
    const raw = "abc\n";
    const r = normalizeForSearch(raw, { stripDelimiters: false });
    expect(r.normalized).toBe("abc ");
    assertValidIndexMap(raw, r);
  });
});

// ── normalizeForSearch — typographer reverse map ───────────────────────────

describe("normalizeForSearch — typographer reverse map (every rule)", () => {
  const cases: Array<[string, string, string]> = [
    ["copyright: (c) -> ©", "©", "(c)"],
    ["trademark: (tm) -> ™", "™", "(tm)"],
    ["registered: (r) -> ®", "®", "(r)"],
    ["plus-minus: +- -> ±", "±", "+-"],
    ["em dash: --- -> —", "—", "---"],
    ["en dash: -- -> –", "–", "--"],
    ["left double quote: “", "“", '"'],
    ["right double quote: ”", "”", '"'],
    ["left single quote: ‘", "‘", "'"],
    ["right single quote / apostrophe: ’", "’", "'"],
  ];

  for (const [label, glyph, ascii] of cases) {
    test(label, () => {
      const r = normalizeForSearch(glyph, { stripDelimiters: false });
      expect(r.normalized).toBe(ascii);
      assertValidIndexMap(glyph, r);
    });
  }

  test("reverses inside a full sentence, preserving surrounding text", () => {
    const raw = "She said “wait—really” then it’s fine © 2026 (r) not (c) literal.";
    const r = normalizeForSearch(raw, { stripDelimiters: false });
    expect(r.normalized).toBe(
      'She said "wait---really" then it\'s fine (c) 2026 (r) not (c) literal.',
    );
    assertValidIndexMap(raw, r);
  });

  test("does NOT introduce an NBSP rule — a literal U+00A0 passes through unchanged, not collapsed", () => {
    // The plan explicitly calls out that no NBSP substitution exists in this
    // markdown-it configuration (verified by reading replacements.mjs and
    // smartquotes.mjs directly — neither file mentions NBSP at all). U+00A0
    // is also not part of THIS module's `[ \t\r\n]` whitespace-collapse
    // definition, so a literal NBSP is copied through verbatim, distinct
    // from an ordinary space.
    const raw = "a b";
    const r = normalizeForSearch(raw, { stripDelimiters: false });
    expect(r.normalized).toBe("a b");
    expect(r.normalized).not.toBe("a b");
    assertValidIndexMap(raw, r);
  });
});

// ── normalizeForSearch — delimiter stripping ───────────────────────────────

describe("normalizeForSearch — delimiter stripping (stripDelimiters: true)", () => {
  test("strips ** (bold)", () => {
    const r = normalizeForSearch("a **bold** word", { stripDelimiters: true });
    expect(r.normalized).toBe("a bold word");
    assertValidIndexMap("a **bold** word", r);
  });

  test("strips * (italic)", () => {
    const r = normalizeForSearch("a *italic* word", { stripDelimiters: true });
    expect(r.normalized).toBe("a italic word");
  });

  test("strips __ (alternate bold syntax)", () => {
    const r = normalizeForSearch("a __bold__ word", { stripDelimiters: true });
    expect(r.normalized).toBe("a bold word");
  });

  test("strips _ (alternate italic syntax)", () => {
    const r = normalizeForSearch("a _italic_ word", { stripDelimiters: true });
    expect(r.normalized).toBe("a italic word");
  });

  test("strips ~~ (strikethrough)", () => {
    const r = normalizeForSearch("a ~~struck~~ word", { stripDelimiters: true });
    expect(r.normalized).toBe("a struck word");
  });

  test("nested delimiters (bold wrapping italic) strip completely", () => {
    const r = normalizeForSearch("**a *b* c**", { stripDelimiters: true });
    expect(r.normalized).toBe("a b c");
  });

  test("adjacent delimiters (bold immediately followed by italic) strip completely", () => {
    const r = normalizeForSearch("**bold***italic*", { stripDelimiters: true });
    expect(r.normalized).toBe("bolditalic");
  });

  test("does not strip a lone ~ (not a valid strikethrough delimiter)", () => {
    const r = normalizeForSearch("a ~b~ c", { stripDelimiters: true });
    expect(r.normalized).toBe("a ~b~ c");
  });

  test("stripDelimiters: false leaves delimiters untouched", () => {
    const r = normalizeForSearch("a **bold** word", { stripDelimiters: false });
    expect(r.normalized).toBe("a **bold** word");
  });

  test("index map still round-trips correctly with stripped characters", () => {
    const raw = "a **bold** word here";
    const r = normalizeForSearch(raw, { stripDelimiters: true });
    assertValidIndexMap(raw, r);
    // every indexMap entry must point at a character that, read forward
    // from raw, actually starts the corresponding normalized character
    // (spot check the 'b' of "bold").
    const bIdx = r.normalized.indexOf("bold");
    expect(raw[r.indexMap[bIdx]!]).toBe("b");
  });
});

// ── findUniqueRange ─────────────────────────────────────────────────────────

describe("findUniqueRange", () => {
  test("returns the raw [from, to) range for exactly one match", () => {
    const haystack = normalizeForSearch("a phrase here", { stripDelimiters: false });
    const range = findUniqueRange("phrase", haystack);
    expect(range).toEqual([2, 8]);
    expect("a phrase here".slice(range![0], range![1])).toBe("phrase");
  });

  test("returns null for zero matches", () => {
    const haystack = normalizeForSearch("nothing matches here", { stripDelimiters: false });
    expect(findUniqueRange("absent", haystack)).toBeNull();
  });

  test("returns null for two non-overlapping (superstring) duplicates", () => {
    const haystack = normalizeForSearch("a phrase here and a phrase there", {
      stripDelimiters: false,
    });
    expect(findUniqueRange("a phrase", haystack)).toBeNull();
  });

  test("returns null for overlapping matches", () => {
    // "aa" occurs at offset 0 and offset 1 in "aaa" (overlapping) — both
    // count, so this is ambiguous per plan §4.6, not deduplicated to one.
    const haystack = normalizeForSearch("aaa", { stripDelimiters: false });
    expect(findUniqueRange("aa", haystack)).toBeNull();
  });

  test("returns null for a substring/superstring duplicate pair", () => {
    // "cat" is a substring of "cats", and "cat" ALSO occurs standalone —
    // two distinct occurrences, ambiguous.
    const haystack = normalizeForSearch("cat and cats", { stripDelimiters: false });
    expect(findUniqueRange("cat", haystack)).toBeNull();
  });

  test("returns null for an empty needle", () => {
    const haystack = normalizeForSearch("anything", { stripDelimiters: false });
    expect(findUniqueRange("", haystack)).toBeNull();
  });

  test("resolves through a delimiter-stripped index map to the ORIGINAL raw span (including delimiters)", () => {
    const raw = "a **bold** word";
    const haystack = normalizeForSearch(raw, { stripDelimiters: true });
    const range = findUniqueRange("a bold word", haystack);
    expect(range).toEqual([0, raw.length]);
    expect(raw.slice(range![0], range![1])).toBe("a **bold** word");
  });
});

// ── hasAmbiguousTypography ──────────────────────────────────────────────────

describe("hasAmbiguousTypography — collapsed punctuation runs (one-to-many, unreversible)", () => {
  test("ellipsis character is ambiguous", () => {
    expect(hasAmbiguousTypography("wait… really")).toBe(true);
  });

  test("downgraded ellipsis after ? is ambiguous", () => {
    expect(hasAmbiguousTypography("really?..")).toBe(true);
  });

  test("downgraded ellipsis after ! is ambiguous", () => {
    expect(hasAmbiguousTypography("really!..")).toBe(true);
  });

  test("collapsed !!! is ambiguous", () => {
    expect(hasAmbiguousTypography("stop!!! now")).toBe(true);
  });

  test("collapsed ??? is ambiguous", () => {
    expect(hasAmbiguousTypography("what??? now")).toBe(true);
  });

  test("a comma is ambiguous (collapsed ,, -> , is one-to-many)", () => {
    expect(hasAmbiguousTypography("apples, oranges")).toBe(true);
  });

  test("ordinary text with none of these is not ambiguous", () => {
    expect(hasAmbiguousTypography("a plain phrase with one. period")).toBe(false);
  });

  test("a single '?' or '!' alone is not ambiguous", () => {
    expect(hasAmbiguousTypography("really? yes! sure")).toBe(false);
  });

  test("a single '.' (not part of a 2+ run) is not ambiguous", () => {
    expect(hasAmbiguousTypography("end of sentence.")).toBe(false);
  });
});

// ── guardrails: backtick / link syntax ─────────────────────────────────────

describe("hasBacktickOrLinkSyntax", () => {
  test("detects a backtick", () => {
    expect(hasBacktickOrLinkSyntax("some `code` here")).toBe(true);
  });

  test("detects [text]( link syntax", () => {
    expect(hasBacktickOrLinkSyntax("a [link](url) here")).toBe(true);
  });

  test("plain text has neither", () => {
    expect(hasBacktickOrLinkSyntax("plain text")).toBe(false);
  });

  test("a lone bracket without ]( is not link syntax", () => {
    expect(hasBacktickOrLinkSyntax("a [footnote reference]")).toBe(false);
  });
});

describe("touchesStructuralSyntax — adjacency-aware code-span/link guardrail", () => {
  const src = "see `code` here and [a link](https://example.com) too";

  test("a match landing entirely inside a code span (no backtick in the matched text) is blocked", () => {
    const start = src.indexOf("code");
    const end = start + "code".length;
    expect(touchesStructuralSyntax(src, start, end)).toBe(true);
  });

  test("a match landing entirely inside link text (no bracket in the matched text) is blocked", () => {
    const start = src.indexOf("a link");
    const end = start + "a link".length;
    expect(touchesStructuralSyntax(src, start, end)).toBe(true);
  });

  test("a match spanning INTO a code span (backtick literally in the matched text) is blocked", () => {
    const start = src.indexOf("`code`");
    const end = start + "`code`".length;
    expect(touchesStructuralSyntax(src, start, end)).toBe(true);
  });

  test("a match entirely outside any code span or link is not blocked", () => {
    const start = src.indexOf("here");
    const end = start + "here".length;
    expect(touchesStructuralSyntax(src, start, end)).toBe(false);
  });

  test("a match that does not touch either boundary at all is not blocked", () => {
    const start = src.indexOf("too");
    const end = start + "too".length;
    expect(touchesStructuralSyntax(src, start, end)).toBe(false);
  });
});

// ── guardrails: same-delimiter nesting ─────────────────────────────────────

describe("hasSameDelimiter — nesting the SAME delimiter is invalid; a different one is fine", () => {
  test("bold: a region already containing ** is blocked", () => {
    expect(hasSameDelimiter("a **bold** word", "bold")).toBe(true);
  });

  test("bold: a region containing __ (alternate bold syntax) is blocked", () => {
    expect(hasSameDelimiter("a __bold__ word", "bold")).toBe(true);
  });

  test("bold: a region containing only single-star italic is NOT blocked (different delimiter)", () => {
    // plan §4.6's own example: bolding `a *b* c` -> `**a *b* c**` is valid.
    expect(hasSameDelimiter("a *b* c", "bold")).toBe(false);
  });

  test("italic: a standalone single * is blocked", () => {
    expect(hasSameDelimiter("a *italic* word", "italic")).toBe(true);
  });

  test("italic: a standalone single _ is blocked", () => {
    expect(hasSameDelimiter("a _italic_ word", "italic")).toBe(true);
  });

  test("italic: a region containing only ** bold is NOT blocked (different delimiter)", () => {
    expect(hasSameDelimiter("a **bold** word", "italic")).toBe(false);
  });

  test("strike: a region already containing ~~ is blocked", () => {
    expect(hasSameDelimiter("a ~~struck~~ word", "strike")).toBe(true);
  });

  test("strike: a region containing ** bold is NOT blocked", () => {
    expect(hasSameDelimiter("a **bold** word", "strike")).toBe(false);
  });

  test("code: a region already containing a backtick is blocked", () => {
    expect(hasSameDelimiter("a `code` word", "code")).toBe(true);
  });
});

describe("wrapDelimiter", () => {
  test("wraps each kind with its markdown delimiter pair", () => {
    expect(wrapDelimiter("x", "bold")).toBe("**x**");
    expect(wrapDelimiter("x", "italic")).toBe("*x*");
    expect(wrapDelimiter("x", "strike")).toBe("~~x~~");
    expect(wrapDelimiter("x", "code")).toBe("`x`");
  });
});

// ── locateSelectionInSource (the end-to-end helper) ────────────────────────

describe("locateSelectionInSource", () => {
  test("finds a plain phrase", () => {
    const m = locateSelectionInSource("a phrase here", "phrase");
    expect(m).toEqual({ start: 2, end: 8, matchedText: "phrase" });
  });

  test("finds a phrase spanning a hard-wrapped source line break", () => {
    const blockSlice = "a phrase\nspanning a line break here";
    const m = locateSelectionInSource(blockSlice, "phrase spanning");
    expect(m).not.toBeNull();
    expect(m!.matchedText).toBe("phrase\nspanning");
  });

  test("finds a phrase spanning an already-bold word via delimiter stripping", () => {
    const blockSlice = "a **bold** word here";
    const m = locateSelectionInSource(blockSlice, "a bold word");
    expect(m).not.toBeNull();
    expect(m!.matchedText).toBe("a **bold** word");
  });

  test("finds a phrase with typographer substitutions reversed", () => {
    const blockSlice = 'She said "wait---really" then left.';
    const m = locateSelectionInSource(blockSlice, "“wait—really”");
    expect(m).not.toBeNull();
    expect(m!.matchedText).toBe('"wait---really"');
  });

  test("returns null for an empty/whitespace-only selection", () => {
    expect(locateSelectionInSource("anything", "   ")).toBeNull();
    expect(locateSelectionInSource("anything", "")).toBeNull();
  });

  test("returns null when the needle contains ambiguous collapsed punctuation", () => {
    expect(locateSelectionInSource("wait... really", "wait… really")).toBeNull();
  });

  test("returns null for zero matches", () => {
    expect(locateSelectionInSource("nothing here matches", "absent phrase")).toBeNull();
  });

  test("returns null for multiple matches", () => {
    expect(locateSelectionInSource("a phrase here and a phrase there", "a phrase")).toBeNull();
  });

  test("footnote reference markers have no literal source correspondence — accepted degrade, not fixed here", () => {
    // Rendered footnote labels are `<sup>` elements with numeric/symbol
    // content (e.g. "1"); the raw source has `[^id]` instead. This module
    // does not special-case footnotes — the search simply fails to find a
    // match, which is the documented, accepted degrade (plan §4.6).
    const blockSlice = "a claim[^1] here";
    const m = locateSelectionInSource(blockSlice, "claim1");
    expect(m).toBeNull();
  });
});
