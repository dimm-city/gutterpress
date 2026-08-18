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
import { authoredBlockAttrs, extraAttrs } from "./attrs";

/** The adoption payload `adoptPluginTokens` stashes on a rewritten token. */
interface PluginPayload {
  marker: string;
  closeMarker?: string;
  tag: string;
  viewAttrs: Record<string, string> | null;
  text?: string;
}

function pluginPayload(tok: Token): PluginPayload {
  return (tok.meta as { gpPlugin: PluginPayload }).gpPlugin;
}

/** Pipeline-injected attributes that must not be presented as the plugin's. */
const GENERATED_VIEW_ATTRS = /^(data-source-range|data-source-line|data-chapter-label)$/;

function viewAttrsOf(tok: Token): Record<string, string> | null {
  if (!tok.attrs || tok.attrs.length === 0) return null;
  const out: Record<string, string> = {};
  for (const [key, value] of tok.attrs) {
    if (!GENERATED_VIEW_ATTRS.test(key)) out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Adopt a PROJECT PLUGIN's block tokens onto the generic plugin nodes.
 *
 * Plugins are plain markdown-it plugins whose token types this product
 * cannot enumerate (CLAUDE.md §5) — but their branded markers follow the
 * marker-family shape: a block-level `X_open`/`X_close` pair, or a
 * self-closing block atom, whose authored lines this pass recovers and
 * stores verbatim on `plugin_block` / `plugin_atom` — which is ALL the
 * serializer ever writes back. Recovery sources, in order:
 *
 *   1. `token.map` — the standard carrier, when the plugin set it.
 *   2. `token.meta.gpEditorLines` — the range the plugin's own block rule
 *      actually consumed, stamped at registration by the core pipeline
 *      (`plugin-provenance.ts`). This is what frees adoption from caring
 *      how each plugin was written: house-style tokens (`meta.line`, `map`
 *      deliberately null per ADR 0009) and container-style closes (no map,
 *      pushed after the rule advanced) both recover exactly. Open markers
 *      read the range's first line; close markers read its last.
 *   3. `token.markup` — last resort; only right when the authored line IS
 *      the markup (e.g. a bare `:::`).
 *
 * Everything it cannot recover it leaves untouched, and the parser then
 * raises on the unknown type — the fail-closed guard is unchanged, it just
 * no longer fires for well-formed plugin markers. A token synthesized by a
 * core rule (`new state.Token`) passed through no block rule, carries no
 * stamp, and still fails closed. Inline unknowns are never adopted: they
 * have no authored line of their own to recover.
 */
function adoptPluginTokens(tokens: Token[], lines: string[], handled: Set<string>): Token[] {
  const stampOf = (tok: Token): [number, number] | undefined => {
    const range = (tok.meta as { gpEditorLines?: unknown } | null)?.gpEditorLines;
    return Array.isArray(range) && range.length === 2 ? (range as [number, number]) : undefined;
  };
  /**
   * One authored marker line, plus WHICH line it is when that is knowable
   * (`map`/stamp yes, bare `markup` no). `edge` picks the end of a stamped
   * range: an open marker is the first line its rule consumed, a close
   * marker the last. The index is what lets the pair handling below reason
   * about attribution instead of trusting text blindly.
   */
  const authoredRef = (
    tok: Token,
    edge: "first" | "last",
  ): { text: string; idx: number | undefined } | undefined => {
    let text: string | undefined;
    let idx: number | undefined;
    if (tok.map) {
      idx = tok.map[0];
    } else {
      const stamp = stampOf(tok);
      if (stamp) idx = edge === "first" ? stamp[0] : stamp[1] - 1;
      else text = tok.markup;
    }
    if (idx !== undefined) text = lines[idx];
    const trimmed = (text ?? "").trim();
    return trimmed ? { text: trimmed, idx } : undefined;
  };
  /** An atom's FULL authored source — its construct may span several lines. */
  const authoredBlock = (tok: Token): string | undefined => {
    const range = tok.map ?? stampOf(tok);
    const text = range ? lines.slice(range[0], range[1]).join("\n") : tok.markup;
    const trimmed = (text ?? "").trim();
    return trimmed || undefined;
  };

  const stack: Array<{ tok: Token; at: number }> = [];
  const dropped = new Set<Token>();
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    if (handled.has(tok.type)) continue;

    if (tok.type.endsWith("_open")) {
      stack.push({ tok, at: i });
      continue;
    }

    if (tok.type.endsWith("_close")) {
      const top = stack.pop();
      if (!top || top.tok.type.slice(0, -5) !== tok.type.slice(0, -6)) continue;
      const open = top.tok;
      const openRef = authoredRef(open, "first");
      const closeRef = authoredRef(tok, "last");
      if (!openRef || !closeRef) continue;

      if (openRef.idx !== undefined && openRef.idx === closeRef.idx) {
        // Both markers resolve to the SAME authored line: the construct is a
        // one-line pair (an empty wrapper from a single marker). Its source
        // form is that line, once — adopt it as an atom, or writing marker
        // AND closeMarker would duplicate the line on save. A one-line pair
        // that somehow holds children has no coherent source form; leave it
        // for the parser to refuse.
        if (i !== top.at + 1) continue;
        open.meta = {
          ...(open.meta as Record<string, unknown> | null),
          gpPlugin: { marker: openRef.text, tag: open.tag || "div", viewAttrs: viewAttrsOf(open), text: "" },
        };
        open.type = "plugin_atom";
        open.nesting = 0;
        dropped.add(tok);
        continue;
      }

      if (closeRef.idx !== undefined) {
        // The recovered close line must not already be owned by a child —
        // the shape an auto-closed container produces at EOF (its close
        // token's consumed range ends on the last CONTENT line, because
        // there is no terminator in the source). Writing that line as a
        // terminator would duplicate it. Ownership evidence is a child's
        // `map`, or a stamp TIGHTER than the close's own: a stamp identical
        // to the close's came from the same rule invocation (inner base
        // `_close` tokens are map-less, so the wrapper stamps them with its
        // whole range) and says nothing about the child itself.
        const ownStamp = tok.map ? undefined : stampOf(tok);
        const childRange = (child: Token): [number, number] | undefined => {
          if (child.map) return child.map;
          const stamp = stampOf(child);
          if (stamp && ownStamp && stamp[0] === ownStamp[0] && stamp[1] === ownStamp[1]) {
            return undefined;
          }
          return stamp;
        };
        const claimed = tokens.slice(top.at + 1, i).some((child) => {
          const range = childRange(child);
          return !!range && range[0] <= closeRef.idx! && closeRef.idx! < range[1];
        });
        if (claimed) continue;
      }

      open.meta = {
        ...(open.meta as Record<string, unknown> | null),
        gpPlugin: {
          marker: openRef.text,
          closeMarker: closeRef.text,
          tag: open.tag || "div",
          viewAttrs: viewAttrsOf(open),
        },
      };
      open.type = "plugin_block_open";
      tok.type = "plugin_block_close";
      continue;
    }

    if (tok.nesting === 0 && tok.block) {
      const marker = authoredBlock(tok);
      if (!marker) continue;
      tok.meta = {
        ...(tok.meta as Record<string, unknown> | null),
        gpPlugin: {
          marker,
          tag: tok.tag || "div",
          viewAttrs: viewAttrsOf(tok),
          text: tok.content || "",
        },
      };
      tok.type = "plugin_atom";
    }
  }
  return dropped.size ? tokens.filter((t) => !dropped.has(t)) : tokens;
}

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

  /**
   * The authored marker line, plus the classes `markers.js` derived from it.
   *
   * The class list is view-only (see `schema.ts`) — it is what lets the
   * editing surface emit the same `.page` / `.section` / author-utility DOM
   * the print path emits, so the book's own stylesheet applies unchanged.
   * Only `marker` is ever serialized back.
   */
  const marker = (tok: Token) => {
    const line = (tok.meta as { line?: number } | null)?.line;
    return {
      marker: typeof line === "number" ? (lines[line - 1] ?? "") : "",
      class: tok.attrGet("class") ?? "",
    };
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
    // Heading and fence attrs are read from the SOURCE line, not the token:
    // a plugin's token transform may decorate tokens freely (the fixture's
    // adds `.fm-h2` to every h2), and token-derived attrs wrote that
    // decoration back into the author's file. See `authoredBlockAttrs`.
    heading: {
      block: "heading",
      getAttrs: (tok) => ({
        level: +tok.tag.slice(1),
        attrs: authoredBlockAttrs(tok.map ? lines[tok.map[0]] : undefined),
      }),
    },
    code_block: { block: "code_block", noCloseToken: true },
    fence: {
      block: "code_block",
      getAttrs: (tok) => ({
        params: tok.info || "",
        attrs: authoredBlockAttrs(tok.map ? lines[tok.map[0]] : undefined),
      }),
      noCloseToken: true,
    },
    hr: { node: "horizontal_rule" },
    image: {
      node: "image",
      getAttrs: (tok) => ({
        src: tok.attrGet("src"),
        title: tok.attrGet("title") || null,
        alt: (tok.children?.[0] && tok.children[0].content) || null,
        // `{.gp-bleed}` and friends. Dropping these silently destroyed image
        // positioning in a book — see attrs.ts.
        attrs: extraAttrs(tok, "image"),
      }),
    },
    hardbreak: { node: "hard_break" },
    em: { mark: "em" },
    strong: { mark: "strong" },
    link: {
      mark: "link",
      getAttrs: (tok) => ({
        href: tok.attrGet("href"),
        title: tok.attrGet("title") || null,
        // `{target="_blank"}` / `{.external}` — see attrs.ts.
        attrs: extraAttrs(tok, "link"),
      }),
    },
    code_inline: { mark: "code", noCloseToken: true },
    s: { mark: "strikethrough" },

    // ── tables (markdown-it emits GFM tables by default) ─────────────────
    table: { block: "table" },
    thead: { block: "table_head" },
    tbody: { block: "table_body" },
    tr: { block: "table_row" },
    // `getAttrs` must return the attribute OBJECT, not a bare value. An
    // earlier `alignOf as ParseSpec["getAttrs"]` cast returned the string
    // `"right"` instead of `{ align: "right" }`, and the cast silenced the
    // type error — so every table's column alignment was dropped on save
    // (`| ---: |` came back as `| --- |`). No casts here.
    th: { block: "table_header", getAttrs: (tok) => ({ align: alignOf(tok) }) },
    td: { block: "table_cell", getAttrs: (tok) => ({ align: alignOf(tok) }) },

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

    // ── project-plugin markers, adopted generically ──────────────────────
    // Rewritten onto these types by `adoptPluginTokens` below — only when the
    // authored open/close lines are recoverable verbatim. `getAttrs` reads
    // the payload the adoption pass stashed on the open token.
    plugin_block: { block: "gp_plugin_block", getAttrs: (tok) => pluginPayload(tok) },
    plugin_atom: { node: "gp_plugin_atom", getAttrs: (tok) => pluginPayload(tok) },
  };

  /**
   * Token types the specs above give the parser a handler for. Anything NOT
   * in this set is a candidate for plugin adoption; anything that survives
   * adoption unadopted makes the parser raise (FAIL CLOSED, unchanged).
   */
  const handled = new Set<string>(["inline", "text", "softbreak"]);
  for (const [type, spec] of Object.entries(specs)) {
    if ((spec.block || spec.mark) && !spec.noCloseToken) {
      handled.add(`${type}_open`);
      handled.add(`${type}_close`);
    } else {
      handled.add(type);
    }
  }

  // The parser tokenizes through this facade so the adoption pass sees every
  // token stream — `parse()`, and nothing else, is what MarkdownParser calls.
  const tokenizer = {
    parse: (src: string, env: Record<string, unknown>) =>
      adoptPluginTokens(md.parse(src, env), lines, handled),
  };
  const parser = new MarkdownParser(gutterpressSchema, tokenizer as unknown as MarkdownIt, specs);

  return {
    /**
     * Throws on any construct the schema does not model — see FAIL CLOSED.
     *
     * That includes reference definitions, which are checked HERE rather than
     * in a caller-side preflight. They are the one construct markdown-it
     * consumes without emitting a token, so the library cannot raise on them
     * — and when the check lived only in `canEditRichly`, every other path
     * into a parse (`setContent` on an external reload, `applyRangeEdit`,
     * `isFixpoint`) silently used a WEAKER predicate and would have absorbed
     * a document whose `[ref]: url` lines then vanished on save. One choke
     * point, so no layer can hold a weaker verdict than another.
     */
    parse(text: string): PMNode {
      const refs = referenceLabels(md, text);
      if (refs.length) {
        throw new Error(
          `this file defines link ${refs.length === 1 ? "reference" : "references"} ` +
            `(${refs.map((r) => `[${r}]`).join(", ")}), which rich editing cannot represent`,
        );
      }
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
 * parse, which is the single fail-closed choke point (unknown token types
 * raise in the library; reference definitions raise in `parse()` itself).
 * The reason is returned so the UI can say WHY a file opened in source mode
 * rather than silently degrading.
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

/**
 * The `[label]: url` definitions in a file.
 *
 * These are the one construct that can go missing with NOTHING to detect it
 * afterwards. markdown-it's reference rule consumes the definition line into
 * `env.references` and emits no token at all, so there is nothing for the
 * parser to raise on; the definition simply vanishes on save. Both existing
 * gates are blind to it by construction — a loss that happens once is stable
 * on the second pass, so the fixpoint holds, and a definition renders no HTML,
 * so the semantic-preservation check compares two identical strings.
 *
 * A USED reference would survive as an inline link, but distinguishing used
 * from unused means guessing which link came from which definition. Refusing
 * whenever a definition is present is the fail-closed reading, and it is free:
 * across the whole first-party corpus, no file defines one.
 */
function referenceLabels(md: MarkdownIt, text: string): string[] {
  const env: { references?: Record<string, unknown> } = {};
  md.parse(text, env);
  const found = Object.keys(env.references ?? {});
  if (found.length === 0) return [];
  // markdown-it normalizes labels to upper case; quote the author's own
  // spelling back at them so the message names something they can search for.
  const authored = new Map(
    [...text.matchAll(/^ {0,3}\[([^\]]+)\]:/gm)].map((m) => [m[1]!.toUpperCase(), m[1]!]),
  );
  return found.map((label) => authored.get(label) ?? label);
}
