/**
 * The locked view drops the fork's hidden syntax from a block's DOM.
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
 * Locked, no block is ever clicked into, so nothing needs to keep its size
 * for the reveal; the fork rebuilds every block from source when the view
 * unlocks (`mount.ts` disposes and rebuilds on that toggle), so nothing
 * removed here is missed. What stays is the glue inside text -  a softbreak's
 * hidden newline is the whitespace the page has there too.
 */

/** Elements whose direct-child glue is structural, never text. */
const STRUCTURAL_PARENTS = new Set(["TABLE", "THEAD", "TBODY", "TFOOT", "TR", "UL", "OL"]);

/** `decorateInactiveBlock` half (locked only): make the block's DOM the page's. */
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
