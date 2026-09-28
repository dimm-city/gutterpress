/**
 * The inline elements plugins wrapped around runs of the author's text, put
 * around the same text in the block the editor built.
 *
 * A plugin that styles a phrase (the field guide's ROLL THE DIE! chip)
 * wraps the phrase in an element of its own and leaves the text as written.
 * The editor renders inline content from source, so the phrase is plain
 * text in its block and the book's CSS for the element never applies -
 * measured as a one-line paragraph on the page rendering as two, and an
 * inline-block chip's height missing from every ability that rolls. The
 * projection names each such element by the block's text, the phrase and
 * the element (`GutterpressProjection.inlineWrappers`); this finds the
 * phrase in the block's own text nodes and wraps it. Two blocks with the
 * same text carry the same wrappers, so no tie needs breaking.
 */
import type { GutterpressProjection, InlineWrapper } from "gutterpress/render";

export type InlineWrapperIndex = ReadonlyMap<string, readonly InlineWrapper[]>;

export function buildInlineWrapperIndex(projection: GutterpressProjection, source: string): InlineWrapperIndex {
  const index = new Map<string, InlineWrapper[]>();
  for (const wrapper of projection.inlineWrappers ?? []) {
    const key = source.slice(wrapper.from, wrapper.to).trimEnd();
    if (!key) continue;
    const list = index.get(key) ?? [];
    if (!list.some((w) => w.text === wrapper.text && w.tag === wrapper.tag && sameAttributes(w.attributes, wrapper.attributes))) {
      list.push(wrapper);
    }
    index.set(key, list);
  }
  return index;
}

function sameAttributes(a: Readonly<Record<string, string>>, b: Readonly<Record<string, string>>): boolean {
  const ka = Object.keys(a).sort();
  const kb = Object.keys(b).sort();
  return ka.length === kb.length && ka.every((k, i) => k === kb[i] && a[k] === b[k]);
}

const SAFE_TAG_RE = /^[a-z][\w-]*$/i;

/** `decorateInactiveBlock` half: wrap the plugin's phrases in the block's own text nodes. */
export function applyInlineWrappers(element: HTMLElement, sourceText: string, index: InlineWrapperIndex): void {
  const wrappers = index.get(sourceText.trimEnd());
  if (!wrappers?.length) return;
  const doc = element.ownerDocument;
  for (const wrapper of wrappers) {
    if (!wrapper.text || !SAFE_TAG_RE.test(wrapper.tag)) continue;
    const walker = doc.createTreeWalker(element, 4 /* NodeFilter.SHOW_TEXT */);
    const nodes: Text[] = [];
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node as Text;
      // The fork's own syntax spans are not the author's text.
      if (text.parentElement?.closest(".md-marker, .md-glue")) continue;
      if (text.data.includes(wrapper.text)) nodes.push(text);
    }
    for (const node of nodes) {
      let rest: Text | null = node;
      while (rest) {
        const at = rest.data.indexOf(wrapper.text);
        if (at < 0) break;
        const phrase = rest.splitText(at);
        const after = phrase.splitText(wrapper.text.length);
        const el = doc.createElement(wrapper.tag);
        for (const [name, value] of Object.entries(wrapper.attributes)) {
          if (!/^on/i.test(name)) el.setAttribute(name, value);
        }
        phrase.replaceWith(el);
        el.appendChild(phrase);
        rest = after.data ? after : null;
      }
    }
  }
}
