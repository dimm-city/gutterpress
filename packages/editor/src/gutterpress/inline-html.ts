/**
 * Inline HTML tags in the INACTIVE (reader's) view.
 *
 * A book may write an inline anchor in raw HTML —
 * `<a href="#ch-2">The Augmerc — Muscle for hire</a>` inside a list item is
 * the field guide's own table of contents. The pipeline renders that as a
 * link; this editor's parser has no inline-HTML rule, so it shows the tags
 * as literal text. The text is then long enough to wrap where the book's is
 * not: those entries measured 74px against the book's 51px, and the page
 * they sit on overflowed into a second one.
 *
 * So while a block is inactive, the TAGS are hidden and their text is left
 * exactly where it was. Nothing is rendered from them — no HTML is
 * constructed or inserted, only existing text nodes are split — so this adds
 * no trust surface. Activating the block rebuilds it from source and the
 * tags are back, editable, like every other marker the fork hides.
 *
 * Code is exempt: a code block or an inline `code` span is showing markup ON
 * PURPOSE, and the book shows it too.
 */

/** A well-formed inline tag. Deliberately strict, so prose like `a < b` is left alone. */
const TAG_RE = /<\/?[a-zA-Z][\w-]*(?:\s[^<>]*)?>/g;
/** A raw `<br>` in any of its spellings. */
const BR_RE = /^<br\s*\/?>$/i;

/** Class applied to a hidden tag run — `editor-css.ts` gives it `display: none`. */
export const INLINE_HTML_TAG_CLASS = "gp-inline-html-tag";

function isExempt(node: Node): boolean {
  for (let el = node.parentElement; el; el = el.parentElement) {
    const tag = el.tagName.toLowerCase();
    if (tag === "code" || tag === "pre") return true;
    if (el.classList.contains("md-document")) return false;
  }
  return false;
}

/** `decorateInactiveBlock` half: hide the inline HTML tags inside `element`. */
export function hideInlineHtmlTags(element: HTMLElement): void {
  const doc = element.ownerDocument;
  const walker = doc.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (text.data.includes("<") && !isExempt(text)) texts.push(text);
  }
  for (const text of texts) {
    const matches = [...text.data.matchAll(TAG_RE)];
    if (!matches.length) continue;
    const fragment = doc.createDocumentFragment();
    // A raw line break is the one tag whose whole meaning is layout: the
    // page breaks the line there, so the block does too. The break is a
    // bare element with no attributes, so this is still no trust surface.
    // It goes after the fork's own glue span when the tag sits inside one
    // (a table cell's ` <br> ` is glue to the fork), which is hidden whole.
    const glue = text.parentElement?.closest(".md-glue");
    let breaks = 0;
    let at = 0;
    for (const match of matches) {
      const start = match.index ?? 0;
      if (start > at) fragment.appendChild(doc.createTextNode(text.data.slice(at, start)));
      const span = doc.createElement("span");
      span.className = INLINE_HTML_TAG_CLASS;
      span.setAttribute("aria-hidden", "true");
      span.textContent = match[0];
      fragment.appendChild(span);
      if (BR_RE.test(match[0])) {
        if (glue) breaks += 1;
        else fragment.appendChild(doc.createElement("br"));
      }
      at = start + match[0].length;
    }
    if (at < text.data.length) fragment.appendChild(doc.createTextNode(text.data.slice(at)));
    text.replaceWith(fragment);
    for (; breaks > 0; breaks--) glue!.after(doc.createElement("br"));
  }
}
