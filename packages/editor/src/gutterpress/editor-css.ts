/**
 * CSS the Gutterpress mount always injects (before any host `extraCss`):
 * marker chips (`render-chip.ts`) and the container wrappers the fork's
 * `groupBlocks` hook mounts (`provider.ts`). The wrapper carries the exact
 * classes and attributes the print pipeline emits (`.section`, `.page`,
 * `data-page`, ...) so a book's own stylesheet styles the editor the way it
 * styles the PDF.
 *
 * The one rule behind every rule here: the editor paginates the way the
 * page does, locked or unlocked. Anything the editor shows that the page
 * does not (a marker's tag, the fork's hidden syntax) takes no space in the
 * text flow, and anything the page has that the fork's DOM shapes
 * differently is reshaped for every INACTIVE block (`.md-markers-hidden`,
 * which the fork toggles on a block whenever it is not the active one).
 * The active block is the author's, in the fork's own editable shape.
 * `packages/desktop/tests/integration/editor-preview-parity.mjs` measures
 * both views against the book.
 */
export const GUTTERPRESS_EDITOR_CSS = `
/* A marker chip has NO box in the text flow, in either view: the page has
   no element where a marker line is. This is a measurement, not a
   preference. A zero-height in-flow chip moved Chromium's
   break-inside: avoid decisions for the sections around it (chapter-03 of
   the field guide paginated into 17 pages against the book's 14), and an
   absolutely positioned one still did (15). display: none is the one
   presentation proven to paginate like the page, so the tag the author sees
   is drawn by marker-tags.ts as an overlay outside the fragmented flow,
   cloned from the .gp-block-chip__tag render-chip.ts builds into the chip.
   A break chip is the exception: it keeps a zero-height box, because a break
   declared on a box that generates none is a break that never happens
   (MARKER_CSS gives .gp-column-break exactly this treatment). A plugin-region
   / raw-html chip is not a chip at all (below). */
.md-block.gp-block-chip {
  display: none;
}
.md-block.gp-block-chip--page-break,
.md-block.gp-block-chip--column-break {
  display: block;
  height: 0;
  margin: 0;
  padding: 0;
  border: 0;
  font-size: 0;
  line-height: 0;
  visibility: hidden;
}
/* The overlay layer and its tags (marker-tags.ts). The layer is a
   zero-size box at the content container's origin; each tag is placed at
   the box of the block its marker stands next to and hung to the left of
   it, in the page margin. Pointer events reach the tags only. */
.gp-marker-tags {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
  z-index: 3;
}
.gp-marker-tag {
  position: absolute;
  transform: translateX(calc(-100% - 10px));
  pointer-events: auto;
  cursor: pointer;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.1em 0.5em;
  width: max-content;
  max-width: 14em;
  padding: 0.05em 0.45em;
  border-left: 3px solid #4c6ef5;
  border-radius: 0 4px 4px 0;
  background: rgba(76, 110, 245, 0.1);
  color: #3b4252;
  font: 12px/1.6 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  text-align: left;
  user-select: none;
}
.gp-marker-tag--closing {
  transform: translate(calc(-100% - 10px), -100%);
}
.gp-marker-tag--end-section,
.gp-marker-tag--html-container,
.gp-marker-tag--page-break,
.gp-marker-tag--column-break {
  border-left-color: #94a3b8;
  background: rgba(148, 163, 184, 0.16);
}
.gp-marker-tag--end-section .gp-block-chip__kind,
.gp-marker-tag--html-container .gp-block-chip__kind,
.gp-marker-tag--page-break .gp-block-chip__kind,
.gp-marker-tag--column-break .gp-block-chip__kind {
  color: #64748b;
}
.gp-block-chip__kind {
  font-size: 9px;
  font-weight: 700;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: #4c6ef5;
}
.gp-block-chip__source {
  font-size: 11px;
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
  font-size: 10px;
  overflow-wrap: anywhere;
}
.gp-block-chip__source--inert {
  flex-basis: 100%;
  margin: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
/* The generated-view preview (a chapter opener's composite) is not part of
   the page's flow either; the page renders the opener through the pipeline's
   own output, which the editor mounts as a wrapper. In the margin tag it
   would only hide the text beside it. */
.gp-marker-tag .gp-block-chip__generated {
  display: none;
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
  height: auto;
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

/* The fork keeps the blank lines BETWEEN blocks in the DOM as a hidden inline
   span, so that revealing them near the caret does not change any height. Its
   newline collapses, so inside a paragraph it costs nothing — but a span is an
   element, and one sitting at the top level before the first page container is
   an element with a box where the book has nothing at all. The fragmenter
   reads that as content on the default page and opens a whole blank leading
   sheet for it (measured: the field guide's front matter paginated 5 pages
   against the book's 4). Hidden, it has no box; the fork reveals it by taking
   the hidden class off, so the caret's reveal still works -  the height
   changes then, which is the price of matching the page while it is hidden. */
.md-editor .md-glue-blockGap.md-glue-hidden,
.md-editor .md-glue-blockBreak.md-glue-hidden {
  display: none;
}
/* The fork puts a table in a shrink-to-fit scroll box, so it can show the
   active-block glow around a table wider than the page. A book's own
   table { width: 100% } then resolves against that shrink-to-fit box instead
   of the page column, and a three-column table came out 198px wide against
   the book's 655px. The box takes the width the book's table expects; the
   glow then surrounds the column, which is where the table is. It stays a
   scroll box, so a table genuinely wider than the column still scrolls. */
.md-editor .md-table-wrapper {
  width: auto;
}
/* A tight list item's content is inline in the book's HTML and a block in the
   fork's (see tight-list.ts for how a tight list is recognized). A book that
   draws its own bullets with li::before then puts an inline marker in front of
   a block child, which CSS wraps in an anonymous block of its own: one extra
   line for every item of every tight list. Rendering the item's paragraph
   inline puts the bullet back on the item's own first line and drops the
   paragraph's vertical margins, which is exactly how the book's bare list text
   behaves. Inactive blocks only: the fork measures an active item's caret
   from that paragraph's own box. */
.md-editor .md-list.gp-list-tight.md-markers-hidden li > .md-paragraph,
.md-editor .md-markers-hidden .md-list.gp-list-tight li > .md-paragraph {
  display: inline;
}
/* An inline HTML tag the book renders rather than prints (see inline-html.ts).
   Hidden in every mode a block is inactive in, exactly like the fork's own
   markdown markers: the text between the tags stays, the tags do not take a
   line the printed page has no room for. */
.gp-inline-html-tag {
  display: none;
}
/* The fork keeps a hidden code fence's vertical footprint (visibility: hidden,
   not display: none) so a code block does not change height when the author
   clicks into it and the real fence lines appear. That reservation costs
   exactly two lines per code block against the printed page, so an inactive
   code block drops it; the block grows by those two lines on the click. */
.md-editor .md-code-block.md-markers-hidden .md-marker-openFence.md-marker-hidden,
.md-editor .md-code-block.md-markers-hidden .md-marker-closeFence.md-marker-hidden,
.md-editor .md-markers-hidden .md-code-block .md-marker-openFence.md-marker-hidden,
.md-editor .md-markers-hidden .md-code-block .md-marker-closeFence.md-marker-hidden {
  display: none;
}
/* ...and the fork's code text is the exact source slice, which begins with
   the newline that ended the opening fence line. The book's own HTML has no
   such newline, so that empty first line is dropped by pulling the code up
   exactly one line box. The lh unit reads the block's own line-height, so a
   book that changes it stays correct.

   break-after: avoid is not a tweak: this box is a zero-height compensation
   for the line below it, not content. Breaking between the two would leave
   the compensation on one page and the code it corrects on the next, so the
   fragmenter counts the empty line as a real one and splits a code block the
   book keeps whole (measured: 07-system-setup ran a page short without it). */
.md-editor .md-code-block.md-markers-hidden:has(> .md-marker-openFence)::before,
.md-editor .md-markers-hidden .md-code-block:has(> .md-marker-openFence)::before {
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
