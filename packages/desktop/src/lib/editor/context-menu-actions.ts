/** Pure source-token helpers for preview context-menu edits. */

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

function escapePlainAlt(value: string): string {
  const punctuation = `!"#$%&'()*+,-./:;<=>?@[\\]^_\`{|}~`;
  let escaped = "";
  for (const char of value) {
    if (punctuation.includes(char)) escaped += "\\";
    escaped += char;
  }
  return escaped;
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
