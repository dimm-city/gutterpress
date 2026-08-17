/**
 * markdown -> ProseMirror doc, using GUTTERPRESS'S OWN markdown-it instance.
 *
 * This is configuration, not a converter. `prosemirror-markdown`'s
 * `MarkdownParser` is designed to tokenize with a markdown-it instance you
 * supply and map the resulting tokens through `ParseSpec` entries — and it
 * declares `markdown-it: ^14`, the same major the CLI ships. So the editor
 * parses with the identical pipeline that prints: same plugins, same
 * `markers.js`, same `typographer`/`linkify` settings. There is no second
 * markdown dialect anywhere in the product, which is the property ADR 0009
 * was protecting when it warned against a second parser.
 *
 * FAIL CLOSED. `MarkdownParser` throws on a token type it has no spec for
 * ("Token type `x` not supported by Markdown parser"). That is exactly the
 * preflight semantics we want, and it is the library's behaviour rather than
 * a list we have to remember to maintain: footnotes, definition lists and the
 * sub/sup/mark/abbr plugin set all raise, so a file using them opens in
 * SOURCE mode instead of being silently mis-serialized.
 */
import { MarkdownParser, type ParseSpec } from "prosemirror-markdown";
import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";
import type { Node as PMNode } from "prosemirror-model";
import { gutterpressSchema } from "./schema";

/** `listIsTight`, which prosemirror-markdown keeps private. */
function listIsTight(tokens: readonly Token[], i: number): boolean {
  while (++i < tokens.length) {
    const t = tokens[i]!;
    if (t.type !== "list_item_open") return t.hidden;
  }
  return false;
}

function alignOf(token: Token): string | null {
  const style = token.attrGet("style") ?? "";
  const m = /text-align:\s*(left|right|center)/.exec(style);
  return m ? m[1]! : null;
}

/**
 * A parser bound to one markdown-it instance.
 *
 * `parse()` records the source lines first so the layout specs can read back
 * the AUTHORED marker line verbatim (see `schema.ts` on why the marker cannot
 * be reconstructed from the token's attributes).
 */
export function createDocParser(md: MarkdownIt) {
  let lines: string[] = [];

  const marker = (tok: Token) => {
    const line = (tok.meta as { line?: number } | null)?.line;
    return { marker: typeof line === "number" ? (lines[line - 1] ?? "") : "" };
  };

  const specs: Record<string, ParseSpec> = {
    // ── standard markdown ────────────────────────────────────────────────
    blockquote: { block: "blockquote" },
    paragraph: { block: "paragraph" },
    list_item: { block: "list_item" },
    bullet_list: { block: "bullet_list", getAttrs: (_, tokens, i) => ({ tight: listIsTight(tokens, i) }) },
    ordered_list: {
      block: "ordered_list",
      getAttrs: (tok, tokens, i) => ({ order: +(tok.attrGet("start") ?? 1) || 1, tight: listIsTight(tokens, i) }),
    },
    heading: { block: "heading", getAttrs: (tok) => ({ level: +tok.tag.slice(1) }) },
    code_block: { block: "code_block", noCloseToken: true },
    fence: { block: "code_block", getAttrs: (tok) => ({ params: tok.info || "" }), noCloseToken: true },
    hr: { node: "horizontal_rule" },
    image: {
      node: "image",
      getAttrs: (tok) => ({
        src: tok.attrGet("src"),
        title: tok.attrGet("title") || null,
        alt: (tok.children?.[0] && tok.children[0].content) || null,
      }),
    },
    hardbreak: { node: "hard_break" },
    em: { mark: "em" },
    strong: { mark: "strong" },
    link: { mark: "link", getAttrs: (tok) => ({ href: tok.attrGet("href"), title: tok.attrGet("title") || null }) },
    code_inline: { mark: "code", noCloseToken: true },

    // ── tables (markdown-it emits GFM tables by default) ─────────────────
    table: { block: "table" },
    thead: { block: "table_head" },
    tbody: { block: "table_body" },
    tr: { block: "table_row" },
    th: { block: "table_header", getAttrs: alignOf as ParseSpec["getAttrs"] },
    td: { block: "table_cell", getAttrs: alignOf as ParseSpec["getAttrs"] },

    // ── Gutterpress layout markers ───────────────────────────────────────
    layout_chapter: { block: "gp_chapter", getAttrs: marker },
    layout_spread: { block: "gp_spread", getAttrs: marker },
    layout_page: { block: "gp_page", getAttrs: marker },
    layout_section: { block: "gp_section", getAttrs: marker },
    layout_page_break: { node: "gp_page_break", getAttrs: marker },
    layout_column_break: { node: "gp_column_break", getAttrs: marker },

    // ── raw HTML, carried verbatim ───────────────────────────────────────
    html_block: { node: "html_block", noCloseToken: true, getAttrs: (tok) => ({ html: tok.content }) },
    html_inline: { node: "html_inline", noCloseToken: true, getAttrs: (tok) => ({ html: tok.content }) },
  };

  const parser = new MarkdownParser(gutterpressSchema, md, specs);

  return {
    /** Throws on any construct the schema does not model — see FAIL CLOSED. */
    parse(text: string): PMNode {
      lines = text.split(/\r\n?|\n/);
      const doc = parser.parse(text);
      if (!doc) throw new Error("markdown parse produced no document");
      return doc;
    },
  };
}

/**
 * Whether a file can be edited richly.
 *
 * There is no separate guard list to keep in sync — we simply attempt the
 * parse. Anything the schema does not model raises, and the reason is
 * returned so the UI can say WHY a file opened in source mode rather than
 * silently degrading.
 */
export function canEditRichly(
  md: MarkdownIt,
  text: string,
): { ok: true } | { ok: false; reason: string } {
  try {
    createDocParser(md).parse(text);
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
