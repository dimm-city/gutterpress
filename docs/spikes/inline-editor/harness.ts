/**
 * SPIKE C — does a ProseMirror schema + an AUTOMATIC opaque-node fallback
 * round-trip the real Gutterpress corpus with ZERO content loss?
 *
 * The mechanism under test is not "write a handler for every token". It is:
 *
 *   wrap the tokenizer -> for every top-level token run whose types (or whose
 *   inline children's types) have no schema handler, splice the run out and
 *   replace it with ONE synthetic token carrying the verbatim source slice
 *   from `token.map`. That becomes an atom node that serializes back byte-for-
 *   byte.
 *
 * If that holds, "Tiptap drops content it doesn't understand" stops being a
 * property of the library and becomes a property of the integration: unknown
 * constructs degrade to a non-editable-but-intact block instead of vanishing.
 *
 * Two runs quantify the trade:
 *   RUN 1  stock CommonMark schema  -> baseline: how much of the corpus falls
 *                                      back when you add nothing
 *   RUN 2  + Gutterpress node types -> how much stays richly editable for a
 *                                      day of schema work
 * The delta between them IS the schema work list.
 */
import {
  MarkdownParser,
  MarkdownSerializer,
  schema as base,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import { Schema } from "prosemirror-model";
import { createMarkdownRenderer } from "../../../packages/cli/src/lib/markdown/renderer.ts";

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

/** Atoms that hold verbatim source. These are what make loss impossible. */
const opaqueNodes = {
  raw_block: {
    group: "block",
    atom: true,
    attrs: { src: { default: "" } },
    toDOM: (n: any) => ["div", { "data-gp-raw": n.attrs.src }],
    parseDOM: [{ tag: "div[data-gp-raw]" }],
  },
  raw_inline: {
    group: "inline",
    inline: true,
    atom: true,
    attrs: { src: { default: "" } },
    toDOM: (n: any) => ["span", { "data-gp-raw": n.attrs.src }],
    parseDOM: [{ tag: "span[data-gp-raw]" }],
  },
} as const;

/** RUN 1: CommonMark + the fallback atoms, nothing else. */
const stockSchema = new Schema({
  nodes: base.spec.nodes
    .addToEnd("raw_block", opaqueNodes.raw_block)
    .addToEnd("raw_inline", opaqueNodes.raw_inline),
  marks: base.spec.marks,
});

/**
 * markdown-it-attrs moves authored `{#id .class key=val}` braces onto token
 * attrs. Nothing in the stock schema carries them, so they evaporate on
 * serialize. Give every node that can carry them one string attr holding the
 * reconstructed brace suffix.
 */
const ATTR_CARRIERS = ["paragraph", "heading", "blockquote", "code_block", "bullet_list", "ordered_list", "list_item", "image"];

/** Attrs a token owns intrinsically, plus everything the engine injects. */
const INTRINSIC_ATTRS: Record<string, Set<string>> = {
  image: new Set(["src", "alt", "title"]),
  link_open: new Set(["href", "title"]),
};

/** Rebuild the `{...}` suffix markdown-it-attrs consumed, or "" if none. */
function braceSuffixOf(tok: any): string {
  const intrinsic = INTRINSIC_ATTRS[tok.type] ?? new Set<string>();
  const parts: string[] = [];
  for (const [k, v] of tok.attrs ?? []) {
    if (intrinsic.has(k) || k.startsWith("data-")) continue;
    if (k === "id") parts.push(`#${v}`);
    else if (k === "class") for (const c of String(v).split(/\s+/).filter(Boolean)) parts.push(`.${c}`);
    else parts.push(`${k}=${v}`);
  }
  return parts.length ? `{${parts.join(" ")}}` : "";
}

const withAttrSlot = (nodes: any) =>
  ATTR_CARRIERS.reduce(
    (m, name) => m.update(name, { ...m.get(name), attrs: { ...(m.get(name).attrs ?? {}), gpAttrs: { default: "" } } }),
    nodes,
  );

/** RUN 2: + the Gutterpress-specific structure a real integration would model. */
const gpSchema = new Schema({
  nodes: withAttrSlot(base.spec.nodes)
    .addToEnd("raw_block", opaqueNodes.raw_block)
    .addToEnd("raw_inline", opaqueNodes.raw_inline)
    // Layout markers: `@chapter` / `@section` / `@page` / `@spread` wrap content.
    .addToEnd("marker_wrap", {
      group: "block",
      content: "block*",
      attrs: { kind: { default: "section" }, src: { default: "" } },
      toDOM: (n: any) => ["div", { "data-gp-marker": n.attrs.kind }, 0],
      parseDOM: [{ tag: "div[data-gp-marker]" }],
    })
    // Standalone markers: bare `@…` lines and explicit break markers.
    .addToEnd("marker_atom", {
      group: "block",
      atom: true,
      attrs: { src: { default: "" } },
      toDOM: (n: any) => ["div", { "data-gp-marker-atom": n.attrs.src }],
      parseDOM: [{ tag: "div[data-gp-marker-atom]" }],
    })
    // Definition lists (markdown-it-deflist).
    .addToEnd("def_list", {
      group: "block",
      content: "(def_term | def_desc)+",
      toDOM: () => ["dl", 0],
      parseDOM: [{ tag: "dl" }],
    })
    .addToEnd("def_term", { content: "inline*", toDOM: () => ["dt", 0], parseDOM: [{ tag: "dt" }] })
    .addToEnd("def_desc", { content: "block+", toDOM: () => ["dd", 0], parseDOM: [{ tag: "dd" }] }),
  marks: base.spec.marks
    .addToEnd("s", { toDOM: () => ["s", 0], parseDOM: [{ tag: "s" }] })
    .addToEnd("sub", { toDOM: () => ["sub", 0], parseDOM: [{ tag: "sub" }] })
    .addToEnd("sup", { toDOM: () => ["sup", 0], parseDOM: [{ tag: "sup" }] })
    .addToEnd("mark", { toDOM: () => ["mark", 0], parseDOM: [{ tag: "mark" }] })
    .addToEnd("abbr", {
      attrs: { title: { default: "" } },
      toDOM: (m: any) => ["abbr", { title: m.attrs.title }, 0],
      parseDOM: [{ tag: "abbr" }],
    }),
});

// ─────────────────────────────────────────────────────────────────────────────
// Token specs
// ─────────────────────────────────────────────────────────────────────────────

const commonTokens: Record<string, any> = {
  blockquote: { block: "blockquote" },
  paragraph: { block: "paragraph" },
  list_item: { block: "list_item" },
  bullet_list: { block: "bullet_list", getAttrs: () => ({ tight: true }) },
  ordered_list: {
    block: "ordered_list",
    getAttrs: (tok: any) => ({ order: +tok.attrGet("start") || 1, tight: true }),
  },
  heading: { block: "heading", getAttrs: (tok: any) => ({ level: +tok.tag.slice(1) }) },
  code_block: { block: "code_block", noCloseToken: true },
  fence: { block: "code_block", getAttrs: (tok: any) => ({ params: tok.info || "" }), noCloseToken: true },
  hr: { node: "horizontal_rule" },
  image: {
    node: "image",
    getAttrs: (tok: any) => ({
      src: tok.attrGet("src"),
      title: tok.attrGet("title") || null,
      alt: tok.children?.[0]?.content || null,
    }),
  },
  hardbreak: { node: "hard_break" },
  em: { mark: "em" },
  strong: { mark: "strong" },
  link: {
    mark: "link",
    getAttrs: (tok: any) => ({ href: tok.attrGet("href"), title: tok.attrGet("title") || null }),
  },
  code_inline: { mark: "code", noCloseToken: true },
  // The escalation product. Never emitted by markdown-it — synthesised below.
  gp_opaque_block: { node: "raw_block", getAttrs: (tok: any) => ({ src: tok.content }) },
  gp_opaque_inline: { node: "raw_inline", getAttrs: (tok: any) => ({ src: tok.content }) },
};

/** Wrap a token spec's getAttrs so it also captures the brace suffix. */
const keepAttrs = (spec: any) => ({
  ...spec,
  getAttrs: (tok: any, tokens: any[], i: number) => ({
    ...(spec.getAttrs ? spec.getAttrs(tok, tokens, i) : {}),
    gpAttrs: braceSuffixOf(tok),
  }),
});

const gpTokens: Record<string, any> = {
  ...commonTokens,
  paragraph: keepAttrs(commonTokens.paragraph),
  heading: keepAttrs(commonTokens.heading),
  blockquote: keepAttrs(commonTokens.blockquote),
  bullet_list: keepAttrs(commonTokens.bullet_list),
  ordered_list: keepAttrs(commonTokens.ordered_list),
  list_item: keepAttrs(commonTokens.list_item),
  code_block: keepAttrs(commonTokens.code_block),
  fence: keepAttrs(commonTokens.fence),
  image: keepAttrs(commonTokens.image),
  layout_chapter: { block: "marker_wrap", getAttrs: (tok: any) => ({ kind: "chapter", src: markerSrcOf(tok) }) },
  layout_section: { block: "marker_wrap", getAttrs: (tok: any) => ({ kind: "section", src: markerSrcOf(tok) }) },
  layout_page: { block: "marker_wrap", getAttrs: (tok: any) => ({ kind: "page", src: markerSrcOf(tok) }) },
  layout_spread: { block: "marker_wrap", getAttrs: (tok: any) => ({ kind: "spread", src: markerSrcOf(tok) }) },
  layout_marker: { node: "marker_atom", getAttrs: (tok: any) => ({ src: markerSrcOf(tok) }) },
  layout_page_break: { node: "marker_atom", getAttrs: () => ({ src: "@break" }) },
  layout_column_break: { node: "marker_atom", getAttrs: () => ({ src: "@break column" }) },
  dl: { block: "def_list" },
  dt: { block: "def_term" },
  dd: { block: "def_desc" },
  s: { mark: "s" },
  sub: { mark: "sub" },
  sup: { mark: "sup" },
  mark: { mark: "mark" },
  abbr: { mark: "abbr", getAttrs: (tok: any) => ({ title: tok.attrGet("title") || "" }) },
  html_inline: { node: "raw_inline", getAttrs: (tok: any) => ({ src: tok.content }) },
  html_block: { node: "raw_block", getAttrs: (tok: any) => ({ src: tok.content }) },
};

/**
 * Source lines of the file currently being parsed. Set by the wrapped
 * tokenizer; read by marker getAttrs, which needs the original line and only
 * receives a token.
 */
let currentLines: string[] = [];

/**
 * Marker tokens deliberately carry NO `token.map` (markers.js: setting it
 * would make markdown-it-source-map stamp data-source-line on the wrapper and
 * break scroll-sync — ADR 0009). They thread the 1-based marker line on
 * `token.meta.line` / `token.meta.__line` instead, so recover source there.
 */
function markerSrcOf(tok: any): string {
  const line = tok.meta?.line ?? tok.meta?.__line;
  if (typeof line === "number") return currentLines[line - 1] ?? "";
  return tok.content || tok.info || "";
}

// ─────────────────────────────────────────────────────────────────────────────
// The escalation pass — the actual thing under test
// ─────────────────────────────────────────────────────────────────────────────

export interface Stats {
  topLevel: number;
  opaque: number;
  unmappable: number;
  causes: Map<string, number>;
}

/** Every markdown-it token type a handler set can consume. */
function handlerKeys(tokens: Record<string, any>): Set<string> {
  const keys = new Set(["text", "inline", "softbreak"]);
  for (const type of Object.keys(tokens)) {
    const spec = tokens[type];
    if (spec.noCloseToken || spec.node) keys.add(type);
    else {
      keys.add(`${type}_open`);
      keys.add(`${type}_close`);
    }
  }
  return keys;
}

/** [start, end] of the balanced run of tokens beginning at `i`. */
function runEnd(toks: any[], i: number): number {
  if (toks[i].nesting !== 1) return i;
  let depth = 0;
  for (let k = i; k < toks.length; k++) {
    depth += toks[k].nesting;
    if (depth === 0) return k;
  }
  return toks.length - 1;
}

function runIsSupported(toks: any[], from: number, to: number, keys: Set<string>, causes: Map<string, number>) {
  let ok = true;
  const note = (t: string) => {
    causes.set(t, (causes.get(t) ?? 0) + 1);
    ok = false;
  };
  for (let k = from; k <= to; k++) {
    const tok = toks[k];
    if (!keys.has(tok.type)) note(tok.type);
    if (tok.type === "inline" && tok.children) {
      for (const child of tok.children) if (!keys.has(child.type)) note(child.type);
    }
  }
  return ok;
}

/**
 * Widest [startLine, endLine) covered by the run.
 *
 * `token.map` alone is NOT enough: marker tokens deliberately omit it and
 * thread the line on `token.meta` instead (see markerSrcOf). Ignoring that
 * makes an opaque slice start below its own `@section` line and silently drop
 * it — the exact silent-loss failure this spike exists to rule out.
 */
function linesOf(toks: any[], from: number, to: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  const see = (a: number, b: number) => {
    lo = Math.min(lo, a);
    hi = Math.max(hi, b);
  };
  for (let k = from; k <= to; k++) {
    const tok = toks[k];
    if (tok.map) see(tok.map[0], tok.map[1]);
    const meta = tok.meta?.line ?? tok.meta?.__line;
    if (typeof meta === "number") see(meta - 1, meta);
  }
  return lo === Infinity ? null : [lo, hi];
}

/**
 * Marker close tokens carry neither `map` nor `meta`, so an opaque run that
 * swallowed a `@section … @end section` pair stops one line short of its own
 * terminator. Extend past one `@end …` line per unmapped close in the run.
 */
function withTerminators(lines: string[], hi: number, toks: any[], from: number, to: number): number {
  let closes = 0;
  for (let k = from; k <= to; k++) {
    if (/^layout_\w+_close$/.test(toks[k].type) && !toks[k].map) closes++;
  }
  let end = hi;
  while (closes > 0) {
    let p = end;
    while (p < lines.length && lines[p].trim() === "") p++;
    if (p >= lines.length || !/^\s*@end\b/i.test(lines[p])) break;
    end = p + 1;
    closes--;
  }
  return end;
}

/**
 * Replace every unsupported top-level run with one synthetic opaque token
 * carrying the run's verbatim source lines.
 */
function escalate(toks: any[], src: string, keys: Set<string>, stats: Stats): any[] {
  const lines = src.split("\n");
  const out: any[] = [];
  // Highest source line already accounted for. Opaque slices start here, not
  // at their own first mapped line, so that any gap a preceding run failed to
  // cover (an unmapped marker line, a stripped attribute line) is swept into
  // the verbatim slice rather than dropped.
  let cursor = 0;
  let i = 0;
  while (i < toks.length) {
    const end = runEnd(toks, i);
    const span = linesOf(toks, i, end);
    stats.topLevel++;
    if (runIsSupported(toks, i, end, keys, stats.causes)) {
      for (let k = i; k <= end; k++) out.push(toks[k]);
    } else if (!span && cursor >= lines.length) {
      stats.unmappable++;
    } else {
      const lo = Math.min(cursor, span ? span[0] : cursor);
      const hi = withTerminators(lines, Math.max(cursor, span ? span[1] : cursor + 1), toks, i, end);
      stats.opaque++;
      out.push({
        type: "gp_opaque_block",
        content: lines.slice(lo, hi).join("\n"),
        map: [lo, hi],
        nesting: 0,
        children: null,
        attrs: null,
      });
      cursor = Math.max(cursor, hi);
    }
    if (span) cursor = Math.max(cursor, span[1]);
    i = end + 1;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serializers
// ─────────────────────────────────────────────────────────────────────────────

const verbatim = (state: any, node: any) => {
  state.write(node.attrs.src);
  state.closeBlock(node);
};

/**
 * Wrap the stock serializers for attr-carrying nodes so the `{...}` suffix is
 * spliced onto the end of whatever they just wrote. Splicing (rather than
 * writing after) keeps the braces on the node's own last line: `closeBlock`
 * only marks a block closed, so at this point the deferred blank line has not
 * been emitted yet.
 */
function withBraceSuffix(nodes: Record<string, any>) {
  const wrapped: Record<string, any> = {};
  for (const name of ATTR_CARRIERS) {
    const base = nodes[name];
    if (!base) continue;
    wrapped[name] = (state: any, node: any, parent: any, index: number) => {
      const at = state.out.length;
      base(state, node, parent, index);
      const suffix = node.attrs?.gpAttrs;
      if (!suffix) return;
      const written = state.out.slice(at);
      const body = written.replace(/\n*$/, "");
      state.out = state.out.slice(0, at) + body + " " + suffix + written.slice(body.length);
    };
  }
  return wrapped;
}

function serializerFor(tokens: Record<string, any>) {
  return new MarkdownSerializer(
    {
      ...defaultMarkdownSerializer.nodes,
      raw_block: verbatim,
      raw_inline: (state: any, node: any) => state.text(node.attrs.src, false),
      marker_atom: verbatim,
      // Markers auto-close, so `@end <kind>` is optional syntax. Emitting it
      // unconditionally is a canonical normalization: structure and author
      // attributes survive, only the optional terminator's presence is
      // normalized (byte-identity is measured separately).
      marker_wrap: (state: any, node: any) => {
        state.write(node.attrs.src || `@${node.attrs.kind}`);
        state.closeBlock(node);
        state.renderContent(node);
        state.write(`@end ${node.attrs.kind}`);
        state.closeBlock(node);
      },
      def_list: (state: any, node: any) => state.renderContent(node),
      def_term: (state: any, node: any) => {
        state.write("");
        state.renderInline(node);
        state.closeBlock(node);
      },
      def_desc: (state: any, node: any) => state.wrapBlock(":   ", null, node, () => state.renderContent(node)),
      // Re-emit the `{...}` suffix markdown-it-attrs consumed. Wrapping the
      // stock serializers keeps their escaping/wrapping behaviour and only
      // appends the braces on the line the node just wrote.
      ...withBraceSuffix(defaultMarkdownSerializer.nodes),
    },
    {
      ...defaultMarkdownSerializer.marks,
      s: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
      sub: { open: "~", close: "~", mixable: true },
      sup: { open: "^", close: "^", mixable: true },
      mark: { open: "==", close: "==", mixable: true },
      abbr: { open: "", close: "", mixable: true },
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Factories
// ─────────────────────────────────────────────────────────────────────────────

export const md = createMarkdownRenderer();

export function makeParser(schema: Schema, tokens: Record<string, any>, stats: Stats) {
  const parser = new MarkdownParser(schema as any, md as any, tokens);
  const keys = handlerKeys(tokens);
  (parser as any).tokenizer = {
    parse: (text: string, env: any) => {
      currentLines = text.split("\n");
      return escalate(md.parse(text, env), text, keys, stats);
    },
  };
  return parser;
}

export const emptyStats = (): Stats => ({ topLevel: 0, opaque: 0, unmappable: 0, causes: new Map() });

export function makeRun1() {
  const stats = emptyStats();
  return { parser: makeParser(stockSchema, commonTokens, stats), ser: serializerFor(commonTokens), stats };
}
export function makeRun2() {
  const stats = emptyStats();
  return { parser: makeParser(gpSchema, gpTokens, stats), ser: serializerFor(gpTokens), stats };
}
export { stockSchema, gpSchema, commonTokens, gpTokens, serializerFor, handlerKeys, escalate };
