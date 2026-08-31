/**
 * Pure source-token helpers for preview context-menu edits.
 *
 * SFE-P3d-parity, Lane D: also the home of the CARET-based counterparts to
 * this file's original preview-driven finders. `findImageToken`/
 * `resolveLinkToken` locate an ALREADY-KNOWN token — the preview hands them
 * the rendered element's own alt/src/href plus an `InlineSourceToken`
 * (exact literal text + occurrence index) resolved from `data-source-range`
 * threading. There is no such rendered element in source/rich mode: the
 * only input available there is a raw caret OFFSET into the live document
 * text. `findImageTokenAtOffset`/`findLinkTokenAtOffset` below fill that
 * gap — given `(text, offset)`, they scan for a well-formed inline image/
 * link token whose span contains `offset`, using the SAME lexical
 * primitives (`scanBracket`/`scanDestination`/`scanAttrs`) the preview-driven
 * finders already use to verify a token's shape, so both entry points agree
 * on what counts as a real token. They additionally DECODE alt/destination
 * text (there is no rendered DOM to read a plain-text value from) — see
 * `unescapeMarkdownText`/`decodeDestination`. This decode is an escape-only
 * reversal (not a full CommonMark inline parse — no caller here needs one):
 * exact for ordinary author-written images/links, and a value round-trips
 * unchanged whenever a caller does not edit it, because `rewriteImageToken`/
 * `rewriteLinkToken` only re-escape a field that actually changed.
 *
 * Known limitation, stated rather than silently assumed away (matches this
 * module's existing posture): this is a lexical scanner, not a CommonMark
 * inline parser, so it does not reproduce every edge case real nesting
 * rules forbid (e.g. a link label containing another link). Scanning left
 * to right and returning the first candidate whose span contains `offset`
 * means an ambiguous nested case resolves to the OUTERMOST enclosing token,
 * a defensible default for the caret-driven UI this feeds, not a claim of
 * full CommonMark fidelity.
 */

import type { InlineSourceToken } from "$lib/preview-client";

export interface ImageTokenMatch {
  start: number;
  end: number;
  alt: string;
  src: string;
  tokenRaw: string;
  attrsRaw: string;
  altStart: number;
  altEnd: number;
  destinationStart: number;
  destinationEnd: number;
}

export interface LinkTokenMatch {
  start: number;
  end: number;
  href: string;
  tokenRaw: string;
  destinationStart: number;
  destinationEnd: number;
}

interface DestinationMatch {
  start: number;
  end: number;
  close: number;
}

function isSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

function isEscaped(text: string, index: number): boolean {
  let slashes = 0;
  for (let i = index - 1; i >= 0 && text[i] === "\\"; i--) slashes++;
  return slashes % 2 === 1;
}

function findOccurrence(text: string, source: InlineSourceToken): number {
  if (!source.token || !Number.isInteger(source.occurrence) || source.occurrence < 0) return -1;
  let from = 0;
  for (let current = 0; current <= source.occurrence; current++) {
    const found = text.indexOf(source.token, from);
    if (found < 0) return -1;
    if (current === source.occurrence) return found;
    from = found + source.token.length;
  }
  return -1;
}

function scanBracket(text: string, open: number): { close: number } | null {
  if (text[open] !== "[") return null;
  let depth = 1;
  for (let i = open + 1; i < text.length; i++) {
    if (text[i] === "`") {
      let ticks = 1;
      while (text[i + ticks] === "`") ticks++;
      let close = i + ticks;
      while (close < text.length) {
        if (text[close] !== "`") {
          close++;
          continue;
        }
        let closeTicks = 1;
        while (text[close + closeTicks] === "`") closeTicks++;
        if (closeTicks === ticks) break;
        close += closeTicks;
      }
      if (close < text.length) i = close + ticks - 1;
      else i += ticks - 1;
    } else if (text[i] === "\\") i++;
    else if (text[i] === "[") depth++;
    else if (text[i] === "]" && --depth === 0) return { close: i };
  }
  return null;
}

/** Locate only the destination inside an already parser-verified inline token. */
function scanDestination(text: string, open: number): DestinationMatch | null {
  let i = open + 1;
  while (isSpace(text[i])) i++;
  const start = i;
  if (text[i] === "<") {
    for (i++; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (text[i] === ">") { i++; break; }
    }
    if (text[i - 1] !== ">") return null;
  } else {
    let depth = 0;
    for (; i < text.length; i++) {
      const char = text[i]!;
      if (char === "\\") { i++; continue; }
      if (isSpace(char) && depth === 0) break;
      if (char === "(") depth++;
      else if (char === ")") {
        if (depth === 0) break;
        depth--;
      }
    }
  }
  const end = i;

  while (isSpace(text[i])) i++;
  if (text[i] !== ")") {
    const opener = text[i];
    const closer = opener === "(" ? ")" : opener;
    if (opener !== '"' && opener !== "'" && opener !== "(") return null;
    let depth = 1;
    for (i++; i < text.length; i++) {
      if (text[i] === "\\") i++;
      else if (opener === "(" && text[i] === "(") depth++;
      else if (text[i] === closer && --depth === 0) { i++; break; }
    }
    while (isSpace(text[i])) i++;
  }
  return text[i] === ")" ? { start, end, close: i } : null;
}

function scanAttrs(text: string, open: number): { raw: string; end: number } {
  let end = open;
  while (text[end] === "{") {
    const groupStart = end;
    let quote = "";
    let closed = false;
    for (let i = end + 1; i < text.length; i++) {
      const char = text[i]!;
      if (char === "\\") i++;
      else if (quote) {
        if (char === quote) quote = "";
      } else if (char === '"' || char === "'") quote = char;
      else if (char === "}") {
        if (i === end + 1) break;
        const body = text.slice(groupStart + 1, i).trim();
        // markdown-it-attrs leaves these as visible literal text. Never
        // absorb them into a property edit merely because braces balance.
        if (!body || body.includes("\\") || body === "." || body === "#") break;
        end = i + 1;
        closed = true;
        break;
      }
    }
    if (!closed) break;
  }
  return { raw: text.slice(open, end), end };
}

export function findImageToken(
  blockSlice: string,
  image: { src: string | null; alt: string | null; source: InlineSourceToken | null },
): ImageTokenMatch | null {
  if (!image.source) return null;
  const start = findOccurrence(blockSlice, image.source);
  if (start < 0) return null;
  const tokenRaw = image.source.token;
  if (!tokenRaw.startsWith("![")) return null;
  const label = scanBracket(tokenRaw, 1);
  if (!label || tokenRaw[label.close + 1] !== "(") return null;
  const destination = scanDestination(tokenRaw, label.close + 1);
  if (!destination || destination.close !== tokenRaw.length - 1) return null;
  const attrs = scanAttrs(blockSlice, start + tokenRaw.length);
  return {
    start,
    end: attrs.end,
    alt: image.alt ?? "",
    src: image.src ?? "",
    tokenRaw,
    attrsRaw: attrs.raw,
    altStart: 2,
    altEnd: label.close,
    destinationStart: destination.start,
    destinationEnd: destination.end,
  };
}

export type LinkResolution =
  | { kind: "found"; match: LinkTokenMatch }
  | { kind: "reference-style" }
  | { kind: "linkified" }
  | { kind: "not-found" };

export function resolveLinkToken(
  blockSlice: string,
  link: { href: string | null; text: string; source: InlineSourceToken | null },
): LinkResolution {
  if (!link.source) {
    return link.href && blockSlice.includes(link.href) ? { kind: "linkified" } : { kind: "not-found" };
  }
  const start = findOccurrence(blockSlice, link.source);
  if (start < 0) return { kind: "not-found" };
  const tokenRaw = link.source.token;
  const label = scanBracket(tokenRaw, 0);
  if (!label || tokenRaw[label.close + 1] !== "(") return { kind: "reference-style" };
  const destination = scanDestination(tokenRaw, label.close + 1);
  if (!destination || destination.close !== tokenRaw.length - 1) return { kind: "not-found" };
  return {
    kind: "found",
    match: {
      start,
      end: start + tokenRaw.length,
      href: link.href ?? "",
      tokenRaw,
      destinationStart: destination.start,
      destinationEnd: destination.end,
    },
  };
}

export function spliceToken(text: string, start: number, end: number, insert: string): string {
  return text.slice(0, start) + insert + text.slice(end);
}

function escapeLabel(value: string): string {
  let escaped = "";
  for (const char of value) {
    if (char === "\\" || char === "[" || char === "]") escaped += "\\";
    escaped += char;
  }
  return escaped;
}

/** CommonMark's backslash-escapable ASCII punctuation set — shared by
 *  {@link escapePlainAlt} (encode, writing) and {@link unescapeMarkdownText}
 *  (decode, reading — SFE-P3d-parity) so the two directions cannot drift
 *  apart into asymmetric round-tripping. */
const ESCAPABLE_PUNCTUATION = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`;

function escapePlainAlt(value: string): string {
  let escaped = "";
  for (const char of value) {
    if (ESCAPABLE_PUNCTUATION.includes(char)) escaped += "\\";
    escaped += char;
  }
  return escaped;
}

/**
 * The reverse of {@link escapePlainAlt}: `\X` -> `X` for every escapable
 * punctuation character, everything else passed through unchanged. Used to
 * turn RAW markdown source (alt text between `![`/`]`, or a bare/angle
 * destination) into the plain value a dialog/prompt should show — see this
 * file's header for why source mode needs a decode step the preview-driven
 * finders never did.
 */
function unescapeMarkdownText(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === "\\" && i + 1 < raw.length && ESCAPABLE_PUNCTUATION.includes(raw[i + 1]!)) {
      out += raw[i + 1];
      i++;
    } else {
      out += raw[i];
    }
  }
  return out;
}

/** Decodes a raw destination slice (as returned by {@link scanDestination}'s
 *  own `[start, end)`, i.e. WITHOUT any title) into the plain URL/path a
 *  dialog/prompt should show: strips a `<...>` wrapper when present, then
 *  unescapes. The mirror of {@link serializeDestination}'s encode direction. */
function decodeDestination(raw: string): string {
  const inner = raw.startsWith("<") && raw.endsWith(">") ? raw.slice(1, -1) : raw;
  return unescapeMarkdownText(inner);
}

function serializeDestination(value: string): string {
  if (!value) return "";
  let needsAngles = false;
  for (const char of value) {
    if (isSpace(char) || char === "(" || char === ")" || char === "<" || char === ">") {
      needsAngles = true;
      break;
    }
  }
  if (!needsAngles) return value;
  let escaped = "";
  for (const char of value) {
    if (char === "\\" || char === "<" || char === ">") escaped += "\\";
    escaped += char;
  }
  return `<${escaped}>`;
}

export function makeLinkToken(label: string, href: string): string {
  return `[${escapeLabel(label)}](${serializeDestination(href)})`;
}

export function rewriteImageToken(
  image: ImageTokenMatch,
  changes: { alt?: string; src?: string; attrsRaw?: string },
): string {
  const alt = changes.alt === undefined
    ? image.tokenRaw.slice(image.altStart, image.altEnd)
    : escapePlainAlt(changes.alt);
  const originalDestination = image.tokenRaw.slice(image.destinationStart, image.destinationEnd);
  const destination = changes.src === undefined
    ? originalDestination
    : serializeDestination(changes.src);
  const beforeDestination = image.tokenRaw.slice(image.altEnd, image.destinationStart);
  const afterDestination = image.tokenRaw.slice(image.destinationEnd);
  return `![${alt}${beforeDestination}${destination}${afterDestination}${changes.attrsRaw ?? image.attrsRaw}`;
}

export function rewriteLinkToken(link: LinkTokenMatch, href: string): string {
  return spliceToken(
    link.tokenRaw,
    link.destinationStart,
    link.destinationEnd,
    serializeDestination(href),
  );
}

/** Locate a normal Markdown link wrapped directly around an image token. */
export function findImageWrapper(
  text: string,
  image: ImageTokenMatch,
): { start: number; end: number; imageToken: string } | null {
  const start = image.start - 1;
  if (start < 0 || text[start] !== "[" || isEscaped(text, start) || text.slice(image.end, image.end + 2) !== "](") return null;
  const wrapper = scanDestination(text, image.end + 1);
  return wrapper
    ? { start, end: wrapper.close + 1, imageToken: text.slice(image.start, image.end) }
    : null;
}

// ── Caret-based finders (SFE-P3d-parity, Lane D) ────────────────────────────
// See this file's header for why these exist alongside findImageToken/
// resolveLinkToken rather than reusing them: there is no rendered preview
// element in source/rich mode, only a raw caret offset into the live text.

/**
 * Locates the image token (`![alt](src){attrs}`) whose span CONTAINS
 * `offset` — inclusive of both edges, so a caret sitting exactly at the
 * token's own start or end still counts as "on" it. `null` when no
 * well-formed image token's span contains `offset` (including when `offset`
 * sits on a bare `<img>` — raw HTML has no Markdown token to address, same
 * as {@link findImageToken}'s own raw-HTML case).
 */
export function findImageTokenAtOffset(text: string, offset: number): ImageTokenMatch | null {
  for (let i = 0; i < text.length - 1; i++) {
    if (text[i] !== "!" || text[i + 1] !== "[") continue;
    if (isEscaped(text, i)) continue;
    const label = scanBracket(text, i + 1);
    if (!label || text[label.close + 1] !== "(") continue;
    const destination = scanDestination(text, label.close + 1);
    if (!destination) continue;
    const attrs = scanAttrs(text, destination.close + 1);
    const end = attrs.end;
    if (offset < i || offset > end) continue;
    return {
      start: i,
      end,
      alt: unescapeMarkdownText(text.slice(i + 2, label.close)),
      src: decodeDestination(text.slice(destination.start, destination.end)),
      tokenRaw: text.slice(i, destination.close + 1),
      attrsRaw: attrs.raw,
      altStart: 2,
      altEnd: label.close - i,
      destinationStart: destination.start - i,
      destinationEnd: destination.end - i,
    };
  }
  return null;
}

/**
 * Locates the inline link token (`[text](href)`) whose span CONTAINS
 * `offset` (inclusive of both edges — see {@link findImageTokenAtOffset}).
 * Skips a `[` immediately preceded by an unescaped `!` (that is an image,
 * not a link — {@link findImageTokenAtOffset}'s territory). `null` for a
 * reference-style link (`[text][ref]`/`[text][]`, no `(` immediately after
 * the label), a "linkified" bare URL (no Markdown link syntax at all), or
 * genuinely no link here — callers that need to tell those apart for a
 * disabled-item TOOLTIP (the preview context menu's `linkDisabledReason`)
 * already have their own resolution path; this caret-driven entry point
 * only needs "editable, or not" (see this module's header on scope).
 */
export function findLinkTokenAtOffset(text: string, offset: number): LinkTokenMatch | null {
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "[") continue;
    if (isEscaped(text, i)) continue;
    if (i > 0 && text[i - 1] === "!" && !isEscaped(text, i - 1)) continue;
    const label = scanBracket(text, i);
    if (!label || text[label.close + 1] !== "(") continue;
    const destination = scanDestination(text, label.close + 1);
    if (!destination) continue;
    const end = destination.close + 1;
    if (offset < i || offset > end) continue;
    return {
      start: i,
      end,
      href: decodeDestination(text.slice(destination.start, destination.end)),
      tokenRaw: text.slice(i, end),
      destinationStart: destination.start - i,
      destinationEnd: destination.end - i,
    };
  }
  return null;
}
