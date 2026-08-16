import { describe, expect, test } from "bun:test";
import MarkdownIt from "markdown-it";
import { registerInlineSourceMetadata } from "./inline-source";
import {
  SOURCE_OFFSETS_ATTR,
  decodeSegments,
  mapRenderedOffset,
  mappedLength,
  registerInlineOffsets,
  type OffsetSegment,
} from "./inline-offsets";

function parse(src: string, opts: Record<string, unknown> = {}) {
  const md = new MarkdownIt({ html: true, ...opts });
  registerInlineOffsets(md);
  return { md, html: md.render(src) };
}

/** Every `data-gp-source-offsets` value in document order. */
function offsetAttrs(html: string): string[] {
  return [...html.matchAll(new RegExp(`${SOURCE_OFFSETS_ATTR}="([^"]*)"`, "g"))].map((m) => m[1]!);
}

/**
 * Each mapped block paired with ITS OWN rendered text.
 *
 * Segments are per-block offsets, so they must be checked against that block's
 * text — comparing every block's segments against the first block's text is
 * what made the two-item list case fail spuriously.
 */
function mappedBlocks(html: string): Array<{ attr: string; text: string }> {
  const out: Array<{ attr: string; text: string }> = [];
  const open = new RegExp(`<([a-z0-9]+)\\b[^>]*${SOURCE_OFFSETS_ATTR}="([^"]*)"[^>]*>`, "gi");
  for (const m of html.matchAll(open)) {
    const tag = m[1]!;
    const from = m.index! + m[0].length;
    const close = html.indexOf(`</${tag}`, from);
    const inner = html.slice(from, close < 0 ? undefined : close);
    out.push({ attr: m[2]!, text: inner.replace(/<[^>]+>/g, "") });
  }
  return out;
}

function lineOf(src: string, line: number): string {
  return src.split("\n")[line] ?? "";
}

/**
 * THE INVARIANT. Every emitted segment must point at source text byte-identical
 * to the rendered text it claims to cover. If this ever fails, the map is
 * lying and a patch built from it would corrupt the author's file — which is
 * the exact failure `inline-source.ts` refused to risk when it computed
 * `state.pos` and threw it away.
 */
function fold(s: string): string {
  return s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
}

function assertSegmentsExact(src: string, rendered: string, segments: OffsetSegment[]) {
  for (const s of segments) {
    const sourceText = lineOf(src, s.line).slice(s.col, s.col + s.len);
    const renderedText = rendered.slice(s.rendered, s.rendered + s.len);
    // Folded, matching the module's contract: the LENGTH-PRESERVING smart-quote
    // substitutions are tolerated because they shift no offset. Many-to-one
    // replacements (`...` -> `…`) are NOT folded here, so a run containing one
    // must still be absent — asserted separately below.
    expect(fold(sourceText)).toBe(fold(renderedText));
  }
}

describe("inline offsets — the exactness invariant", () => {
  const cases: Record<string, string> = {
    "plain paragraph": "Hello world, this is plain text.",
    "bold in the middle": "Some **bold** text here.",
    "italic and bold": "A *little* and a **lot** of emphasis.",
    "a link": "See [the docs](https://example.com) for more.",
    "inline code": "Call `render()` to start.",
    "heading": "## A Heading With Words",
    "list item": "- first item\n- second item",
    "blockquote": "> quoted text here",
    "nested emphasis": "***both at once*** and after",
    "trailing text after markup": "**lead** then a long trailing run of plain words",
    "text before and after a link": "before [mid](u) after",
    "multiple links": "[one](a) and [two](b) and [three](c)",
    "underscores in words": "snake_case_word stays intact",
    "escaped asterisk": String.raw`literal \* asterisk`,
  };

  for (const [name, src] of Object.entries(cases)) {
    test(name, () => {
      const { html } = parse(src);
      const blocks = mappedBlocks(html);
      // Non-vacuous: every one of these constructs must actually produce a map.
      // Without this the exactness check below would pass trivially on zero
      // segments — the "gate that cannot catch its own failure" shape.
      expect(blocks.length).toBeGreaterThan(0);
      for (const { attr, text } of blocks) {
        const segments = decodeSegments(attr);
        expect(segments.length).toBeGreaterThan(0);
        assertSegmentsExact(src, text, segments);
      }
    });
  }

  /** Constructs whose rendered text must be mapped in FULL, not partially. */
  const fullyMapped: Record<string, string> = {
    "plain paragraph": "Hello world, this is plain text.",
    "bold in the middle": "Some **bold** text here.",
    "a link": "See [the docs](https://example.com) for more.",
    heading: "## A Heading With Words",
    blockquote: "> quoted text here",
    "list items": "- first item\n- second item",
    "two paragraphs": "First para here.\n\nSecond para there.",
  };

  for (const [name, src] of Object.entries(fullyMapped)) {
    test(`${name} — every rendered character is mapped`, () => {
      for (const { attr, text } of mappedBlocks(parse(src).html)) {
        expect(mappedLength(decodeSegments(attr))).toBe(text.length);
      }
    });
  }

  test("inline code is deliberately unmapped but does not desync the offsets", () => {
    const src = "Call `render()` to start.";
    const [block] = mappedBlocks(parse(src).html);
    const segments = decodeSegments(block!.attr);
    // The backticked run is not a literal source slice, so it gets no
    // coordinate — but the text AFTER it must still map correctly, which only
    // holds if the rendered offset advanced past it.
    expect(mappedLength(segments)).toBe(block!.text.length - "render()".length);
    assertSegmentsExact(src, block!.text, segments);
  });

  test("smart quotes stay mapped — the substitution is 1:1 so offsets hold", () => {
    const src = "It's a perfectly ordinary sentence.";
    const { html } = parse(src, { typographer: true });
    const [block] = mappedBlocks(html);
    const segments = decodeSegments(block!.attr);
    expect(block!.text).toContain("’"); // typographer really did run
    expect(mappedLength(segments)).toBe(block!.text.length);
    assertSegmentsExact(src, block!.text, segments);
  });

  test("many-to-one substitutions are NOT mapped — they shift every later offset", () => {
    const src = "A sentence... and more words after it";
    const { html } = parse(src, { typographer: true });
    const [block] = mappedBlocks(html);
    const segments = decodeSegments(block!.attr);
    // `...` -> `…` is 3 source chars for 1 rendered char, so a run spanning it
    // would misplace everything after. It must break instead.
    expect(block!.text).toContain("…");
    expect(mappedLength(segments)).toBeLessThan(block!.text.length);
    assertSegmentsExact(src, block!.text, segments);
  });

  test("CRLF input yields the same line/col coordinates as LF", () => {
    const lf = "First line here.\n\nSecond **bold** line.";
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(offsetAttrs(parse(lf).html)).toEqual(offsetAttrs(parse(crlf).html));
  });

  test("no segment ever spans a line break", () => {
    const src = "a paragraph that\nwraps across two source lines with **bold** in it";
    const { html } = parse(src);
    for (const attr of offsetAttrs(html)) {
      for (const s of decodeSegments(attr)) {
        expect(lineOf(src, s.line).length).toBeGreaterThanOrEqual(s.col + s.len);
      }
    }
  });
});

/**
 * `data-gp-source-offsets` is a destructive edit coordinate: a consumer splices
 * the author's file at the character it names. `html: true` is on with no
 * allowlist, so an author (or an untrusted source document) must not be able to
 * supply one and steer a splice to a location of their choosing.
 *
 * These use BOTH rules together, as production does — the raw-HTML strip lives
 * in `inline-source.ts` and the attrs filter in `inline-offsets.ts`.
 */
describe("forgery — an author can never supply the coordinate", () => {
  function fullParse(src: string): string {
    const md = new MarkdownIt({ html: true });
    registerInlineSourceMetadata(md);
    registerInlineOffsets(md);
    return md.render(src);
  }

  test("raw HTML block cannot carry a forged map", () => {
    const html = fullParse(`<p ${SOURCE_OFFSETS_ATTR}="0:0:0:99">victim</p>`);
    expect(html).not.toContain(`${SOURCE_OFFSETS_ATTR}="0:0:0:99"`);
  });

  test("raw HTML on a block element other than img/a is also stripped", () => {
    for (const tag of ["div", "h2", "li", "blockquote", "td"]) {
      const html = fullParse(`<${tag} ${SOURCE_OFFSETS_ATTR}="0:0:0:99">x</${tag}>`);
      expect(html).not.toContain(`${SOURCE_OFFSETS_ATTR}="0:0:0:99"`);
    }
  });

  test("case-insensitive attribute spelling is stripped too", () => {
    const html = fullParse(`<p DATA-GP-SOURCE-OFFSETS="0:0:0:99">victim</p>`);
    expect(html.toLowerCase()).not.toContain(`${SOURCE_OFFSETS_ATTR}="0:0:0:99"`);
  });

  test("a forged value on an UNMAPPED block does not survive", () => {
    // The dangerous case: a block we emit no map for would otherwise keep the
    // author's value, since there is nothing to overwrite it.
    const html = fullParse(`<p ${SOURCE_OFFSETS_ATTR}="0:0:0:99"></p>`);
    expect(html).not.toContain("0:0:0:99");
  });

  test("code examples stay opaque — a coordinate inside <xmp> is NOT rewritten", () => {
    const html = fullParse(`<xmp><p ${SOURCE_OFFSETS_ATTR}="0:0:0:99">shown</p></xmp>`);
    // Inside a raw-text element this is displayed text, not an attribute, so
    // mangling it would corrupt an author's documentation of this very feature.
    expect(html).toContain(`${SOURCE_OFFSETS_ATTR}="0:0:0:99"`);
  });

  test("any map that IS emitted is still the parser's own, and exact", () => {
    const src = "A normal paragraph of prose.";
    const html = fullParse(src);
    for (const { attr, text } of mappedBlocks(html)) {
      assertSegmentsExact(src, text, decodeSegments(attr));
    }
  });
});

describe("mapRenderedOffset", () => {
  const segments: OffsetSegment[] = [
    { rendered: 0, line: 0, col: 0, len: 5 },
    { rendered: 5, line: 0, col: 9, len: 4 },
  ];

  test("maps inside a segment", () => {
    expect(mapRenderedOffset(segments, 2)).toEqual({ line: 0, col: 2 });
    expect(mapRenderedOffset(segments, 6)).toEqual({ line: 0, col: 10 });
  });

  test("maps the caret at a segment end (the insertion point)", () => {
    expect(mapRenderedOffset(segments, 5)).toEqual({ line: 0, col: 5 });
  });

  test("returns null outside any segment — never a guess", () => {
    expect(mapRenderedOffset(segments, 99)).toBeNull();
    expect(mapRenderedOffset([], 0)).toBeNull();
  });
});

describe("wire format", () => {
  test("round-trips", () => {
    const segs: OffsetSegment[] = [{ rendered: 0, line: 1, col: 2, len: 3 }];
    expect(decodeSegments("0:1:2:3")).toEqual(segs);
  });

  test("rejects malformed entries instead of producing NaN coordinates", () => {
    expect(decodeSegments("bad")).toEqual([]);
    expect(decodeSegments("0:1:2")).toEqual([]);
    expect(decodeSegments("0:-1:2:3")).toEqual([]);
    expect(decodeSegments("")).toEqual([]);
  });

  test("mappedLength sums coverage", () => {
    expect(mappedLength([{ rendered: 0, line: 0, col: 0, len: 4 }])).toBe(4);
    expect(mappedLength([])).toBe(0);
  });
});
