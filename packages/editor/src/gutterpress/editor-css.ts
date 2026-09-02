/**
 * CSS the Gutterpress mount always injects (before any host `extraCss`):
 * marker chips (`render-chip.ts`) and the container wrappers the fork's
 * `groupBlocks` hook mounts (`provider.ts`). The chip is a compact,
 * editable declaration bar; the wrapper carries the exact classes and
 * attributes the print pipeline emits (`.section`, `.page`, `data-page`,
 * …) so a book's own stylesheet styles the editor the way it styles the
 * PDF.
 */
export const GUTTERPRESS_EDITOR_CSS = `
.md-block.gp-block-chip {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.15em 0.7em;
  margin: 0.5em 0 0.35em;
  padding: 0.15em 0.6em;
  border-left: 3px solid #4c6ef5;
  border-radius: 0 4px 4px 0;
  background: rgba(76, 110, 245, 0.07);
  color: #3b4252;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.gp-block-chip__kind {
  font-size: 10px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4c6ef5;
}
.gp-block-chip__source {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.gp-block-chip__attrs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35em;
}
.gp-block-chip__attr {
  padding: 0 0.4em;
  border-radius: 3px;
  background: rgba(0, 0, 0, 0.07);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.gp-block-chip--end-section,
.gp-block-chip--html-container,
.gp-block-chip--page-break,
.gp-block-chip--column-break {
  border-left-color: #94a3b8;
  background: rgba(148, 163, 184, 0.12);
}
.gp-block-chip--end-section .gp-block-chip__kind,
.gp-block-chip--html-container .gp-block-chip__kind,
.gp-block-chip--page-break .gp-block-chip__kind,
.gp-block-chip--column-break .gp-block-chip__kind {
  color: #64748b;
}
.gp-block-chip__source--inert {
  flex-basis: 100%;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* A plugin-region / raw-html chip is not a chip at all: what it shows is the
   pipeline's own rendered output, which prints. It must therefore add NOTHING
   of its own — the book has no element here, so any box this contributes is a
   box the printed page does not have.

   The class selector alone lost to .md-block.gp-block-chip above, which is
   one specificity step higher, so none of this applied: the pipeline's output
   was laid out as FLEX ITEMS inside a padded, bordered chip. A skill card's
   flavor paragraph came out 420px wide against the book's 480px, every line
   under it re-wrapped, and the cards grew past the page height and split where
   the book keeps them whole. Matching the base rule's specificity is what
   makes the reset win. */
.md-block.gp-block-chip--plugin-region,
.md-block.gp-block-chip--raw-html {
  display: block;
  gap: 0;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 0;
  background: none;
  font: inherit;
  color: inherit;
}
.gp-block-chip--plugin-region > .gp-block-chip__kind,
.gp-block-chip--raw-html > .gp-block-chip__kind,
.gp-block-chip--plugin-region > .gp-block-chip__source--inert,
.gp-block-chip--raw-html > .gp-block-chip__source--inert,
.gp-block-chip--plugin-region > .gp-block-chip__attrs,
.gp-block-chip--raw-html > .gp-block-chip__attrs {
  display: none;
}
.gp-block-chip__rendered {
  display: contents;
}
/* A break marker is a real forced break in the book, so it must be one here
   too: the chip stands in for the pipeline's own gp-page-break /
   gp-column-break element and carries that element's break behaviour.
   Without this the editor simply ignores the break markers and paginates
   differently from the page.

   A page break is expressed as a COLUMN break because on screen a page box
   IS a multicol column (the same reason the viewer synthesizes column breaks
   for the book's own page-like breaks). Chromium ignores a page-valued break
   outright in a multicol context, so declaring one here would silently do
   nothing. */
.md-block.gp-block-chip--page-break {
  break-before: column;
}
.md-block.gp-block-chip--column-break {
  break-after: column;
}

/* Locked (reading) view: a MARKER chip is an authoring affordance and takes
   vertical space the printed page does not, so the locked view drops it and
   paginates exactly like the book (proved by
   packages/desktop/tests/integration/editor-preview-parity.mjs). A
   plugin-region / raw-html chip is NOT dropped: what it shows is the
   pipeline's own rendered output, which does print. */
.md-editor.md-readonly
  .gp-block-chip:not(.gp-block-chip--plugin-region):not(.gp-block-chip--raw-html):not(.gp-block-chip--page-break):not(.gp-block-chip--column-break) {
  display: none;
}
/* A break chip is dropped the way the pipeline's own break element is: it
   keeps a box, because a break declared on a box that generates none is a
   break that never happens. MARKER_CSS gives .gp-column-break exactly this
   treatment for the same reason. */
.md-editor.md-readonly .gp-block-chip--page-break,
.md-editor.md-readonly .gp-block-chip--column-break {
  height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 0;
  line-height: 0;
  visibility: hidden;
}
/* The fork keeps the blank lines BETWEEN blocks in the DOM as a hidden inline
   span, so that revealing them near the caret does not change any height. Its
   newline collapses, so inside a paragraph it costs nothing — but a span is an
   element, and one sitting at the top level before the first page container is
   an element with a box where the book has nothing at all. The fragmenter
   reads that as content on the default page and opens a whole blank leading
   sheet for it (measured: the field guide's front matter paginated 5 pages
   against the book's 4). Locked, no block ever becomes active, so the
   reservation buys nothing and the span can go. */
.md-editor.md-readonly .md-glue-blockGap.md-glue-hidden,
.md-editor.md-readonly .md-glue-blockBreak.md-glue-hidden {
  display: none;
}
/* The fork puts a table in a shrink-to-fit scroll box, so it can show the
   active-block glow around a table wider than the page. A book's own
   table { width: 100% } then resolves against that shrink-to-fit box instead
   of the page column, and a three-column table came out 198px wide against
   the book's 655px. Locked, no block is ever active and the glow buys
   nothing, so the box takes the width the book's table expects. It stays a
   scroll box, so a table genuinely wider than the column still scrolls. */
.md-editor.md-readonly .md-table-wrapper {
  width: auto;
}
/* A tight list item's content is inline in the book's HTML and a block in the
   fork's (see tight-list.ts for how a tight list is recognized). A book that
   draws its own bullets with li::before then puts an inline marker in front of
   a block child, which CSS wraps in an anonymous block of its own: one extra
   line for every item of every tight list. Rendering the item's paragraph
   inline puts the bullet back on the item's own first line and drops the
   paragraph's vertical margins, which is exactly how the book's bare list text
   behaves. Locked only: the fork measures an active item's caret from that
   paragraph's own box. */
.md-editor.md-readonly .md-list.gp-list-tight li > .md-paragraph {
  display: inline;
}
/* An inline HTML tag the book renders rather than prints (see inline-html.ts).
   Hidden in every mode a block is inactive in, exactly like the fork's own
   markdown markers: the text between the tags stays, the tags do not take a
   line the printed page has no room for. */
.gp-inline-html-tag {
  display: none;
}
/* Locked (reading) view: the fork keeps a hidden code fence's vertical
   footprint (visibility: hidden, not display: none) so a code block does not
   change height when the author clicks into it and the real fence lines appear.
   Locked, no block ever becomes active, so that reservation buys nothing and
   costs exactly two lines per code block against the printed page. */
.md-editor.md-readonly .md-marker-openFence.md-marker-hidden,
.md-editor.md-readonly .md-marker-closeFence.md-marker-hidden {
  display: none;
}
/* ...and the fork's code text is the exact source slice, which begins with
   the newline that ended the opening fence line. The book's own HTML has no
   such newline, so locked, that empty first line is dropped by pulling the
   code up exactly one line box. The lh unit reads the block's own
   line-height, so a book that changes it stays correct.

   break-after: avoid is not a tweak: this box is a zero-height compensation
   for the line below it, not content. Breaking between the two would leave
   the compensation on one page and the code it corrects on the next, so the
   fragmenter counts the empty line as a real one and splits a code block the
   book keeps whole (measured: 07-system-setup ran a page short without it). */
.md-editor.md-readonly .md-code-block:has(> .md-marker-openFence)::before {
  content: "";
  display: block;
  margin-bottom: -1lh;
  break-after: avoid;
}
/* The container wrappers get NOTHING from this file. They carry the book's
   own classes, and the book's CSS is what sizes them; anything added here
   changes the editor's layout away from the page. Two that were tried and
   removed: a margin/padding (MARKER_CSS gives a page/spread wrapper a
   min-height of the full content box, so a stray one pushes the box past its
   own page — the cover came out two pages long that way) and
   position: relative (it makes the wrapper the containing block for
   absolutely positioned author content, so a .gp-pin inside a section would
   anchor to the section here and to the page in the book). */
`;
