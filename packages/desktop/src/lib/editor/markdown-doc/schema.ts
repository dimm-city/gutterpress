/**
 * The ProseMirror schema for a Gutterpress document.
 *
 * Built on `prosemirror-markdown`'s own schema (doc, paragraph, blockquote,
 * horizontal_rule, heading, code_block, ordered_list, bullet_list, list_item,
 * text, image, hard_break; marks em, strong, link, code) and extended with the
 * three things a Gutterpress book actually contains that it does not cover.
 *
 * The additions were chosen by MEASURING the token vocabulary of every example
 * book rather than by guessing — 40 distinct block token types and 12 inline
 * ones across the corpus:
 *
 *   - TABLES (30 tables / 412 `td` / 82 `th`). markdown-it emits GFM tables by
 *     default; `prosemirror-markdown`'s schema has no table nodes.
 *   - GUTTERPRESS LAYOUT MARKERS (`layout_chapter/_spread/_page/_section` plus
 *     the `_page_break` / `_column_break` atoms) — the product's authoring
 *     surface, parsed by `markers.js`.
 *   - RAW HTML (51 `html_block`, 30 `html_inline`). Too common to refuse; the
 *     renderer runs `html: true` with no allowlist, so this is ordinary
 *     authored content and is carried verbatim.
 *
 * Deliberately absent, and therefore rejected by the preflight rather than
 * mis-modelled: footnotes, definition lists, and the sub/sup/mark/abbr plugin
 * set. `MarkdownParser` throws on a token type it has no spec for
 * ("Token type `x` not supported"), so an unmodelled construct fails CLOSED —
 * the file opens in source mode. That is the behaviour we want, and it comes
 * from the library rather than from a list we have to remember to maintain.
 */
import { schema as base } from "prosemirror-markdown";
import { Schema, type NodeSpec } from "prosemirror-model";

/**
 * A Gutterpress layout wrapper.
 *
 * `marker` holds the AUTHORED marker line, verbatim — not a reconstruction
 * from the emitted attributes. That is deliberate and it is not the
 * postmortem's `srcMap` smell (which memoized bytes for every node to paper
 * over a lossy serializer). The token's attributes genuinely cannot be
 * inverted: `layout_page_open` carries `data-chapter-label` PROPAGATED from
 * its enclosing chapter, indistinguishable from an authored one, and
 * `data-source-range` is added by a later core rule. Rebuilding `@page` from
 * them would invent `label=…` the author never wrote. Keeping the one source
 * line is exact, and it is one attribute on one node type.
 */
/**
 * `class` is the classes `markers.js` PUT ON THE TOKEN — `"page wide"`,
 * `"section gp-columns-2"` — carried through so the editing view emits the
 * same DOM the print path does.
 *
 * This is what makes "looks as it will print" true rather than approximate: a
 * book styles `.page`, `.section` and its own `.wide`/`.gp-columns-2` utility
 * classes, so a view that rendered a generic `div.gp-layout` would drop every
 * one of those rules on the floor. It is also why the editor needs no
 * stylesheet of its own for author content — the book's CSS matches, unchanged.
 *
 * View-only: the serializer round-trips from `marker` alone (the authored
 * line), so nothing here can reach the file.
 */
function layoutWrapper(): NodeSpec {
  return {
    content: "block+",
    group: "block",
    defining: true,
    attrs: { marker: { default: "" }, class: { default: "" } },
    // Rendered for the editing view only. The PRINT path never sees this
    // schema — it renders through markdown-it exactly as it always has.
    toDOM: (node) => [
      "div",
      { class: (node.attrs.class as string) || "gp-layout", "data-marker": node.attrs.marker as string },
      0,
    ],
  };
}

function layoutAtom(): NodeSpec {
  return {
    group: "block",
    atom: true,
    selectable: true,
    attrs: { marker: { default: "" }, class: { default: "" } },
    toDOM: (node) => [
      "div",
      {
        class: (node.attrs.class as string) || "gp-layout-atom",
        "data-marker": node.attrs.marker as string,
        "aria-hidden": "true",
      },
    ],
  };
}

const tableNodes: Record<string, NodeSpec> = {
  table: { content: "table_head? table_body", group: "block", tableRole: "table", isolating: true,
    toDOM: () => ["table", 0] },
  table_head: { content: "table_row+", tableRole: "head", isolating: true, toDOM: () => ["thead", 0] },
  table_body: { content: "table_row+", tableRole: "body", isolating: true, toDOM: () => ["tbody", 0] },
  table_row: { content: "(table_cell | table_header)*", tableRole: "row", toDOM: () => ["tr", 0] },
  // Cells hold INLINE content, not blocks: markdown tables are single-line by
  // construction, and allowing `block+` here would let the editor create cell
  // content that has no markdown spelling.
  table_cell: { content: "inline*", tableRole: "cell", isolating: true,
    attrs: { align: { default: null } },
    toDOM: (n) => ["td", n.attrs.align ? { style: `text-align:${n.attrs.align}` } : {}, 0] },
  table_header: { content: "inline*", tableRole: "header_cell", isolating: true,
    attrs: { align: { default: null } },
    toDOM: (n) => ["th", n.attrs.align ? { style: `text-align:${n.attrs.align}` } : {}, 0] },
};

/**
 * `markdown-it-attrs` braces, kept on the nodes that actually carry them.
 *
 * Measured across the first-party corpus: 18 heading ids and 10 image classes.
 * Without this they were silently dropped on save — see `attrs.ts`. The value
 * is the author's attribute map; `attrsToBraces()` turns it back into
 * `{.gp-bleed}` / `{#custom-id}` on serialize.
 */
const withAttrs = (spec: NodeSpec): NodeSpec => ({
  ...spec,
  attrs: { ...(spec.attrs ?? {}), attrs: { default: null } },
});

export const gutterpressSchema = new Schema({
  nodes: base.spec.nodes
    .update("image", withAttrs(base.spec.nodes.get("image")!))
    .update("heading", withAttrs(base.spec.nodes.get("heading")!))
    .append(tableNodes)
    .append({
      gp_chapter: layoutWrapper(),
      gp_spread: layoutWrapper(),
      gp_page: layoutWrapper(),
      gp_section: layoutWrapper(),
      gp_page_break: layoutAtom(),
      gp_column_break: layoutAtom(),
      /** A raw `html_block`, carried verbatim. */
      html_block: {
        group: "block",
        atom: true,
        selectable: true,
        attrs: { html: { default: "" } },
        toDOM: (node) => ["div", { class: "gp-raw-html" }, node.attrs.html as string],
      },
      /** A raw `html_inline` span, carried verbatim. */
      html_inline: {
        group: "inline",
        inline: true,
        atom: true,
        attrs: { html: { default: "" } },
        toDOM: (node) => ["span", { class: "gp-raw-html-inline" }, node.attrs.html as string],
      },
    }),
  marks: base.spec.marks,
});

export type GutterpressSchema = typeof gutterpressSchema;
