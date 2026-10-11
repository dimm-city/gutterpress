/**
 * A tight list's items hold INLINE content in the book's HTML; the fork
 * wraps every item's text in a paragraph block.
 *
 * markdown-it emits `<li>text</li>` for a tight list and `<li><p>text</p></li>`
 * for a loose one. The fork has one representation for both: the item's
 * content is always a block view (`p.md-paragraph`). That difference is
 * invisible until a book styles its bullets with `li::before`, which the
 * design guide does — an inline `::before` in front of a BLOCK child is
 * wrapped in an anonymous block of its own, so every item of every tight
 * list gained a full line the printed page does not have. One chapter's
 * ability lists ran six lines long on a single item that way.
 *
 * Tightness is read from the list's own source, the way markdown-it reads
 * it: a blank line anywhere inside the list (other than at its end) makes
 * the list loose. The one case this reads more conservatively than
 * markdown-it is a blank line inside a fenced code block in an item —
 * markdown-it's fence rule consumes those without loosening the list, while
 * this sees the blank line and calls the list loose. That direction is the
 * safe one: a list wrongly called loose is left exactly as it renders today.
 */

/** Marks a list whose items the book renders as inline content. */
export const TIGHT_LIST_CLASS = "gp-list-tight";

const BLANK_LINE = /\n[^\S\n]*\n/;

/**
 * `decorateInactiveBlock` half: mark a tight list so the locked view can
 * render its items the way the book does. A nested list inside a tight list
 * is tight too (its source is a subset containing no blank line), so the
 * class on the outermost list covers the whole tree.
 */
export function markTightList(element: HTMLElement, node: { readonly kind: string }, sourceText: string): void {
  if (node.kind !== "list") return;
  if (BLANK_LINE.test(sourceText.trimEnd())) return;
  element.classList.add(TIGHT_LIST_CLASS);
}
