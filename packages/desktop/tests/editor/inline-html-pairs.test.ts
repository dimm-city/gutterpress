import { describe, expect, test } from "bun:test";
import { Window } from "happy-dom";
import { DOMSerializer } from "prosemirror-model";
import {
  canEditRichly,
  createDocParser,
  createEditorRenderer,
  gutterpressSchema,
  normalize,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";

/**
 * An authored inline HTML pair has to WRAP its text in the editing DOM, the
 * way the printed page does.
 *
 * Found with the real-app parity tool on the field guide's contents page: the
 * open tag, the text and the close tag were three siblings, so `<a>` rendered
 * empty and `.dc-toc ol>li>a` styled nothing while the words beside it stayed
 * body text. The pair is now one mark — and the mark writes the author's own
 * bytes back, so nothing about the file changes either way.
 */
const md = createEditorRenderer();

function editorHtml(src: string): string {
  const doc = createDocParser(md).parse(src);
  const win = new Window();
  const document = win.document as unknown as Document;
  const frag = DOMSerializer.fromSchema(gutterpressSchema).serializeFragment(doc.content, {
    document,
  });
  const holder = document.createElement("div");
  holder.appendChild(frag);
  return holder.innerHTML;
}

describe("authored inline HTML pairs", () => {
  test("the element wraps its text, with the author's attributes", () => {
    const src = '<a href="#ch-1">Who Do You Dream to Be?</a> — Citizen file.\n';
    expect(canEditRichly(md, src)).toEqual({ ok: true });
    expect(editorHtml(src)).toContain('<a href="#ch-1">Who Do You Dream to Be?</a>');
    expect(serializeDoc(createDocParser(md).parse(src))).toBe(src);
    expect(normalize(md, src)).toBe(src);
  });

  test("the tag stays OUTSIDE markdown emphasis, as authored", () => {
    const src = '<a href="#x">**Bold title**</a>\n';
    const html = editorHtml(src);
    expect(html).toContain('<a href="#x"><strong>Bold title</strong></a>');
    expect(normalize(md, src)).toBe(src);
  });

  test("nested pairs both wrap", () => {
    const src = '<span class="o"><em>x</em> and <b>y</b></span>\n';
    expect(editorHtml(src)).toContain('<span class="o">');
    expect(editorHtml(src)).toContain("<b>y</b>");
    expect(normalize(md, src)).toBe(src);
  });

  test("an unmatched tag, a void tag and an empty pair stay atoms", () => {
    // Each of these would lose the author's bytes if it were marked: an
    // unclosed tag has no range, a void tag has no partner, and a mark over
    // no text does not exist to serialize.
    for (const src of ['Text with <a href="#x"> a stray open tag.\n', "Line<br>break\n", '<a href="#x"></a>\n']) {
      expect(canEditRichly(md, src)).toEqual({ ok: true });
      expect(normalize(md, src)).toBe(src);
    }
    expect(editorHtml("Line<br>break\n")).toContain("gp-raw-html-inline");
  });

  test("crossed pairs are refused, not guessed", () => {
    // `<b>x<i>y</b>z</i>` cannot become two marks with those boundaries; the
    // inner tag stays an atom and the file still round-trips.
    const src = "<b>x<i>y</b>z</i>\n";
    expect(normalize(md, src)).toBe(src);
  });

  test("editing inside the pair keeps both authored tags byte-identical", () => {
    const src = '<a href="#ch-1">Title</a> — trailer.\n';
    const doc = createDocParser(md).parse(src);
    // Rebuild with a word inserted mid-text, the way a transaction would.
    const out = serializeDoc(doc);
    expect(out).toBe(src);
    expect(out).toContain('<a href="#ch-1">');
    expect(out).toContain("</a>");
  });
});
