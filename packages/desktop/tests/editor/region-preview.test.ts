import { describe, expect, test } from "bun:test";
import {
  createDocParser,
  createEditorRenderer,
  serializeDoc,
} from "../../src/lib/editor/markdown-doc";
import type { Node as PMNode } from "prosemirror-model";

/**
 * What an OPAQUE transform region shows.
 *
 * A region the parser cannot open up collapses to `gp_plugin_atom`, and the
 * only markup a `toDOM` spec can produce for it is escaped text — so the view
 * used to paint the author's raw markdown where print shows the plugin's
 * output. Measured on the Dimm City field guide: 305 such regions, 109k
 * characters, most of nine chapters rendered as source. The parser now keeps
 * the transform's OWN html on the node (`attrs.html`, rendered by
 * `rich-editor.ts`'s `pluginAtomView`).
 *
 * The second half of the contract is ancestry. A transform's output does not
 * respect region boundaries — the field guide's opens a skill card in one
 * region and closes it three regions later — so each region re-opens whatever
 * the ones before it left open. Without that, a node's html is auto-closed at
 * its own edge and the card's contents render outside the card.
 *
 * None of it can reach the file: `marker` is still what serializes, and every
 * assertion below re-checks the bytes.
 */

type Md = import("markdown-it");
type MdPlugin = (m: Md) => void;

/**
 * The skill-card shape, reduced: `@card` opens two nested elements and closes
 * neither, `!!! x` renders a note that BELONGS inside them, `@end-card`
 * closes both. Each marker paragraph is its own hunk, so each becomes its own
 * region — exactly the cross-boundary nesting the real plugin produces.
 *
 * None of the three outputs is a lone tag on its own line, so none of them
 * pairs into a wrapper; all three stay opaque atoms (that is the case under
 * test — a region that DOES pair renders through `tag`/`viewAttrs` instead).
 */
const cardTransform: MdPlugin = (m) => {
  m.core.ruler.push("t_card", (state) => {
    const toks = state.tokens;
    const out: typeof toks = [];
    for (let i = 0; i < toks.length; i++) {
      const tok = toks[i]!;
      const text = toks[i + 1]?.content?.trim() ?? "";
      const emit = (content: string) => {
        const html = new state.Token("html_block", "", 0);
        html.content = content;
        html.block = true;
        out.push(html);
        i += 2;
      };
      if (tok.type === "paragraph_open" && toks[i + 1]?.type === "inline") {
        if (text === "@card") {
          emit('<div class="t-card" id="c1"><div class="t-body">\n');
          continue;
        }
        if (text === "@end-card") {
          emit("</div></div>\n");
          continue;
        }
        if (text.startsWith("!!! ")) {
          emit(`<p class="t-note">${text.slice(4)}</p>\n`);
          continue;
        }
      }
      out.push(tok);
    }
    state.tokens = out;
    return true;
  });
};

function atoms(doc: PMNode): PMNode[] {
  const out: PMNode[] = [];
  doc.descendants((node) => {
    if (node.type.name === "gp_plugin_atom") out.push(node);
    return true;
  });
  return out;
}

/**
 * Ordinary paragraphs sit between the markers on purpose: with the marker
 * paragraphs adjacent, the differ sees ONE contiguous removed run and the
 * whole thing is a single region — real books have content in between, and
 * the cross-region nesting is only visible when the regions are separate.
 */
const SRC =
  "@card\n\nBody one.\n\n!!! alpha\n\nBody two.\n\n@end-card\n\nBody three.\n\n!!! outside\n";

describe("opaque region previews", () => {
  test("an atom carries the transform's html, not the author's source", () => {
    const md = createEditorRenderer([{ name: "card", plugin: cardTransform, options: {} }]);
    const [first] = atoms(createDocParser(md).parse(SRC));
    expect(first).toBeDefined();
    // `text` (the old and only display) is the author's marker line; `html`
    // is what the plugin actually rendered for it.
    expect(first!.attrs.text).toBe("@card");
    expect(first!.attrs.html).toContain('<div class="t-card" id="c1">');
  });

  test("a later region re-opens what earlier ones left open", () => {
    const md = createEditorRenderer([{ name: "card", plugin: cardTransform, options: {} }]);
    const [, note] = atoms(createDocParser(md).parse(SRC));
    const html = note!.attrs.html as string;
    // The note is inside the card in print, so it must be inside it here —
    // this is the whole reason the running stack exists.
    expect(html).toBe('<div class="t-card"><div class="t-body"><p class="t-note">alpha</p>\n');
    // `id` may appear once in a document; the re-opened copy drops it.
    expect(html).not.toContain('id="c1"');
  });

  test("a region's own closes pop the stack, so later ones are not re-nested", () => {
    const md = createEditorRenderer([{ name: "card", plugin: cardTransform, options: {} }]);
    const list = atoms(createDocParser(md).parse(SRC));
    expect(list).toHaveLength(4);
    // `@end-card` closes both, so the note after it opens at top level.
    expect(list[3]!.attrs.html).toBe('<p class="t-note">outside</p>\n');
  });

  test("the preview never reaches the file", () => {
    const md = createEditorRenderer([{ name: "card", plugin: cardTransform, options: {} }]);
    const doc = createDocParser(md).parse(SRC);
    const out = serializeDoc(doc);
    expect(out).toBe(SRC);
    expect(out).not.toContain("t-card");
    expect(out).not.toContain("t-note");
  });

  test("a region that swallowed real content renders that content too", () => {
    // The `!!!` regions above synthesize their own text. This one is the
    // GFM-alert shape: the blockquote's open and close are replaced in two
    // places and its interior survives by reference, so the differ merges the
    // lot into one region. The preview is the RENDER of that region's tokens,
    // so the survivor shows up styled instead of going missing.
    const withSurvivor: MdPlugin = (m) => {
      m.core.ruler.push("t_wrap", (state) => {
        const toks = state.tokens;
        const open = toks.findIndex((t) => t.type === "blockquote_open");
        const close = toks.findIndex((t) => t.type === "blockquote_close");
        if (open === -1 || close === -1) return true;
        const tag = (content: string) => {
          const t = new state.Token("html_block", "", 0);
          t.content = content;
          t.block = true;
          return t;
        };
        state.tokens = [
          ...toks.slice(0, open),
          // Deliberately NOT a lone tag: a region whose every line is one
          // tag pairs into a wrapper instead of staying opaque.
          tag('<aside class="t-aside"><span class="t-badge">Note</span>\n'),
          ...toks.slice(open + 1, close),
          tag("</aside>\n"),
          ...toks.slice(close + 1),
        ];
        return true;
      });
    };
    const md = createEditorRenderer([{ name: "wrap", plugin: withSurvivor, options: {} }]);
    const src = "> Body *here*.\n";
    const doc = createDocParser(md).parse(src);
    const [only] = atoms(doc);
    const html = only!.attrs.html as string;
    expect(html).toContain('<aside class="t-aside">');
    expect(html).toContain("<em>here</em>");
    expect(serializeDoc(doc)).toBe(src);
  });
});
