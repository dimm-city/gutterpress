import type MarkdownIt from "markdown-it";
import type StateInline from "markdown-it/lib/rules_inline/state_inline.mjs";

export const SOURCE_TOKEN_ATTR = "data-gp-source-token";
export const SOURCE_OCCURRENCE_ATTR = "data-gp-source-occurrence";

type InlineRule = (state: StateInline, silent: boolean) => boolean;
type InternalRule = { name: string; fn: InlineRule };

const RESERVED_ATTRS = new Set([SOURCE_TOKEN_ATTR, SOURCE_OCCURRENCE_ATTR]);

function isHtmlSpace(char: string | undefined): boolean {
  return char === " " || char === "\t" || char === "\n" || char === "\r" || char === "\f";
}

/** Remove Gutterpress-owned attributes from one real opening tag. */
function stripReservedAttrsFromTag(html: string): string {
  let out = "";
  let inTag = false;
  let quote = "";
  for (let i = 0; i < html.length;) {
    const char = html[i]!;
    if (!inTag) {
      out += char;
      if (char === "<") inTag = true;
      i++;
      continue;
    }
    if (quote) {
      out += char;
      if (char === quote) quote = "";
      i++;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      out += char;
      i++;
      continue;
    }
    if (char === ">") {
      inTag = false;
      out += char;
      i++;
      continue;
    }
    if (!isHtmlSpace(char)) {
      out += char;
      i++;
      continue;
    }

    let nameStart = i;
    while (isHtmlSpace(html[nameStart])) nameStart++;
    let nameEnd = nameStart;
    while (
      nameEnd < html.length &&
      !isHtmlSpace(html[nameEnd]) &&
      html[nameEnd] !== "=" &&
      html[nameEnd] !== "/" &&
      html[nameEnd] !== ">"
    ) nameEnd++;
    const name = html.slice(nameStart, nameEnd).toLowerCase();
    if (!RESERVED_ATTRS.has(name)) {
      out += html.slice(i, nameStart);
      i = nameStart;
      continue;
    }

    i = nameEnd;
    while (isHtmlSpace(html[i])) i++;
    if (html[i] !== "=") continue;
    i++;
    while (isHtmlSpace(html[i])) i++;
    const valueQuote = html[i];
    if (valueQuote === '"' || valueQuote === "'") {
      for (i++; i < html.length && html[i] !== valueQuote; i++) {}
      if (html[i] === valueQuote) i++;
    } else {
      while (i < html.length && !isHtmlSpace(html[i]) && html[i] !== ">") i++;
    }
  }
  return out;
}

function tagEnd(html: string, start: number): number {
  let quote = "";
  for (let i = start + 1; i < html.length; i++) {
    const char = html[i]!;
    if (quote) {
      if (char === quote) quote = "";
    } else if (char === '"' || char === "'") quote = char;
    else if (char === ">") return i + 1;
  }
  return html.length;
}

function tagIdentity(tag: string): { name: string; closing: boolean } | null {
  let i = 1;
  while (isHtmlSpace(tag[i])) i++;
  const closing = tag[i] === "/";
  if (closing) {
    i++;
    while (isHtmlSpace(tag[i])) i++;
  }
  const start = i;
  while (i < tag.length) {
    const char = tag[i]!.toLowerCase();
    if ((char >= "a" && char <= "z") || (char >= "0" && char <= "9") || char === "-") i++;
    else break;
  }
  return i > start ? { name: tag.slice(start, i).toLowerCase(), closing } : null;
}

function findProtectedClose(html: string, tag: string, from: number): number {
  const needle = `</${tag}`;
  for (let at = html.indexOf(needle, from); at >= 0; at = html.indexOf(needle, at + needle.length)) {
    const boundary = html[at + needle.length];
    if (boundary === ">" || boundary === "/" || isHtmlSpace(boundary)) return at;
  }
  return -1;
}

/** Sanitize only real editable-element tags, leaving code/examples opaque. */
function stripReservedRawHtmlAttrs(
  html: string,
  initialProtectedTag = "",
): { html: string; protectedTag: string } {
  const protectedTags = new Set([
    "script", "style", "textarea", "title", "xmp", "iframe", "noembed", "noframes",
    "noscript", "plaintext",
  ]);
  const lower = html.toLowerCase();
  let out = "";
  let i = 0;
  let protectedTag = initialProtectedTag;
  while (i < html.length) {
    if (protectedTag) {
      // HTML's obsolete-but-supported <plaintext> has no end tag: every
      // remaining byte is text in Chromium.
      if (protectedTag === "plaintext") return { html: out + html.slice(i), protectedTag };
      const closeAt = findProtectedClose(lower, protectedTag, i);
      if (closeAt < 0) return { html: out + html.slice(i), protectedTag };
      out += html.slice(i, closeAt);
      i = closeAt;
      protectedTag = "";
      continue;
    }
    if (html.startsWith("<!--", i)) {
      const closeAt = html.indexOf("-->", i + 4);
      const end = closeAt < 0 ? html.length : closeAt + 3;
      out += html.slice(i, end);
      i = end;
      continue;
    }
    if (html[i] !== "<") {
      out += html[i++];
      continue;
    }
    const end = tagEnd(html, i);
    const tag = html.slice(i, end);
    const identity = tagIdentity(tag);
    if (!identity) {
      out += tag;
    } else if (!identity.closing && (identity.name === "img" || identity.name === "a")) {
      out += stripReservedAttrsFromTag(tag);
    } else {
      out += tag;
      if (!identity.closing && protectedTags.has(identity.name)) {
        protectedTag = identity.name;
      }
    }
    i = end;
  }
  return { html: out, protectedTag };
}

function occurrenceAt(source: string, token: string, target: number): number {
  let occurrence = 0;
  let from = 0;
  while (from < target) {
    const found = source.indexOf(token, from);
    if (found < 0 || found >= target) break;
    occurrence++;
    from = found + token.length;
  }
  return occurrence;
}

/**
 * Attach the exact source token and its literal occurrence to rendered
 * Markdown images and links. The Markdown parser remains the sole syntax
 * authority; desktop menus consume these coordinates instead of reparsing or
 * guessing from DOM src/text values.
 */
export function registerInlineSourceMetadata(md: MarkdownIt): void {
  // Sanitize raw HTML after inline parsing so raw-text state can span sibling
  // html_inline/text tokens. Renderer callbacks see one token at a time and
  // cannot distinguish a real <img> from the same bytes inside <script>.
  md.core.ruler.push("inline_source_raw_html", (state) => {
    let protectedTag = "";
    for (const block of state.tokens) {
      if (block.type === "html_block") {
        const sanitized = stripReservedRawHtmlAttrs(block.content, protectedTag);
        block.content = sanitized.html;
        protectedTag = sanitized.protectedTag;
        continue;
      }
      if (!block.children) continue;
      for (const token of block.children) {
        if (token.type !== "html_inline") continue;
        const sanitized = stripReservedRawHtmlAttrs(token.content, protectedTag);
        token.content = sanitized.html;
        protectedTag = sanitized.protectedTag;
      }
    }
  });

  const ruler = md.inline.ruler as typeof md.inline.ruler & { __rules__: InternalRule[] };

  for (const [ruleName, tokenType] of [["image", "image"], ["link", "link_open"]] as const) {
    const entry = ruler.__rules__.find((rule) => rule.name === ruleName);
    if (!entry) continue;
    const original = entry.fn;
    ruler.at(ruleName, (state, silent) => {
      const sourceStart = state.pos;
      const tokenStart = state.tokens.length;
      const matched = original(state, silent);
      if (!matched || silent) return matched;

      const token = state.tokens.slice(tokenStart).find((candidate) => candidate.type === tokenType);
      if (!token) return matched;
      const sourceToken = state.src.slice(sourceStart, state.pos);
      // Inline parsing normalizes multiline blockquote/list continuations, so
      // that token is not a literal slice of the source file. Do not expose a
      // destructive edit coordinate when identity is not exact.
      if (sourceToken.includes("\n") || sourceToken.includes("\r")) return matched;
      token.meta ??= {};
      token.meta.gpInlineSource = {
        token: sourceToken,
        occurrence: occurrenceAt(state.src, sourceToken, sourceStart),
      };
      return matched;
    });

    const originalRender = md.renderer.rules[tokenType];
    md.renderer.rules[tokenType] = (tokens, index, options, env, renderer) => {
      const token = tokens[index]!;
      if (token.attrs) {
        token.attrs = token.attrs.filter(([name]) => !RESERVED_ATTRS.has(name.toLowerCase()));
      }
      const source = token.meta?.gpInlineSource as { token: string; occurrence: number } | undefined;
      if (source) {
        token.attrSet(SOURCE_TOKEN_ATTR, source.token);
        token.attrSet(SOURCE_OCCURRENCE_ATTR, String(source.occurrence));
      }
      return originalRender
        ? originalRender(tokens, index, options, env, renderer)
        : renderer.renderToken(tokens, index, options);
    };
  }
}
