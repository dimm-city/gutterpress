/**
 * Characterization test net for `markers.js`.
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
import markerPlugin, { MARKER_CSS, buildDeclaredMarkerRegistry } from "./markers.js";
import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { createMarkdownRenderer, type LoadedPlugin } from "./renderer";
import { assembleBookHtml } from "./assemble";

interface LayoutWarning {
  line: number;
  type: string;
  message: string;
  marker: unknown;
}

interface PagedEnv {
  layoutWarnings?: LayoutWarning[];
  __layoutMarkersUsed?: boolean;
  [key: string]: unknown;
}

/** Render markdown through a bare MarkdownIt + marker plugin instance. */
function renderPaged(
  src: string,
  options: Record<string, unknown> = {},
  env: PagedEnv = {}
): { html: string; env: PagedEnv } {
  const md = new MarkdownIt({ html: true });
  md.use(markerPlugin, options);
  const html = md.render(src, env);
  return { html, env };
}

/**
 * Parse (not render) markdown through a bare MarkdownIt + marker plugin
 * instance, for tests that inspect `token.meta` directly (source-line
 * threading — §2.1 of docs/inline-editing-plan.md) rather than rendered HTML.
 */
function parsePaged(
  src: string,
  options: Record<string, unknown> = {},
  env: PagedEnv = {}
): { tokens: import("markdown-it/lib/token.mjs").default[]; env: PagedEnv } {
  const md = new MarkdownIt({ html: true });
  md.use(markerPlugin, options);
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
    // site (markers.js) and ADR 0009: setting map would make
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

  test("layout_section_open carries the marker line", () => {
    const { tokens } = parsePaged("@page\n@section S\nHi\n");
    const t = findToken(tokens, "layout_section_open")!;
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
      "@section .gp-columns-2\nA\n@column-break\nB\n@end-section\n"
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

// A break marker's div becomes a grid ITEM when its DIRECT parent is a
// gp-grid-* container: it takes a cell of its own, corrupts auto-placement
// in print, and the viewer's break-synthesis spacer (another item) puts
// content on the WRONG page — the one page-level print/preview parity break
// the gp-grid evidence pack measured (Chromium 151). The warning fires on
// the innermost open frame only: a break inside a plain @section on a grid
// @page is an ordinary block-flow child and stays silent.
describe("break_inside_grid warning", () => {
  test("@page-break directly inside a grid @section warns and still emits the break div", () => {
    const { html, env } = renderPaged("@section .gp-grid-2\nA\n\n@page-break\n\nB\n");
    expect(env.layoutWarnings).toHaveLength(1);
    expect(env.layoutWarnings![0]).toMatchObject({
      line: 4,
      type: "break_inside_grid",
      marker: { kind: "page-break", name: null, attrs: {}, __line: 4 },
    });
    expect(env.layoutWarnings![0]!.message).toContain(".gp-grid-2");
    expect(env.layoutWarnings![0]!.message).toContain("@section");
    // Warn-and-report only — the break still lands where it always did.
    expect(html).toContain('<div class="gp-page-break" aria-hidden="true"></div>');
  });

  test("@column-break directly inside a grid @page (no section) warns, naming @page as the host", () => {
    const { env } = renderPaged("@page .gp-grid-3\nA\n\n@column-break\n\nB\n");
    expect(env.layoutWarnings).toHaveLength(1);
    expect(env.layoutWarnings![0]).toMatchObject({ line: 4, type: "break_inside_grid" });
    expect(env.layoutWarnings![0]!.message).toContain(".gp-grid-3");
    expect(env.layoutWarnings![0]!.message).toContain("@page");
  });

  test("@page-break directly inside a grid @spread warns", () => {
    const { env } = renderPaged("@spread .gp-grid-2\n@page-break\n");
    // spread_eof_close still fires too — the spread never saw a @page.
    expect(env.layoutWarnings?.map((w) => w.type)).toEqual([
      "break_inside_grid",
      "spread_eof_close",
    ]);
  });

  test("near-miss: a break inside a PLAIN @section on a grid @page is silent (block-flow child)", () => {
    const { env } = renderPaged("@page .gp-grid-2\n@section\nA\n\n@page-break\n\nB\n");
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("near-miss: gp-columns-* is multicol, not grid — breaks inside it stay silent", () => {
    const { env } = renderPaged("@section .gp-columns-2\nA\n\n@column-break\n\nB\n");
    expect(env.layoutWarnings).toBeUndefined();
  });
});

// The exact silent failure that shipped a broken page: a DECORATED @section
// (classes or attributes) closed by a sibling @section or @end-section with
// nothing between the two markers — the decoration styles an empty element,
// so the layout the author asked for never prints. Corpus-scanned across
// both real books: zero false positives for this shape. The warning anchors
// at the OPENING marker (where the decoration is) and names the closer's
// line; wider close paths (EOF drain, @page/@chapter cascade closes) were
// not corpus-cleared and stay silent.
describe("empty_section warning", () => {
  test("a decorated @section immediately closed by a sibling @section warns, anchored at the opener", () => {
    const { html, env } = renderPaged("@section .gp-grid-2\n@section\nHi\n");
    expect(env.layoutWarnings).toEqual([
      {
        line: 1,
        type: "empty_section",
        message:
          "This @section (.gp-grid-2) was closed by the @section on line 2 with no content between the two markers, so its styling applies to an empty element and nothing prints the layout it asked for. Delete one of the two markers, or move the content that belongs inside the section between them.",
        marker: null,
      },
    ]);
    // Behavior unchanged: the empty decorated div still renders.
    expect(html).toBe(
      '<div class="section gp-grid-2"></div><div class="section"><p>Hi</p>\n</div>'
    );
  });

  test("a decorated @section immediately closed by @end-section warns, naming the closer's line", () => {
    const { env } = renderPaged("@section .sidebar\n@end-section\nHi\n");
    expect(env.layoutWarnings).toHaveLength(1);
    expect(env.layoutWarnings![0]).toMatchObject({ line: 1, type: "empty_section" });
    expect(env.layoutWarnings![0]!.message).toContain("@end-section on line 2");
  });

  test("attribute decoration counts too (#id / key=value, not just classes)", () => {
    const { env } = renderPaged("@section #intro\n@end-section\nHi\n");
    expect(env.layoutWarnings).toHaveLength(1);
    expect(env.layoutWarnings![0]).toMatchObject({ line: 1, type: "empty_section" });
    expect(env.layoutWarnings![0]!.message).toContain("#intro");
  });

  test("near-miss: an UNdecorated empty section is silent (a common drafting state)", () => {
    const { env } = renderPaged("@section\n@section .x\nHi\n");
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("near-miss: a decorated section WITH content is silent", () => {
    const { env } = renderPaged("@section .sidebar\nHi\n@end-section\n");
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("near-miss: a NAME alone is not decoration", () => {
    // data-section="Notes" carries identity, not styling — an empty named
    // section renders the same with or without content following later.
    const { env } = renderPaged("@section Notes\n@end-section\n");
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("a decorated empty section closed by the EOF drain is silent (not corpus-cleared)", () => {
    const { env } = renderPaged("@section .sidebar\n");
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("a decorated empty section closed by a new @page's cascade is silent (not corpus-cleared)", () => {
    const { env } = renderPaged("@page\n@section .sidebar\n@page\nHi\n");
    expect(env.layoutWarnings).toBeUndefined();
  });

  test("an empty @continue continuation closed by @end-section warns (it carries the cloned classes)", () => {
    // The continuation clones the section's decoration (plus gp-continued),
    // so an empty continuation is an equally invisible styled box — e.g. a
    // "(continued)" label with nothing under it.
    const { env } = renderPaged("@section .note\nHi\n@continue\n@end-section\n");
    expect(env.layoutWarnings).toHaveLength(1);
    expect(env.layoutWarnings![0]).toMatchObject({ line: 3, type: "empty_section" });
    expect(env.layoutWarnings![0]!.message).toContain(".note .gp-continued");
    expect(env.layoutWarnings![0]!.message).toContain("@end-section on line 4");
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

  test("@column-break emits a fixed marker div", () => {
    const { html } = renderPaged("@section\nA\n@column-break\nB\n@end-section\n");
    expect(html).toContain(
      '<div class="gp-column-break" aria-hidden="true"></div>'
    );
  });

  test("@column-break inside a .gp-columns-2 section is the same marker div, never a wrapper", () => {
    const { html } = renderPaged(
      "@section .gp-columns-2\nA\n@column-break\nB\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section gp-columns-2"><p>A</p>\n' +
        '<div class="gp-column-break" aria-hidden="true"></div>\n<p>B</p>\n</div>'
    );
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

  test("a quote/angle bracket smuggled into a section's class via a mismatched-quote class=value must be escaped in the rendered class attribute, not break out of it", () => {
    // parseMarkerLine's tokenizer only treats a quote character as a
    // delimiter for ITS OWN quote type: while inside a `'...'` run, a literal
    // `"` character is copied straight into the token body (see the
    // single/double-quoted key=value tests above). That lets an author's
    // (or a template's) class value carry a real `"` plus `<`/`>` into
    // `token.attrGet('class')`. The section renders through markdown-it's own
    // renderToken, whose attribute escaping must keep that value from
    // reaching the output raw and breaking out of the `class="..."` attribute.
    const { html } = renderPaged(
      "@section .gp-columns-2 class='x\"><y'\nA\n@column-break\nB\n@end-section\n"
    );
    // The raw, unescaped characters must never appear as literal HTML.
    expect(html).not.toContain('x"><y');
    expect(html).toBe(
      '<div class="section gp-columns-2 x&quot;&gt;&lt;y"><p>A</p>\n' +
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
    expect(MARKER_CSS).toContain(
      ":where(.page, .spread) { position: relative; display: flow-root; box-sizing: border-box; " +
        "min-height: calc(var(--gp-content-h, 1px) - 1px); }",
    );
  });

  // The other half of that contract: a page root that only shrink-wraps its
  // prose is a containing block whose bottom edge is the end of the TEXT, so
  // `.gp-pin .gp-bottom` lands under the last paragraph. The engines publish
  // the page content height as --gp-content-h; the 1px fallback, less the
  // 1px cushion, keeps the rule inert for plain markdown-it use with no
  // engine.
  test("stretches page roots to the published page content height, min-height only", () => {
    const rule = MARKER_CSS.match(/:where\(\.page, \.spread\)\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toContain("min-height: calc(var(--gp-content-h, 1px) - 1px)");
    // `height` would stop a long .page from fragmenting across sheets.
    expect(rule![0]).not.toMatch(/[^-]height:\s*var/);
    // Both measured on a real book: padding would push a content-box
    // min-height onto a spurious sheet, and a child margin collapsing
    // through the root's edge would eat into the sheet it starts.
    expect(rule![0]).toContain("box-sizing: border-box");
    expect(rule![0]).toContain("display: flow-root");
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

  test("grid runs declare 2/3 equal tracks with the author-settable --gp-grid-gap", () => {
    // Plain class selectors, no :where() — like .gp-columns-*, injection
    // order (core before author CSS) is what lets author rules at equal
    // specificity win. Measured (Chromium 151): grid rows fragment across
    // sheets with exact print/viewer parity, so no fit-one-page guard
    // belongs here.
    const grid2 = GUTTERPRESS_CSS.match(/\.gp-grid-2\s*\{[^}]*\}/);
    const grid3 = GUTTERPRESS_CSS.match(/\.gp-grid-3\s*\{[^}]*\}/);
    expect(grid2).not.toBeNull();
    expect(grid3).not.toBeNull();
    expect(grid2![0]).toMatch(/display:\s*grid/);
    expect(grid2![0]).toContain("grid-template-columns: repeat(2, 1fr)");
    expect(grid3![0]).toMatch(/display:\s*grid/);
    expect(grid3![0]).toContain("grid-template-columns: repeat(3, 1fr)");
    for (const rule of [grid2, grid3]) {
      expect(rule![0]).toContain("gap: var(--gp-grid-gap, 1.5em)");
      // align-content is deliberately NOT set: default stretch on a
      // min-height page root spreads rows identically in both engines (an
      // authoring choice, not a parity hazard); authors opt into packed
      // rows with align-content: start.
      expect(rule![0]).not.toContain("align-content");
    }
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

  test(".gp-flush ships no CSS — the engines implement it", () => {
    // The class is a marker consumed by the compiler and the viewer
    // (engine/shared/flush.ts): reaching the paper requires freeing that
    // page's margins and relocating the furniture that lived in them,
    // neither of which a static stylesheet can do. An earlier attempt DID
    // ship it as CSS — `:has()` reassigning the root to a gp-flush-* named
    // page — and stole the author's own `page:` assignment (every
    // declaration on their named page, furniture included, vanished). No
    // rule may come back here.
    expect(GUTTERPRESS_CSS).not.toContain("gp-flush");
    expect(GUTTERPRESS_CSS).not.toContain(":has(.gp-pin");
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
    // that exclusion and must be deliberate. (`gp--flush-*` pages exist too,
    // but the COMPILER generates those per build — they are never in this
    // static stylesheet, and the width guard readmits them explicitly.)
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
// after markdown-it-attrs runs — a bare MarkdownIt + markerPlugin never
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

// unknown_gp_class (#226): a gp-* class that is not part of core's published
// vocabulary previously rendered as a silent no-op — an author typed
// `@section .gp-columns-all` before the class existed and nothing said why.
// Same gp_pin_scope_check core rule as pin_outside_page, but unconditional
// (checked everywhere, not gated by @page/@spread depth) and keyed on the
// `gp-` prefix only: `.dc-*`, `.fg-*`, and unprefixed classes are never this
// check's business.
describe("unknown_gp_class warning (gp_pin_scope_check)", () => {
  function gpClassWarnings(src: string): { all: LayoutWarning[]; unknown: LayoutWarning[] } {
    const md = createMarkdownRenderer();
    const env: PagedEnv = {};
    md.render(src, env);
    const all = env.layoutWarnings ?? [];
    return { all, unknown: all.filter((w) => w.type === "unknown_gp_class") };
  }

  test("an unknown gp-* class warns, naming the element and a did-you-mean", () => {
    const { unknown } = gpClassWarnings("@section .gp-column-2\n\ntext\n");
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.message).toBe(
      'Unknown class "gp-column-2" on @section. Did you mean "gp-columns-2"?'
    );
  });

  test("a document with no markers still warns for a {.gp-typo} image", () => {
    const { all, unknown } = gpClassWarnings("![w](w.png){.gp-typo}\n");
    expect(all).toEqual(unknown); // fires even though no markers are used
    expect(unknown).toHaveLength(1);
    expect(unknown[0]!.message).toContain('Unknown class "gp-typo" on an image.');
  });

  test("known classes across both core CSS files never warn, including marker-only ones", () => {
    const src = [
      "@page",
      "",
      "@section {.gp-columns-2 .gp-grid-3}",
      "",
      "text",
      "",
      "@column-break",
      "",
      "more text",
      "",
      "@end-section",
      "",
      "@section Notes",
      "",
      "content",
      "",
      "@continue",
      "",
      "more content",
      "",
      "@end-section",
      "",
      "![a](a.png){.gp-left .gp-small .gp-tight .gp-shape}",
      "",
      "![b](b.png){.gp-pin .gp-top .gp-behind}",
      "",
      "![c](c.png){.gp-bleed .gp-flush}",
      "",
      "@page-break",
      "",
    ].join("\n");
    const { unknown } = gpClassWarnings(src);
    expect(unknown).toEqual([]);
  });

  test("a non-gp- class never warns, however unusual", () => {
    const { unknown } = gpClassWarnings("![w](w.png){.dc-panel .fg-art-top .made-up-class}\n");
    expect(unknown).toEqual([]);
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
  const render = (src: string) => new MarkdownIt().use(markerPlugin).render(src);

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
/**
 * Writing about markers without triggering them.
 *
 * There is no Gutterpress escape syntax and there must not be one: markdown
 * already has this. `\@page` renders as literal `@page` because CommonMark
 * lists `@` among the escapable ASCII punctuation, and because this plugin
 * only claims a line whose first non-space character is `@` — a line starting
 * with `\` is never offered to `parseMarkerLine` at all.
 *
 * That is a conjunction of two behaviors owned by two different layers, and
 * nothing else asserts it. A future move to a block rule that scans further
 * into the line (or a tokenizer that strips escapes before this rule sees the
 * source) would quietly re-arm the trap, so the contract is pinned here.
 */
describe("escaping a marker so it stays prose", () => {
  const KINDS = [
    "@chapter",
    "@spread",
    "@page",
    "@section",
    "@continue",
    "@end-section",
    "@page-break",
    "@column-break",
  ];

  test("a backslash keeps every marker kind as text, with no warning", () => {
    for (const kind of KINDS) {
      const { html, env } = renderPaged(`\\${kind} is written like this.\n`);
      expect(html).toContain(`${kind} is written like this.`);
      expect(html).not.toContain("<div");
      expect(env.layoutWarnings ?? []).toEqual([]);
    }
  });

  test("the real trap — a sentence that WRAPS onto a marker word — is escapable", () => {
    const src =
      "A pinned image sets itself against its\n\\@page container — centered by default.\n";
    const { html, env } = renderPaged(src);
    expect(html).toContain("@page container");
    // One paragraph: the sentence was never split by a page wrapper.
    expect(html.match(/<p>/g)).toHaveLength(1);
    expect(html).not.toContain('class="page');
    expect(env.layoutWarnings ?? []).toEqual([]);
  });

  test("control: the same line without the backslash IS a marker", () => {
    const src = "A pinned image sets itself against its\n@page container — centered by default.\n";
    const { html } = renderPaged(src);
    expect(html).toContain('class="page');
  });

  test("an inline-code span is the other way to name a marker in prose", () => {
    const { html, env } = renderPaged("Start a page with `@page` on its own line.\n");
    expect(html).toContain("<code>@page</code>");
    expect(env.layoutWarnings ?? []).toEqual([]);
  });
});

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

  // The trap this hint exists for: a marker is any line whose first non-space
  // character is `@` + a known kind, INCLUDING a line a paragraph wrapped onto.
  // The author never typed a marker, so a message that only explains class
  // syntax leaves them with a page split mid-sentence and no idea why. This
  // repo's own gp-image-positioning fixture shipped exactly that split.
  describe("the prose-escape hint", () => {
    test("unrecognized_marker_token names the escape for its own kind", () => {
      const w = ofType(
        "A pinned image sets itself against its\n@page container — centered by default.\n",
        "unrecognized_marker_token"
      );
      expect(w.length).toBeGreaterThan(0);
      expect(w[0]!.message).toContain("\\@page");
      expect(w[0]!.message).toContain("`@page`");
    });

    test("the several-plain-words case names it too, with that marker's kind", () => {
      const w = ofType("@section one of the tide tables\nHi\n", "extra_bare_marker_token");
      expect(w).toHaveLength(1);
      expect(w[0]!.message).toContain("\\@section");
    });

    test("a well-formed marker never gets the hint (nothing to second-guess)", () => {
      expect(warnings("@page cover .a #id class=c,d\nHi\n")).toEqual([]);
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

// ─────────────────────────────────────────────────────────────────────────
// #240 — declarative container components in core.
//
// Two layers, tested separately:
//   - `buildDeclaredMarkerRegistry` (pure data validation: collisions,
//     alias/preset/deprecated resolution) — unit-tested directly below.
//   - the `layout_transform` dispatch it feeds (`renderPaged`/`parsePaged`
//     with `{ declaredMarkers }`, exactly like `preferPagesInSpreads` above)
//     — parsing/rendering behavior, tested in the second describe block.
//
// `data-source-range`/`data-chapter-src` threading (the issue's central
// "hand-built wrappers silently drop them" complaint) is proven separately,
// against the REAL pipeline, in source-range.test.ts — see the describe
// block there titled "declared markers (#240)".
// ─────────────────────────────────────────────────────────────────────────

describe("buildDeclaredMarkerRegistry (#240)", () => {
  describe("collisions fail at load time, naming both sides (P2)", () => {
    test("a declared name shadowing a core reserved name names the plugin and the core name", () => {
      const build = () =>
        buildDeclaredMarkerRegistry([{ pluginName: "dc-plugin", markers: { section: { class: "x" } } }]);
      expect(build).toThrow(/dc-plugin/);
      expect(build).toThrow(/@section/);
      expect(build).toThrow(/core Gutterpress marker name/);
    });

    test("every one of the eight core reserved names is rejected", () => {
      // "end-section" hits the earlier, ALSO-correct "end- is reserved for
      // an auto-derived closer" rejection first (validateDeclaredMarkerName
      // runs before the KNOWN_KINDS check) — still a rejection, just a
      // different true reason, so it gets its own assertion below.
      const coreNames = ["chapter", "spread", "page", "section", "continue", "page-break", "column-break"];
      for (const name of coreNames) {
        expect(() =>
          buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { [name]: {} } }])
        ).toThrow(/core Gutterpress marker name/);
      }
      expect(() =>
        buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { "end-section": {} } }])
      ).toThrow(/reserved/);
    });

    test("two different plugins declaring the same name names both plugins", () => {
      const build = () =>
        buildDeclaredMarkerRegistry([
          { pluginName: "plugin-a", markers: { callout: { class: "a-alert" } } },
          { pluginName: "plugin-b", markers: { callout: { class: "b-alert" } } },
        ]);
      expect(build).toThrow(/plugin-a/);
      expect(build).toThrow(/plugin-b/);
      expect(build).toThrow(/@callout/);
    });

    test("a name starting with `end-` is rejected — reserved for another marker's auto-derived closer", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { "end-foo": { class: "x" } } }])
      ).toThrow(/reserved/);
    });

    test("an invalid marker name (uppercase) is rejected before any collision check runs", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { Callout: { class: "x" } } }])
      ).toThrow(/invalid name/);
    });
  });

  describe("container shape validation", () => {
    test("rejects a declaration that is not a plain object", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { callout: "oops" } }])
      ).toThrow(/is not a plain object/);
    });

    test("rejects an invalid `tag`", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { callout: { tag: "DIV" } } }])
      ).toThrow(/invalid `tag`/);
    });

    test("rejects a `class` that is not a string", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { callout: { class: 5 } } }])
      ).toThrow(/`class`/);
    });

    test("rejects `variants` that is not a plain object", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { callout: { variants: ["x"] } } }])
      ).toThrow(/`variants`/);
    });

    test("rejects a variant whose value is not a string", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([
          { pluginName: "p", markers: { callout: { variants: { note: 5 } } } },
        ])
      ).toThrow(/variant "note"/);
    });

    test("rejects a `label` with no `class`", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([
          { pluginName: "p", markers: { callout: { label: { from: "attr:label" } } } },
        ])
      ).toThrow(/label\.class/);
    });

    test('rejects a `label.from` that is not "attr:<name>"', () => {
      expect(() =>
        buildDeclaredMarkerRegistry([
          { pluginName: "p", markers: { callout: { label: { class: "x", from: "name" } } } },
        ])
      ).toThrow(/label\.from/);
    });

    test("rejects an unsupported `autoCloseAt` value", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([
          { pluginName: "p", markers: { callout: { autoCloseAt: ["page"] } } },
        ])
      ).toThrow(/unsupported `autoCloseAt` value/);
    });

    test("rejects `autoCloseAt` that is not an array", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([
          { pluginName: "p", markers: { callout: { autoCloseAt: "eof" } } },
        ])
      ).toThrow(/`autoCloseAt`/);
    });
  });

  describe("alias resolution", () => {
    test("aliasing an unknown marker throws", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([{ pluginName: "p", markers: { "dm-note": { alias: "collout" } } }])
      ).toThrow(/unknown marker "@collout"/);
    });

    test("aliasing an alias (chained) throws", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([
          {
            pluginName: "p",
            markers: {
              callout: { class: "dc-alert" },
              "dm-note": { alias: "callout" },
              "dm-note-2": { alias: "dm-note" },
            },
          },
        ])
      ).toThrow(/itself an alias/);
    });

    test("aliasing a deprecated marker throws", () => {
      expect(() =>
        buildDeclaredMarkerRegistry([
          {
            pluginName: "p",
            markers: {
              "roll-table": { deprecated: "gone" },
              "dice-table": { alias: "roll-table" },
            },
          },
        ])
      ).toThrow(/deprecated/);
    });

    test("an alias may target a marker declared by a DIFFERENT plugin, regardless of load order", () => {
      const registry = buildDeclaredMarkerRegistry([
        { pluginName: "plugin-alias", markers: { "dm-note": { alias: "callout", preset: { variant: "dm" } } } },
        { pluginName: "plugin-base", markers: { callout: { class: "dc-alert", variants: { dm: "dc-dm-note" } } } },
      ]);
      expect(registry.get("dm-note")).toMatchObject({ baseKind: "callout", presetVariant: "dm" });
    });
  });

  describe("resolved shapes — the issue's own example table", () => {
    const sources = [
      {
        pluginName: "dc-components",
        markers: {
          callout: {
            tag: "div",
            class: "dc-alert",
            variants: { note: "dc-note", warning: "dc-note warning", dm: "dc-dm-note" },
            label: { class: "dc-alert-label", from: "attr:label" },
            autoCloseAt: ["eof"],
          },
          sidebar: { tag: "aside", class: "dc-sidebar" },
          lede: { class: "dc-intro" },
          "dm-note": { alias: "callout", preset: { variant: "dm" } },
          "roll-table": { deprecated: "Removed in 17.3.0 — use @outcome." },
        },
      },
    ];

    test("wrapper: resolves a full container declaration", () => {
      const registry = buildDeclaredMarkerRegistry(sources);
      expect(registry.get("callout")).toEqual({
        name: "callout",
        baseKind: "callout",
        tag: "div",
        classBase: "dc-alert",
        variants: { note: "dc-note", warning: "dc-note warning", dm: "dc-dm-note" },
        label: { class: "dc-alert-label", attr: "label", tag: "div" },
        autoCloseAtEof: true,
      });
    });

    test("wrapper: resolves a minimal container declaration with tag/class defaults", () => {
      const registry = buildDeclaredMarkerRegistry(sources);
      expect(registry.get("sidebar")).toEqual({
        name: "sidebar",
        baseKind: "sidebar",
        tag: "aside",
        classBase: "dc-sidebar",
        variants: undefined,
        label: undefined,
        autoCloseAtEof: false,
      });
      expect(registry.get("lede")).toEqual({
        name: "lede",
        baseKind: "lede",
        tag: "div",
        classBase: "dc-intro",
        variants: undefined,
        label: undefined,
        autoCloseAtEof: false,
      });
    });

    test("alias+preset: resolves to the target's shape plus baseKind/presetVariant", () => {
      const registry = buildDeclaredMarkerRegistry(sources);
      expect(registry.get("dm-note")).toEqual({
        name: "dm-note",
        baseKind: "callout",
        presetVariant: "dm",
        tag: "div",
        classBase: "dc-alert",
        variants: { note: "dc-note", warning: "dc-note warning", dm: "dc-dm-note" },
        label: { class: "dc-alert-label", attr: "label", tag: "div" },
        autoCloseAtEof: true,
      });
    });

    test("deprecated: resolves to just {name, deprecated} — every other field is discarded", () => {
      const registry = buildDeclaredMarkerRegistry(sources);
      expect(registry.get("roll-table")).toEqual({
        name: "roll-table",
        deprecated: "Removed in 17.3.0 — use @outcome.",
      });
    });

    test("an empty sources list, or a plugin with an empty markers object, resolves to an empty registry", () => {
      expect(buildDeclaredMarkerRegistry([]).size).toBe(0);
      expect(buildDeclaredMarkerRegistry([{ pluginName: "p", markers: {} }]).size).toBe(0);
    });
  });
});

describe("declared markers — parsing & rendering (#240)", () => {
  /** The issue's own example table, minus the deprecated/alias entries that
   * get their own focused tests below. Shared (read-only) across this
   * describe block, the same way other describes above share one `md`. */
  const declaredMarkers = buildDeclaredMarkerRegistry([
    {
      pluginName: "dc-components",
      markers: {
        callout: {
          tag: "div",
          class: "dc-alert",
          variants: { note: "dc-note", warning: "dc-note warning", dm: "dc-dm-note" },
          label: { class: "dc-alert-label", from: "attr:label" },
          autoCloseAt: ["eof"],
        },
        sidebar: { tag: "aside", class: "dc-sidebar" },
        lede: { class: "dc-intro" },
        "dm-note": { alias: "callout", preset: { variant: "dm" } },
        "roll-table": { deprecated: "Removed in 17.3.0 — use @outcome." },
      },
    },
  ]);

  describe("wrapper", () => {
    test("a bare declared marker renders as its declared tag + class, exactly like @section renders div+class", () => {
      const { html } = renderPaged("@sidebar\nAside text.\n@end-sidebar\n", { declaredMarkers });
      expect(html).toBe('<aside class="dc-sidebar"><p>Aside text.</p>\n</aside>');
    });

    test("both attr spellings — .class and {.class} — are equivalent, exactly like @section", () => {
      const compact = renderPaged("@sidebar .extra\nText.\n@end-sidebar\n", { declaredMarkers });
      const braced = renderPaged("@sidebar {.extra}\nText.\n@end-sidebar\n", { declaredMarkers });
      expect(compact.html).toBe(braced.html);
      expect(classList(compact.html)).toEqual(["dc-sidebar", "extra"]);
    });

    test("a marker with no declared `class` still wraps in its declared `tag`", () => {
      const { html } = renderPaged("@lede\nOpening line.\n@end-lede\n", { declaredMarkers });
      expect(html).toBe('<div class="dc-intro"><p>Opening line.</p>\n</div>');
    });
  });

  describe("variants", () => {
    test("the marker's bare name selects a variant, appended after the base class", () => {
      const { html } = renderPaged("@callout warning\nWatch out.\n@end-callout\n", { declaredMarkers });
      expect(html).toBe(
        '<div class="dc-alert dc-note warning" data-callout="warning"><p>Watch out.</p>\n</div>'
      );
    });

    test("a name with no matching variant still opens (base class only, no crash)", () => {
      const { html } = renderPaged("@callout unknown-variant\nText.\n@end-callout\n", { declaredMarkers });
      expect(html).toContain('class="dc-alert"');
      expect(html).toContain('data-callout="unknown-variant"');
    });
  });

  describe("label", () => {
    test('`label.from: "attr:label"` injects a structural label element as the first child, from the marker\'s own attr', () => {
      const { html } = renderPaged(
        '@callout note label="Heads up"\nBody text.\n@end-callout\n',
        { declaredMarkers }
      );
      expect(html).toBe(
        '<div class="dc-alert dc-note" data-callout="note" data-label="Heads up">' +
          '<div class="dc-alert-label">Heads up</div>\n' +
          "<p>Body text.</p>\n</div>"
      );
    });

    test("with no matching attr on the line, no label element is injected", () => {
      const { html } = renderPaged("@callout note\nBody text.\n@end-callout\n", { declaredMarkers });
      expect(html).not.toContain("dc-alert-label");
      expect(html).toBe('<div class="dc-alert dc-note" data-callout="note"><p>Body text.</p>\n</div>');
    });

    test("the label text is HTML-escaped", () => {
      const { html } = renderPaged(
        '@callout note label="<script>"\nText.\n@end-callout\n',
        { declaredMarkers }
      );
      expect(html).toContain('<div class="dc-alert-label">&lt;script&gt;</div>');
      expect(html).not.toContain("<script>");
    });
  });

  describe("alias + preset", () => {
    test("an alias with no args uses its preset variant", () => {
      const { html } = renderPaged("@dm-note\nSomething.\n@end-callout\n", { declaredMarkers });
      expect(html).toBe('<div class="dc-alert dc-dm-note" data-callout="dm"><p>Something.</p>\n</div>');
    });

    test("the alias's OWN auto-derived closer (@end-dm-note) closes the same frame as @end-callout", () => {
      const { html } = renderPaged("@dm-note\nSomething.\n@end-dm-note\n", { declaredMarkers });
      expect(html).toBe('<div class="dc-alert dc-dm-note" data-callout="dm"><p>Something.</p>\n</div>');
    });

    test("an explicit name on the alias line overrides the preset", () => {
      const { html } = renderPaged("@dm-note warning\nText.\n@end-callout\n", { declaredMarkers });
      expect(html).toContain('class="dc-alert dc-note warning"');
      expect(html).toContain('data-callout="warning"');
    });
  });

  describe("deprecated", () => {
    test("a deprecated marker warns and strips — no wrapper is emitted at all", () => {
      const { html, env } = renderPaged("@roll-table\nOld stuff.\n@end-roll-table\n", { declaredMarkers });
      expect(html).toBe("<p>Old stuff.</p>\n");
      const w = (env.layoutWarnings ?? []).filter((x) => x.type === "deprecated_marker");
      expect(w).toHaveLength(2);
      expect(w[0]!.message).toContain("@roll-table");
      expect(w[0]!.message).toContain("Removed in 17.3.0");
      expect(w[1]!.message).toContain("@end-roll-table");
    });
  });

  describe("nesting and auto-close (the same rules @section follows)", () => {
    test("opening a new @page silently drains a still-open declared container (never straddles a page boundary)", () => {
      const { html, env } = renderPaged(
        "@page\n@sidebar\nInside.\n@page\nOutside.\n",
        { declaredMarkers }
      );
      expect(html).toBe(
        '<div class="page"><aside class="dc-sidebar"><p>Inside.</p>\n</aside></div>' +
          '<div class="page"><p>Outside.</p>\n</div>'
      );
      expect(env.layoutWarnings ?? []).toEqual([]);
    });

    test("re-entrant: opening a second instance of the SAME declared kind closes the first, exactly like @section", () => {
      const { html } = renderPaged(
        "@callout note\nFirst.\n@callout warning\nSecond.\n@end-callout\n",
        { declaredMarkers }
      );
      expect(html).toBe(
        '<div class="dc-alert dc-note" data-callout="note"><p>First.</p>\n</div>' +
          '<div class="dc-alert dc-note warning" data-callout="warning"><p>Second.</p>\n</div>'
      );
    });

    test("@end-<name> used with nothing open warns and is otherwise a no-op", () => {
      const { html, env } = renderPaged("@end-sidebar\nText.\n", { declaredMarkers });
      expect(html).toBe("<p>Text.</p>\n");
      const w = (env.layoutWarnings ?? []).filter((x) => x.type === "declared_marker_close_without_open");
      expect(w).toHaveLength(1);
      expect(w[0]!.message).toContain("@end-sidebar");
      expect(w[0]!.message).toContain("@sidebar");
    });

    test("EOF: a marker with NO autoCloseAt still closes (valid HTML), but warns", () => {
      const { html, env } = renderPaged("@sidebar\nUnclosed.\n", { declaredMarkers });
      expect(html).toBe('<aside class="dc-sidebar"><p>Unclosed.</p>\n</aside>');
      const w = (env.layoutWarnings ?? []).filter((x) => x.type === "declared_marker_eof_close");
      expect(w).toHaveLength(1);
      expect(w[0]!.message).toContain("@sidebar");
    });

    test('EOF: a marker WITH autoCloseAt: ["eof"] closes silently — no warning', () => {
      const { html, env } = renderPaged("@callout note\nRuns to EOF.\n", { declaredMarkers });
      expect(html).toBe('<div class="dc-alert dc-note" data-callout="note"><p>Runs to EOF.</p>\n</div>');
      expect((env.layoutWarnings ?? []).filter((x) => x.type === "declared_marker_eof_close")).toEqual([]);
    });
  });

  describe("unknown marker (the marker twin of unknown_gp_class)", () => {
    test("a typo close to a DECLARED name warns with a suggestion, in the concise unknown_gp_class shape", () => {
      const { env } = renderPaged("@calout\nHi.\n", { declaredMarkers });
      const w = (env.layoutWarnings ?? []).filter((x) => x.type === "unknown_marker");
      expect(w).toHaveLength(1);
      expect(w[0]!.message).toBe('Unknown marker "@calout". Did you mean "@callout"?');
    });

    test("fires even in a document with NO OTHER marker at all — unlike the core-only heuristic", () => {
      // scanForMistypedMarkers (core kinds only) is deliberately conservative
      // here (see "a document with no core markers at all is never scanned"
      // above) — the whole point of this diagnostic being modeled on
      // unknown_gp_class instead is that a plugin's vocabulary does not get
      // that same pass. This document uses no core marker whatsoever.
      const { env } = renderPaged("@calout\n\ntext\n", { declaredMarkers });
      expect((env.layoutWarnings ?? []).filter((x) => x.type === "unknown_marker")).toHaveLength(1);
    });

    test("an exact declared name, or an exact core name, is never flagged", () => {
      const { env: e1 } = renderPaged("@sidebar\nHi.\n@end-sidebar\n", { declaredMarkers });
      const { env: e2 } = renderPaged("@page\nHi.\n", { declaredMarkers });
      expect((e1.layoutWarnings ?? []).filter((x) => x.type === "unknown_marker")).toEqual([]);
      expect((e2.layoutWarnings ?? []).filter((x) => x.type === "unknown_marker")).toEqual([]);
    });

    test("a word too far from any declared name stays silent", () => {
      const { env } = renderPaged("@xyz\n\ntext\n", { declaredMarkers });
      expect((env.layoutWarnings ?? []).filter((x) => x.type === "unknown_marker")).toEqual([]);
    });

    test("with no declared markers at all (the zero-#240 case), this check is a complete no-op", () => {
      const { env } = renderPaged("@calout\n\ntext\n");
      expect(env.layoutWarnings ?? []).toEqual([]);
    });
  });

  test("token.meta.line threading matches every core layout_*_open token (source-range primitive)", () => {
    const { tokens } = parsePaged("Intro\n\n@sidebar\nHi\n@end-sidebar\n", { declaredMarkers });
    const t = findToken(tokens, "layout_component_open")!;
    expect(t.meta).toEqual({ line: 3 });
    // Do NOT set token.map — see openChapter's identical comment (ADR 0009).
    // This is what lets the UNCHANGED, unconditional source_range core rule
    // (source-range.ts) annotate a declared marker's wrapper with ZERO
    // extra plumbing: it keys on token.nesting === 1, not on token TYPE. The
    // full data-source-range/data-chapter-src proof, against the real
    // pipeline, lives in source-range.test.ts.
    expect(t.map).toBeNull();
  });
});

describe("createMarkdownRenderer wiring (#240)", () => {
  test("throws at renderer-creation time when two loaded plugins declare colliding marker names, naming both", () => {
    const pluginA: LoadedPlugin = { name: "plugin-a", plugin: () => {}, options: {}, markers: { callout: { class: "a" } } };
    const pluginB: LoadedPlugin = { name: "plugin-b", plugin: () => {}, options: {}, markers: { callout: { class: "b" } } };
    expect(() => createMarkdownRenderer([pluginA, pluginB])).toThrow(/plugin-a/);
    expect(() => createMarkdownRenderer([pluginA, pluginB])).toThrow(/plugin-b/);
  });

  test("throws when a loaded plugin's declared marker shadows a core reserved name", () => {
    const plugin: LoadedPlugin = { name: "plugin-a", plugin: () => {}, options: {}, markers: { section: { class: "x" } } };
    expect(() => createMarkdownRenderer([plugin])).toThrow(/core Gutterpress marker name/);
  });

  test("a loaded plugin with no `markers` export renders exactly as before #240 (zero behavior change)", () => {
    const plugin: LoadedPlugin = { name: "plain-plugin", plugin: () => {}, options: {} };
    const md = createMarkdownRenderer([plugin]);
    const html = md.render("@page\nHi\n", {});
    // createMarkdownRenderer's FULL pipeline also stamps data-source-range/
    // data-source-line (unrelated to #240, unconditional on every render) —
    // asserted on structure/content, not full equality, for that reason.
    expect(html).toContain('<div class="page"');
    expect(html).toContain(">Hi</p>");
  });

  test("declaring `markers` and a hand-written block rule on the SAME plugin are not mutually exclusive", () => {
    // §5 doctrine check: a plugin may declare containers AND still register
    // its own plain markdown-it rules for bespoke behavior the table can't
    // express — the declarative path is an alternative, never a replacement.
    const plugin: LoadedPlugin = {
      name: "hybrid-plugin",
      plugin: (md) => {
        md.core.ruler.after("block", "hybrid_marker", (state) => {
          for (const tok of state.tokens) {
            if (tok.type === "inline") tok.content = tok.content.replace("WORLD", "GALAXY");
          }
        });
      },
      options: {},
      markers: { sidebar: { tag: "aside", class: "dc-sidebar" } },
    };
    const md = createMarkdownRenderer([plugin]);
    const html = md.render("@sidebar\nHELLO WORLD\n@end-sidebar\n", {});
    expect(html).toContain('<aside class="dc-sidebar"');
    expect(html).toContain(">HELLO GALAXY</p>");
    expect(html).not.toContain("WORLD<");
  });
});
