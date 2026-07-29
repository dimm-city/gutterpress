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
import markdownItPaged, { PAGED_CSS } from "./markdown-it-paged.js";
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

    test("@section (standalone, warns section_without_page)", () => {
      const { html, env } = renderPaged("@section\nHi\n");
      expect(html).toBe('<div class="section"><p>Hi</p>\n</div>');
      expect(env.layoutWarnings).toEqual([
        {
          line: 1,
          type: "section_without_page",
          message:
            "@section used without an open @page; region will render but will not be wrapped in a page.",
          marker: { kind: "section", name: null, attrs: {}, __line: 1 },
        },
      ]);
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
      expect(env.layoutWarnings?.[0]?.type).toBe("section_without_page");
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
        '<div class="md-page-break" aria-hidden="true"></div>\n<p>Hi</p>\n'
      );

      const columnBreak = renderPaged("@column-break .foo #bar\nHi\n").html;
      expect(columnBreak).toBe(
        '<div class="md-column-break" aria-hidden="true"></div>\n<p>Hi</p>\n'
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

  test("@section wraps content in div.section (warns, unwrapped by a page)", () => {
    const { html, env } = renderPaged("@section\nHello\n");
    expect(html).toBe('<div class="section"><p>Hello</p>\n</div>');
    expect(env.layoutWarnings?.map((w) => w.type)).toEqual([
      "section_without_page",
    ]);
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
  test("@section without an open @page: section_without_page warning, unwrapped section", () => {
    const { html, env } = renderPaged("@section\nHi\n");
    expect(html).toBe('<div class="section"><p>Hi</p>\n</div>');
    expect(env.layoutWarnings).toEqual([
      {
        line: 1,
        type: "section_without_page",
        message:
          "@section used without an open @page; region will render but will not be wrapped in a page.",
        marker: { kind: "section", name: null, attrs: {}, __line: 1 },
      },
    ]);
  });

  test("@section without a page + implicitPage:true wraps it in an auto page instead", () => {
    const { html, env } = renderPaged("@section\nHi\n", { implicitPage: true });
    expect(html).toBe(
      '<div class="page" data-page="auto"><div class="section"><p>Hi</p>\n</div></div>'
    );
    expect(env.layoutWarnings).toEqual([
      {
        line: 1,
        type: "implicit_page",
        message:
          '@section used without an open @page; creating an implicit page wrapper (data-page="auto").',
        marker: { kind: "section", name: null, attrs: {}, __line: 1 },
      },
    ]);
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

  test("@section directly inside a spread with no @page yet: BOTH section_without_page and spread_without_pages fire", () => {
    const { html, env } = renderPaged("@spread\n@section\nHi\n");
    expect(html).toBe(
      '<div class="spread"><div class="section"><p>Hi</p>\n</div></div>'
    );
    expect(env.layoutWarnings?.map((w) => w.type)).toEqual([
      "section_without_page",
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
  test("@continue closes the current section and opens a new one with the same name + gutterpress-continued class", () => {
    const { html } = renderPaged("@section S\nA\n@continue\nB\n@end-section\n");
    expect(html).toBe(
      '<div class="section" data-section="S"><p>A</p>\n</div>' +
        '<div class="section gutterpress-continued" data-section="S"><p>B</p>\n</div>'
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
      '<div class="section gutterpress-continued" data-section="S" data-region="aside">'
    );
  });

  test("@continue does not duplicate gutterpress-continued if chained twice", () => {
    const { html } = renderPaged(
      "@section S\nA\n@continue\nB\n@continue\nC\n@end-section\n"
    );
    const matches = html.match(/class="section[^"]*"/g) || [];
    expect(matches).toEqual([
      'class="section"',
      'class="section gutterpress-continued"',
      'class="section gutterpress-continued"',
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
      '<div class="page"><p>A</p>\n<div class="md-page-break" aria-hidden="true"></div>\n<p>B</p>\n</div>'
    );
  });

  test("@column-break outside a .col-split section emits a fixed marker div", () => {
    const { html } = renderPaged("@section\nA\n@column-break\nB\n@end-section\n");
    expect(html).toContain(
      '<div class="md-column-break" aria-hidden="true"></div>'
    );
  });

  test("@column-break inside a .col-split section rewrites into sibling .col divs", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section col-split"><div class="col">\n<p>A</p>\n</div>' +
        '<div class="col">\n<p>B</p>\n</div></div>\n'
    );
  });

  test("@column-break with NO col-split class does not open .col wrappers even mid-section", () => {
    const { html } = renderPaged(
      "@section .two-column\nA\n@column-break\nB\n@end-section\n"
    );
    expect(html).not.toContain('class="col"');
    expect(html).toContain(
      '<div class="md-column-break" aria-hidden="true"></div>'
    );
  });

  test("a .col-split section with NO @column-break renders as a single ordinary section", () => {
    const { html } = renderPaged("@section .col-split\nA\n@end-section\n");
    expect(html).toBe('<div class="section col-split"><p>A</p>\n</div>');
  });
});

describe("column-split depth isolation (env.__colSplitDepth, not module state)", () => {
  test("depth is reset to 0 at the start of each render, even when no @page/@chapter marker appears", () => {
    const { env } = renderPaged("@section\nA\n");
    expect(env.__colSplitDepth).toBe(0);
  });

  test("opening a @page unconditionally resets depth to 0 on env (defensive reset, not just lazy init)", () => {
    const { env } = renderPaged("@page\nA\n");
    expect(env.__colSplitDepth).toBe(0);
  });

  test("a balanced .col-split render nets back to its starting depth (0 on a fresh env)", () => {
    const { env } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n"
    );
    expect(env.__colSplitDepth).toBe(0);
  });

  test("two independent renders on fresh envs (same md instance) never see each other's depth", () => {
    const md = new MarkdownIt({ html: true });
    md.use(markdownItPaged);

    const env1: PagedEnv = {};
    const html1 = md.render(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n",
      env1
    );
    expect(html1).toContain('<div class="col">');
    expect(env1.__colSplitDepth).toBe(0);

    const env2: PagedEnv = {};
    const html2 = md.render("@page\nA\n", env2);
    expect(html2).toBe('<div class="page"><p>A</p>\n</div>');
    expect(env2.__colSplitDepth).toBe(0);
  });

  test("layout_page_open defensively resets a poisoned/leaked depth back to 0", () => {
    // Simulate a caller reusing one `env` object across sequential render()
    // calls and something having left a stale, nonzero depth on it. The
    // layout_page_open renderer rule resets depth to 0 unconditionally, so a
    // .col-split section starting fresh under a NEW @page renders with
    // exactly one level of column wrapping, unaffected by the stale value.
    const env: PagedEnv = { __colSplitDepth: 3 };
    const { html } = renderPaged(
      "@page\n@section .col-split\nA\n@column-break\nB\n@end-section\n",
      {},
      env
    );
    expect(html).toBe(
      '<div class="page"><div class="section col-split"><div class="col">\n<p>A</p>\n</div>' +
        '<div class="col">\n<p>B</p>\n</div></div>\n</div>'
    );
    expect(env.__colSplitDepth).toBe(0);
  });

  test("layout_chapter_open also defensively resets a poisoned depth back to 0", () => {
    const env: PagedEnv = { __colSplitDepth: 5 };
    const { html } = renderPaged(
      "@chapter\n@page\n@section .col-split\nA\n@column-break\nB\n@end-section\n",
      {},
      env
    );
    expect(html).toContain('<div class="col">');
    expect(env.__colSplitDepth).toBe(0);
  });

  test("a stale nonzero depth is cleared before a render whose first marker is a .col-split @section", () => {
    const env: PagedEnv = { __colSplitDepth: 2 };
    const { html } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n",
      {},
      env
    );
    expect(html).toBe(
      '<div class="section col-split"><div class="col">\n<p>A</p>\n</div>' +
        '<div class="col">\n<p>B</p>\n</div></div>\n'
    );
    expect(env.__colSplitDepth).toBe(0);
  });
});

describe("col-split has-column-break detection (characterization for the transform-time precompute)", () => {
  // These pin the exact rendered output of the O(n) forward scan currently
  // done per-section inside the layout_section_open renderer rule
  // (:615-622). A refactor that precomputes "does this section contain a
  // column-break" once, during the layout_transform core pass, must produce
  // byte-identical output for every case below — in particular the flag
  // must be scoped to exactly one section's open/close pair and must never
  // leak onto a sibling, a @continue continuation, or a later section.

  test("a col-split section with TWO column-breaks (three columns) col-wraps every segment", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@column-break\nC\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section col-split"><div class="col">\n<p>A</p>\n</div>' +
        '<div class="col">\n<p>B</p>\n</div>' +
        '<div class="col">\n<p>C</p>\n</div></div>\n'
    );
  });

  test("two independent col-split sections, both with breaks, back to back: each gets its own column wrapping, depth resets between them", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n" +
        "@section .col-split\nC\n@column-break\nD\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section col-split"><div class="col">\n<p>A</p>\n</div>' +
        '<div class="col">\n<p>B</p>\n</div></div>\n' +
        '<div class="section col-split"><div class="col">\n<p>C</p>\n</div>' +
        '<div class="col">\n<p>D</p>\n</div></div>\n'
    );
  });

  test("a col-split section WITHOUT a break followed by one WITH a break: the flag must not leak from the second section onto the first (or vice versa)", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@end-section\n" +
        "@section .col-split\nB\n@column-break\nC\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section col-split"><p>A</p>\n</div>' +
        '<div class="section col-split"><div class="col">\n<p>B</p>\n</div>' +
        '<div class="col">\n<p>C</p>\n</div></div>\n'
    );
  });

  test("a col-split section WITH a break followed by one WITHOUT: order reversed, still no leak", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@end-section\n" +
        "@section .col-split\nC\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section col-split"><div class="col">\n<p>A</p>\n</div>' +
        '<div class="col">\n<p>B</p>\n</div></div>\n' +
        '<div class="section col-split"><p>C</p>\n</div>'
    );
  });

  test("@continue on a col-split section: the continuation section's own has-column-break is evaluated independently of the original section's", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@column-break\nB\n@continue\nC\n@end-section\n"
    );
    // First section had a break -> column-wrapped. The continuation section
    // (no break inside it) does not -> plain renderToken output, even though
    // it inherits the .col-split class from the section it continues.
    expect(html).toBe(
      '<div class="section col-split"><div class="col">\n<p>A</p>\n</div>' +
        '<div class="col">\n<p>B</p>\n</div></div>\n' +
        '<div class="section col-split gutterpress-continued"><p>C</p>\n</div>'
    );
  });

  test("@continue on a col-split section where only the CONTINUATION has a break", () => {
    const { html } = renderPaged(
      "@section .col-split\nA\n@continue\nB\n@column-break\nC\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section col-split"><p>A</p>\n</div>' +
        '<div class="section col-split gutterpress-continued"><div class="col">\n<p>B</p>\n</div>' +
        '<div class="col">\n<p>C</p>\n</div></div>\n'
    );
  });

  test("a column-break outside of any col-split section (plain .section) never sets a stray flag that could leak forward", () => {
    const { html } = renderPaged(
      "@section\nA\n@column-break\nB\n@end-section\n" +
        "@section .col-split\nC\n@end-section\n"
    );
    expect(html).toBe(
      '<div class="section"><p>A</p>\n' +
        '<div class="md-column-break" aria-hidden="true"></div>\n<p>B</p>\n</div>' +
        '<div class="section col-split"><p>C</p>\n</div>'
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

  test("a quote/angle bracket smuggled into a .col-split section's class via a mismatched-quote class=value must be escaped in the rendered class attribute, not break out of it", () => {
    // parseMarkerLine's tokenizer only treats a quote character as a
    // delimiter for ITS OWN quote type: while inside a `'...'` run, a literal
    // `"` character is copied straight into the token body (see the
    // single/double-quoted key=value tests above). That lets an author's
    // (or a template's) class value carry a real `"` plus `<`/`>` into
    // `token.attrGet('class')`. The col-split renderer branch must escape
    // that value with the file's own `escapeAttr` before interpolating it,
    // the same as every other attribute this file emits — it must never
    // reach the output raw and break out of the `class="..."` attribute.
    const { html } = renderPaged(
      "@section .col-split class='x\"><y'\nA\n@column-break\nB\n@end-section\n"
    );
    // The raw, unescaped characters must never appear as literal HTML.
    expect(html).not.toContain('x"><y');
    expect(html).toBe(
      '<div class="section col-split x&quot;&gt;&lt;y"><div class="col">\n<p>A</p>\n</div>' +
        '<div class="col">\n<p>B</p>\n</div></div>\n'
    );
  });
});

describe("PAGED_CSS export", () => {
  test("is a non-empty string containing the key selectors the plugin relies on", () => {
    expect(typeof PAGED_CSS).toBe("string");
    expect(PAGED_CSS.length).toBeGreaterThan(0);
    for (const selector of [
      ".md-page-break",
      ".page",
      ".spread",
      ".section",
      ".section.col-split",
      ".md-column-break",
    ]) {
      expect(PAGED_CSS).toContain(selector);
    }
  });
});

// The five author-facing image/block utility classes promised by the user
// guide (Chapter 3 "Common image classes" / "Full-bleed artwork") — see UX
// finding M17 and CLAUDE.md §0 (author-first primitive layering: a behavior
// broadly useful to non-technical authors belongs in core, not a project
// layer). markdown-it-attrs (bundled, see renderer.ts) already lets authors
// attach `{.center}` etc. to any element; PAGED_CSS must supply the matching
// print-safe rules so the classes actually do something.
describe("PAGED_CSS author-facing image/block utilities (M17)", () => {
  test("defines .center as a block-centering rule", () => {
    const rule = PAGED_CSS.match(/\.center\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/margin-left:\s*auto/);
    expect(rule![0]).toMatch(/margin-right:\s*auto/);
  });

  test("defines .float-left / .float-right as real floats with margins", () => {
    const left = PAGED_CSS.match(/\.float-left\s*\{[^}]*\}/);
    const right = PAGED_CSS.match(/\.float-right\s*\{[^}]*\}/);
    expect(left).not.toBeNull();
    expect(right).not.toBeNull();
    expect(left![0]).toMatch(/float:\s*left/);
    expect(left![0]).toMatch(/margin:/);
    expect(right![0]).toMatch(/float:\s*right/);
    expect(right![0]).toMatch(/margin:/);
  });

  test("defines .full-width as 100% of the content width", () => {
    const rule = PAGED_CSS.match(/\.full-width\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    expect(rule![0]).toMatch(/width:\s*100%/);
  });

  test("defines .full-bleed using break-before + Paged.js's own page-margin custom properties (no fabricated @page art template)", () => {
    const rule = PAGED_CSS.match(/\.full-bleed\s*\{[^}]*\}/);
    expect(rule).not.toBeNull();
    const body = rule![0];
    expect(body).toMatch(/break-before:\s*page/);
    // Escapes to the page's own trim edge via the real, Paged.js-populated
    // --pagedjs-margin-* custom properties (see node_modules/pagedjs
    // src/polisher/base.js / atpage.js) — not an invented mechanism.
    expect(body).toMatch(/--pagedjs-margin-left/);
    expect(body).toMatch(/--pagedjs-margin-right/);
    expect(body).toMatch(/margin-left:\s*calc\(-1 \*/);
    expect(body).toMatch(/margin-right:\s*calc\(-1 \*/);
    // Must NOT promise a named `art` page template or header/footer removal —
    // neither is implemented.
    expect(PAGED_CSS).not.toMatch(/@page\s+art\b/);
  });
});

describe("author-facing image/block utilities — rendered output (M17)", () => {
  test("markdown-it-attrs (bundled) attaches .center/.float-left/.float-right/.full-width/.full-bleed to images", () => {
    const md = createMarkdownRenderer();
    const html = md.render(
      "![Centered](a.jpg){.center}\n\n" +
      "![Left](b.jpg){.float-left}\n\n" +
      "![Right](c.jpg){.float-right}\n\n" +
      "![Wide](d.jpg){.full-width}\n\n" +
      "![Bleed](e.jpg){.full-bleed}\n"
    );
    expect(html).toContain('<img src="a.jpg" alt="Centered" class="center">');
    expect(html).toContain('<img src="b.jpg" alt="Left" class="float-left">');
    expect(html).toContain('<img src="c.jpg" alt="Right" class="float-right">');
    expect(html).toContain('<img src="d.jpg" alt="Wide" class="full-width">');
    expect(html).toContain('<img src="e.jpg" alt="Bleed" class="full-bleed">');
  });

  test("a book.html build carries the utility-class CSS through assembleBookHtml's injected <style> block", async () => {
    const html = await assembleBookHtml({
      files: ["01-page.md"],
      readText: async () => "![Art](art.jpg){.full-bleed}\n",
      title: "Utility class build test",
    });

    expect(html).toContain('<img src="art.jpg" alt="Art" class="full-bleed">');
    // The style block is the one, real vehicle for this CSS (assemble.ts
    // injects PAGED_CSS verbatim) — no separate theme/plugin CSS is involved.
    for (const selector of [".center", ".float-left", ".float-right", ".full-width", ".full-bleed"]) {
      expect(html).toContain(selector);
    }
  });
});
