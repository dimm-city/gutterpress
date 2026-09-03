/**
 * Acceptance tests for the `source_range` primitive (docs/inline-editing-plan.md
 * §2.5). Renders through `createMarkdownRenderer()` — the FULL pipeline
 * (markdown-it-attrs, footnote, deflist, source-map, the marker plugin, then
 * `source_range` registered last) — exactly what `renderer.ts` ships, so
 * these tests exercise the rule as real callers see it, not in isolation.
 */
import { describe, test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import markdownItAttrs from "markdown-it-attrs";
import markdownItFootnote from "markdown-it-footnote";
import markdownItDeflist from "markdown-it-deflist";
import markdownItSourceMap from "markdown-it-source-map";
import markerPlugin from "./markers.js";
import { registerImageRule } from "./images";
import { createMarkdownRenderer } from "./renderer";
import { SOURCE_RANGE_ATTR } from "./source-range";

// ── corpus builder ───────────────────────────────────────────────────────────
//
// Segments are tracked by a running line counter as they're appended, so
// expected [start, end) ranges and expected block text are DERIVED from the
// same construction the corpus is built from — never hand-counted — which is
// what makes the "reproduces its exact block source" assertions below a real
// correctness check rather than a tautology.

interface Segment {
  start: number;
  end: number;
}

class CorpusBuilder {
  private lines: string[] = [];
  readonly segments: Record<string, Segment> = {};

  push(...more: string[]): this {
    this.lines.push(...more);
    return this;
  }

  blank(): this {
    return this.push("");
  }

  seg(name: string, ...segLines: string[]): this {
    const start = this.lines.length;
    this.push(...segLines);
    this.segments[name] = { start, end: this.lines.length };
    return this;
  }

  /** Raw text of a previously-recorded segment, LF-joined with a trailing newline. */
  text(name: string, eol: "\n" | "\r\n" | "\r" = "\n"): string {
    const s = this.segments[name]!;
    return this.lines.slice(s.start, s.end).join("\n").replace(/\n/g, eol) + eol;
  }

  build(): string {
    return this.lines.join("\n") + "\n";
  }
}

/**
 * A lib-test-local mirror of the desktop consumer helper
 * (`packages/desktop/src/lib/editor/source-range.ts`'s `buildLineStarts` /
 * `charRange`), duplicated here (not imported — the CLI package must not
 * depend on the desktop package) so these tests can independently verify the
 * WIRE CONTRACT: that `data-source-range` values, resolved against the
 * ORIGINAL markdown source, reproduce the exact block text. The desktop
 * package owns testing `buildLineStarts`/`charRange`'s own correctness
 * (LF/CRLF/lone-CR, clamping, throwing) in its own test suite
 * (`packages/desktop/tests/editor/source-range.test.ts`) — this mirror exists
 * only to exercise THIS package's output against it.
 */
function buildLineStarts(text: string): number[] {
  const starts = [0];
  const re = /\r\n?|\n/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index + m[0].length);
  return starts;
}

function charRange(text: string, starts: number[], range: [number, number]): [number, number] {
  const [from, to] = range;
  const fromOffset = from < starts.length ? starts[from]! : text.length;
  const toOffset = to < starts.length ? starts[to]! : text.length;
  return [fromOffset, toOffset];
}

/** Extract every `data-source-range="a:b"` occurrence from HTML, in document order. */
function extractSourceRanges(html: string): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  const re = new RegExp(`${SOURCE_RANGE_ATTR}="(\\d+):(\\d+)"`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push([Number(m[1]), Number(m[2])]);
  return out;
}

/** Extract every `data-source-line="N"` occurrence from HTML, in document order (regression check). */
function extractSourceLines(html: string): string[] {
  const out: string[] = [];
  const re = /data-source-line="(\d+)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) out.push(m[1]!);
  return out;
}

// ── generic-constructs corpus (headings, paragraphs, nesting, fence, table,
//    footnote, attrs, typographer) ─────────────────────────────────────────

function buildGenericCorpus(): CorpusBuilder {
  const c = new CorpusBuilder();
  c.seg("heading", "# Chapter One").blank();
  c.seg(
    "paragraph",
    "This is a paragraph with *emphasis* and a footnote reference[^n1]."
  ).blank();
  c.seg(
    "blockquoteList",
    "> A quoted list:",
    ">",
    "> - first item",
    "> - second item"
  ).blank();
  c.seg("fence", "```js", "const x = 1;", "```").blank();
  c.seg("table", "| A | B |", "|---|---|", "| 1 | 2 |").blank();
  c.seg("footnoteDef", "[^n1]: The footnote definition.").blank();
  c.seg("attrsParagraph", "Styled paragraph. {.foo #bar}").blank();
  c.seg("typographerParagraph", '"Quoted" text -- with a dash... more.').blank();
  return c;
}

describe("source_range: generic markdown constructs", () => {
  const md = createMarkdownRenderer();
  const corpus = buildGenericCorpus();
  const src = corpus.build();
  const html = md.render(src, {});

  test("heading: range matches and charRange reproduces exact source", () => {
    const seg = corpus.segments.heading!;
    expect(html).toContain(`<h1 ${SOURCE_RANGE_ATTR}="${seg.start}:${seg.end}"`);
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [seg.start, seg.end]);
    expect(src.slice(from, to)).toBe(corpus.text("heading"));
  });

  test("paragraph: range matches and charRange reproduces exact source", () => {
    const seg = corpus.segments.paragraph!;
    expect(html).toContain(`<p ${SOURCE_RANGE_ATTR}="${seg.start}:${seg.end}"`);
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [seg.start, seg.end]);
    expect(src.slice(from, to)).toBe(corpus.text("paragraph"));
  });

  test("nested blockquote > list: the WRAPPER range covers the whole segment", () => {
    const seg = corpus.segments.blockquoteList!;
    expect(html).toContain(`<blockquote ${SOURCE_RANGE_ATTR}="${seg.start}:${seg.end}"`);
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [seg.start, seg.end]);
    expect(src.slice(from, to)).toBe(corpus.text("blockquoteList"));
  });

  test("nested blockquote > list: the LAST list item's own sub-range reproduces just its own (blockquote-prefixed) line — every nesting level, last item of a list", () => {
    const seg = corpus.segments.blockquoteList!;
    // "second item" is the segment's 4th line (0-based offset 3 within the segment).
    const lastItemStart = seg.start + 3;
    const lastItemEnd = seg.start + 4;
    expect(html).toContain(
      `<li ${SOURCE_RANGE_ATTR}="${lastItemStart}:${lastItemEnd}">second item</li>`
    );
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [lastItemStart, lastItemEnd]);
    // The raw source line retains its blockquote-marker prefix — token.map
    // indexes the ORIGINAL document, not a stripped per-container view.
    expect(src.slice(from, to)).toBe("> - second item\n");
  });

  test("fence: data-source-range lands on <code> (NOT <pre> — gotcha §2.6), and reproduces the whole fenced block INCLUDING the closing fence line", () => {
    const seg = corpus.segments.fence!;
    expect(html).toContain(`<pre><code ${SOURCE_RANGE_ATTR}="${seg.start}:${seg.end}"`);
    // Confirm it is NOT on <pre>.
    expect(html).not.toMatch(new RegExp(`<pre ${SOURCE_RANGE_ATTR}`));
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [seg.start, seg.end]);
    expect(src.slice(from, to)).toBe(corpus.text("fence"));
  });

  test("table: rows (<tr>, <thead>, <tbody>) get ranges; cells (<th>/<td>) do NOT (markdown-it never sets token.map on cells)", () => {
    const seg = corpus.segments.table!;
    expect(html).toContain(`<table ${SOURCE_RANGE_ATTR}="${seg.start}:${seg.end}"`);
    expect(html).toContain(`<tr ${SOURCE_RANGE_ATTR}=`);
    expect(html).not.toMatch(new RegExp(`<t[hd] ${SOURCE_RANGE_ATTR}`));
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [seg.start, seg.end]);
    expect(src.slice(from, to)).toBe(corpus.text("table"));
  });

  test("footnote definition: retains its TRUE source range after footnote_tail relocates it to the document end", () => {
    const seg = corpus.segments.footnoteDef!;
    expect(html).toContain(`<p ${SOURCE_RANGE_ATTR}="${seg.start}:${seg.end}"`);
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [seg.start, seg.end]);
    // Reproduces the RAW definition line, including the "[^n1]: " marker —
    // the rendered <li> body never contains that marker text, proving the
    // range is against SOURCE, not rendered output.
    expect(src.slice(from, to)).toBe(corpus.text("footnoteDef"));
    expect(src.slice(from, to)).toContain("[^n1]:");
  });

  test("markdown-it-attrs syntax: data-source-range coexists with attrs-plugin class/id, and reproduces the source line VERBATIM (including the {.foo #bar} suffix)", () => {
    const seg = corpus.segments.attrsParagraph!;
    expect(html).toContain(
      `<p class="foo" id="bar" ${SOURCE_RANGE_ATTR}="${seg.start}:${seg.end}"`
    );
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [seg.start, seg.end]);
    expect(src.slice(from, to)).toBe(corpus.text("attrsParagraph"));
  });

  test("typographer punctuation: charRange reproduces the RAW (pre-conversion) source, not the rendered smart-quoted/en-dash text", () => {
    const seg = corpus.segments.typographerParagraph!;
    expect(html).toContain(`<p ${SOURCE_RANGE_ATTR}="${seg.start}:${seg.end}"`);
    // The RENDERED text is typographically converted…
    expect(html).toContain("“Quoted” text – with a dash… more.");
    // …but the range must resolve against the ORIGINAL, un-converted source.
    const starts = buildLineStarts(src);
    const [from, to] = charRange(src, starts, [seg.start, seg.end]);
    expect(src.slice(from, to)).toBe(corpus.text("typographerParagraph"));
    expect(src.slice(from, to)).toBe('"Quoted" text -- with a dash... more.\n');
  });
});

// ── negative fixture: raw html_block ─────────────────────────────────────────

describe("source_range: negative fixture (§2.6 deliberate gap)", () => {
  test("raw html_block output carries NO data-source-range (markdown-it's html_block renderer discards token.attrs)", () => {
    const md = createMarkdownRenderer();
    const src = "Para.\n\n<div>raw html</div>\n\nAfter.\n";
    const html = md.render(src, {});
    // The surrounding paragraphs DO get annotated…
    expect(html).toContain(`<p ${SOURCE_RANGE_ATTR}="0:1"`);
    expect(html).toContain(`<p ${SOURCE_RANGE_ATTR}="4:5"`);
    // …but the raw HTML block itself never does, anywhere in the document.
    expect(html).toContain("<div>raw html</div>");
    expect(html).not.toMatch(new RegExp(`<div[^>]*${SOURCE_RANGE_ATTR}[^>]*>raw html`));
  });
});

// ── layout markers (@section / @continue / @page-break) ─────────────────────

describe("source_range: layout markers", () => {
  test("preview chapter identity survives custom layout-marker renderers", () => {
    const md = createMarkdownRenderer();
    const html = md.render(
      "@section .gp-columns-2\nA\n@column-break\nB\n@end-section\n@page-break\n",
      { sourceChapter: "chapters/a.md" },
    );

    expect(html).toMatch(/class="section gp-columns-2"[^>]*data-chapter-src="chapters\/a\.md"/);
    expect(html).toMatch(/class="gp-page-break"[^>]*data-chapter-src="chapters\/a\.md"/);
  });

  test("@chapter / @page / @section / @continue / @page-break all get single-line ranges that reproduce their exact marker line", () => {
    const md = createMarkdownRenderer();
    const src =
      "@chapter C\n@page\n@section S\nA\n@continue\nB\n@end-section\n@page-break\nC\n";
    const html = md.render(src, {});
    const starts = buildLineStarts(src);

    // line 0: "@chapter C" -> chapter wrapper range [0,1)
    expect(html).toContain(`<div class="chapter" data-chapter-label="C" ${SOURCE_RANGE_ATTR}="0:1"`);
    // line 1: "@page" -> page wrapper range [1,2)
    expect(html).toContain(`${SOURCE_RANGE_ATTR}="1:2"`);
    // line 2: "@section S" -> section wrapper range [2,3)
    expect(html).toContain(`<div class="section" data-section="S" ${SOURCE_RANGE_ATTR}="2:3"`);
    // line 4: "@continue" -> continuation section's OWN line is 4, and it
    // gets a FINITE range (the §2.1 @continue fix)
    expect(html).toContain(
      `<div class="section gp-continued" data-section="S" ${SOURCE_RANGE_ATTR}="4:5"`
    );
    // line 7: "@page-break" -> break div range [7,8) — proves the renderer
    // rule fix (markers.js) actually emits the attribute a custom
    // renderer rule would otherwise silently drop.
    expect(html).toContain(`class="gp-page-break" aria-hidden="true" ${SOURCE_RANGE_ATTR}="7:8"`);

    const [from, to] = charRange(src, starts, [7, 8]);
    expect(src.slice(from, to)).toBe("@page-break\n");
  });

  test("a block immediately followed by an @marker line: the block's range ends exactly where the marker begins", () => {
    const md = createMarkdownRenderer();
    const src = "Some text\n@page-break\n";
    const html = md.render(src, {});
    const starts = buildLineStarts(src);

    expect(html).toContain(`<p ${SOURCE_RANGE_ATTR}="0:1"`);
    const [from, to] = charRange(src, starts, [0, 1]);
    // Reproduces ONLY the paragraph's own text — not the marker line.
    expect(src.slice(from, to)).toBe("Some text\n");

    expect(html).toContain(`${SOURCE_RANGE_ATTR}="1:2"`);
    const [mFrom, mTo] = charRange(src, starts, [1, 2]);
    expect(src.slice(mFrom, mTo)).toBe("@page-break\n");
  });
});

// ── last block with no trailing newline ──────────────────────────────────────

describe("source_range: file whose last block has no trailing newline", () => {
  test("charRange clamps `to` at text.length instead of indexing out of bounds", () => {
    const md = createMarkdownRenderer();
    const src = "First line.\n\nLast line, no trailing newline";
    const html = md.render(src, {});
    const starts = buildLineStarts(src);

    expect(html).toContain(`<p ${SOURCE_RANGE_ATTR}="2:3"`);
    const [from, to] = charRange(src, starts, [2, 3]);
    expect(to).toBe(src.length);
    expect(src.slice(from, to)).toBe("Last line, no trailing newline");
  });
});

// ── LF / CRLF / lone-CR round-trip ───────────────────────────────────────────

describe("source_range: LF / CRLF / lone-CR line-ending invariance", () => {
  const md = createMarkdownRenderer();
  const corpus = buildGenericCorpus();
  const srcLF = corpus.build();
  const htmlLF = md.render(srcLF, {});
  const rangesLF = extractSourceRanges(htmlLF);

  test("CRLF corpus renders the SAME data-source-range line indices as LF (line-based indexing is EOL-invariant)", () => {
    const srcCRLF = srcLF.replace(/\n/g, "\r\n");
    const htmlCRLF = md.render(srcCRLF, {});
    expect(extractSourceRanges(htmlCRLF)).toEqual(rangesLF);
  });

  test("lone-CR corpus renders the SAME data-source-range line indices as LF", () => {
    const srcCR = srcLF.replace(/\n/g, "\r");
    const htmlCR = md.render(srcCR, {});
    expect(extractSourceRanges(htmlCR)).toEqual(rangesLF);
  });

  for (const [label, eol] of [
    ["CRLF", "\r\n"],
    ["lone-CR", "\r"],
  ] as const) {
    test(`${label}: charRange against a ${label}-line-ended buffer reproduces the exact (${label}-ended) block source for heading/paragraph/last-list-item/fence/footnote`, () => {
      const src = srcLF.replace(/\n/g, eol);
      const starts = buildLineStarts(src);

      const check = (segName: string) => {
        const seg = corpus.segments[segName]!;
        const [from, to] = charRange(src, starts, [seg.start, seg.end]);
        expect(src.slice(from, to)).toBe(corpus.text(segName, eol));
      };

      check("heading");
      check("paragraph");
      check("fence");
      check("footnoteDef");

      // Last list item, using the same blockquote-relative offset as above.
      const bq = corpus.segments.blockquoteList!;
      const [from, to] = charRange(src, starts, [bq.start + 3, bq.start + 4]);
      expect(src.slice(from, to)).toBe(`> - second item${eol}`);
    });
  }
});

// ── data-source-line regression: coverage must be byte-for-byte unchanged ───

describe("source_range: data-source-line regression (must NOT change)", () => {
  test("the ordered list of data-source-line values is IDENTICAL with and without the source_range rule", () => {
    const corpus = buildGenericCorpus();
    corpus.push("@chapter C").push("@page").seg("section", "@section S", "In a section.").push("@end-section");
    const src = corpus.build();

    // "after": the real pipeline, source_range rule included.
    const mdAfter = createMarkdownRenderer();
    const htmlAfter = mdAfter.render(src, {});

    // "before": the identical pipeline MINUS the source_range rule — a
    // faithful mirror of renderer.ts's md.use() sequence, built directly so
    // this test doesn't depend on git history to prove the rule is additive.
    // markdown-it-source-map's data-source-line stamping is a renderToken
    // monkeypatch keyed on token.map/level — our rule only ever ADDS
    // token.attrs (data-source-range) and never touches token.map, so this
    // comparison is expected to hold by construction; this test locks that
    // guarantee in as a regression net, per plan §2.5.
    const mdBefore = new MarkdownIt({ html: true, linkify: true, typographer: true });
    mdBefore.use(markdownItAttrs);
    mdBefore.use(markdownItFootnote);
    mdBefore.use(markdownItDeflist);
    mdBefore.use(markdownItSourceMap);
    mdBefore.use(markerPlugin);
    registerImageRule(mdBefore);
    // NOTE: no `source_range` rule pushed here — this IS the "before" state.

    const htmlBefore = mdBefore.render(src, {});

    const linesBefore = extractSourceLines(htmlBefore);
    const linesAfter = extractSourceLines(htmlAfter);

    expect(linesBefore.length).toBeGreaterThan(0);
    expect(linesAfter).toEqual(linesBefore);
  });
});
