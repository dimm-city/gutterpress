/**
 * context-menu-actions.ts — pure parameter-resolution helpers for the preview
 * context menu's image/link items (inline-editing plan §4.4).
 *
 * Given the RAW MARKDOWN SOURCE of the block the author right-clicked (the
 * `data-source-range` slice — never the rendered HTML) and the rendered
 * `image`/`link` fields `getContextTargetAt` reported, these locate the exact
 * markdown token so a menu action can splice just that token, and detect the
 * documented degrade cases (reference-style links, linkified bare URLs, raw
 * HTML `<img>`) so the caller can disable/relabel items instead of guessing.
 *
 * Pure string functions — zero DOM / `node:*` / lib value imports, testable
 * directly under `bun test`.
 */

/** A located `![alt](src "title")` (or with a trailing `{...}` attrs suffix)
 *  markdown image token — offsets are relative to the BLOCK SLICE passed in. */
export interface ImageTokenMatch {
  start: number;
  end: number;
  alt: string;
  src: string;
  /** The `{...}` attrs suffix text (markdown-it-attrs), or "" when absent. */
  attrsRaw: string;
}

const IMAGE_TOKEN_RE = /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)(\{[^}]*\})?/g;

/**
 * Find the markdown image token in `blockSlice` whose rendered `src`/`alt`
 * match the point-resolved `image` field (`registerImageRule` records refs
 * but does not rewrite `src`, so the attribute text matches author text
 * verbatim — plan §4.4). Returns null when no such token exists in the slice
 * (e.g. the block is a raw HTML `<img>` instead — see {@link hasRawHtmlImg}).
 */
export function findImageToken(
  blockSlice: string,
  image: { src: string | null; alt: string | null },
): ImageTokenMatch | null {
  if (!image.src) return null;
  IMAGE_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = IMAGE_TOKEN_RE.exec(blockSlice))) {
    const [full, alt, src, attrsRaw] = m;
    if (src === image.src && (image.alt == null || alt === image.alt)) {
      return { start: m.index, end: m.index + full.length, alt: alt ?? "", src, attrsRaw: attrsRaw ?? "" };
    }
  }
  return null;
}

/** True when the block slice contains a raw HTML `<img>` tag — those never
 *  carry `data-source-range`-addressable markdown syntax (plan §2.6); the
 *  only available image action for one is "Edit block in editor". */
export function hasRawHtmlImg(blockSlice: string): boolean {
  return /<img\b/i.test(blockSlice);
}

/** A located `[text](href "title")` markdown link token (never an image —
 *  the match is rejected when immediately preceded by `!`). */
export interface LinkTokenMatch {
  start: number;
  end: number;
  text: string;
  href: string;
}

const LINK_TOKEN_RE = /(^|[^!])\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

function findLinkToken(blockSlice: string, link: { href: string | null }): LinkTokenMatch | null {
  if (!link.href) return null;
  LINK_TOKEN_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = LINK_TOKEN_RE.exec(blockSlice))) {
    const [full, pre, text, href] = m;
    if (href === link.href) {
      return { start: m.index + pre.length, end: m.index + full.length, text, href };
    }
  }
  return null;
}

export type LinkResolution =
  | { kind: "found"; match: LinkTokenMatch }
  /** `[text][id]` — the definition line is unrecoverable from the rendered
   *  block alone (plan §2.6). Only "Copy link target" stays enabled. */
  | { kind: "reference-style" }
  /** `linkify: true` renders a bare URL as an anchor with no bracket syntax
   *  in the source at all (plan §4.4). Only "Copy link target" stays enabled. */
  | { kind: "linkified" }
  /** Neither pattern found — degrade to "Edit block in editor" only. */
  | { kind: "not-found" };

/** Resolve a rendered `<a>`'s `href`/text back to its markdown source form,
 * or one of the documented degrade cases (plan §4.4). */
export function resolveLinkToken(
  blockSlice: string,
  link: { href: string | null; text: string },
): LinkResolution {
  const match = findLinkToken(blockSlice, link);
  if (match) return { kind: "found", match };
  if (/\[[^\]]*\]\[[^\]]*\]/.test(blockSlice)) return { kind: "reference-style" };
  if (link.href && blockSlice.includes(link.href)) return { kind: "linkified" };
  return { kind: "not-found" };
}

/**
 * Splice `insert` in place of `[start, end)` within `text` — the shared
 * primitive every image/link edit action uses to rewrite just its token
 * inside an already-resolved block slice.
 */
export function spliceToken(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}
