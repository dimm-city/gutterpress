/**
 * Drops the fork's hidden syntax from an inactive block's DOM.
 *
 * The fork keeps every piece of markdown syntax in the DOM as an element it
 * hides (`.md-marker-hidden`, `display: none`) or keeps as an invisible
 * inline footprint (`.md-glue-hidden`, `visibility: hidden`), so that a block
 * keeps its size when the author clicks into it and the syntax appears. The
 * printed page has none of those elements, and a book's CSS is written
 * against the page: `li > p:only-child` finds an item's paragraph on the
 * page and misses it in the editor, where a hidden list marker is the item's
 * first child; the glue between a table's rows is an inline box that a
 * `table` wraps in an anonymous row of its own height; an indented list's
 * indent glue is three invisible spaces in front of every item's text.
 *
 * An inactive block does not need to keep its size for the reveal: the fork
 * builds the block's view afresh when it becomes active (see `mount.ts`'s
 * `decorateInactiveBlock`), so the DOM this trims is discarded on the click
 * and the caret only ever sees a view built from source. The block does
 * change size on that click -  the page's shape and the editable shape are
 * not the same height -  which is the cost of paginating like the page.
 * What stays is the glue inside text -  a softbreak's hidden newline is the
 * whitespace the page has there too.
 */

/** Elements whose direct-child glue is structural, never text. */
const STRUCTURAL_PARENTS = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "UL", "OL"]);

/** `decorateInactiveBlock` half: make the inactive block's DOM the page's. */
export function stripHiddenMarkup(element: HTMLElement): void {
  for (const marker of Array.from(element.querySelectorAll(".md-marker-hidden, .md-list-gutter, .md-glue-indent.md-glue-hidden"))) {
    marker.remove();
  }
  for (const glue of Array.from(element.querySelectorAll(".md-glue-hidden"))) {
    const parent = glue.parentElement;
    if (!parent) continue;
    // Glue between rows and items is structure; the blank lines after a
    // block and the whitespace at either end of one are nothing the page
    // renders -  and an image is the page's `p > img:only-child` only once
    // the newline glue after it is gone.
    const blank = !(glue.textContent ?? "").trim();
    const atEdge = glue === parent.firstChild || glue === parent.lastChild;
    if (STRUCTURAL_PARENTS.has(parent.tagName) || glue.classList.contains("md-glue-blockGap") || glue.classList.contains("md-glue-blockBreak") || (blank && atEdge)) {
      glue.remove();
    }
  }
  if (element.classList.contains("md-marker-hidden")) element.remove();
}
