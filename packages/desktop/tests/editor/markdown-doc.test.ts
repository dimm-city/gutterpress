import { describe, expect, test } from "bun:test";
import {
  canEditRichly,
  createEditorRenderer,
  createDocParser,
  isFixpoint,
  normalize,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";
import { semanticHtml } from "../support/semantic-html";

/** A fresh instance per call, same configuration the print path uses. */
const md = () => createEditorRenderer();

function roundTrip(src: string): string {
  return serializeDoc(createDocParser(md()).parse(src));
}

describe("parse -> serialize round trip", () => {
  const cases: Record<string, string> = {
    paragraph: "Hello world.\n",
    heading: "# Title\n",
    "nested heading": "### Third level\n",
    emphasis: "Some **bold** and _em_ text.\n",
    "inline code": "Call `render()` now.\n",
    link: "See [docs](https://example.com) for more.\n",
    image: "![alt text](img.png)\n",
    blockquote: "> quoted line\n",
    "bullet list": "* one\n* two\n",
    "ordered list": "1. one\n2. two\n",
    fence: "```js\nconst x = 1;\n```\n",
    hr: "---\n",
    "two paragraphs": "First para.\n\nSecond para.\n",
  };

  for (const [name, src] of Object.entries(cases)) {
    test(`${name} is a fixpoint`, () => {
      const once = roundTrip(src);
      const twice = roundTrip(once);
      expect(twice).toBe(once);
    });
  }
});

describe("author HTML that WRAPS markdown", () => {
  // A book writes components as an HTML wrapper with markdown inside; the
  // blank lines are what keep the inside markdown. Modelling each tag as its
  // own atom put the content BESIDE the wrapper instead of in it, and every
  // style scoped to that wrapper stopped applying — measured on the design
  // guide, where sidebar text rendered at body size because, in the editing
  // DOM, it was not inside the sidebar.
  const wrapped = '<div class="example">\n\nBody **markdown** here.\n\n</div>\n';

  test("nests the content inside the wrapper", () => {
    const doc = createDocParser(md()).parse(wrapped);
    const block = doc.child(0);
    expect(block.type.name).toBe("gp_plugin_block");
    expect(block.attrs.tag).toBe("div");
    expect((block.attrs.viewAttrs as Record<string, string>).class).toBe("example");
    expect(block.childCount).toBe(1);
    expect(block.child(0).textContent).toBe("Body markdown here.");
  });

  test("round-trips the author's own tags verbatim", () => {
    expect(roundTrip(wrapped)).toBe(wrapped);
    expect(roundTrip(roundTrip(wrapped))).toBe(roundTrip(wrapped));
  });

  test("nests through several levels", () => {
    const src =
      '<div class="example">\n\n<div class="sidebar">\n\nInner.\n\n</div>\n\n</div>\n';
    const doc = createDocParser(md()).parse(src);
    const outer = doc.child(0);
    expect((outer.attrs.viewAttrs as Record<string, string>).class).toBe("example");
    const inner = outer.child(0);
    expect(inner.type.name).toBe("gp_plugin_block");
    expect((inner.attrs.viewAttrs as Record<string, string>).class).toBe("sidebar");
    expect(roundTrip(src)).toBe(src);
  });

  test("a self-contained element stays a verbatim atom", () => {
    // No markdown inside, nothing to nest: this is the html_block case, and
    // its bytes must round-trip exactly as they always did.
    const src = '<div class="note">Just <em>html</em>.</div>\n';
    expect(roundTrip(src)).toBe(src);
  });

  test("an unbalanced tag is left alone rather than guessed at", () => {
    const src = '<div class="open">\n\nText.\n';
    const doc = createDocParser(md()).parse(src);
    expect(doc.child(0).type.name).toBe("html_block");
    expect(roundTrip(src)).toBe(src);
  });
});

describe("Gutterpress layout markers", () => {
  const markers: Record<string, string> = {
    "@chapter": "@chapter C.01 #ch-one .fancy\n\nBody text.\n",
    "@page": "@page #pg-one .opener\n\nBody text.\n",
    "@spread": "@spread\n\nBody text.\n",
    "@section with end": "@section .two-column\n\nBody text.\n\n@end-section\n",
    "@page-break": "Before.\n\n@page-break\n\nAfter.\n",
    "@column-break": "@section\n\nA\n\n@column-break\n\nB\n\n@end-section\n",
  };

  for (const [name, src] of Object.entries(markers)) {
    test(`${name} survives verbatim`, () => {
      const out = roundTrip(src);
      // The AUTHORED marker line must reappear exactly — its attributes are
      // not invertible (a @page inherits data-chapter-label from its chapter),
      // which is why the node carries the source line.
      const markerLine = src.split("\n").find((l) => l.startsWith("@"))!;
      expect(out).toContain(markerLine);
    });

    test(`${name} is a fixpoint`, () => {
      const once = roundTrip(src);
      expect(roundTrip(once)).toBe(once);
    });
  }
});

  test("a marker's own attributes reach the editing DOM, not just its class", () => {
    // The wrapper the pipeline emits carries the author's `#id` and, for a
    // labelled chapter, `data-chapter-label`. The editor kept only `class`,
    // so a book styling `#ch-one .lede` or `[data-chapter-label]` — the
    // frozen chapter-opener pattern does exactly that — rendered differently
    // in the editor than in print for no reason but attributes lost in
    // transit. View-only: none of them is ever serialized back.
    const doc = createDocParser(md()).parse(
      '@chapter "C.01" #ch-one .fancy\n\n@page\n\nBody text.\n',
    );
    const chapter = doc.child(0);
    expect(chapter.type.name).toBe("gp_chapter");
    const view = chapter.attrs.viewAttrs as Record<string, string>;
    expect(view.id).toBe("ch-one");
    expect(view["data-chapter-label"]).toBe("C.01");
    // …and the class stays where it was, not duplicated into viewAttrs.
    expect(view.class).toBeUndefined();
    expect(chapter.attrs.class).toContain("fancy");
    expect(serializeDoc(doc)).toBe('@chapter "C.01" #ch-one .fancy\n\n@page\n\nBody text.\n');
  });

describe("tables", () => {
  const src = "| A | B |\n| --- | --- |\n| 1 | 2 |\n";

  test("round-trips to a table", () => {
    const out = roundTrip(src);
    expect(out).toContain("| A | B |");
    expect(out).toContain("| 1 | 2 |");
  });

  test("is a fixpoint", () => {
    const once = roundTrip(src);
    expect(roundTrip(once)).toBe(once);
  });

  test("a pipe inside a cell is escaped so the row stays a row", () => {
    const out = roundTrip("| A | B |\n| --- | --- |\n| a \\| b | 2 |\n");
    expect(out.split("\n").find((l) => l.includes("a "))!.match(/(?<!\\)\|/g)!.length).toBe(3);
  });
});

describe("raw HTML is carried verbatim", () => {
  test("html_block", () => {
    const out = roundTrip('<div class="lede">Intro</div>\n');
    expect(out).toContain('<div class="lede">Intro</div>');
  });

  test("html_block is a fixpoint", () => {
    const once = roundTrip('<div class="lede">Intro</div>\n');
    expect(roundTrip(once)).toBe(once);
  });

  test("html_inline", () => {
    const out = roundTrip("text with <br> inside\n");
    expect(out).toContain("<br>");
  });
});

describe("fail closed", () => {
  test("footnotes are refused, not mis-serialized", () => {
    const verdict = canEditRichly(md(), "Text[^a]\n\n[^a]: A note.\n");
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain("not supported");
  });

  test("definition lists are refused", () => {
    const verdict = canEditRichly(md(), "Term\n: definition\n");
    expect(verdict.ok).toBe(false);
  });

  test("ordinary prose is accepted", () => {
    expect(canEditRichly(md(), "Just a paragraph.\n").ok).toBe(true);
  });

  test("a refusal names the construct so the UI can explain it", () => {
    const verdict = canEditRichly(md(), "Text[^a]\n\n[^a]: A note.\n");
    if (!verdict.ok) expect(verdict.reason.length).toBeGreaterThan(0);
  });
});

describe("normalization is accepted, but must be stable", () => {
  test("normalize is idempotent on a mixed document", () => {
    const src = [
      "@chapter C.01 #ch",
      "",
      "# Heading",
      "",
      "Text with **bold**, _em_, `code` and a [link](x).",
      "",
      "- item one",
      "- item two",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "> quote",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
    ].join("\n");
    const r = isFixpoint(md(), src);
    expect(r.ok).toBe(true);
  });

  test("normalize returns a trailing newline and no trailing blank run", () => {
    const out = normalize(md(), "Text.\n\n\n\n");
    expect(out.endsWith("\n")).toBe(true);
    expect(out.endsWith("\n\n")).toBe(false);
  });
});

/**
 * Byte- and meaning-fidelity found lacking on the REAL plugin books (the
 * dc-op-manual acceptance run, spec §7): each case here was measured as a
 * fixpoint or semantic-preservation failure on a shipped chapter before the
 * fix it pins.
 */
describe("real-book fidelity", () => {
  test("the authored bullet character round-trips", () => {
    // Serializing every list as `*` merged the field guide's alternating
    // `*`/`+` single-item lists into ONE loose list on reparse — a rendered
    // DOM change plus a blank-line churn that broke the fixpoint.
    expect(roundTrip("- one\n- two\n")).toBe("- one\n- two\n");
    expect(roundTrip("+ one\n+ two\n")).toBe("+ one\n+ two\n");
  });

  test("adjacent distinct-marker lists stay separate lists", () => {
    const src = "Intro:\n\n* first\n\n+ second\n";
    const m = md();
    const out = normalize(m, src);
    expect(out).toContain("* first");
    expect(out).toContain("+ second");
    expect(isFixpoint(m, out).ok).toBe(true);
    const uls = (html: string) => (html.match(/<ul/g) ?? []).length;
    expect(uls(m.render(out, {}))).toBe(uls(m.render(src, {})));
  });

  test("block-end braces on a paragraph round-trip (the space binds them to the block)", () => {
    // `![art](a.png) {.fg-x}` puts the class on the PARAGRAPH; it was
    // silently dropped on save (chapter-00's `.fg-art-intro-creaturepunk`).
    expect(roundTrip("![art](a.png) {.fg-x}\n")).toBe("![art](a.png) {.fg-x}\n");
  });

  test("image-bound braces are NOT also claimed by the paragraph", () => {
    // `){.x}` touches the image and is the image's alone — the first cut of
    // the paragraph rule re-emitted it at paragraph level too, which moved
    // the class onto the <p> on reparse.
    expect(roundTrip("![art](a.png){.fg-x}\n")).toBe("![art](a.png){.fg-x}\n");
  });

  test("braces on a horizontal rule round-trip", () => {
    // `---{.column-break}` — the design guide's decorated-rule idiom.
    expect(roundTrip("---{.column-break}\n")).toBe("---{.column-break}\n");
  });

  test("an authored HTML entity keeps its bytes AND its meaning", () => {
    // `&quot;` is exempt from typographer; decoding it to `"` on save made
    // the next render curl it (chapter-05's semantic drift).
    const src = "&quot;The streets keep score.&quot;\n";
    const m = md();
    expect(normalize(m, src)).toBe(src);
    expect(m.render(normalize(m, src), {})).toBe(m.render(src, {}));
  });

  test("an entity in a HEADING never deletes the heading", () => {
    // REGRESSION: the entity->html_inline retag produced an atom that
    // heading content (`(text | image)*`) refuses, and `createAndFill` then
    // dropped the WHOLE heading node — `# A &amp; B` vanished from the file
    // on save. In a heading the entity stays on the decoded-text path: the
    // byte decodes (the pre-retag lesser loss), but the heading and its
    // rendered meaning survive.
    const m = md();
    const src = "# A &amp; B\n\nBody &amp; text.\n";
    const doc = createDocParser(m).parse(src);
    expect(doc.child(0).type.name).toBe("heading");
    expect(doc.child(0).textContent).toBe("A & B");
    const out = normalize(m, src);
    // The heading decodes its entity; the paragraph keeps its bytes.
    expect(out).toBe("# A & B\n\nBody &amp; text.\n");
    expect(m.render(out, {})).toBe(m.render(src, {}));
    expect(isFixpoint(m, src).ok).toBe(true);
  });

  test("entities in headings survive across shapes (nbsp, link-wrapped)", () => {
    const m = md();
    for (const src of ["# Chapter&nbsp;One\n", "## A &ndash; B\n", "# See [a &amp; b](url)\n"]) {
      const doc = createDocParser(m).parse(src);
      expect({ src, first: doc.child(0).type.name }).toEqual({ src, first: "heading" });
      // semanticHtml: decoding the entity legitimately changes the
      // source-coordinate plumbing attrs (`data-gp-source-token`); the
      // rendered CONTENT must not change.
      expect(semanticHtml(m.render(normalize(m, src), {}))).toBe(semanticHtml(m.render(src, {})));
      expect(isFixpoint(m, src).ok).toBe(true);
    }
  });

  test("an entity in a paragraph still round-trips byte-exact", () => {
    // The heading carve-out must not widen: outside headings the entity
    // keeps its authored bytes via the html_inline retag.
    const m = md();
    for (const src of ["Body &amp; text.\n", "Fee&nbsp;schedule.\n"]) {
      expect(normalize(m, src)).toBe(src);
      expect(m.render(normalize(m, src), {})).toBe(m.render(src, {}));
    }
  });

  test("value-less braces round-trip on every block that takes them", () => {
    // `{disabled}` — markdown-it-attrs consumes the braces and sets
    // `disabled=""` on the element; the brace parser dropped the bare token,
    // so the attribute silently vanished from the file on save.
    const m = md();
    for (const src of [
      "Hello world {disabled}\n",
      "# Head {disabled}\n",
      "---{disabled}\n",
      "```js {disabled}\ncode\n```\n",
      "![img](a.png){contenteditable}\n",
    ]) {
      expect({ src, out: normalize(m, src) }).toEqual({ src, out: src });
      expect(m.render(normalize(m, src), {})).toBe(m.render(src, {}));
    }
  });

  test("value-less braces mix canonically with valued ones", () => {
    const m = md();
    const src = "Hello world {disabled data-x=1}\n";
    const out = normalize(m, src);
    // Canonical emission: non-class/id keys alphabetically, bare key for the
    // value-less one.
    expect(out).toBe("Hello world {data-x=1 disabled}\n");
    expect(isFixpoint(m, src).ok).toBe(true);
    // semanticHtml: reordering the braces reorders the rendered attributes;
    // the attribute SET must be unchanged.
    expect(semanticHtml(m.render(out, {}))).toBe(semanticHtml(m.render(src, {})));
  });
});

/**
 * Regressions found by review, each one a way an author's file came back
 * changed. Every case here failed before the fix; the comment on each says
 * what it produced.
 */
describe("content preservation", () => {
  /** Every character with the SET of marks on it, nesting order ignored. */
  function markProfile(src: string): string {
    const doc = createDocParser(md()).parse(src);
    const out: string[] = [];
    doc.descendants((node) => {
      if (!node.isText) return true;
      const marks = node.marks.map((m) => m.type.name).sort().join("+");
      for (const ch of node.text ?? "") out.push(`${ch}:${marks}`);
      return true;
    });
    return out.join("|");
  }

  test("emphasis nested inside a link keeps its markers", () => {
    // Was: `[a **bold *****italic*** **word**](…)`, which re-parses with a
    // literal `**bold **` as TEXT. Mark order in schema.ts is the fix.
    const src = "[a **bold _italic_ word**](https://example.com)\n";
    expect(roundTrip(src)).toBe("[a **bold *italic* word**](https://example.com)\n");
    expect(markProfile(roundTrip(src))).toBe(markProfile(src));
  });

  test("a bold link does not turn inside out", () => {
    // Was: `**[bold link](…)**` — link and strong swapped nesting.
    expect(roundTrip("[**bold link**](https://example.com)\n")).toBe(
      "[**bold link**](https://example.com)\n",
    );
  });

  test("a header-only table gains no phantom row", () => {
    // Was: a `|  |` row appended, which rendered as a real empty row.
    const src = "| A | B |\n| --- | --- |\n";
    expect(roundTrip(src)).toBe(src);
  });

  test("a quoted multi-word attribute value stays quoted", () => {
    // Was: `{data-note=two words}`, re-parsing as data-note="two" plus an
    // invented `words=""`.
    const src = '# Heading {data-note="two words"}\n';
    expect(roundTrip(src)).toBe(src);
  });

  test("attribute values are quoted only when they need it", () => {
    expect(roundTrip("# Heading {#id .cls data-x=plain}\n")).toBe(
      "# Heading {.cls #id data-x=plain}\n",
    );
  });

  test("link attributes survive", () => {
    // Was: dropped entirely — every `target`, `rel` and utility class gone.
    expect(roundTrip('[docs](https://example.com){target="_blank"}\n')).toBe(
      "[docs](https://example.com){target=_blank}\n",
    );
    expect(roundTrip("[docs](https://example.com){.external}\n")).toBe(
      "[docs](https://example.com){.external}\n",
    );
  });

  test("fence attributes survive", () => {
    // Was: dropped, leaving only the language.
    const src = "```js {.line-numbers}\nconst x = 1;\n```\n";
    expect(roundTrip(src)).toBe(src);
  });

  test("a fence still grows past a backtick run in its own body", () => {
    const src = "````text {.x}\n```\n````\n";
    expect(roundTrip(src)).toBe(src);
  });

  test("an author's aria-hidden is not mistaken for a generated one", () => {
    // Was: stripped, deleting a deliberate accessibility annotation.
    expect(roundTrip('![Decorative](border.png){aria-hidden="true"}\n')).toBe(
      "![Decorative](border.png){aria-hidden=true}\n",
    );
  });

  test("pipeline-generated attributes are still not written back", () => {
    // The other half of the same filter: these must never reach the file.
    const out = roundTrip("# Title\n");
    expect(out).not.toContain("data-source-range");
    expect(out).not.toContain("data-chapter-label");
  });

  test("a file defining a link reference is refused, not silently emptied", () => {
    // Was: accepted, and the definition line deleted on save. Invisible to
    // both the fixpoint gate (a loss is stable) and the semantic gate (a
    // definition renders no HTML).
    const src = 'Just a paragraph.\n\n[unused]: https://example.com "Unused"\n';
    const verdict = canEditRichly(md(), src);
    expect(verdict.ok).toBe(false);
    expect(verdict.ok === false && verdict.reason).toContain("[unused]");
  });

  test("a file with no references is unaffected", () => {
    expect(canEditRichly(md(), "Just a paragraph.\n").ok).toBe(true);
  });
});
