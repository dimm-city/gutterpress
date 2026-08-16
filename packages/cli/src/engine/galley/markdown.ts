/**
 * Galley markdown codec — markdown-it tokens → ProseMirror doc, and doc →
 * markdown. The two invariants everything else leans on:
 *
 * 1. ZERO LOSS. Every non-blank source line is covered either by a modelled
 *    node or by an opaque atom carrying its verbatim bytes. Three mechanisms
 *    add up to that guarantee:
 *      - escalation: any token run whose types (or inline children's types)
 *        have no handler becomes one `rawBlock` atom with the run's source
 *        slice (recursing into marker wraps, so a table inside a @section
 *        falls back alone — not the whole section);
 *      - the gap sweep: lines markdown-it CONSUMED without emitting tokens
 *        (abbr definitions, reference-link definitions) show up as map gaps
 *        between runs and are emitted as opaque atoms;
 *      - marker terminator recovery: `@end-section` lines carry no token
 *        map, so opaque slices are extended over them (the spike caught
 *        both this and the meta-only marker-line defect; see
 *        docs/inline-editor-library-evaluation.md).
 *    The corpus gate (galley.test.ts / roundtrip gate) holds this at zero
 *    lost words.
 *
 * 2. UNTOUCHED BLOCKS KEEP THEIR BYTES. `buildGalleyDoc` records each
 *    doc/markerWrap child's source slice in a WeakMap keyed by node
 *    IDENTITY. ProseMirror's persistent tree keeps untouched nodes
 *    identical across transactions, so at serialize time a hit means "the
 *    author never edited this block" and the original bytes are emitted
 *    verbatim. Anything edited serializes canonically.
 *
 * Parsing always happens with Gutterpress's OWN markdown-it token stream
 * (served by the preview server) — this module never tokenizes markdown
 * itself, so there is exactly one parser in the product.
 */
import {
  MarkdownParser,
  MarkdownSerializer,
  defaultMarkdownSerializer,
} from "prosemirror-markdown";
import { Fragment } from "@tiptap/pm/model";
import type { Node as PMNode, Schema } from "@tiptap/pm/model";

// ── plain-JSON token shape (markdown-it Token survives JSON round-trip) ─────

export interface GalleyToken {
  type: string;
  tag?: string;
  attrs?: Array<[string, string]> | null;
  map?: [number, number] | null;
  nesting: number;
  content?: string;
  markup?: string;
  info?: string;
  meta?: Record<string, unknown> | null;
  children?: GalleyToken[] | null;
  hidden?: boolean;
}

const attrOf = (tok: GalleyToken, name: string): string | null => {
  for (const [k, v] of tok.attrs ?? []) if (k === name) return v;
  return null;
};

// ── authored `{...}` reconstruction ─────────────────────────────────────────

/** Attrs a token owns intrinsically — everything else is authored braces. */
const INTRINSIC_ATTRS: Record<string, ReadonlySet<string>> = {
  image: new Set(["src", "alt", "title"]),
  link_open: new Set(["href", "title"]),
  td_open: new Set(["style"]),
  th_open: new Set(["style"]),
  ordered_list_open: new Set(["start"]),
};

/**
 * Attributes the ENGINE injects (source-range annotations, marker plumbing)
 * — never authored, never re-emitted. An exact-name set, not a data-*
 * prefix filter: authors may write their own `{data-role=aside}` braces
 * and those must survive.
 */
const INJECTED_ATTRS = new Set([
  "data-source-range",
  "data-source-line",
  "data-chapter-src",
  "data-chapter-label",
  "aria-hidden",
]);

/** Rebuild the `{#id .class key=val}` suffix markdown-it-attrs consumed. */
export function braceSuffixOf(tok: GalleyToken): string {
  const intrinsic = INTRINSIC_ATTRS[tok.type] ?? INTRINSIC_ATTRS[`${tok.type}_open`];
  const parts: string[] = [];
  for (const [k, v] of tok.attrs ?? []) {
    if (intrinsic?.has(k) || INJECTED_ATTRS.has(k)) continue;
    if (k === "id") parts.push(`#${v}`);
    else if (k === "class") for (const c of v.split(/\s+/).filter(Boolean)) parts.push(`.${c}`);
    // Values with whitespace round-trip only in markdown-it-attrs' quoted
    // form (its grammar has no escape for embedded quotes, so a value
    // containing `"` cannot be authored via braces in the first place).
    else parts.push(/\s/.test(v) ? `${k}="${v}"` : `${k}=${v}`);
  }
  return parts.length ? `{${parts.join(" ")}}` : "";
}

// ── token preprocessing ─────────────────────────────────────────────────────

const OPENER_RE = /^<div class="chapter-opener" data-chapter-label="([^"]*)">/;

/**
 * Normalize the raw stream before spec dispatch:
 * - the renderer-injected chapter opener (an unmapped html_block) becomes a
 *   display-only `gp_chapter_opener` token so it can never serialize;
 * - inline footnotes without a label can't be reconstructed from tokens, so
 *   they are renamed to an unhandled type and escalate with their paragraph;
 * - table cells get paragraph wrappers (markdown-it emits bare inline
 *   content in th/td; the schema's cells hold blocks).
 */
function preprocess(tokens: GalleyToken[]): GalleyToken[] {
  const out: GalleyToken[] = [];
  for (const tok of tokens) {
    if (tok.type === "html_block" && !tok.map && OPENER_RE.test(tok.content ?? "")) {
      const label = OPENER_RE.exec(tok.content ?? "")![1]!;
      out.push({ type: "gp_chapter_opener", nesting: 0, meta: { label } });
      continue;
    }
    if (tok.type === "footnote_ref" && !tok.meta?.label) {
      out.push({ ...tok, type: "footnote_ref_inline" });
      continue;
    }
    // Drop markdown-it-footnote's wrapper around the hoisted definitions.
    // Keeping it made the whole collection ONE unhandled run, whose span is
    // [min, max] over its inner token maps — and because the plugin gathers
    // definitions written at scattered source lines, that span swallowed
    // every line between the first and last definition. Any paragraph in
    // between was then emitted twice: once as itself, once inside the opaque
    // slice. Without the wrapper each `footnote_open…footnote_close` is its
    // own balanced run with its own contiguous span. Nesting stays balanced:
    // the open/close pair is removed together.
    if (tok.type === "footnote_block_open" || tok.type === "footnote_block_close") continue;
    if (tok.children) {
      out.push({ ...tok, children: preprocess(tok.children) });
      continue;
    }
    out.push(tok);
    if (tok.type === "th_open" || tok.type === "td_open") {
      out.push({ type: "paragraph_open", tag: "p", nesting: 1, hidden: false });
    }
  }
  // Close the injected cell paragraphs (walk again pairing with cell closes).
  const withCloses: GalleyToken[] = [];
  for (const tok of out) {
    if (tok.type === "th_close" || tok.type === "td_close") {
      withCloses.push({ type: "paragraph_close", tag: "p", nesting: -1 });
    }
    withCloses.push(tok);
  }
  return withCloses;
}

// ── escalation ──────────────────────────────────────────────────────────────

export interface SpanNode {
  /** [from, to) source lines, or null when the node has no source (opener). */
  span: [number, number] | null;
  /** Child spans when the node is a container we preserve into (markerWrap). */
  children: SpanNode[] | null;
}

export interface EscalateStats {
  blocks: number;
  opaque: number;
}

const MARKER_WRAP_OPENS = new Set([
  "layout_chapter_open",
  "layout_section_open",
  "layout_page_open",
  "layout_spread_open",
]);

/** Marker-family lines are token-backed or regenerated — never gap content. */
const MARKER_LINE_RE =
  /^\s*@(chapter|spread|page|section|continue|end-section|page-break|column-break)\b/;

/** All token types a handler set consumes (open/close naming convention). */
function handlerKeys(specs: Record<string, Record<string, unknown>>): Set<string> {
  const keys = new Set(["text", "inline", "softbreak"]);
  for (const type of Object.keys(specs)) {
    const spec = specs[type]!;
    if (spec.noCloseToken || spec.node || spec.ignore) {
      keys.add(type);
      if (!spec.noCloseToken && !spec.node) {
        keys.add(`${type}_open`);
        keys.add(`${type}_close`);
      }
    } else {
      keys.add(`${type}_open`);
      keys.add(`${type}_close`);
    }
  }
  return keys;
}

/** End index of the balanced run starting at `i`. */
function runEnd(toks: GalleyToken[], i: number): number {
  if (toks[i]!.nesting !== 1) return i;
  let depth = 0;
  for (let k = i; k < toks.length; k++) {
    depth += toks[k]!.nesting;
    if (depth === 0) return k;
  }
  return toks.length - 1;
}

/**
 * Container tokens whose authored `{…}` braces have no serialization the
 * schema can round-trip faithfully: markdown-it-attrs' binding rules for
 * these are positional (own line after a table is eaten as a ROW; an
 * end-of-item brace binds to the <li>; a blank-line brace becomes an
 * attrs-only paragraph) and every placement we tried corrupted or migrated
 * the attrs on reparse (Opus-verified probes: phantom table rows, `{.x}` →
 * `{.x .x}` accumulation). Refuse-by-default instead: a container carrying
 * authored braces escalates VERBATIM — zero loss, source-editable, and a
 * corpus-empty path today (no example book authors container-level braces).
 */
const ATTR_REFUSED_CONTAINERS = new Set([
  "bullet_list_open",
  "ordered_list_open",
  "blockquote_open",
  "table_open",
  "list_item_open",
  "dl_open",
]);

function runIsSupported(toks: GalleyToken[], from: number, to: number, keys: Set<string>): boolean {
  for (let k = from; k <= to; k++) {
    const tok = toks[k]!;
    if (!keys.has(tok.type)) return false;
    if (ATTR_REFUSED_CONTAINERS.has(tok.type) && braceSuffixOf(tok) !== "") return false;
    if (tok.type === "inline") {
      for (const child of tok.children ?? []) if (!keys.has(child.type)) return false;
    }
  }
  return true;
}

/**
 * Source-line extent of a run. Marker tokens deliberately omit `token.map`
 * (ADR 0009) and thread the line on `token.meta.line` — both are read.
 */
function linesOf(toks: GalleyToken[], from: number, to: number): [number, number] | null {
  let lo = Infinity;
  let hi = -Infinity;
  for (let k = from; k <= to; k++) {
    const tok = toks[k]!;
    if (tok.map) {
      lo = Math.min(lo, tok.map[0]);
      hi = Math.max(hi, tok.map[1]);
    }
    const metaLine = (tok.meta as { line?: number } | null)?.line;
    if (typeof metaLine === "number") {
      lo = Math.min(lo, metaLine - 1);
      hi = Math.max(hi, metaLine);
    }
  }
  return lo === Infinity ? null : [lo, hi];
}

/** Extend an opaque slice over unmapped `@end-section` terminator lines. */
function withTerminators(
  lines: string[],
  hi: number,
  toks: GalleyToken[],
  from: number,
  to: number,
): number {
  let closes = 0;
  for (let k = from; k <= to; k++) {
    if (/^layout_\w+_close$/.test(toks[k]!.type) && !toks[k]!.map) closes++;
  }
  let end = hi;
  while (closes > 0) {
    let p = end;
    while (p < lines.length && lines[p]!.trim() === "") p++;
    if (p >= lines.length || !/^\s*@end-section\b/.test(lines[p]!)) break;
    end = p + 1;
    closes--;
  }
  return end;
}

function opaqueToken(lines: string[], from: number, to: number): GalleyToken {
  return {
    type: "gp_opaque_block",
    nesting: 0,
    content: lines.slice(from, to).join("\n"),
    map: [from, to],
  };
}

/** One balanced run, described before any output is materialized. */
interface RunDesc {
  kind: "keep" | "opaque" | "wrap";
  i: number;
  end: number;
  span: [number, number] | null;
  children: RunDesc[] | null;
}

/**
 * Phase A — describe every run and mark which source lines are covered by
 * SOME token, at any position in the stream. Coverage must be complete
 * before gaps are swept because plugins move tokens (markdown-it-footnote
 * relocates definition tokens to the stream's end while their maps still
 * point at the definition's source lines); a cursor-only sweep would see
 * those lines as uncovered and duplicate them.
 */
function describeRuns(
  toks: GalleyToken[],
  lines: string[],
  keys: Set<string>,
  stats: EscalateStats,
  covered: Uint8Array,
): RunDesc[] {
  const cover = (from: number, to: number) => covered.fill(1, Math.max(0, from), Math.min(covered.length, to));
  const runs: RunDesc[] = [];
  let i = 0;
  while (i < toks.length) {
    const end = runEnd(toks, i);
    const tok = toks[i]!;
    const span = linesOf(toks, i, end);
    stats.blocks++;
    if (MARKER_WRAP_OPENS.has(tok.type)) {
      // Container — recurse so an unmodelled block inside a section
      // degrades alone. Cover only the marker's own line here; children
      // cover their own.
      const metaLine = (tok.meta as { line?: number } | null)?.line;
      if (typeof metaLine === "number") cover(metaLine - 1, metaLine);
      const children = describeRuns(toks.slice(i + 1, end), lines, keys, stats, covered);
      runs.push({ kind: "wrap", i, end, span, children });
    } else if (runIsSupported(toks, i, end, keys)) {
      if (span) cover(span[0], span[1]);
      runs.push({ kind: "keep", i, end, span, children: null });
    } else {
      stats.opaque++;
      const to = span ? withTerminators(lines, span[1], toks, i, end) : null;
      const full: [number, number] | null = span ? [span[0], to!] : null;
      if (full) cover(full[0], full[1]);
      runs.push({ kind: "opaque", i, end, span: full, children: null });
    }
    i = end + 1;
  }
  return runs;
}

/**
 * Phase B — materialize the processed stream, inserting one opaque atom per
 * uncovered non-blank gap (lines a plugin consumed without emitting tokens:
 * abbr definitions, reference-link definitions). Marker-family lines are
 * never gap content — they are token-backed or regenerated on serialize.
 */
function emitRuns(
  runs: RunDesc[],
  toks: GalleyToken[],
  lines: string[],
  covered: Uint8Array,
  stats: EscalateStats,
  windowFrom: number,
  windowTo: number,
): { tokens: GalleyToken[]; spans: SpanNode[] } {
  const out: GalleyToken[] = [];
  const spans: SpanNode[] = [];
  let cursor = windowFrom;

  const sweepGap = (upto: number) => {
    let at = cursor;
    while (at < upto) {
      while (
        at < upto &&
        (covered[at] || lines[at]!.trim() === "" || MARKER_LINE_RE.test(lines[at]!))
      )
        at++;
      if (at >= upto) break;
      let gapEnd = at;
      while (gapEnd < upto && !covered[gapEnd] && lines[gapEnd]!.trim() !== "" && !MARKER_LINE_RE.test(lines[gapEnd]!))
        gapEnd++;
      stats.blocks++;
      stats.opaque++;
      out.push(opaqueToken(lines, at, gapEnd));
      spans.push({ span: [at, gapEnd], children: null });
      covered.fill(1, at, gapEnd);
      at = gapEnd;
    }
    cursor = Math.max(cursor, upto);
  };

  for (const run of runs) {
    if (run.span && run.span[0] > cursor) sweepGap(run.span[0]);
    if (run.kind === "wrap") {
      const openTok = toks[run.i]!;
      const metaLine = (openTok.meta as { line?: number } | null)?.line;
      const innerFrom = typeof metaLine === "number" ? metaLine : cursor;
      const innerTo = run.span ? run.span[1] : windowTo;
      const inner = emitRuns(
        run.children!,
        toks.slice(run.i + 1, run.end),
        lines,
        covered,
        stats,
        innerFrom,
        innerTo,
      );
      out.push(openTok, ...inner.tokens, toks[run.end]!);
      spans.push({ span: run.span, children: inner.spans });
    } else if (run.kind === "keep") {
      for (let k = run.i; k <= run.end; k++) out.push(toks[k]!);
      spans.push({ span: run.span, children: null });
    } else if (run.span) {
      out.push(opaqueToken(lines, run.span[0], run.span[1]));
      spans.push({ span: run.span, children: null });
    } else {
      // Unsupported run with no source footprint (generated tokens only) —
      // nothing to keep, no node, no span entry.
      continue;
    }
    if (run.span) cursor = Math.max(cursor, run.span[1]);
  }
  sweepGap(windowTo);
  return { tokens: out, spans };
}

function escalate(
  toks: GalleyToken[],
  lines: string[],
  keys: Set<string>,
  stats: EscalateStats,
): { tokens: GalleyToken[]; spans: SpanNode[] } {
  const covered = new Uint8Array(lines.length);
  const runs = describeRuns(toks, lines, keys, stats, covered);
  return emitRuns(runs, toks, lines, covered, stats, 0, lines.length);
}

// ── token specs (markdown-it type → schema node/mark) ───────────────────────

function markerAttrs(kind: string, tok: GalleyToken, lines: string[]) {
  const line = (tok.meta as { line?: number } | null)?.line;
  return {
    kind,
    src: typeof line === "number" ? (lines[line - 1] ?? `@${kind}`) : `@${kind}`,
    domAttrs: tok.attrs ?? [],
  };
}

function buildTokenSpecs(lines: string[]): Record<string, Record<string, unknown>> {
  const gp = (tok: GalleyToken) => ({
    gpAttrs: braceSuffixOf(tok),
    // Rendered as data-source-line so the source-pane scroll sync works
    // over the editing DOM (stale after edits; heals on the next build).
    gpLine: tok.map ? tok.map[0] + 1 : null,
  });
  const cell = (name: string) => ({
    block: name,
    getAttrs: (tok: GalleyToken) => {
      const m = /text-align:\s*(left|center|right)/.exec(attrOf(tok, "style") ?? "");
      return { gpAlign: m ? m[1] : null };
    },
  });
  return {
    paragraph: { block: "paragraph", getAttrs: gp },
    heading: {
      block: "heading",
      getAttrs: (tok: GalleyToken) => ({ level: +(tok.tag ?? "h1").slice(1), ...gp(tok) }),
    },
    blockquote: { block: "blockquote" },
    bullet_list: { block: "bulletList" },
    ordered_list: {
      block: "orderedList",
      getAttrs: (tok: GalleyToken) => ({ start: +(attrOf(tok, "start") ?? "1") }),
    },
    list_item: { block: "listItem" },
    code_block: { block: "codeBlock", noCloseToken: true, getAttrs: gp },
    fence: {
      block: "codeBlock",
      noCloseToken: true,
      getAttrs: (tok: GalleyToken) => ({
        language: (tok.info ?? "").trim().split(/\s+/)[0] || null,
        ...gp(tok),
      }),
    },
    hr: { node: "horizontalRule" },
    hardbreak: { node: "hardBreak" },
    image: {
      node: "image",
      getAttrs: (tok: GalleyToken) => ({
        src: attrOf(tok, "src") ?? "",
        alt: tok.content ?? "",
        title: attrOf(tok, "title"),
        ...gp(tok),
      }),
    },
    em: { mark: "italic" },
    strong: { mark: "bold" },
    s: { mark: "strike" },
    code_inline: { mark: "code", noCloseToken: true },
    link: {
      mark: "link",
      getAttrs: (tok: GalleyToken) => ({
        href: attrOf(tok, "href") ?? "",
        title: attrOf(tok, "title"),
      }),
    },
    sub: { mark: "sub" },
    sup: { mark: "sup" },
    mark: { mark: "highlight" },
    abbr: {
      mark: "abbr",
      getAttrs: (tok: GalleyToken) => ({ title: attrOf(tok, "title") ?? "" }),
    },
    // Markers. The transform pass rewrote layout_marker into these.
    layout_chapter: {
      block: "markerWrap",
      getAttrs: (tok: GalleyToken) => markerAttrs("chapter", tok, lines),
    },
    layout_section: {
      block: "markerWrap",
      getAttrs: (tok: GalleyToken) => markerAttrs("section", tok, lines),
    },
    layout_page: {
      block: "markerWrap",
      getAttrs: (tok: GalleyToken) => markerAttrs("page", tok, lines),
    },
    layout_spread: {
      block: "markerWrap",
      getAttrs: (tok: GalleyToken) => markerAttrs("spread", tok, lines),
    },
    layout_page_break: {
      node: "markerAtom",
      getAttrs: (tok: GalleyToken) => {
        const line = (tok.meta as { line?: number } | null)?.line;
        return {
          src: typeof line === "number" ? (lines[line - 1] ?? "@page-break") : "@page-break",
          domAttrs: tok.attrs ?? [],
        };
      },
    },
    layout_column_break: {
      node: "markerAtom",
      getAttrs: (tok: GalleyToken) => {
        const line = (tok.meta as { line?: number } | null)?.line;
        return {
          src: typeof line === "number" ? (lines[line - 1] ?? "@column-break") : "@column-break",
          domAttrs: tok.attrs ?? [],
        };
      },
    },
    // Definition lists.
    dl: { block: "defList" },
    dt: { block: "defTerm" },
    dd: { block: "defDesc" },
    // Tables (thead/tbody flattened; the serializer re-derives them).
    table: { block: "table" },
    thead: { ignore: true },
    tbody: { ignore: true },
    tr: { block: "tableRow" },
    th: cell("tableHeader"),
    td: cell("tableCell"),
    // Verbatim fallbacks.
    html_block: {
      node: "rawBlock",
      getAttrs: (tok: GalleyToken) => ({ src: (tok.content ?? "").replace(/\n$/, "") }),
    },
    html_inline: {
      node: "rawInline",
      getAttrs: (tok: GalleyToken) => ({ src: tok.content ?? "" }),
    },
    footnote_ref: {
      node: "rawInline",
      getAttrs: (tok: GalleyToken) => ({ src: `[^${(tok.meta as { label?: string })?.label}]` }),
    },
    gp_chapter_opener: {
      node: "chapterOpener",
      getAttrs: (tok: GalleyToken) => ({ label: (tok.meta as { label?: string })?.label ?? "" }),
    },
    gp_opaque_block: {
      node: "rawBlock",
      getAttrs: (tok: GalleyToken) => ({
        src: tok.content ?? "",
        srcLine: tok.map ? tok.map[0] + 1 : null,
      }),
    },
  };
}

// ── doc build ───────────────────────────────────────────────────────────────

export interface GalleyDocBuild {
  doc: PMNode;
  /** node identity → verbatim source slice, for byte-preservation. */
  srcMap: WeakMap<PMNode, string>;
  stats: EscalateStats & { preservable: number };
}

/**
 * Build the editor document from the server's token stream. `source` is the
 * exact markdown the tokens were parsed from (slices and marker lines are
 * recovered from it).
 */
export function buildGalleyDoc(
  schema: Schema,
  rawTokens: GalleyToken[],
  source: string,
  sharedSrcMap?: WeakMap<PMNode, string>,
): GalleyDocBuild {
  const lines = source.split("\n");
  const specs = buildTokenSpecs(lines);
  const keys = handlerKeys(specs);
  const stats: EscalateStats = { blocks: 0, opaque: 0 };
  const { tokens, spans } = escalate(preprocess(rawTokens), lines, keys, stats);

  const parser = new MarkdownParser(
    schema as never,
    // The stream is pre-tokenized — there is deliberately no markdown-it here.
    { parse: () => tokens } as never,
    specs as never,
  );
  const doc = parser.parse(source) as unknown as PMNode;

  const srcMap = sharedSrcMap ?? new WeakMap<PMNode, string>();
  let preservable = 0;
  const attach = (parent: PMNode, spanChildren: SpanNode[]) => {
    if (parent.childCount !== spanChildren.length) return; // safe bail → canonical
    parent.forEach((child, _offset, idx) => {
      const s = spanChildren[idx]!;
      // markerWrap nodes are never preserved whole: their span cannot see
      // the unmapped `@end-section` terminator, so whole-wrap preservation
      // would drop it. The wrap serializes structurally (marker line +
      // preserved children + regenerated terminator).
      if (s.span && child.type.name !== "markerWrap") {
        srcMap.set(child, lines.slice(s.span[0], s.span[1]).join("\n"));
        preservable++;
      }
      if (s.children && child.type.name === "markerWrap") {
        // The chapter opener is generated (no span) but IS a child node;
        // spans for marker children include it via the recursion, so counts
        // line up as long as the tree matched.
        attach(child, s.children);
      }
    });
  };
  attach(doc, spans);

  return { doc, srcMap, stats: { ...stats, preservable } };
}

// ── serialization ───────────────────────────────────────────────────────────

/**
 * Reverse of markdown-it's `typographer: true` substitutions, so characters
 * the pipeline produced serialize back as an author would type them. A
 * literally-authored “smart” character normalizes to its ASCII spelling —
 * display-identical after the next render. (Table mirrors
 * desktop's deleted selection-search.ts.)
 */
const TYPOGRAPHER_REVERSE: ReadonlyArray<readonly [string, string]> = [
  ["©", "(c)"],
  ["™", "(tm)"],
  ["®", "(r)"],
  ["±", "+-"],
  ["…", "..."],
  ["—", "---"],
  ["–", "--"],
  ["“", '"'],
  ["”", '"'],
  ["‘", "'"],
  ["’", "'"],
];

export function reverseTypography(text: string): string {
  let out = text;
  for (const [smart, ascii] of TYPOGRAPHER_REVERSE) out = out.split(smart).join(ascii);
  return out;
}

type SerializerFn = (state: never, node: PMNode, parent: PMNode, index: number) => void;

const d = defaultMarkdownSerializer.nodes;

/**
 * Append the authored brace suffix to what the wrapped fn just wrote — LEAF
 * blocks only (paragraph, heading, code fence: end of the last content
 * line; images: no separating space). Container blocks never reach here:
 * markdown-it-attrs' positional binding rules for them cannot be
 * regenerated faithfully, so containers carrying authored braces are
 * refused at escalation (ATTR_REFUSED_CONTAINERS) and round-trip verbatim.
 */
function withBraceSuffix(fn: SerializerFn, placement: "line" | "inline" = "line"): SerializerFn {
  return (state, node, parent, index) => {
    const s = state as unknown as { out: string };
    const at = s.out.length;
    fn(state, node, parent, index);
    const raw = (node.attrs as { gpAttrs?: string }).gpAttrs;
    if (!raw) return;
    const written = s.out.slice(at);
    const body = written.replace(/\n*$/, "");
    if (body === "") {
      // Attrs-only block (an empty paragraph carrying `{…}`): splicing the
      // brace at `at` would glue it onto the PREVIOUS block's last line
      // (closeBlock defers separators until the next write). Write it as
      // the block's own content instead — flushing the pending separator.
      const st = state as unknown as { write(t: string): void; closeBlock(n: PMNode): void };
      st.write(raw);
      st.closeBlock(node);
      return;
    }
    const sep = placement === "inline" ? "" : " ";
    s.out = s.out.slice(0, at) + body + sep + raw + written.slice(body.length);
  };
}

const verbatimBlock: SerializerFn = (state, node) => {
  const st = state as unknown as {
    text(t: string, esc: boolean): void;
    closeBlock(n: PMNode): void;
  };
  st.text((node.attrs as { src: string }).src, false);
  st.closeBlock(node);
};

/** Serialize one block's inline projection for a pipe-table cell. */
function cellText(plain: MarkdownSerializer, schema: Schema, cellNode: PMNode): string {
  const parts: string[] = [];
  cellNode.forEach((block) => {
    const doc = schema.topNodeType.create(null, [block]);
    parts.push(plain.serialize(doc as never, { tightLists: true }).trim().replace(/\n+/g, " "));
  });
  return parts.join("<br>").replace(/\|/g, "\\|");
}

function buildSerializer(
  schema: Schema,
  srcMap: WeakMap<PMNode, string> | null,
): MarkdownSerializer {
  // A preservation-free serializer for nested contexts (table cells).
  const plain: MarkdownSerializer = srcMap
    ? buildSerializer(schema, null)
    : (undefined as unknown as MarkdownSerializer);

  const nodes: Record<string, SerializerFn> = {
    paragraph: withBraceSuffix(d.paragraph as SerializerFn),
    heading: withBraceSuffix(d.heading as SerializerFn),
    blockquote: d.blockquote as SerializerFn,
    horizontalRule: (state, node) => {
      const st = state as unknown as { write(t: string): void; closeBlock(n: PMNode): void };
      st.write("---");
      st.closeBlock(node);
    },
    hardBreak: d.hard_break as SerializerFn,
    bulletList: ((state, node) => {
      (state as unknown as {
        renderList(n: PMNode, delim: string, first: (i: number) => string): void;
      }).renderList(node, "  ", () => "- ");
    }) as SerializerFn,
    orderedList: ((state, node) => {
      const start = ((node.attrs as { start?: number }).start ?? 1) as number;
      const maxW = String(start + node.childCount - 1).length;
      const st = state as unknown as {
        renderList(n: PMNode, delim: string, first: (i: number) => string): void;
        repeat(s: string, n: number): string;
      };
      st.renderList(node, st.repeat(" ", maxW + 2), (i: number) => {
        const nStr = String(start + i);
        return st.repeat(" ", maxW - nStr.length) + nStr + ". ";
      });
    }) as SerializerFn,
    listItem: d.list_item as SerializerFn,
    codeBlock: (state, node) => {
      const st = state as unknown as {
        write(t: string): void;
        text(t: string, esc: boolean): void;
        closeBlock(n: PMNode): void;
      };
      const { language, gpAttrs } = node.attrs as { language?: string | null; gpAttrs?: string };
      const backticks = node.textContent.match(/`{3,}/g);
      const fence = backticks ? backticks.sort().slice(-1)[0] + "`" : "```";
      st.write(fence + (language ?? "") + (gpAttrs ? ` ${gpAttrs}` : "") + "\n");
      st.text(node.textContent, false);
      st.write("\n");
      st.write(fence);
      st.closeBlock(node);
    },
    image: withBraceSuffix(((state, node) => {
      const st = state as unknown as { write(t: string): void; esc(t: string): string };
      const { src, alt, title } = node.attrs as { src: string; alt: string; title: string | null };
      st.write(
        `![${st.esc(alt || "")}](${src.replace(/[()]/g, "\\$&")}${
          title ? ` "${title.replace(/"/g, '\\"')}"` : ""
        })`,
      );
    }) as SerializerFn, "inline"),
    text: (state, node) => {
      const st = state as unknown as { text(t: string, esc?: boolean): void; inAutolink?: boolean };
      st.text(reverseTypography(node.text ?? ""), !st.inAutolink);
    },
    markerWrap: (state, node, parent, index) => {
      const st = state as unknown as {
        write(t: string): void;
        closeBlock(n: PMNode): void;
        renderContent(n: PMNode): void;
      };
      st.write((node.attrs as { src: string }).src);
      st.closeBlock(node);
      st.renderContent(node);
      // Only @end-section exists in the marker grammar; chapter/page/spread
      // auto-close at the next marker or EOF. A section followed by its
      // OWN continuation must NOT be terminated: `@continue` re-opens the
      // current section, so an injected `@end-section` before it would make
      // the continuation parse as continue_without_section and be dropped —
      // a zero-loss violation (verified finding; test pins it).
      if ((node.attrs as { kind: string }).kind === "section") {
        const next = parent && index + 1 < parent.childCount ? parent.child(index + 1) : null;
        const nextIsContinuation =
          next?.type.name === "markerWrap" &&
          /^\s*@continue\b/.test((next.attrs as { src: string }).src);
        if (!nextIsContinuation) {
          st.write("@end-section");
          st.closeBlock(node);
        }
      }
    },
    markerAtom: (state, node) => {
      const st = state as unknown as { write(t: string): void; closeBlock(n: PMNode): void };
      st.write((node.attrs as { src: string }).src);
      st.closeBlock(node);
    },
    chapterOpener: () => {
      /* generated content — never serializes */
    },
    rawBlock: verbatimBlock,
    rawInline: (state, node) => {
      (state as unknown as { text(t: string, esc: boolean): void }).text(
        (node.attrs as { src: string }).src,
        false,
      );
    },
    // Serialized per chapter by the editor; transparent if it appears inline.
    chapterFile: (state, node) => {
      (state as unknown as { renderContent(n: PMNode): void }).renderContent(node);
    },
    defList: (state, node) => {
      (state as unknown as { renderContent(n: PMNode): void }).renderContent(node);
    },
    defTerm: (state, node) => {
      const st = state as unknown as {
        renderInline(n: PMNode): void;
        closeBlock(n: PMNode): void;
      };
      st.renderInline(node);
      st.closeBlock(node);
    },
    defDesc: (state, node) => {
      const st = state as unknown as {
        wrapBlock(delim: string, first: string | null, n: PMNode, f: () => void): void;
        renderContent(n: PMNode): void;
      };
      st.wrapBlock("    ", ":   ", node, () => st.renderContent(node));
    },
    table: ((state, node) => {
      const st = state as unknown as { write(t: string): void; closeBlock(n: PMNode): void };
      const rows: Array<{ header: boolean; cells: Array<{ align: string | null; text: string }> }> =
        [];
      node.forEach((row) => {
        const cells: Array<{ align: string | null; text: string }> = [];
        row.forEach((c) => {
          cells.push({
            align: (c.attrs as { gpAlign: string | null }).gpAlign,
            text: cellText(srcMap ? plain : (buildSerializer(schema, null) as never), schema, c),
          });
        });
        rows.push({ header: row.firstChild?.type.name === "tableHeader", cells });
      });
      const lines: string[] = [];
      rows.forEach((row, ri) => {
        lines.push(`| ${row.cells.map((c) => c.text || " ").join(" | ")} |`);
        if (ri === 0 && row.header) {
          lines.push(
            `| ${row.cells
              .map((c) =>
                c.align === "center" ? ":---:" : c.align === "right" ? "---:" : c.align === "left" ? ":---" : "---",
              )
              .join(" | ")} |`,
          );
        }
      });
      st.write(lines.join("\n"));
      st.closeBlock(node);
    }) as SerializerFn,
    // Rows/cells are consumed by the table serializer above; stubs keep an
    // out-of-place node from throwing.
    tableRow: () => {},
    tableHeader: () => {},
    tableCell: () => {},
  };

  // Byte-preservation interception: an untouched direct child of the doc or
  // of a markerWrap emits its original source slice verbatim.
  if (srcMap) {
    for (const name of Object.keys(nodes)) {
      const original = nodes[name]!;
      nodes[name] = (state, node, parent, index) => {
        const parentName = parent?.type?.name;
        if (
          (parentName === "doc" || parentName === "markerWrap" || parentName === "chapterFile") &&
          srcMap.has(node)
        ) {
          const st = state as unknown as {
            text(t: string, esc: boolean): void;
            closeBlock(n: PMNode): void;
          };
          st.text(srcMap.get(node)!.replace(/\n+$/, ""), false);
          st.closeBlock(node);
          return;
        }
        original(state, node, parent, index);
      };
    }
  }

  return new MarkdownSerializer(nodes as never, {
    ...defaultMarkdownSerializer.marks,
    bold: defaultMarkdownSerializer.marks.strong!,
    italic: defaultMarkdownSerializer.marks.em!,
    strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
    sub: { open: "~", close: "~", mixable: true },
    sup: { open: "^", close: "^", mixable: true },
    highlight: { open: "==", close: "==", mixable: true, expelEnclosingWhitespace: true },
    abbr: { open: "", close: "", mixable: true },
  } as never);
}

/**
 * Serialize the doc back to markdown. Pass the build's `srcMap` to keep
 * untouched blocks byte-identical; omit it for fully canonical output.
 */
/** A footnote definition line: `[^label]: body`. */
const FOOTNOTE_DEF_RE = /^\[\^[^\]]*\]:/;

/** 1-based source line a top-level child came from, when it knows one. */
function sourceLineOf(node: PMNode): number | null {
  const a = node.attrs as { gpLine?: number | null; srcLine?: number | null };
  return a.gpLine ?? a.srcLine ?? null;
}

/**
 * Undo markdown-it-footnote's hoisting.
 *
 * The plugin moves EVERY footnote definition into a trailing footnote block,
 * so the token stream — and therefore the document — ends with definitions
 * that the author wrote mid-file. Document order is render order (the print
 * pipeline puts the notes section at the end too, so the editor matches the
 * PDF), but it is NOT source order, and serializing document order would
 * rewrite the author's file with every definition moved to the bottom.
 *
 * This puts each definition back in front of the first later-sourced sibling.
 * Only footnote definitions move, and only ones that know their source line;
 * siblings without a line are skipped in the comparison, so newly typed
 * content never shifts.
 */
function unhoistFootnoteDefs(schema: Schema, node: PMNode): PMNode {
  if (!node.isBlock && !node.type.name.startsWith("doc")) return node;
  const kids: PMNode[] = [];
  node.forEach((child) => {
    kids.push(
      child.type.name === "chapterFile" || child.type.name === "doc"
        ? unhoistFootnoteDefs(schema, child)
        : child,
    );
  });
  const isDef = (n: PMNode) =>
    n.type.name === "rawBlock" &&
    FOOTNOTE_DEF_RE.test(String((n.attrs as { src?: string }).src ?? "")) &&
    sourceLineOf(n) !== null;
  if (!kids.some(isDef)) {
    return kids.length === node.childCount && kids.every((k, i) => k === node.child(i))
      ? node
      : node.copy(Fragment.fromArray(kids));
  }
  const defs = kids.filter(isDef);
  const rest = kids.filter((k) => !isDef(k));
  for (const def of defs) {
    const line = sourceLineOf(def)!;
    let at = rest.length;
    for (let i = 0; i < rest.length; i++) {
      const sibling = sourceLineOf(rest[i]!);
      if (sibling !== null && sibling > line) {
        at = i;
        break;
      }
    }
    rest.splice(at, 0, def);
  }
  return node.copy(Fragment.fromArray(rest));
}

export function serializeGalleyDoc(
  schema: Schema,
  doc: PMNode,
  srcMap?: WeakMap<PMNode, string>,
): string {
  const serializer = buildSerializer(schema, srcMap ?? null);
  const out = serializer.serialize(unhoistFootnoteDefs(schema, doc) as never, {
    tightLists: true,
  });
  return out.endsWith("\n") ? out : `${out}\n`;
}
