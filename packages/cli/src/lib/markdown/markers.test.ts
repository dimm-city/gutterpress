/**
 * Characterization test net for `markdown-it-paged.js`.
 *
 * Goal: pin the CURRENT observable behavior of the plugin so precisely that a
 * future refactor of the `layout_transform` scope state machine (e.g.
 * chapter/spread/page/section booleans -> an explicit stack) cannot change
 * behavior without a test failing here. This file is a SAFETY NET, not a bug
 * hunt — every assertion below matches what the implementation does today,
 * including a couple of surprising corners (documented inline) that look like
 * they *could* be bugs but are deliberately locked as-is.
 *
 * `parseMarkerLine` is a module-private function (not exported), so its
 * grammar is characterized indirectly through rendered output + the emitted
 * `data-*`/`class`/`id` attributes and `env.layoutWarnings` entries — exactly
 * the same surface real callers (`renderer.ts` -> `createMarkdownRenderer`)
 * observe. This mirrors how the plugin is actually invoked in production: a
 * bare `markdown-it` instance with the plugin applied, rendered with an `env`
 * object to capture warnings.
 */
import { describe, test, expect } from "bun:test";
import MarkdownIt from "markdown-it";
import markdownItPaged, { MARKER_CSS } from "./markers.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { createMarkdownRenderer } from "./renderer";
import { assembleBookHtml } from "./assemble";

interface LayoutWarning {
  line: number;
  type: string;
  message: string;
  marker: unknown;
}

interface PagedEnv {
  layoutWarnings?: LayoutWarning[];
  __colSplitDepth?: number;
  __layoutMarkersUsed?: boolean;
  [key: string]: unknown;
}

/** Render markdown through a bare MarkdownIt + markdown-it-paged instance. */
function renderPaged(
  src: string,
  options: Record<string, unknown> = {},
  env: PagedEnv = {}
): { html: string; env: PagedEnv } {
  const md = new MarkdownIt({ html: true });
  md.use(markdownItPaged, options);
  const html = md.render(src, env);
  return { html, env };
}

/**
 * Parse (not render) markdown through a bare MarkdownIt + markdown-it-paged
 * instance, for tests that inspect `token.meta` directly (source-line
 * threading — §2.1 of docs/inline-editing-plan.md) rather than rendered HTML.
 */
function parsePaged(
  src: string,
  options: Record<string, unknown> = {},
  env: PagedEnv = {}
): { tokens: import("markdown-it/lib/token.mjs").default[]; env: PagedEnv } {
  const md = new MarkdownIt({ html: true });
  md.use(markdownItPaged, options);
  const tokens = md.parse(src, env);
  return { tokens, env };
}

/** First token of a given `type` in a token array, or undefined. */
function findToken(
  tokens: import("markdown-it/lib/token.mjs").default[],
  type: string
) {
  return tokens.find((t) => t.type === type);
}

/** All tokens of a given `type` in a token array, in document order. */
function findTokens(
  tokens: import("markdown-it/lib/token.mjs").default[],
  type: string
) {
  return tokens.filter((t) => t.type === type);
}

/** Extract the value of one HTML attribute from a single opening tag string. */
function attr(html: string, name: string): string | null {
  const m = html.match(new RegExp(`${name}="([^"]*)"`));
  return m ? m[1]! : null;
}

/** Split a rendered `class="..."` attribute into its individual tokens. */
function classList(html: string, name = "class"): string[] {
  const v = attr(html, name);
  return v ? v.split(/\s+/).filter(Boolean) : [];
}

describe("token.meta.line threading (source-range primitive, plan §2.1)", () => {
  test("layout_chapter_open carries the 1-based marker line, and token.map stays null", () => {
    const { tokens } = parsePaged("Intro\n\n@chapter C.01\nHi\n");
    const t = findToken(tokens, "layout_chapter_open")!;
    expect(t.meta).toEqual({ line: 3 });
    // Do NOT set token.map here — see the inline comment at the assignment
    // site (markdown-it-paged.js) and ADR 0009: setting map would make
    // markdown-it-source-map stamp data-source-line on this wrapper too,
    // breaking preview scroll-sync's rect tie-break.
    expect(t.map).toBeNull();
  });

  test("layout_spread_open carries the 1-based marker line", () => {
    const { tokens } = parsePaged("@spread\nHi\n");
    const t = findToken(tokens, "layout_spread_open")!;
    expect(t.meta).toEqual({ line: 1 });
    expect(t.map).toBeNull();
  });

  test("layout_page_open carries the 1-based marker line", () => {
    const { tokens } = parsePaged("@chapter\n@page MyPage\nHi\n");
    const t = findToken(tokens, "layout_page_open")!;
    expect(t.meta.line).toBe(2);
    expect(t.map).toBeNull();
  });

  test("layout_section_open carries the marker line, and nothing else", () => {
    const { tokens } = parsePaged("@page\n@section S\nHi\n");
    const t = findToken(tokens, "layout_section_open")!;
    // `hasColumnBreak` was precomputed here for the removed .col-split
    // renderer branch; `line` is the only per-token guidance left.
    expect(t.meta).toEqual({ line: 2 });
    expect(t.map).toBeNull();
  });

  test("layout_page_break carries the marker line", () => {
    const { tokens } = parsePaged("A\n\n@page-break\n\nB\n");
    const t = findToken(tokens, "layout_page_break")!;
    expect(t.meta).toEqual({ line: 3 });
    expect(t.map).toBeNull();
  });

  test("layout_column_break carries the marker line", () => {
    const { tokens } = parsePaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    );
    const t = findToken(tokens, "layout_column_break")!;
    expect(t.meta).toEqual({ line: 3 });
    expect(t.map).toBeNull();
  });

  test("@continue fix: the continuation section gets a FINITE meta.line (regression test for the dropped-__line bug)", () => {
    const { tokens } = parsePaged(
      "@section S\nA\n@continue\nB\n@end-section\n"
    );
    const sections = findTokens(tokens, "layout_section_open");
    expect(sections).toHaveLength(2);
    const [original, continuation] = sections;
    // original @section is on line 1
    expect(original!.meta.line).toBe(1);
    // @continue itself is on line 3 — the continuation section must inherit
    // THAT line, not undefined/NaN (contMeta only copied name/attrs before
    // the fix, silently dropping __line).
    expect(continuation!.meta.line).toBe(3);
    expect(Number.isFinite(continuation!.meta.line)).toBe(true);
  });

  test("@continue chained twice: every continuation section gets its own finite line", () => {
    const { tokens } = parsePaged(
      "@section S\nA\n@continue\nB\n@continue\nC\n@end-section\n"
    );
    const sections = findTokens(tokens, "layout_section_open");
    expect(sections.map((t) => t.meta.line)).toEqual([1, 3, 5]);
  });
});

describe("marker grammar (parsed via rendered output + warnings)", () => {
  describe("bare markers (no name, no attrs)", () => {
    test("@chapter", () => {
      const { html } = renderPaged("@chapter\nHi\n");
      expect(html).toBe('<div class="chapter"><p>Hi</p>\n</div>');
    });

    test("@spread", () => {
      const { html } = renderPaged("@spread\nHi\n");
      expect(html).toBe('<div class="spread"><p>Hi</p>\n</div>');
    });

    test("@page", () => {
      const { html } = renderPaged("@page\nHi\n");
      expect(html).toBe('<div class="page"><p>Hi</p>\n</div>');
    });

    test("@section (standalone) renders unwrapped and warns about nothing", () => {
      // A section with no open @page is valid authoring — audited across two
      // real books, all 17 occurrences were `@section .gp-columns-2` layout
      // wrappers that rendered correctly. See the @section branch in
      // markers.js for why the warning (and `implicitPage`) were removed.
      const { html, env } = renderPaged("@section\nHi\n");
      expect(html).toBe('<div class="section"><p>Hi</p>\n</div>');
      expect(env.layoutWarnings ?? []).toEqual([]);
    });
  });

  describe("bare name", () => {
    test("@chapter <name> -> data-chapter-label", () => {
      const { html } = renderPaged("@chapter C.01\nHi\n");
      expect(html).toBe(
        '<div class="chapter" data-chapter-label="C.01"><p>Hi</p>\n</div>'
      );
    });

    test("@spread <name> -> data-spread", () => {
      const { html } = renderPaged("@spread MySpread\nHi\n");
      expect(html).toBe(
        '<div class="spread" data-spread="MySpread"><p>Hi</p>\n</div>'
      );
    });

    test("@page <name> -> data-page", () => {
      const { html } = renderPaged("@page MyPage\nHi\n");
      expect(html).toBe('<div class="page" data-page="MyPage"><p>Hi</p>\n</div>');
    });

    test("@section <name> -> data-section (still warns, no open page)", () => {
      const { html, env } = renderPaged("@section MySection\nHi\n");
      expect(html).toBe(
        '<div class="section" data-section="MySection"><p>Hi</p>\n</div>'
      );
      expect(env.layoutWarnings ?? []).toEqual([]);
    });
  });

  describe("shorthand class / id tokens", () => {
    test("single .class", () => {
      const { html } = renderPaged("@page .cover\nHi\n");
      expect(classList(html)).toEqual(["page", "cover"]);
    });

    test("multiple .class tokens, in order", () => {
      const { html } = renderPaged("@page .a .b .c\nHi\n");
      expect(classList(html)).toEqual(["page", "a", "b", "c"]);
    });

    test("#id shorthand", () => {
      const { html } = renderPaged("@page #my-id\nHi\n");
      expect(attr(html, "id")).toBe("my-id");
      expect(html).toBe('<div class="page" id="my-id"><p>Hi</p>\n</div>');
    });

    test("empty .class token (bare dot) is ignored", () => {
      const { html } = renderPaged("@page .\nHi\n");
      expect(html).toBe('<div class="page"><p>Hi</p>\n</div>');
    });

    test("empty #id token (bare hash) is ignored", () => {
      const { html } = renderPaged("@page #\nHi\n");
      expect(html).toBe('<div class="page"><p>Hi</p>\n</div>');
    });
  });

  describe("key=value attrs", () => {
    test("unquoted key=value -> data-<key>", () => {
      const { html } = renderPaged("@page template=cover\nHi\n");
      expect(attr(html, "data-template")).toBe("cover");
    });

    test("double-quoted key=\"value with spaces\"", () => {
      const { html } = renderPaged('@page title="Hello World"\nHi\n');
      expect(attr(html, "data-title")).toBe("Hello World");
    });

    test("single-quoted key='value with spaces'", () => {
      const { html } = renderPaged("@page title='Hello World'\nHi\n");
      expect(attr(html, "data-title")).toBe("Hello World");
    });

    test("unterminated quote absorbs rest of the line into one token", () => {
      const { html } = renderPaged('@page title="unterminated\nHi\n');
      // The quote is never closed, so parsing runs to end-of-line and the
      // partial token (without the closing quote) becomes the value.
      expect(attr(html, "data-title")).toBe("unterminated");
    });

    test("empty key=value (no value) produces no visible data attribute", () => {
      const { html } = renderPaged("@page key=\nHi\n");
      // attrs.key = '' is set internally, but attachDataAttrs skips falsy
      // values (`if (!v) continue;`), so nothing is emitted for it.
      expect(html).toBe('<div class="page"><p>Hi</p>\n</div>');
    });

    test("key=value where key is 'id' behaves the same as #id shorthand", () => {
      const { html } = renderPaged("@page id=explicit-id\nHi\n");
      expect(html).toBe('<div class="page" id="explicit-id"><p>Hi</p>\n</div>');
    });

    test("class=foo,bar (comma-separated) merges into the class list", () => {
      const { html } = renderPaged("@page class=foo,bar\nHi\n");
      expect(classList(html)).toEqual(["page", "foo", "bar"]);
    });

    test("class=foo bar (space-separated) splits into TWO tokens at the tokenizer level: 'class=foo' contributes only 'foo' to the class list, and the trailing bare 'bar' is picked up as the marker's NAME instead of a class", () => {
      // Surprising but current: whitespace-splitting happens before key=value
      // parsing, so a space inside an unquoted class=... value does not
      // extend the value — it starts a new bare token, which then wins the
      // "single bare token" name-detection rule.
      const { html, env } = renderPaged("@page class=foo bar\nHi\n");
      expect(classList(html)).toEqual(["page", "foo"]);
      expect(attr(html, "data-page")).toBe("bar");
      expect(env.layoutWarnings).toEqual([
        {
          line: 1,
          type: "ambiguous_marker_token",
          message:
            "A bare marker token after a key=value attribute is being interpreted as the marker name (or an extra class). Use comma-separated classes (class=a,b) or .class shorthand instead.",
          marker: { kind: "page", name: "bar", attrs: { class: "foo" }, __line: 1 },
        },
      ]);
    });

    test("an ambiguous marker interrupting a paragraph warns exactly once (silent terminator probes must not duplicate the warning)", () => {
      // markerBlock is registered as a paragraph terminator (alt:
      // ['paragraph', ...]), so markdown-it probes it in silent mode while
      // scanning paragraph lines. The warning must only fire when the token
      // is actually committed, not on every probe.
      const { env } = renderPaged("Some paragraph text\n@page class=foo bar\nHi\n");
      expect(env.layoutWarnings).toHaveLength(1);
      expect(env.layoutWarnings![0]).toMatchObject({
        line: 2,
        type: "ambiguous_marker_token",
      });
    });

    test("a bare token after key=value warns even when the name slot is already taken (token becomes a class)", () => {
      const { html, env } = renderPaged("@page cover class=a bar\nHi\n");
      expect(attr(html, "data-page")).toBe("cover");
      expect(classList(html)).toEqual(["page", "a", "bar"]);
      expect(env.layoutWarnings).toHaveLength(1);
      expect(env.layoutWarnings![0]).toMatchObject({ type: "ambiguous_marker_token" });
    });

    test(".class token and class=... key both contribute, dot-token first", () => {
      const { html } = renderPaged("@page .a class=b,c\nHi\n");
      expect(classList(html)).toEqual(["page", "a", "b", "c"]);
    });

    test("region= sets data-region (special-cased, still an attr)", () => {
      const { html } = renderPaged("@section region=aside\nHi\n");
      expect(attr(html, "data-region")).toBe("aside");
    });

    test("template= sets data-template (special-cased, still an attr)", () => {
      const { html } = renderPaged("@page template=cover\nHi\n");
      expect(attr(html, "data-template")).toBe("cover");
    });
  });

  describe("combinations", () => {
    test("name + key=value + #id + classes, in that source order", () => {
      const { html } = renderPaged(
        "@page Cover key=val #the-id .cls1 .cls2\nHi\n"
      );
      // Exact serialization order is a real characterization point: class is
      // set first (openPage's addClasses call happens before
      // attachDataAttrs), then data-page (name), then id, then the leftover
      // generic data-key attr in source-token order.
      expect(html).toBe(
        '<div class="page cls1 cls2" data-page="Cover" id="the-id" data-key="val"><p>Hi</p>\n</div>'
      );
    });

    test("@chapter: name + ch= attr + .class + #id + extra class", () => {
      const { html } = renderPaged(
        "@chapter C.01 ch=2 .extra #cid\n@page\nHi\n"
      );
      expect(html).toBe(
        '<div class="chapter extra" data-chapter-label="C.01" id="cid" data-ch="2">' +
          '<div class="page chapter-2" data-chapter-label="C.01">' +
          '<div class="chapter-opener" data-chapter-label="C.01">C.01</div>\n' +
          "<p>Hi</p>\n</div></div>"
      );
    });
  });

  describe("bare-token edge cases", () => {
    test("two bare tokens with no attrs: only the FIRST becomes the name candidate check, but since there is no explicit attr/shorthand and bareTokens.length !== 1, NEITHER becomes the name — both fall through to classes", () => {
      const { html } = renderPaged("@page name1 name2\nHi\n");
      expect(attr(html, "data-page")).toBeNull();
      expect(classList(html)).toEqual(["page", "name1", "name2"]);
    });

    test("a single bare token with no other attrs/shorthand IS treated as the name", () => {
      const { html } = renderPaged("@page onlybare\nHi\n");
      expect(attr(html, "data-page")).toBe("onlybare");
      expect(classList(html)).toEqual(["page"]);
    });

    test("a single bare token PLUS explicit attrs/shorthand is treated as the name too", () => {
      const { html } = renderPaged("@page onlybare .extra\nHi\n");
      expect(attr(html, "data-page")).toBe("onlybare");
      expect(classList(html)).toEqual(["page", "extra"]);
    });
  });

  describe("non-markers and malformed input", () => {
    test("line without a leading '@' is not a marker", () => {
      const { html } = renderPaged("page\nHi\n");
      expect(html).toBe("<p>page\nHi</p>\n");
    });

    test("unknown marker kind is not a marker (falls through to paragraph text)", () => {
      const { html } = renderPaged("@foobar\nHi\n");
      expect(html).toBe("<p>@foobar\nHi</p>\n");
    });

    test("bare '@' with nothing after it is not a marker", () => {
      const { html } = renderPaged("@\nHi\n");
      expect(html).toBe("<p>@\nHi</p>\n");
    });

    test("leading/trailing whitespace around the marker line is trimmed", () => {
      const { html } = renderPaged("   @page   \nHi\n");
      expect(html).toBe('<div class="page"><p>Hi</p>\n</div>');
    });
  });

  describe("kinds with no body (attrs/name always ignored)", () => {
    test("@continue, @end-section, @page-break, @column-break ignore any trailing tokens", () => {
      const pageBreak = renderPaged(
        "@page-break trailing tokens ignored .foo #bar\nHi\n"
      ).html;
      expect(pageBreak).toBe(
        '<div class="gp-page-break" aria-hidden="true"></div>\n<p>Hi</p>\n'
      );

      const columnBreak = renderPaged("@column-break .foo #bar\nHi\n").html;
      expect(columnBreak).toBe(
        '<div class="gp-column-break" aria-hidden="true"></div>\n<p>Hi</p>\n'
      );

      const endSection = renderPaged("@end-section .foo #bar\nHi\n").html;
      expect(endSection).toBe("<p>Hi</p>\n");
    });
  });
});

describe("single markers -> HTML wrapper", () => {
  test("@chapter wraps content in div.chapter", () => {
    const { html } = renderPaged("@chapter\nHello\n");
    expect(html).toBe('<div class="chapter"><p>Hello</p>\n</div>');
  });

  test("@spread wraps content in div.spread", () => {
    const { html } = renderPaged("@spread\nHello\n");
    expect(html).toBe('<div class="spread"><p>Hello</p>\n</div>');
  });

  test("@page wraps content in div.page", () => {
    const { html } = renderPaged("@page\nHello\n");
    expect(html).toBe('<div class="page"><p>Hello</p>\n</div>');
  });

  test("@section wraps content in div.section, no page required", () => {
    const { html, env } = renderPaged("@section\nHello\n");
    expect(html).toBe('<div class="section"><p>Hello</p>\n</div>');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });
});

describe("nesting: chapter > spread > page > section", () => {
  test("full nesting closes innermost-first, in reverse open order", () => {
    const { html, env } = renderPaged(
      "@chapter C.01\n@spread\n@page\n@section\nBody\n"
    );
    expect(html).toBe(
      '<div class="chapter" data-chapter-label="C.01">' +
        '<div class="spread">' +
        '<div class="page" data-chapter-label="C.01">' +
        '<div class="chapter-opener" data-chapter-label="C.01">C.01</div>\n' +
        '<div class="section"><p>Body</p>\n</div>' +
        "</div></div></div>"
    );
    // Fully nested inside a page: no section_without_page/spread_without_pages
    // warnings, only the natural EOF close is silent here because the spread
    // did see a page.
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("spread containing two pages, each with a section", () => {
    const { html } = renderPaged(
      "@spread\n@page\n@section\nA\n@page\n@section\nB\n"
    );
    expect(html).toBe(
      '<div class="spread">' +
        '<div class="page"><div class="section"><p>A</p>\n</div></div>' +
        '<div class="page"><div class="section"><p>B</p>\n</div></div>' +
        "</div>"
    );
  });

  test("chapter containing two spreads, back to back", () => {
    const { html, env } = renderPaged(
      "@chapter\n@spread\n@page\nA\n@spread\n@page\nB\n"
    );
    // The second @spread auto-closes the first (with a nested_spread warning)
    // because a chapter does not itself count as a "page" for spread purposes.
    expect(html).toBe(
      '<div class="chapter">' +
        '<div class="spread"><div class="page"><p>A</p>\n</div></div>' +
        '<div class="spread"><div class="page"><p>B</p>\n</div></div>' +
        "</div>"
    );
    expect(env.layoutWarnings?.map((w) => w.type)).toEqual(["nested_spread"]);
  });

  test("page closes an already-open page automatically (no warning)", () => {
    const { html, env } = renderPaged("@page\nA\n@page\nB\n");
    expect(html).toBe(
      '<div class="page"><p>A</p>\n</div><div class="page"><p>B</p>\n</div>'
    );
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("a new @page closes a still-open @section from the previous page", () => {
    const { html } = renderPaged("@page\n@section\nA\n@page\nB\n");
    expect(html).toBe(
      '<div class="page"><div class="section"><p>A</p>\n</div></div>' +
        '<div class="page"><p>B</p>\n</div>'
    );
  });
});

describe("auto-close at end-of-document (scope-leak prevention)", () => {
  test("everything left open (chapter>spread>page>section) closes cleanly with no warnings", () => {
    const { html, env } = renderPaged("@chapter C\n@spread\n@page\n@section\nHi\n");
    expect(html).toBe(
      '<div class="chapter" data-chapter-label="C">' +
        '<div class="spread">' +
        '<div class="page" data-chapter-label="C">' +
        '<div class="chapter-opener" data-chapter-label="C">C</div>\n' +
        '<div class="section"><p>Hi</p>\n</div>' +
        "</div></div></div>"
    );
    // The spread DID see a page before EOF, so no spread_eof_close warning.
    expect(env.layoutWarnings).toBeUndefined();
    // Balanced: every opening div has a matching closing div.
    expect((html.match(/<div/g) || []).length).toBe(
      (html.match(/<\/div>/g) || []).length
    );
  });

  test("an open @page (no chapter/spread) closes at EOF with no warning", () => {
    const { html } = renderPaged("@page\nHi\n");
    expect(html).toBe('<div class="page"><p>Hi</p>\n</div>');
  });

  test("an open @spread that never saw a @page warns spread_eof_close", () => {
    const { html, env } = renderPaged("@spread\nHi\n");
    expect(html).toBe('<div class="spread"><p>Hi</p>\n</div>');
    expect(env.layoutWarnings).toEqual([
      {
        line: 0,
        type: "spread_eof_close",
        message:
          "An open @spread reached end-of-document; closing it automatically.",
        marker: null,
      },
    ]);
  });

  test("an open @spread that DID see a @page does not warn at EOF", () => {
    const { html, env } = renderPaged("@spread\n@page\nHi\n");
    expect(html).toBe('<div class="spread"><div class="page"><p>Hi</p>\n</div></div>');
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("two chapters in one document do not leak scope into each other", () => {
    const { html } = renderPaged(
      "@chapter A\n@page\nP1\n@chapter B\n@page\nP2\n"
    );
    expect(html).toBe(
      '<div class="chapter" data-chapter-label="A">' +
        '<div class="page" data-chapter-label="A">' +
        '<div class="chapter-opener" data-chapter-label="A">A</div>\n<p>P1</p>\n' +
        "</div></div>" +
        '<div class="chapter" data-chapter-label="B">' +
        '<div class="page" data-chapter-label="B">' +
        '<div class="chapter-opener" data-chapter-label="B">B</div>\n<p>P2</p>\n' +
        "</div></div>"
    );
  });
});

describe("mis-ordered markers, implicit wrapping, and warnings", () => {
  // AUDITED 2026-08-12 and settled: a @section with no open @page is valid
  // authoring. All 17 occurrences across two real books were
  // `@section .gp-columns-2` — column runs used as layout wrappers around
  // flowing prose. None rendered wrong; none used .gp-pin. The warning was
  // 17-for-17 false positives, and the `implicitPage` option that would have
  // wrapped them was unreachable (settable from no manifest key or CLI flag)
  // AND latently broken (`.page { break-before: page }` applies to the
  // synthetic wrapper, so enabling it inserted a page break before every
  // stray section). Both removed. The one real harm — a .gp-pin with no
  // containing block — has its own precise diagnostic in gp-pin-scope.js.
  test("@section without an open @page: no warning, section left unwrapped", () => {
    const { html, env } = renderPaged("@section\nHi\n");
    expect(html).toBe('<div class="section"><p>Hi</p>\n</div>');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });

  test("no synthetic page wrapper is ever produced for a stray @section", () => {
    // Pins the removal itself: a previously-supported option could inject
    // `<div class="page" data-page="auto">` here. Nothing may do so now.
    const { html } = renderPaged("@section\nHi\n", { implicitPage: true });
    expect(html).not.toContain('data-page="auto"');
    expect(html).toBe('<div class="section"><p>Hi</p>\n</div>');
  });

  test("@spread while a spread is already open: auto-closes the previous one + nested_spread warning", () => {
    const { html, env } = renderPaged("@spread\n@page\nA\n@spread\n@page\nB\n");
    expect(html).toBe(
      '<div class="spread"><div class="page"><p>A</p>\n</div></div>' +
        '<div class="spread"><div class="page"><p>B</p>\n</div></div>'
    );
    expect(env.layoutWarnings).toEqual([
      {
        line: 4,
        type: "nested_spread",
        message:
          "@spread encountered while another spread is open; closing the previous spread automatically.",
        marker: { kind: "spread", name: null, attrs: {}, __line: 4 },
      },
    ]);
  });

  test("@page outside a spread is silent by default", () => {
    const { html, env } = renderPaged("@page\nA\n");
    expect(html).toBe('<div class="page"><p>A</p>\n</div>');
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("@page outside a spread warns page_outside_spread when preferPagesInSpreads is set", () => {
    const { html, env } = renderPaged("@page\nA\n", {
      preferPagesInSpreads: true,
    });
    expect(html).toBe('<div class="page"><p>A</p>\n</div>');
    expect(env.layoutWarnings).toEqual([
      {
        line: 1,
        type: "page_outside_spread",
        message:
          "@page used outside of a spread; allowed, but spreads are recommended for deliberate grouping.",
        marker: { kind: "page", name: null, attrs: {}, __line: 1 },
      },
    ]);
  });

  test("@section directly inside a spread with no @page: only the SPREAD warns", () => {
    // A spread genuinely needs pages — it is a two-page construct, so a
    // spread with no page is malformed. A bare section is not: that warning
    // was removed as a 17-for-17 false positive. The two were adjacent, so
    // this pins that removing one left the other intact.
    const { html, env } = renderPaged("@spread\n@section\nHi\n");
    expect(html).toBe(
      '<div class="spread"><div class="section"><p>Hi</p>\n</div></div>'
    );
    expect(env.layoutWarnings?.map((w) => w.type)).toEqual([
      "spread_without_pages",
      // The spread never saw a @page before EOF either.
      "spread_eof_close",
    ]);
  });

  test("@continue without an open @section is dropped with continue_without_section warning", () => {
    const { html, env } = renderPaged("@continue\nHi\n");
    expect(html).toBe("<p>Hi</p>\n");
    expect(env.layoutWarnings).toEqual([
      {
        line: 1,
        type: "continue_without_section",
        message: "@continue used without an open @section; ignoring marker.",
        marker: { kind: "continue", name: null, attrs: {}, __line: 1 },
      },
    ]);
  });

  test("@end-section with nothing open is a silent no-op", () => {
    const { html, env } = renderPaged("@end-section\nHi\n");
    expect(html).toBe("<p>Hi</p>\n");
    expect(env.layoutWarnings).toBeUndefined();
  });
});

describe("chapter label propagation to child @page elements", () => {
  test("every @page in a chapter gets data-chapter-label, but only the first gets .chapter-opener", () => {
    const { html } = renderPaged(
      "@chapter C.01\n@page\nP1\n@page\nP2\n@page\nP3\n"
    );
    expect(html).toBe(
      '<div class="chapter" data-chapter-label="C.01">' +
        '<div class="page" data-chapter-label="C.01">' +
        '<div class="chapter-opener" data-chapter-label="C.01">C.01</div>\n<p>P1</p>\n' +
        "</div>" +
        '<div class="page" data-chapter-label="C.01"><p>P2</p>\n</div>' +
        '<div class="page" data-chapter-label="C.01"><p>P3</p>\n</div>' +
        "</div>"
    );
  });

  test("a multi-page chapter still exposes the label on page 2 without repeating the opener", () => {
    const { html } = renderPaged("@chapter C.01\n@page\nP1\n@page\nP2\n");
    expect(html).toContain('<div class="page" data-chapter-label="C.01"><p>P2</p>\n</div>');
    expect(html.match(/chapter-opener/g) || []).toHaveLength(1);
  });

  test("a chapter with no name propagates nothing (no data-chapter-label, no opener)", () => {
    const { html } = renderPaged("@chapter\n@page\nP1\n@page\nP2\n");
    expect(html).toBe(
      '<div class="chapter"><div class="page"><p>P1</p>\n</div><div class="page"><p>P2</p>\n</div></div>'
    );
    expect(html).not.toContain("chapter-opener");
    expect(html).not.toContain("data-chapter-label");
  });

  test("a new @chapter resets the opener: each chapter gets exactly one opener, on its own first page", () => {
    const { html } = renderPaged(
      "@chapter A\n@page\nP1\n@chapter B\n@page\nP2\n@page\nP3\n"
    );
    const openerCount = (html.match(/chapter-opener/g) || []).length;
    expect(openerCount).toBe(2);
    // Chapter B's SECOND page (P3) must not repeat the opener.
    expect(html).toBe(
      '<div class="chapter" data-chapter-label="A">' +
        '<div class="page" data-chapter-label="A">' +
        '<div class="chapter-opener" data-chapter-label="A">A</div>\n<p>P1</p>\n' +
        "</div></div>" +
        '<div class="chapter" data-chapter-label="B">' +
        '<div class="page" data-chapter-label="B">' +
        '<div class="chapter-opener" data-chapter-label="B">B</div>\n<p>P2</p>\n' +
        "</div>" +
        '<div class="page" data-chapter-label="B"><p>P3</p>\n</div>' +
        "</div>"
    );
  });
});

describe("chapter counter class inheritance (ch=N / .chapter-N)", () => {
  test("ch=<N> attribute produces .chapter-<N> on every child page", () => {
    const { html } = renderPaged("@chapter ch=3\n@page\nA\n@page\nB\n");
    expect(classList(html.split("</div>")[0]!)).toEqual(["chapter"]);
    expect(html).toContain('<div class="chapter" data-ch="3">');
    expect(html).toContain('<div class="page chapter-3">');
    // Both pages inherit the same counter class.
    expect((html.match(/chapter-3/g) || []).length).toBe(2);
  });

  test("explicit .chapter-N class on @chapter is used as-is and inherited by pages", () => {
    const { html } = renderPaged("@chapter .chapter-5\n@page\nA\n");
    expect(html).toBe(
      '<div class="chapter chapter-5"><div class="page chapter-5"><p>A</p>\n</div></div>'
    );
  });

  test("explicit .chapter-N class wins over a conflicting ch= attribute", () => {
    const { html } = renderPaged("@chapter .chapter-5 ch=9\n@page\nA\n");
    expect(html).toContain('<div class="chapter chapter-5" data-ch="9">');
    expect(html).toContain('<div class="page chapter-5">');
    expect(html).not.toContain("chapter-9");
  });

  test("a page's own explicit class is preserved alongside the inherited chapter class", () => {
    const { html } = renderPaged("@chapter ch=2\n@page .cover\nA\n");
    expect(classList(html.match(/<div class="page[^"]*"/)![0]!)).toEqual([
      "page",
      "cover",
      "chapter-2",
    ]);
  });

  test("a page already declaring the same chapter class is not duplicated", () => {
    const { html } = renderPaged("@chapter ch=2\n@page .chapter-2\nA\n");
    const cls = classList(html.match(/<div class="page[^"]*"/)![0]!);
    expect(cls).toEqual(["page", "chapter-2"]);
  });

  test("a page opened with no enclosing @chapter gets no counter class", () => {
    const { html } = renderPaged("@page\nA\n");
    expect(html).toBe('<div class="page"><p>A</p>\n</div>');
  });

  test("a following chapter with no ch/.chapter-N does not inherit the previous chapter's counter", () => {
    const { html } = renderPaged(
      "@chapter ch=2\n@page\nA\n@chapter\n@page\nB\n"
    );
    expect(html).toBe(
      '<div class="chapter" data-ch="2"><div class="page chapter-2"><p>A</p>\n</div></div>' +
        '<div class="chapter"><div class="page"><p>B</p>\n</div></div>'
    );
  });
});

describe("@continue / @end-section", () => {
  test("@continue closes the current section and opens a new one with the same name + gp-continued class", () => {
    const { html } = renderPaged("@section S\nA\n@continue\nB\n@end-section\n");
    expect(html).toBe(
      '<div class="section" data-section="S"><p>A</p>\n</div>' +
        '<div class="section gp-continued" data-section="S"><p>B</p>\n</div>'
    );
  });

  test("@continue preserves the section's other attrs (e.g. region)", () => {
    const { html } = renderPaged(
      "@section S region=aside\nA\n@continue\nB\n@end-section\n"
    );
    expect(html).toContain(
      '<div class="section" data-section="S" data-region="aside">'
    );
    expect(html).toContain(
      '<div class="section gp-continued" data-section="S" data-region="aside">'
    );
  });

  test("@continue does not duplicate gp-continued if chained twice", () => {
    const { html } = renderPaged(
      "@section S\nA\n@continue\nB\n@continue\nC\n@end-section\n"
    );
    const matches = html.match(/class="section[^"]*"/g) || [];
    expect(matches).toEqual([
      'class="section"',
      'class="section gp-continued"',
      'class="section gp-continued"',
    ]);
  });

  test("@end-section closes the nearest open section only", () => {
    const { html } = renderPaged(
      "@page\n@section\nInner\n@end-section\nOuter still in page\n"
    );
    expect(html).toBe(
      '<div class="page"><div class="section"><p>Inner</p>\n</div>' +
        "<p>Outer still in page</p>\n</div>"
    );
  });
});

describe("@page-break / @column-break output", () => {
  test("@page-break emits a self-closing marker div", () => {
    const { html } = renderPaged("@page\nA\n@page-break\nB\n");
    expect(html).toBe(
      '<div class="page"><p>A</p>\n<div class="gp-page-break" aria-hidden="true"></div>\n<p>B</p>\n</div>'
    );
  });

  test("@column-break outside a .col-split section emits a fixed marker div", () => {
    const { html } = renderPaged("@section\nA\n@column-break\nB\n@end-section\n");
    expect(html).toContain(
      '<div class="gp-column-break" aria-hidden="true"></div>'
    );
  });

  test("@column-break inside a .col-split section emits the same marker div as anywhere else", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section col-split"><p>A</p>\n' +
        '<div class="gp-column-break" aria-hidden="true"></div>\n<p>B</p>\n</div>'
    );
  });

  test("@column-break with NO col-split class does not open .col wrappers even mid-section", () => {
    const { html } = renderPaged(
      "@section .two-column\nA\n@column-break\nB\n@end-section\n"
    );
    expect(html).not.toContain('class="col"');
    expect(html).toContain(
      '<div class="gp-column-break" aria-hidden="true"></div>'
    );
  });

  test("a .col-split section with NO @column-break renders as a single ordinary section", () => {
    const { html } = renderPaged("@section .col-split\nA\n@end-section\n");
    expect(html).toBe('<div class="section col-split"><p>A</p>\n</div>');
  });
});

describe("col-split removal: native break-after replaces the .col wrappers", () => {
  // `.col-split` used to make the renderer emit explicit <div class="col">
  // siblings and rewrite @column-break into the boundary between them, because
  // Paged.js stripped `break-after: column`. Paged.js was deleted 2026-08-10,
  // and native `break-after: column` was measured on Chromium 153 to reproduce
  // the fixed split exactly (5/0 with a forced break vs 3/2 when balancing).
  //
  // The two describe blocks that stood here — "column-split depth isolation
  // (env.__colSplitDepth ...)" and "col-split has-column-break detection" —
  // tested that removed machinery and went with it. These tests pin the
  // behaviour that replaced it.

  test("@column-break in a .col-split section emits the plain marker div, NOT .col wrappers", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section col-split"><p>A</p>\n' +
        '<div class="gp-column-break" aria-hidden="true"></div>\n<p>B</p>\n</div>'
    );
    expect(html).not.toContain('<div class="col">');
  });

  test(".col-split is now an inert author class — same output as any other class", () => {
    const withSplit = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    ).html;
    const withOther = renderPaged(
      "@section .whatever\nA\n@column-break\nB\n@end-section\n"
    ).html;
    expect(withSplit.replace("col-split", "whatever")).toBe(withOther);
  });

  test("no per-render depth state is left on env", () => {
    const { env } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    );
    expect(env.__colSplitDepth).toBeUndefined();
  });

  test("consecutive renders on one md instance cannot leak state into each other", () => {
    const first = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    ).html;
    const second = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    ).html;
    expect(second).toBe(first);
  });
});

describe("redundant pass-through renderer rules removed (characterization: output unaffected)", () => {
  // layout_chapter_close / layout_spread_open / layout_spread_close /
  // layout_page_close previously had renderer rules that did nothing but
  // `return self.renderToken(tokens, idx, opts)` — exactly what markdown-it's
  // own Renderer.render() does by default for any token type with no
  // registered rule. Deleting those rules must not change a single byte of
  // output, including when the tokens carry extra attrs (id / data-*) that
  // flow through renderToken's normal attribute-rendering path.
  test("spread open+close and chapter close render identically for a fully-attributed nest", () => {
    const { html } = renderPaged(
      "@chapter C.01 ch=2 .extra #cid\n@spread MySpread region=x #spr\n@page\nHi\n"
    );
    expect(html).toBe(
      '<div class="chapter extra" data-chapter-label="C.01" id="cid" data-ch="2">' +
        '<div class="spread" data-spread="MySpread" data-region="x" id="spr">' +
        '<div class="page chapter-2" data-chapter-label="C.01">' +
        '<div class="chapter-opener" data-chapter-label="C.01">C.01</div>\n' +
        "<p>Hi</p>\n</div></div></div>"
    );
  });

  test("page close renders identically when a page carries an id and data attrs", () => {
    const { html } = renderPaged("@page MyPage #pid template=cover\nHi\n@page\nBye\n");
    expect(html).toBe(
      '<div class="page" data-page="MyPage" data-template="cover" id="pid"><p>Hi</p>\n</div>' +
        '<div class="page"><p>Bye</p>\n</div>'
    );
  });
});

describe("HTML escaping", () => {
  test("chapter-opener text content and data-chapter-label attr are escaped for <, & and >", () => {
    const { html } = renderPaged('@chapter "<a&b>"\n@page\nHi\n');
    expect(html).toBe(
      '<div class="chapter" data-chapter-label="&lt;a&amp;b&gt;">' +
        '<div class="page" data-chapter-label="&lt;a&amp;b&gt;">' +
        '<div class="chapter-opener" data-chapter-label="&lt;a&amp;b&gt;">&lt;a&amp;b&gt;</div>\n' +
        "<p>Hi</p>\n</div></div>"
    );
  });

  test("a quote inside a key=value attribute is escaped by markdown-it's own attribute renderer", () => {
    const { html } = renderPaged("@page title='a\"b'\nHi\n");
    expect(attr(html, "data-title")).toBe('a&quot;b');
  });

  test("angle brackets and ampersand inside a key=value attribute are escaped", () => {
    const { html } = renderPaged("@page note=a<b&c\nHi\n");
    expect(attr(html, "data-note")).toBe("a&lt;b&amp;c");
  });

  test("a quote/angle bracket smuggled into a .col-split section's class via a mismatched-quote class=value must be escaped in the rendered class attribute, not break out of it", () => {
    // parseMarkerLine's tokenizer only treats a quote character as a
    // delimiter for ITS OWN quote type: while inside a `'...'` run, a literal
    // `"` character is copied straight into the token body (see the
    // single/double-quoted key=value tests above). That lets an author's
    // (or a template's) class value carry a real `"` plus `<`/`>` into
    // `token.attrGet('class')`. It must never reach the output raw and break
    // out of the `class="..."` attribute.
    //
    // This used to be escaped by the `.col-split` renderer branch calling this
    // file's own `escapeAttr` on an interpolated string. That branch is gone
    // (2026-08-17); the section wrapper now falls through to markdown-it's
    // `renderToken`/`renderAttrs`, which escapes every attribute itself. The
    // guarantee is the same and the mechanism is the library's rather than
    // ours — so the assertion below is kept exactly as it was.
    const { html } = renderPaged(
      "@section .col-split class='x\"><y'\nA\n@column-break\nB\n@end-section\n"
    );
    // The raw, unescaped characters must never appear as literal HTML.
    expect(html).not.toContain('x"><y');
    expect(html).toBe(
      '<div class="section col-split x&quot;&gt;&lt;y"><p>A</p>\n' +
        '<div class="gp-column-break" aria-hidden="true"></div>\n<p>B</p>\n</div>'
    );
  });
});

describe("MARKER_CSS export", () => {
  test("is a non-empty string containing the key selectors the plugin relies on", () => {
    expect(typeof MARKER_CSS).toBe("string");
    expect(MARKER_CSS.length).toBeGreaterThan(0);
    for (const selector of [
      ".gp-page-break",
      ".page",
      ".spread",
      ":where(.page, .spread)",
      ".gp-column-break",
    ]) {
      expect(MARKER_CSS).toContain(selector);
    }
  });

  // #6: the old blanket `.section { break-inside: avoid }` produced a
  // taller-than-a-column dead-column collapse in multicol layouts and had to
  // be undone by `.section.col-split { break-inside: auto }`. Both are gone;
  // keep-together is now only the empty-first-fragment glue, which achieves
  // the same intent without the collapse.
  test("no longer sets a blanket break-inside: avoid on .section (or the col-split override that undid it)", () => {
    expect(MARKER_CSS).not.toMatch(/\.section\s*\{[^}]*break-inside/);
    expect(MARKER_CSS).not.toContain(".section.col-split");
  });

  // #7: the safe default reset — heading orphans, image sizing, and the
  // first-child keep-together glue that replaces #6's blanket rule.
  test("defines the safe default reset (headings, image sizing, first-child glue), all at zero specificity", () => {
    expect(MARKER_CSS).toContain(":where(h1,h2,h3,h4,h5,h6) { break-after: avoid; }");
    expect(MARKER_CSS).toContain(":where(img, svg, video) { max-width: 100%; }");
    expect(MARKER_CSS).toContain(
      ":where(p > img:only-child, figure > img) { width: fit-content; max-width: 100%; height: auto; vertical-align: bottom; }"
    );
    expect(MARKER_CSS).toContain(":where(.section, figure) > :where(:first-child) { break-before: avoid; }");
  });

  // The standalone-image default must bound the PREFERRED width (only an
  // explicit width does; max-width alone does not — measured), without
  // upscaling small art. `fit-content` does both: a 3000px plate scales down
  // to the content box, a 64px icon stays 64px. Measured on Chromium 148 at
  // 6x4in: width:auto shrank the whole document to 0.667 (text run 100.2pt
  // vs 150.4pt); width:100% stopped the shrink but blew a 64px icon to 5in;
  // fit-content stopped the shrink AND left the icon alone.
  test("standalone image default bounds preferred width without upscaling", () => {
    expect(MARKER_CSS).toMatch(/width: fit-content/);
    expect(MARKER_CSS).not.toMatch(/img:only-child[^{]*\{[^}]*[^-]width: 100%/);
  });

  // The utility classes style `![alt](src){.class}` output, whose `<p><img
  // class="...">` still matches `p > img:only-child`. At :where()'s zero
  // specificity their `max-width` wins outright, so no `:not([class])`
  // guard is needed (verified in print: a .gp-left 3000px image renders
  // at the class's 50% width, not the default's 100%).
  test("utility-class images keep their own sizing over the zero-specificity default", () => {
    const md = createMarkdownRenderer();
    const html = md.render("![b](b.png){.gp-left}");
    expect(html).toContain('<img src="b.png" alt="b"');
    expect(html).toContain('class="gp-left"');
    // First .gp-left rule in the sheet is the float rule (the later one is
    // the pin-edge justify-self modifier).
    const rule = GUTTERPRESS_CSS.match(/\.gp-left\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/float:\s*left/);
    expect(rule![0]).toMatch(/max-width:\s*50%/);
  });

  // #2: .page/.spread must be the containing block for abspos descendants so
  // a mispinned bottom:0 fails locally instead of painting on the book's last
  // page. :where() so author CSS at any specificity can opt back to static.
  test("makes .page/.spread positioned containing blocks at zero specificity", () => {
    expect(MARKER_CSS).toContain(":where(.page, .spread) { position: relative; }");
  });
});

// The core author-facing image/block utility classes promised by the user
// guide (Chapter 3 "Common image classes" / "Full-bleed artwork") — see UX
// finding M17 and CLAUDE.md §0 (author-first primitive layering: a behavior
// broadly useful to non-technical authors belongs in core, not a project
// layer). markdown-it-attrs (bundled, see renderer.ts) already lets authors
// attach `{.gp-center}` etc. to any element; MARKER_CSS must supply the matching
// print-safe rules so the classes actually do something.
describe("GUTTERPRESS_CSS author-facing image/block utilities (M17)", () => {
  // gp-* only: the five pre-vocabulary names were REMOVED, so the regexes
  // must match bare gp-* selectors — a grouped legacy alias reappearing here
  // is a regression.
  test("defines .gp-center as a block-centering rule", () => {
    const rule = GUTTERPRESS_CSS.match(/\.gp-center\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/margin-left:\s*auto/);
    expect(rule![0]).toMatch(/margin-right:\s*auto/);
  });

  test("defines .gp-left / .gp-right as real floats with margins", () => {
    const left = GUTTERPRESS_CSS.match(/\.gp-left\s*\{[^}]*\}/);
    const right = GUTTERPRESS_CSS.match(/\.gp-right\s*\{[^}]*\}/);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left![0]).toMatch(/float:\s*left/);
    expect(left![0]).toMatch(/margin:/);
    expect(right![0]).toMatch(/float:\s*right/);
    expect(right![0]).toMatch(/margin:/);
  });

  test("defines .gp-full as 100% of the content width", () => {
    const rule = GUTTERPRESS_CSS.match(/\.gp-full\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/width:\s*100%/);
  });

  test("defines .gp-bleed as break-before + the zero-side-margin named page (no margin out-dent)", () => {
    const rule = GUTTERPRESS_CSS.match(/\.gp-bleed\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toMatch(/break-before:\s*page/);
    // The bleed comes from `@page gp-full-bleed { margin-left/right: 0 }` —
    // the page's content box IS the sheet, so a plain `width: 100%` reaches
    // both edges. Nothing may out-dent past the content box: measured on
    // Chromium 148, feeding the real page margins into a negative margin
    // shrinks the WHOLE document ~10% (the shrink-to-fit trigger is the
    // content box, not the sheet).
    expect(body).toMatch(/page:\s*gp-full-bleed/);
    expect(body).toMatch(/width:\s*100%/);
    expect(body).not.toMatch(/calc\(/);
    // Paged.js is gone (native-only-migration-plan.md Phase 6) — nothing sets
    // its page-margin custom properties any more, so they must not survive
    // here as a permanent no-op.
    expect(GUTTERPRESS_CSS).not.toMatch(/--pagedjs-margin/);
    expect(body).not.toMatch(/--gp-margin/);
    expect(GUTTERPRESS_CSS).toMatch(/@page gp-full-bleed\s*\{[^}]*margin-left:\s*0/);
    // Must NOT promise a named `art` page template or header/footer removal —
    // neither is implemented.
    expect(GUTTERPRESS_CSS).not.toMatch(/@page\s+art\b/);
  });
});

describe("author-facing image/block utilities — rendered output (M17)", () => {
  test("markdown-it-attrs (bundled) attaches .gp-center/.gp-left/.gp-right/.gp-full/.gp-bleed to images", () => {
    const md = createMarkdownRenderer();
    const html = md.render(
      "![Centered](a.jpg){.gp-center}\n\n" +
      "![Left](b.jpg){.gp-left}\n\n" +
      "![Right](c.jpg){.gp-right}\n\n" +
      "![Wide](d.jpg){.gp-full}\n\n" +
      "![Bleed](e.jpg){.gp-bleed}\n"
    );
    for (const [src, alt, cls] of [
      ["a.jpg", "Centered", "gp-center"],
      ["b.jpg", "Left", "gp-left"],
      ["c.jpg", "Right", "gp-right"],
      ["d.jpg", "Wide", "gp-full"],
      ["e.jpg", "Bleed", "gp-bleed"],
    ]) {
      const imageAt = html.indexOf(`<img src="${src}" alt="${alt}"`);
      expect(imageAt).toBeGreaterThan(-1);
      expect(html.slice(imageAt, html.indexOf(">", imageAt))).toContain(`class="${cls}"`);
    }
  });

  test("a book.html build carries the utility-class CSS through assembleBookHtml's injected <style> block", async () => {
    const html = await assembleBookHtml({
      files: ["01-page.md"],
      readText: async () => "![Art](art.jpg){.gp-bleed}\n",
      title: "Utility class build test",
    });

    const imageAt = html.indexOf('<img src="art.jpg" alt="Art"');
    expect(imageAt).toBeGreaterThan(-1);
    expect(html.slice(imageAt, html.indexOf(">", imageAt))).toContain('class="gp-bleed"');
    // The style block is the one, real vehicle for this CSS (assemble.ts
    // injects GUTTERPRESS_CSS verbatim) — no separate theme/plugin CSS is involved.
    for (const selector of [".gp-center", ".gp-left", ".gp-right", ".gp-full", ".gp-bleed"]) {
      expect(html).toContain(selector);
    }
  });
});

// The composable gp-* vocabulary (image positioning v1) — gp-* ONLY: the
// pre-vocabulary utility names (.center/.float-left/.float-right/
// .full-width/.full-bleed) were removed, not aliased. Rule ORDER inside
// GUTTERPRESS_CSS is the contract — flow positions → sizes → spacing → shape →
// .gp-pin → pin-edge modifiers, all at flat 0-1-0 specificity so
// combinations resolve by source order. The index assertions below pin that
// order; they are load-bearing, not cosmetic (e.g. a size's max-width:100%
// only lifts the floats' 50% cap because it comes later in the sheet).
describe("GUTTERPRESS_CSS gp-* vocabulary", () => {
  test("the removed pre-vocabulary class names stay removed", () => {
    // One vocabulary: a legacy selector reappearing (even grouped as an
    // alias) reintroduces a second way to spell every layout and undoes the
    // removal. The desktop's editing helpers recognize these names only to
    // REWRITE them to gp-* — the CSS must not quietly resurrect them.
    for (const legacy of [".center", ".float-left", ".float-right", ".full-width", ".full-bleed"]) {
      expect(GUTTERPRESS_CSS).not.toContain(`${legacy} `);
      expect(GUTTERPRESS_CSS).not.toContain(`${legacy},`);
    }
  });

  test("sizes declare width 25/50/75% with the float-cap lift", () => {
    const small = GUTTERPRESS_CSS.match(/\.gp-small\s*\{[^}]*\}/);
    const medium = GUTTERPRESS_CSS.match(/\.gp-medium\s*\{[^}]*\}/);
    const large = GUTTERPRESS_CSS.match(/\.gp-large\s*\{[^}]*\}/);
    expect(small![0]).toMatch(/width:\s*25%/);
    expect(medium![0]).toMatch(/width:\s*50%/);
    expect(large![0]).toMatch(/width:\s*75%/);
    for (const rule of [small, medium, large]) {
      expect(rule![0]).toMatch(/max-width:\s*100%/);
    }
    // After the float rules, so max-width:100% beats the 50% cap on order.
    expect(GUTTERPRESS_CSS.indexOf(".gp-small")).toBeGreaterThan(GUTTERPRESS_CSS.indexOf(".gp-right {"));
  });

  test("spacing presets set --gp-gap and the float rules consume it", () => {
    expect(GUTTERPRESS_CSS).toMatch(/\.gp-tight\s*\{\s*--gp-gap:\s*0\.5em;\s*\}/);
    expect(GUTTERPRESS_CSS).toMatch(/\.gp-loose\s*\{\s*--gp-gap:\s*2em;\s*\}/);
    const left = GUTTERPRESS_CSS.match(/\.gp-left\s*\{[^}]*\}/)![0];
    const right = GUTTERPRESS_CSS.match(/\.gp-right\s*\{[^}]*\}/)![0];
    expect(left).toContain("var(--gp-gap, 1em)");
    expect(right).toContain("var(--gp-gap, 1em)");
  });

  test(".gp-pin is abspos with inset:0 and EXPLICIT center defaults", () => {
    const pin = GUTTERPRESS_CSS.match(/\.gp-pin\s*\{[^}]*\}/)![0];
    expect(pin).toMatch(/position:\s*absolute/);
    // inset:0 is load-bearing: abspos self-alignment aligns within the
    // inset-modified containing block; with auto insets that collapses to
    // the static-position rectangle and alignment does nothing.
    expect(pin).toMatch(/inset:\s*0/);
    // `normal` behaves as `start` for abspos replaced elements — the
    // centered-by-default promise requires explicit centers.
    expect(pin).toMatch(/align-self:\s*center/);
    expect(pin).toMatch(/justify-self:\s*center/);
    expect(pin).toMatch(/margin:\s*0/);
    // After the float rules, so margin:0/max-width:100% beat float declarations.
    expect(GUTTERPRESS_CSS.indexOf(".gp-pin")).toBeGreaterThan(GUTTERPRESS_CSS.indexOf(".gp-right {"));
  });

  test("pin edge modifiers come after .gp-pin so they beat its center defaults", () => {
    expect(GUTTERPRESS_CSS).toMatch(/\.gp-top\s*\{\s*align-self:\s*start;\s*\}/);
    expect(GUTTERPRESS_CSS).toMatch(/\.gp-bottom\s*\{\s*align-self:\s*end;\s*\}/);
    expect(GUTTERPRESS_CSS).toMatch(/\.gp-left\s*\{\s*justify-self:\s*start;\s*\}/);
    expect(GUTTERPRESS_CSS).toMatch(/\.gp-right\s*\{\s*justify-self:\s*end;\s*\}/);
    const pinRuleAt = GUTTERPRESS_CSS.indexOf(".gp-pin {");
    expect(pinRuleAt).toBeGreaterThan(-1);
    // .gp-left/.gp-right appear twice (float rule + pin edge); the edge
    // occurrence must be the later one, after .gp-pin.
    expect(GUTTERPRESS_CSS.lastIndexOf(".gp-left")).toBeGreaterThan(pinRuleAt);
    expect(GUTTERPRESS_CSS.lastIndexOf(".gp-right")).toBeGreaterThan(pinRuleAt);
    expect(GUTTERPRESS_CSS.indexOf(".gp-top")).toBeGreaterThan(pinRuleAt);
    expect(GUTTERPRESS_CSS.indexOf(".gp-bottom")).toBeGreaterThan(pinRuleAt);
  });

  test("wrapper-margin neutralizers cover bleed and pin at zero specificity", () => {
    expect(GUTTERPRESS_CSS).toContain(":where(p:has(> img.gp-bleed:only-child)) { margin: 0; }");
    expect(GUTTERPRESS_CSS).toContain(":where(p:has(> img.gp-pin:only-child)) { margin: 0; }");
  });

  test("adds no new @page gp-* names (gp-full-bleed stays the only one)", () => {
    // build.ts's shrink-to-fit guard excludes the whole `gp-` named-page
    // namespace from its page-width Math.max; every name added here widens
    // that exclusion and must be deliberate.
    expect(GUTTERPRESS_CSS.match(/@page gp-/g)).toHaveLength(1);
  });
});

describe("gp-* vocabulary — rendered output", () => {
  test("multi-class attrs compose on the rendered <img>", () => {
    const md = createMarkdownRenderer();
    const html = md.render("![Art](x.png){.gp-right .gp-small}");
    expect(html).toContain('<img src="x.png" alt="Art"');
    expect(html).toContain('class="gp-right gp-small"');
  });

  test("assembleBookHtml carries every gp-* selector into the injected <style> block", async () => {
    const html = await assembleBookHtml({
      files: ["01-page.md"],
      readText: async () => "@page\n\n![Art](art.jpg){.gp-pin .gp-bottom}\n",
      title: "gp-* build test",
    });
    expect(html).toContain('<img src="art.jpg" alt="Art"');
    expect(html).toContain('class="gp-pin gp-bottom"');
    for (const selector of [
      ".gp-left", ".gp-right", ".gp-center", ".gp-full", ".gp-bleed",
      ".gp-small", ".gp-medium", ".gp-large", ".gp-tight", ".gp-loose",
      ".gp-pin", ".gp-top", ".gp-bottom",
    ]) {
      expect(html).toContain(selector);
    }
  });
});

// gp_pin_scope_check: a .gp-pin outside any @page/@spread resolves against
// the document canvas in print (and the preview MASKS it — the viewer strip
// is positioned and one page tall), so the plugin warns at parse time. These
// tests go through createMarkdownRenderer() because the classes only exist
// after markdown-it-attrs runs — a bare MarkdownIt + markdownItPaged never
// attaches `{.gp-pin}`.
describe("pin_outside_page warning (gp_pin_scope_check)", () => {
  function pinWarnings(src: string): { all: LayoutWarning[]; pin: LayoutWarning[] } {
    const md = createMarkdownRenderer();
    const env: PagedEnv = {};
    md.render(src, env);
    const all = env.layoutWarnings ?? [];
    return { all, pin: all.filter((w) => w.type === "pin_outside_page") };
  }

  test("warns once, with the 1-based source line, in a markerless document", () => {
    const { all, pin } = pinWarnings("intro\n\n![w](w.png){.gp-pin}\n");
    expect(all).toEqual(pin); // fires even though no markers are used
    expect(pin).toHaveLength(1);
    expect(pin[0]!.line).toBe(3);
    expect(pin[0]!.message).toContain("@page or @spread");
  });

  test("silent for a .gp-pin image inside @page", () => {
    const { pin } = pinWarnings("@page\n\n![w](w.png){.gp-pin .gp-bottom}\n");
    expect(pin).toEqual([]);
  });

  test("silent for a .gp-pin image inside @spread", () => {
    const { pin } = pinWarnings("@spread\n\n![w](w.png){.gp-pin}\n");
    expect(pin).toEqual([]);
  });

  test("silent under nested @spread + @page (no double-count, no double-warn)", () => {
    const { pin } = pinWarnings("@spread\n\n@page\n\n![w](w.png){.gp-pin}\n");
    expect(pin).toEqual([]);
  });

  test("warns for a pin placed before the first @page", () => {
    const { pin } = pinWarnings("![w](w.png){.gp-pin}\n\n@page\n\ncontent\n");
    expect(pin).toHaveLength(1);
    expect(pin[0]!.line).toBe(1);
  });

  test("two uncontained pins warn twice (no dedupe)", () => {
    const { pin } = pinWarnings("![a](a.png){.gp-pin}\n\n![b](b.png){.gp-pin}\n");
    expect(pin).toHaveLength(2);
    expect(pin.map((w) => w.line)).toEqual([1, 3]);
  });

  test("warns for a block-level {.gp-pin} outside any page", () => {
    const { pin } = pinWarnings("# Title {.gp-pin}\n");
    expect(pin).toHaveLength(1);
    expect(pin[0]!.line).toBe(1);
  });

  test("an image with other gp-* classes but no .gp-pin never warns", () => {
    const { pin } = pinWarnings("![w](w.png){.gp-right .gp-small}\n");
    expect(pin).toEqual([]);
  });
});

/**
 * The markdown-it-attrs `{...}` spelling on core marker arguments.
 *
 * Regression: `@section {.two-column}` used to swallow the braces token as
 * the section's NAME, so the class silently vanished and the element
 * rendered as a bare `.section` — no warning, no columns, and (in a book
 * that styles `.section` by default) unwanted chrome. A field-guide chapter
 * shipped that way. Both spellings must now mean the same thing.
 */
describe("marker arguments accept the {.class} spelling", () => {
  const render = (src: string) => new MarkdownIt().use(markdownItPaged).render(src);

  test("{.class} on @section is equivalent to .class", () => {
    const braced = render("@section {.two-column}\n\ntext\n");
    const bare = render("@section .two-column\n\ntext\n");
    expect(braced).toContain('class="section two-column"');
    expect(braced).toBe(bare);
  });

  test("the multi-class form survives the tokenizer split", () => {
    const html = render("@section {.a .b}\n\ntext\n");
    expect(html).toContain('class="section a b"');
  });

  test("{#id} normalizes the same way", () => {
    expect(render("@section {#intro}\n\ntext\n")).toContain('id="intro"');
  });

  test("a bare name is still a name, not a class", () => {
    expect(render("@page cover\n\ntext\n")).toContain('data-page="cover"');
  });
});

/**
 * Loud failure on marker mistakes.
 *
 * Every case below used to render something plausible-looking and say
 * NOTHING — the same silence that let `@section {.two-column}` ship as a
 * bare `.section` for two days. Rendering is deliberately unchanged: the
 * point is that the author is now told.
 */
describe("marker mistakes are reported (not silently absorbed)", () => {
  const warnings = (src: string) => {
    const { env } = renderPaged(src);
    return env.layoutWarnings ?? [];
  };
  const ofType = (src: string, type: string) =>
    warnings(src).filter((w) => w.type === type);

  describe("unrecognized_marker_token", () => {
    test("a token the grammar has no form for is reported, and still lands as a class", () => {
      const { html, env } = renderPaged("@page =oops\nHi\n");
      expect(classList(html)).toEqual(["page", "=oops"]);
      const w = env.layoutWarnings!.filter((x) => x.type === "unrecognized_marker_token");
      expect(w).toHaveLength(1);
      expect(w[0]!.line).toBe(1);
      expect(w[0]!.message).toContain('"=oops"');
      expect(w[0]!.message).toContain(".my-class");
    });

    test("a stray arrow from a copy-pasted docs table is reported", () => {
      const w = ofType("@page .skills → <div>\nHi\n", "unrecognized_marker_token");
      expect(w.map((x) => x.message.match(/"([^"]+)"/)![1])).toEqual(["→", "<div>"]);
    });

    test("a QUOTED multi-word label is a deliberate name, not an unrecognized token", () => {
      // `@chapter "Field Notes" #ch-notes` is the documented labelled-chapter
      // form (the toolbar scaffold writes it). The label used to be reported
      // as "not something a marker understands" even though the marker itself
      // accepted it as the name and emitted data-chapter-label from it.
      const { html, env } = renderPaged('@chapter "Field Notes" #ch-notes\nHi\n');
      expect(html).toContain('data-chapter-label="Field Notes"');
      expect((env.layoutWarnings ?? []).filter((x) => x.type === "unrecognized_marker_token")).toEqual([]);
    });

    test("an empty .class / #id token is reported rather than silently dropped", () => {
      expect(ofType("@page .\nHi\n", "unrecognized_marker_token")).toHaveLength(1);
      expect(ofType("@page #\nHi\n", "unrecognized_marker_token")).toHaveLength(1);
    });

    test("every well-formed argument spelling stays silent", () => {
      expect(warnings("@page cover .a .b #id template=x class=c,d\nHi\n")).toEqual([]);
      expect(warnings("@page {.a} {#b}\nHi\n")).toEqual([]);
      expect(warnings('@page title="Hello World"\nHi\n')).toEqual([]);
      expect(warnings("@page C.01 .chapter-1\nHi\n")).toEqual([]);
    });
  });

  describe("extra_bare_marker_token", () => {
    test("two plain words with nothing else: the name is silently lost — now reported", () => {
      const { html, env } = renderPaged("@page My Cover\nHi\n");
      // Unchanged behavior: no data-page at all, both words became classes.
      expect(html).not.toContain("data-page");
      expect(classList(html)).toEqual(["page", "My", "Cover"]);
      const w = env.layoutWarnings!.filter((x) => x.type === "extra_bare_marker_token");
      expect(w).toHaveLength(1);
      expect(w[0]!.line).toBe(1);
      expect(w[0]!.message).toContain("NONE of them was used as the name");
      expect(w[0]!.message).toContain('"My Cover"');
    });

    test("a second plain word alongside a .class: first wins the name, rest demoted", () => {
      const { html, env } = renderPaged("@page cover extra .a\nHi\n");
      expect(attr(html, "data-page")).toBe("cover");
      expect(classList(html)).toEqual(["page", "extra", "a"]);
      const w = env.layoutWarnings!.filter((x) => x.type === "extra_bare_marker_token");
      expect(w).toHaveLength(1);
      expect(w[0]!.message).toContain('"extra"');
    });

    test("one plain word is a name, not a mistake", () => {
      expect(ofType("@page cover .a\nHi\n", "extra_bare_marker_token")).toEqual([]);
    });

    test("does not double-report alongside ambiguous_marker_token", () => {
      const w = warnings("@page cover class=a bar\nHi\n");
      expect(w.map((x) => x.type)).toEqual(["ambiguous_marker_token"]);
    });
  });

  describe("unknown_marker", () => {
    test("a mistyped kind that no rule consumed is reported with a suggestion", () => {
      const w = ofType("@page\n\n@secton .two-column\n\ntext\n", "unknown_marker");
      expect(w).toHaveLength(1);
      expect(w[0]!.line).toBe(3);
      expect(w[0]!.message).toContain('"@secton"');
      expect(w[0]!.message).toContain('"@section"');
    });

    test("a case mismatch is caught (marker names are lower-case)", () => {
      const w = ofType("@page\n\n@Section\n\ntext\n", "unknown_marker");
      expect(w).toHaveLength(1);
      expect(w[0]!.message).toContain('"@Section"');
    });

    test("plural typos are caught", () => {
      expect(ofType("@page\n\n@sections\n\nt\n", "unknown_marker")).toHaveLength(1);
      expect(ofType("@page\n\n@pages\n\nt\n", "unknown_marker")).toHaveLength(1);
    });

    test("a plugin-style marker far from any known kind stays silent", () => {
      for (const m of ["@skill", "@callout", "@lede", "@tape", "@gear", "@specialty"]) {
        expect(ofType(`@page\n\n${m} Foo\n\nt\n`, "unknown_marker")).toEqual([]);
      }
    });

    test("prose, handles and email addresses stay silent", () => {
      expect(ofType("@page\n\n@itlackey said hi\n\n", "unknown_marker")).toEqual([]);
      expect(ofType("@page\n\nfoo@bar.com\n\n", "unknown_marker")).toEqual([]);
      expect(ofType("@page\n\n@user.name pinged me\n\n", "unknown_marker")).toEqual([]);
    });

    test("known marker names in documentation headings and prose stay silent", () => {
      const src = `@page

### @chapter

@chapter is the wrapper used for a chapter opener.

- @section starts a smaller layout region.

> @page is also safe in quoted documentation.
`;
      expect(ofType(src, "unknown_marker")).toEqual([]);
    });

    test("fenced code is not scanned (a CSS `@page {` example is not a marker)", () => {
      expect(ofType("@page\n\n```css\n@page {\n  margin: 0;\n}\n```\n", "unknown_marker")).toEqual([]);
    });

    test("a document with no core markers at all is never scanned (deliberately conservative)", () => {
      expect(warnings("@secton .two-column\n\ntext\n")).toEqual([]);
    });
  });
});
