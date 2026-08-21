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
 *   - RAW HTML (49 `html_block`, 30 `html_inline`). Too common to refuse; the
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
import { Schema, type DOMOutputSpec, type MarkSpec, type NodeSpec } from "prosemirror-model";
import type { ExtraAttrs } from "./attrs";

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
    attrs: { marker: { default: "" }, class: { default: "" }, viewAttrs: { default: null } },
    // Rendered for the editing view only. The PRINT path never sees this
    // schema — it renders through markdown-it exactly as it always has.
    //
    // `viewAttrs` is everything ELSE the pipeline put on the wrapper — the
    // author's `#id`, `data-chapter-label`, any attribute a marker sets.
    // Keeping only `class` meant a book styling `#ch-notes .lede` or
    // `[data-chapter-label]` (the frozen chapter-opener pattern does exactly
    // that) rendered differently here than in print, for no reason other
    // than the attributes being dropped in transit.
    toDOM: (node) => [
      "div",
      {
        ...((node.attrs.viewAttrs as Record<string, string> | null) ?? {}),
        class: (node.attrs.class as string) || "gp-layout",
        "data-marker": node.attrs.marker as string,
      },
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

/**
 * A PROJECT PLUGIN's wrapped block — `@sidebar … @end-sidebar`, `@callout …`
 * — modelled GENERICALLY rather than one node per known marker.
 *
 * Plugins are plain markdown-it plugins (CLAUDE.md §5); the product cannot
 * enumerate their token types ahead of time, and refusing every plugin marker
 * put whole chapters of plugin-using books into source mode. What CAN be
 * required is that the tokens carry recoverable SOURCE: the parser's
 * normalization pass (see `parser.ts`, `adoptPluginTokens`) rewrites an
 * unknown open/close pair onto this node only when the authored open and
 * close lines can be read back verbatim (from `token.map` against the source,
 * or `token.markup`). Anything less reconstructable still fails closed.
 *
 * `marker`/`closeMarker` are the authored lines and are ALL that serializes.
 * `tag` + `viewAttrs` reproduce the DOM the plugin's own render rules emit
 * (minus pipeline-generated attributes), so the plugin's shipped CSS styles
 * the block in the editor exactly as in print — view-only, like `class` on
 * the core wrappers.
 */
function pluginBlock(): NodeSpec {
  return {
    content: "block+",
    group: "block",
    defining: true,
    attrs: {
      marker: { default: "" },
      closeMarker: { default: "" },
      tag: { default: "div" },
      viewAttrs: { default: null },
    },
    toDOM: (node) => [
      (node.attrs.tag as string) || "div",
      {
        ...((node.attrs.viewAttrs as Record<string, string> | null) ?? {}),
        "data-marker": node.attrs.marker as string,
      },
      0,
    ],
  };
}

/** A plugin's self-closing marker (`@stamp "Checked"`). `text` is the token's
 *  rendered content, shown so the atom is visible chrome rather than a blank
 *  box; only `marker` serializes. */
function pluginAtom(): NodeSpec {
  return {
    group: "block",
    atom: true,
    selectable: true,
    attrs: {
      marker: { default: "" },
      tag: { default: "div" },
      viewAttrs: { default: null },
      text: { default: "" },
    },
    toDOM: (node) => {
      const attrs = {
        ...((node.attrs.viewAttrs as Record<string, string> | null) ?? {}),
        "data-marker": node.attrs.marker as string,
      };
      const tag = (node.attrs.tag as string) || "div";
      const text = (node.attrs.text as string) || "";
      return text ? [tag, attrs, text] : [tag, attrs];
    },
  };
}

const tableNodes: Record<string, NodeSpec> = {
  // `table_body?`, not `table_body`. A header-only table (`| A |\n| --- |`) is
  // legal GFM and an ordinary thing to write — a template waiting to be filled
  // in. With the body REQUIRED, `createAndFill` had to invent a `table_row` to
  // satisfy the schema, and saving wrote back a `|  |` row the author never
  // typed, which then rendered as a real empty row in the printed book.
  table: { content: "table_head? table_body?", group: "block", tableRole: "table", isolating: true,
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
  toDOM: spec.toDOM
    ? (node) => renderAuthoredAttrs(spec.toDOM!(node), node.attrs.attrs as ExtraAttrs | null)
    : spec.toDOM,
});

/**
 * Put the author's braces on the editing DOM, on the SAME element the print
 * pipeline puts them on.
 *
 * Carrying `{.dc-chevron}` through a save (above) is only half the promise:
 * an editing surface that keeps the class in the file but not in the view
 * shows the author a heading their book does not have — measured against the
 * real app, `# Contents {.dc-chevron}` painted as a bare `h1` in magenta while
 * the preview and the PDF painted the branded chevron rule. Every style
 * divergence the parity tool found on the field guide's headings was this.
 *
 * The target element is the INNERMOST one of the node's own output, which is
 * what markdown-it does for all five constructs that can carry braces:
 * `<code>` inside `<pre>` for a fence, and the single element for a heading,
 * paragraph, image or rule. `class` is merged (a fence's `language-js` must
 * survive); everything else the author wrote wins, and `attrs.ts` has already
 * filtered out the keys the node models itself or the pipeline generated.
 */
function renderAuthoredAttrs(out: DOMOutputSpec, authored: ExtraAttrs | null): DOMOutputSpec {
  if (!authored || !Array.isArray(out) || typeof out[0] !== "string") return out;
  const spec = out.slice() as unknown[];
  // Recurse to the innermost element spec (`["pre", ["code", 0]]` → the code).
  const lastIdx = spec.length - 1;
  const last = spec[lastIdx];
  if (lastIdx > 0 && Array.isArray(last)) {
    spec[lastIdx] = renderAuthoredAttrs(last as unknown as DOMOutputSpec, authored);
    return spec as unknown as DOMOutputSpec;
  }
  const existing =
    spec.length > 1 && typeof spec[1] === "object" && spec[1] !== null && !Array.isArray(spec[1])
      ? { ...(spec[1] as Record<string, string>) }
      : null;
  const merged: Record<string, string> = { ...(existing ?? {}) };
  for (const [k, v] of Object.entries(authored)) {
    merged[k] = k === "class" && merged.class ? `${merged.class} ${v}` : v;
  }
  if (existing) spec[1] = merged;
  else spec.splice(1, 0, merged);
  return spec as unknown as DOMOutputSpec;
}

/**
 * The authored bullet character (`*`, `-` or `+`), kept on the list.
 *
 * A marker change is the ONLY thing that splits adjacent bullet lists in
 * CommonMark — blank lines never do. Books use that deliberately (the field
 * guide alternates `*`/`+`/`-` to produce separate single-item lists), so
 * serializing every list as `*` merged them into one loose list on reparse:
 * a rendered-DOM change the semantic gate catches, plus a blank-line churn
 * that broke the fixpoint. The default serializer already emits
 * `node.attrs.bullet || "*"`; declaring the attr is what lets the parser
 * carry the authored character through.
 */
const withBullet = (spec: NodeSpec): NodeSpec => ({
  ...spec,
  attrs: { ...(spec.attrs ?? {}), bullet: { default: "*" } },
});

/**
 * `link` FIRST. Mark order decides nesting, and nesting decides whether the
 * serializer emits valid markdown.
 *
 * ProseMirror sorts every text node's marks by their rank in this list, and
 * `MarkdownSerializerState` closes marks back to the longest common prefix of
 * the previous node's sorted marks. `prosemirror-markdown`'s own schema ranks
 * `link` LAST, so a link wrapping emphasis — which is how a link with any
 * formatting inside it is written — sorts the link innermost even though the
 * source has it outermost. Every emphasis boundary inside the link then forces
 * the serializer to close and reopen its neighbours, and the asterisks it
 * emits do not re-parse:
 *
 *   in   [a **bold _italic_ word**](https://example.com)
 *   out  [a **bold *****italic*** **word**](https://example.com)
 *
 * which renders as the literal text `a **bold **` followed by a wrongly
 * bold-AND-italic "italic" — visible garbage in the printed book. This is
 * upstream behaviour, reproduced with the stock `defaultMarkdownParser` and
 * `defaultMarkdownSerializer`, not something our specs introduced. Mark order
 * is the part we own, so it is the part that changes.
 *
 * Ranking `link` first is not a cost-free win, and it was chosen by measuring
 * rather than by reasoning. Across an 11-case inline matrix, comparing the
 * SET of marks on every character before and after a round trip (so a mere
 * re-nesting of `<a><strong>` into `<strong><a>` counts as equal, because it
 * is):
 *
 *   order                     characters whose marks changed
 *   em, strong, link (stock)  4 literal `*` injected, "bold" loses strong
 *   link, em, strong (ours)   one SPACE loses `strong`
 *
 * Both orders disagree with the input on exactly one case out of eleven. The
 * stock order corrupts the author's text; ours changes whether a single space
 * character is bold, which no renderer can show. `roundtrip.test.ts` holds
 * that matrix so a future reorder has to face the same evidence.
 */
/**
 * An authored inline HTML pair, carried as a mark so the element wraps its
 * text (`adoptInlineHtmlPairs` in parser.ts explains why it must).
 *
 * OUTERMOST of all marks — ahead of `link` — because that is where the author
 * wrote it: `<a href="#x">**Title**</a>` serializes with the tag outside the
 * emphasis, exactly as typed. `open`/`close` are the authored strings and are
 * all the serializer writes; `tag`/`attrs` build the element for the view and
 * never reach the file.
 */
const rawHtmlMark: MarkSpec = {
  attrs: { tag: { default: "span" }, attrs: { default: null }, open: { default: "" }, close: { default: "" } },
  // Not `inclusive`: typing at the edge of an authored tag pair should write
  // ordinary text, not silently extend markup the author wrote by hand.
  inclusive: false,
  // A mark normally excludes its own type, which would make `<span><b>x</b>`
  // keep only the inner tag — authored HTML nests, so this type must be able
  // to stack with itself. The set keeps insertion order, so the tags render
  // and serialize in the order they were written.
  excludes: "",
  toDOM: (mark) => [
    (mark.attrs.tag as string) || "span",
    { ...((mark.attrs.attrs as Record<string, string> | null) ?? {}) },
    0,
  ],
};

const markOrder = base.spec.marks
  .addToStart("raw_html", rawHtmlMark)
  .remove("link")
  .addToStart("link", {
  ...base.spec.marks.get("link")!,
  // `[docs](url){target="_blank"}` — the same `markdown-it-attrs` braces the
  // heading and image nodes carry, on the one INLINE construct that takes
  // them. Without the slot they parsed and then evaporated on save, which
  // quietly unset every `target`, `rel` and utility class in a book.
  attrs: { ...(base.spec.marks.get("link")!.attrs ?? {}), attrs: { default: null } },
});

/**
 * A list that renders its own tightness.
 *
 * markdown-it emits a TIGHT list as `<li>text</li>` and a loose one as
 * `<li><p>text</p></li>`; ProseMirror's list_item always holds a paragraph,
 * so the editing surface emits the loose DOM either way and the book's own
 * `p { margin: … }` then spaces a tight list out — visibly looser than the
 * page it is meant to be showing. The tightness is already parsed onto the
 * node, so the fix is to publish it to CSS and let the editor stylesheet
 * (`engine/viewer/live-document.ts`) close those margins.
 *
 * Marking the LIST rather than the item keeps this one attribute at the one
 * place markdown decides it: tightness is a property of the list.
 */
function tightAware(spec: NodeSpec, tag: "ul" | "ol"): NodeSpec {
  return {
    ...spec,
    toDOM: (node) => [
      tag,
      {
        ...(tag === "ol" && (node.attrs.order as number) !== 1
          ? { start: node.attrs.order as number }
          : {}),
        ...(node.attrs.tight ? { "data-tight": "true" } : {}),
      },
      0,
    ],
  };
}

/**
 * `language-js` on the fence's `<code>`, the way markdown-it writes it.
 *
 * `prosemirror-markdown` keeps the info string as `data-params` on the `<pre>`
 * and emits no language class at all, so a highlighter theme or any book rule
 * written against `code.language-css` styled the printed page and not the
 * editing surface. The first-party corpus has 168 language-tagged fences (83
 * of them `markdown`, in the design guide), so this is the common case, not an
 * edge one. Only the first word of the info string is the language — the rest
 * is the fence's own metadata, exactly as markdown-it treats it.
 */
function withFenceLanguage(spec: NodeSpec): NodeSpec {
  return {
    ...spec,
    toDOM: (node) => {
      const lang = String(node.attrs.params ?? "").trim().split(/\s+/)[0];
      return [
        "pre",
        node.attrs.params ? { "data-params": node.attrs.params as string } : {},
        ["code", lang ? { class: `language-${lang}` } : {}, 0],
      ];
    },
  };
}

export const gutterpressSchema = new Schema({
  nodes: base.spec.nodes
    .update("bullet_list", withBullet(tightAware(base.spec.nodes.get("bullet_list")!, "ul")))
    .update("ordered_list", tightAware(base.spec.nodes.get("ordered_list")!, "ol"))
    // `![art](a.png) {.class}` — a block-end brace block attaches to the
    // PARAGRAPH (space before the braces), not the image; without the slot
    // it was silently dropped on save. Same `attrs.ts` machinery as heading.
    .update("paragraph", withAttrs(base.spec.nodes.get("paragraph")!))
    .update("image", withAttrs(base.spec.nodes.get("image")!))
    .update("heading", withAttrs(base.spec.nodes.get("heading")!))
    // `---{.column-break}` — a decorated rule is a real book idiom.
    .update("horizontal_rule", withAttrs(base.spec.nodes.get("horizontal_rule")!))
    // ```js {.line-numbers} — the info string is `params`, the braces are not.
    .update("code_block", withAttrs(withFenceLanguage(base.spec.nodes.get("code_block")!)))
    .append(tableNodes)
    .append({
      gp_chapter: layoutWrapper(),
      gp_spread: layoutWrapper(),
      gp_page: layoutWrapper(),
      gp_section: layoutWrapper(),
      gp_page_break: layoutAtom(),
      gp_column_break: layoutAtom(),
      gp_plugin_block: pluginBlock(),
      gp_plugin_atom: pluginAtom(),
      /**
       * Content the PIPELINE generated — shown, never authored, never saved.
       *
       * `markers.js` injects markup the author never typed (today the
       * chapter-opener badge). Print shows it, so the editor must too, or the
       * surface is not showing the book. It cannot be an `html_block`: that
       * node round-trips its bytes, which would materialize generated markup
       * into the author's file on the next save.
       *
       * So it is its own node — atom, read-only in the view (see
       * `rawHtmlView` in `rich-editor.ts`), and serialized to NOTHING. That
       * last property is what makes it safe, and it is what the fixpoint gate
       * checks on every corpus file.
       *
       * Why a node rather than a view decoration: position. A decoration has
       * to be placed by rules the view maintains itself, and a second copy of
       * the pipeline's rules is exactly what put an invented chapter-opener
       * on books whose chapters have no `@page`. A node lands where the
       * pipeline put it, by construction.
       */
      gp_generated: {
        group: "block",
        atom: true,
        selectable: false,
        attrs: { html: { default: "" } },
        toDOM: (node) => ["div", { class: "gp-generated" }, node.attrs.html as string],
      },
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
  marks: markOrder.append({
    /**
     * `~~struck~~`. markdown-it emits `s_open`/`s_close` out of the box, and
     * without a mark for it the parser RAISED — so a single `~~word~~` made a
     * whole file un-editable, and the toolbar's strikethrough button had
     * nothing to bind to. Modelling it is the fix (CLAUDE.md §5), not
     * declaring the action unsupported.
     */
    strikethrough: {
      parseDOM: [{ tag: "s" }, { tag: "del" }, { tag: "strike" }],
      toDOM: () => ["s", 0],
    },
  }),
});

