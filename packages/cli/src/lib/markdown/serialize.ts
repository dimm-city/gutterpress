/**
 * serialize.ts — pure (node-free) block-scoped HTML→markdown serializer.
 *
 * The inline-editing previewer (ADR 0010) edits the RENDERED book DOM
 * directly; saving syncs the markdown source files to match the screen. This
 * module is the codec for that sync: it extracts a structural model from one
 * edited block element and emits markdown that re-renders to the same model.
 *
 * Design rules (ADR 0010, plan `review-the-example-html-tender-starfish`):
 *
 *  - CLOSED SET. The extractor recognizes exactly the DOM the core renderer
 *    emits (renderer.ts pipeline; probe fixtures in serialize.test.ts).
 *    Anything else — unknown tags, renderer-owned attrs in unexpected shape,
 *    raw-HTML islands, plugin-minted structure — throws
 *    {@link UnextractableBlock}. A throw means "this block refuses inline
 *    editing" (degrade to the source overlay), never a guessed edit.
 *  - SOUND, NOT BYTE-FAITHFUL. Edited blocks are rewritten in canonical
 *    markdown (product decision 2026-08-15: normalization of edited blocks
 *    is accepted; untouched blocks are never written at all). The soundness
 *    contract — enforced by scripts/roundtrip-gate.ts over the example
 *    corpus and by the preview's converge-on-drift verifier at runtime — is
 *    MODEL equality: extract(render(serialize(m))) must equal m.
 *  - TYPOGRAPHER OUTPUT IS EMITTED VERBATIM. The DOM already contains the
 *    typographer's Unicode output (“ ” ’ – — © …), and Unicode passes
 *    through markdown-it untransformed, so verbatim emission is always
 *    sound. ASCII the user types ('"', '--', '(c)') re-renders to the smart
 *    form; the converge-on-drift pass then upgrades the screen — smart
 *    punctuation applies to inline edits exactly like it does to source
 *    edits.
 *  - PWA-CLEAN. Zero value imports; ships through `gutterpress/render`
 *    (check-render-pure.mjs). DOM access goes through the minimal
 *    {@link ElementLike} interface so real DOM (the preview frame), fixtures
 *    (bun tests), and DOMParser documents (the drift verifier) all work.
 */

// ────────────────────────────────────────────────────────────────────────────
// DOM-shaped structural interface
// ────────────────────────────────────────────────────────────────────────────

/** Minimal structural view of a DOM Text/Comment node. */
export interface TextLike {
  /** Node.TEXT_NODE (3) for text, Node.COMMENT_NODE (8) for comments. */
  readonly nodeType: number;
  /** Text content (DOM `Text.data`). */
  readonly data: string;
}

/** Minimal structural view of a DOM Element — satisfied by real Elements. */
export interface ElementLike {
  /** Node.ELEMENT_NODE (1). */
  readonly nodeType: number;
  /** Upper- OR lower-case tag name; compared case-insensitively. */
  readonly tagName: string;
  getAttribute(name: string): string | null;
  getAttributeNames(): string[];
  readonly childNodes: ArrayLike<ElementLike | TextLike>;
}

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;
const COMMENT_NODE = 8;

function isElement(n: ElementLike | TextLike): n is ElementLike {
  return n.nodeType === ELEMENT_NODE;
}

// ────────────────────────────────────────────────────────────────────────────
// Model
// ────────────────────────────────────────────────────────────────────────────

/** Author attributes surviving render-artifact stripping, in DOM order. */
export type AttrList = Array<[name: string, value: string]>;

export type InlineNode =
  | { t: "text"; text: string }
  | { t: "hardbreak" }
  | { t: "code"; text: string; attrs: AttrList }
  | {
      t: "em" | "strong" | "s" | "sup" | "sub" | "mark";
      children: InlineNode[];
      attrs: AttrList;
    }
  | {
      t: "link";
      href: string;
      title: string | null;
      children: InlineNode[];
      attrs: AttrList;
      /** True for linkify/autolink links (no data-gp-source-token; href derivable from the text). */
      bare: boolean;
    }
  | {
      t: "image";
      src: string;
      alt: string;
      title: string | null;
      attrs: AttrList;
    }
  | { t: "abbr"; title: string; text: string }
  /** Rendered `[^n]` marker; the author label is harvested from source at emit time. */
  | { t: "footnoteRef" };

/**
 * One list item. Shapes (matching what markdown-it emits):
 *  - tight simple:  `lead` only (inline content).
 *  - tight nested:  `lead` + `blocks` (text line followed by a nested
 *    list/fence — no <p> wrapper).
 *  - loose:         `blocks` only (children are <p>-led block elements).
 */
export interface ListItemNode {
  lead: InlineNode[] | null;
  blocks: BlockNode[] | null;
}

export type TableAlign = "left" | "center" | "right" | null;

export type BlockNode =
  | { t: "p"; inline: InlineNode[]; attrs: AttrList }
  | { t: "h"; level: 1 | 2 | 3 | 4 | 5 | 6; inline: InlineNode[]; attrs: AttrList }
  | { t: "blockquote"; blocks: BlockNode[] }
  | {
      t: "list";
      ordered: boolean;
      start: number | null;
      loose: boolean;
      items: ListItemNode[];
    }
  | {
      t: "table";
      align: TableAlign[];
      head: InlineNode[][];
      body: InlineNode[][][];
    }
  | { t: "fence"; language: string; code: string; attrs: AttrList }
  | { t: "hr" }
  | { t: "dl"; groups: Array<{ dt: InlineNode[]; dds: InlineNode[][] }> };

/** Optional markdown features (bundled opt-in plugins). Tags for disabled
 *  features are treated as raw HTML → {@link UnextractableBlock}. */
export interface SerializeFeatures {
  sup?: boolean;
  sub?: boolean;
  mark?: boolean;
  abbr?: boolean;
}

export interface SerializeOptions {
  features?: SerializeFeatures;
}

/** Thrown when a block is outside the closed set this codec understands.
 *  Callers treat it as "refuse inline editing for this block". */
export class UnextractableBlock extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "UnextractableBlock";
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Render-artifact stripping
// ────────────────────────────────────────────────────────────────────────────

/** Attributes the render pipeline (or the editor chrome) adds; never
 *  authored, never serialized. */
const ARTIFACT_ATTRS = new Set([
  "data-source-range",
  "data-source-line",
  "data-chapter-src",
  "data-chapter-label",
  "data-gp-source-token",
  "data-gp-source-occurrence",
  "data-gp-edit-degraded",
  "contenteditable",
  "spellcheck",
]);

/** Editor-chrome classes; stripped from class lists before modeling. */
const ARTIFACT_CLASS_RE = /^(?:gutterpress-(?:hl|edit-mask)|gp-(?:overflowing|editing))$/;

function authorAttrs(el: ElementLike, opts?: { dropStyleDecl?: RegExp }): AttrList {
  const out: AttrList = [];
  for (const name of el.getAttributeNames()) {
    const lower = name.toLowerCase();
    if (ARTIFACT_ATTRS.has(lower)) continue;
    let value = el.getAttribute(name);
    if (value == null) continue;
    if (lower === "class") {
      const classes = value.split(/\s+/).filter((c) => c && !ARTIFACT_CLASS_RE.test(c));
      if (!classes.length) continue;
      value = classes.join(" ");
    }
    if (lower === "style" && opts?.dropStyleDecl) {
      const decls = value
        .split(";")
        .map((d) => d.trim())
        .filter((d) => d && !opts.dropStyleDecl!.test(d));
      if (!decls.length) continue;
      value = decls.join("; ");
    }
    out.push([name, value]);
  }
  return out;
}

function takeAttr(attrs: AttrList, name: string): string | null {
  const idx = attrs.findIndex(([n]) => n.toLowerCase() === name);
  if (idx === -1) return null;
  const [, value] = attrs[idx]!;
  attrs.splice(idx, 1);
  return value;
}

// ────────────────────────────────────────────────────────────────────────────
// Extraction: ElementLike → model
// ────────────────────────────────────────────────────────────────────────────

const INLINE_WRAP_TAGS: Record<string, "em" | "strong" | "s" | "sup" | "sub" | "mark"> = {
  em: "em",
  i: "em",
  strong: "strong",
  b: "strong",
  s: "s",
  del: "s",
  strike: "s", // execCommand("strikeThrough") output normalizes to ~~s~~
  sup: "sup",
  sub: "sub",
  mark: "mark",
};

/** Prose text normalization: NBSP (contenteditable's double-space artifact)
 *  and newlines become plain spaces, runs collapse. Sound because extraction
 *  applies it identically to both sides of every model comparison, and HTML
 *  already renders these runs as a single space. */
function normalizeProseText(raw: string): string {
  return raw.replace(/[\u00a0\s]+/g, " ");
}

function tagOf(el: ElementLike): string {
  return el.tagName.toLowerCase();
}

function classListOf(el: ElementLike): string[] {
  return (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean);
}

function textContentOf(el: ElementLike): string {
  let out = "";
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isElement(child)) out += textContentOf(child);
    else if (child.nodeType === TEXT_NODE) out += child.data;
  }
  return out;
}

function inlineText(nodes: InlineNode[]): string {
  let out = "";
  for (const n of nodes) {
    switch (n.t) {
      case "text":
      case "code":
      case "abbr":
        out += n.t === "text" ? n.text : n.text;
        break;
      case "em":
      case "strong":
      case "s":
      case "sup":
      case "sub":
      case "mark":
      case "link":
        out += inlineText(n.children);
        break;
      case "image":
        out += n.alt;
        break;
      default:
        break;
    }
  }
  return out;
}

function extractInlineChildren(
  el: ElementLike,
  features: SerializeFeatures,
): InlineNode[] {
  const out: InlineNode[] = [];
  const push = (node: InlineNode) => {
    const prev = out[out.length - 1];
    if (node.t === "text" && prev?.t === "text") {
      prev.text += node.text;
      return;
    }
    out.push(node);
  };

  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (!isElement(child)) {
      if (child.nodeType === COMMENT_NODE) continue;
      if (child.nodeType !== TEXT_NODE) {
        throw new UnextractableBlock(`unsupported node type ${child.nodeType}`);
      }
      const text = normalizeProseText(child.data);
      if (text) push({ t: "text", text });
      continue;
    }

    const tag = tagOf(child);

    if (tag === "br") {
      push({ t: "hardbreak" });
      continue;
    }

    if (tag === "code") {
      push({ t: "code", text: textContentOf(child), attrs: authorAttrs(child) });
      continue;
    }

    if (tag === "sup" && classListOf(child).includes("footnote-ref")) {
      // markdown-it-footnote's `[^n]` marker (core, independent of the sup
      // plugin). Internals (`<a href="#fnN" id="fnrefN">`) are positional
      // render output; the author label is harvested from source at emit.
      push({ t: "footnoteRef" });
      continue;
    }

    const wrap = INLINE_WRAP_TAGS[tag];
    if (wrap) {
      if (
        (wrap === "sup" && !features.sup) ||
        (wrap === "sub" && !features.sub) ||
        (wrap === "mark" && !features.mark)
      ) {
        throw new UnextractableBlock(`<${tag}> without the matching plugin enabled`);
      }
      push({
        t: wrap,
        children: extractInlineChildren(child, features),
        attrs: authorAttrs(child),
      });
      continue;
    }

    if (tag === "abbr") {
      if (!features.abbr) {
        throw new UnextractableBlock("<abbr> without the abbr plugin enabled");
      }
      // Emitted as plain text; the `*[term]: title` definition elsewhere in
      // the file re-wraps every occurrence on render.
      push({
        t: "abbr",
        title: child.getAttribute("title") ?? "",
        text: textContentOf(child),
      });
      continue;
    }

    if (tag === "a") {
      const cls = classListOf(child);
      if (cls.includes("footnote-backref")) continue; // render artifact
      const attrs = authorAttrs(child);
      const href = takeAttr(attrs, "href");
      const title = takeAttr(attrs, "title");
      if (href == null) throw new UnextractableBlock("<a> without href");
      const hadSourceToken = child.getAttribute("data-gp-source-token") != null;
      const linkChildren = extractInlineChildren(child, features);
      const text = inlineText(linkChildren);
      const bare =
        !hadSourceToken &&
        title == null &&
        attrs.length === 0 &&
        (href === text || href === `mailto:${text}` || href === `http://${text}`);
      push({ t: "link", href, title, children: linkChildren, attrs, bare });
      continue;
    }

    if (tag === "img") {
      const attrs = authorAttrs(child, {
        // images.ts mirrors src into --gp-shape at render time; never authored.
        dropStyleDecl: /^--gp-shape\s*:/,
      });
      const src = takeAttr(attrs, "src");
      const alt = takeAttr(attrs, "alt") ?? "";
      const title = takeAttr(attrs, "title");
      if (src == null) throw new UnextractableBlock("<img> without src");
      push({ t: "image", src, alt, title, attrs });
      continue;
    }

    if (tag === "span") {
      // Attribute-free spans appear from contenteditable churn; unwrap.
      if (child.getAttributeNames().length === 0) {
        for (const inner of extractInlineChildren(child, features)) push(inner);
        continue;
      }
      throw new UnextractableBlock("<span> with attributes");
    }

    throw new UnextractableBlock(`unsupported inline element <${tag}>`);
  }

  return out;
}

function trimInline(nodes: InlineNode[]): InlineNode[] {
  const first = nodes[0];
  if (first?.t === "text") {
    first.text = first.text.replace(/^ +/, "");
    if (!first.text) nodes.shift();
  }
  const last = nodes[nodes.length - 1];
  if (last?.t === "text") {
    last.text = last.text.replace(/ +$/, "");
    if (!last.text) nodes.pop();
  }
  return nodes;
}

/** Element children only, tolerating whitespace-only text between blocks. */
function blockChildren(el: ElementLike): ElementLike[] {
  const out: ElementLike[] = [];
  const children = el.childNodes;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isElement(child)) {
      out.push(child);
      continue;
    }
    if (child.nodeType === COMMENT_NODE) continue;
    if (child.nodeType === TEXT_NODE && child.data.trim() === "") continue;
    throw new UnextractableBlock("unexpected text between block elements");
  }
  return out;
}

const HEADING_RE = /^h([1-6])$/;

const BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol",
  "table", "pre", "hr", "dl",
]);

/**
 * Extract the structural model of one block element.
 *
 * @throws {UnextractableBlock} for anything outside the closed set.
 */
export function extractBlockModel(
  el: ElementLike,
  options: SerializeOptions = {},
): BlockNode {
  const features = options.features ?? {};
  const tag = tagOf(el);

  if (tag === "p") {
    return {
      t: "p",
      inline: trimInline(extractInlineChildren(el, features)),
      attrs: authorAttrs(el),
    };
  }

  const h = HEADING_RE.exec(tag);
  if (h) {
    return {
      t: "h",
      level: Number(h[1]) as 1 | 2 | 3 | 4 | 5 | 6,
      inline: trimInline(extractInlineChildren(el, features)),
      attrs: authorAttrs(el),
    };
  }

  if (tag === "blockquote") {
    if (authorAttrs(el).length) throw new UnextractableBlock("author attrs on <blockquote>");
    return {
      t: "blockquote",
      blocks: blockChildren(el).map((c) => extractBlockModel(c, options)),
    };
  }

  if (tag === "ul" || tag === "ol") {
    const attrs = authorAttrs(el);
    const startRaw = tag === "ol" ? takeAttr(attrs, "start") : null;
    if (attrs.length) throw new UnextractableBlock("author attrs on list");
    const items: ListItemNode[] = [];
    let loose = false;
    for (const li of blockChildren(el)) {
      if (tagOf(li) !== "li") throw new UnextractableBlock(`<${tagOf(li)}> inside <${tag}>`);
      if (authorAttrs(li).length) throw new UnextractableBlock("author attrs on <li>");
      const item = extractListItem(li, options);
      if (item.lead === null) loose = true;
      items.push(item);
    }
    return {
      t: "list",
      ordered: tag === "ol",
      start: startRaw != null ? Number(startRaw) : null,
      loose,
      items,
    };
  }

  if (tag === "table") return extractTable(el, options);

  if (tag === "pre") {
    if (authorAttrs(el).length) throw new UnextractableBlock("author attrs on <pre>");
    const kids = blockChildren(el);
    if (kids.length !== 1 || tagOf(kids[0]!) !== "code") {
      throw new UnextractableBlock("<pre> without a single <code> child");
    }
    const code = kids[0]!;
    const attrs = authorAttrs(code);
    const cls = takeAttr(attrs, "class");
    let language = "";
    const extraClasses: string[] = [];
    for (const c of (cls ?? "").split(/\s+/).filter(Boolean)) {
      if (c.startsWith("language-") && !language) language = c.slice("language-".length);
      else extraClasses.push(c);
    }
    if (extraClasses.length) attrs.unshift(["class", extraClasses.join(" ")]);
    // markdown-it appends a trailing newline to fence content.
    let codeText = textContentOf(code);
    if (codeText.endsWith("\n")) codeText = codeText.slice(0, -1);
    return { t: "fence", language, code: codeText, attrs };
  }

  if (tag === "hr") {
    if (authorAttrs(el).length) throw new UnextractableBlock("author attrs on <hr>");
    return { t: "hr" };
  }

  if (tag === "dl") return extractDeflist(el, options);

  throw new UnextractableBlock(`unsupported block element <${tag}>`);
}

function extractListItem(li: ElementLike, options: SerializeOptions): ListItemNode {
  const features = options.features ?? {};
  const children = li.childNodes;

  // Split children at the first block-level element.
  let firstBlockIdx = -1;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    if (isElement(child) && BLOCK_TAGS.has(tagOf(child))) {
      firstBlockIdx = i;
      break;
    }
  }

  if (firstBlockIdx === -1) {
    // Tight simple item: all-inline content.
    const holder: ElementLike = li;
    return { lead: trimInline(extractInlineChildren(holder, features)), blocks: null };
  }

  // Collect the inline lead (may be empty), then block children only.
  const leadNodes: InlineNode[] = [];
  const blocks: BlockNode[] = [];
  let sawBlock = false;
  for (let i = 0; i < children.length; i++) {
    const child = children[i]!;
    const isBlockEl = isElement(child) && BLOCK_TAGS.has(tagOf(child));
    if (!sawBlock && !isBlockEl) {
      if (!isElement(child)) {
        if (child.nodeType === COMMENT_NODE) continue;
        const text = normalizeProseText(child.data);
        if (text.trim()) leadNodes.push({ t: "text", text });
        continue;
      }
      // Inline element before the first block: extract via a synthetic pass.
      const wrapper: ElementLike = {
        nodeType: ELEMENT_NODE,
        tagName: "li",
        getAttribute: () => null,
        getAttributeNames: () => [],
        childNodes: [child],
      };
      leadNodes.push(...extractInlineChildren(wrapper, features));
      continue;
    }
    if (!isBlockEl) {
      if (!isElement(child)) {
        if (child.nodeType === COMMENT_NODE) continue;
        if (child.nodeType === TEXT_NODE && child.data.trim() === "") continue;
      }
      throw new UnextractableBlock("inline content between blocks in list item");
    }
    sawBlock = true;
    blocks.push(extractBlockModel(child as ElementLike, options));
  }

  const lead = trimInline(leadNodes);
  if (lead.length === 0) {
    // Loose item (children are <p>-led blocks) — or an empty-lead nested list.
    return { lead: null, blocks };
  }
  if (blocks.some((b) => b.t === "p")) {
    throw new UnextractableBlock("mixed inline lead and <p> in list item");
  }
  return { lead, blocks };
}

const ALIGN_RE = /^text-align:\s*(left|center|right)$/;

function extractTable(el: ElementLike, options: SerializeOptions): BlockNode {
  const features = options.features ?? {};
  if (authorAttrs(el).length) throw new UnextractableBlock("author attrs on <table>");
  let head: InlineNode[][] | null = null;
  const body: InlineNode[][][] = [];
  const align: TableAlign[] = [];

  const readRow = (tr: ElementLike, cellTag: "th" | "td", firstRow: boolean): InlineNode[][] => {
    if (authorAttrs(tr).length) throw new UnextractableBlock("author attrs on <tr>");
    const cells: InlineNode[][] = [];
    let col = 0;
    for (const cell of blockChildren(tr)) {
      if (tagOf(cell) !== cellTag) {
        throw new UnextractableBlock(`<${tagOf(cell)}> where <${cellTag}> expected`);
      }
      const cellAttrs = authorAttrs(cell);
      const style = takeAttr(cellAttrs, "style");
      if (cellAttrs.length) throw new UnextractableBlock("author attrs on table cell");
      let cellAlign: TableAlign = null;
      if (style != null) {
        const m = ALIGN_RE.exec(style.trim());
        if (!m) throw new UnextractableBlock("unexpected style on table cell");
        cellAlign = m[1] as TableAlign;
      }
      if (firstRow) align.push(cellAlign);
      else if (align[col] !== cellAlign) {
        throw new UnextractableBlock("inconsistent column alignment");
      }
      cells.push(trimInline(extractInlineChildren(cell, features)));
      col++;
    }
    if (!firstRow && cells.length !== align.length) {
      throw new UnextractableBlock("ragged table row");
    }
    return cells;
  };

  for (const part of blockChildren(el)) {
    const partTag = tagOf(part);
    if (partTag === "thead") {
      if (authorAttrs(part).length) throw new UnextractableBlock("attrs on <thead>");
      const rows = blockChildren(part);
      if (rows.length !== 1 || tagOf(rows[0]!) !== "tr") {
        throw new UnextractableBlock("thead without exactly one <tr>");
      }
      head = readRow(rows[0]!, "th", true);
    } else if (partTag === "tbody") {
      if (authorAttrs(part).length) throw new UnextractableBlock("attrs on <tbody>");
      for (const tr of blockChildren(part)) {
        if (tagOf(tr) !== "tr") throw new UnextractableBlock("non-<tr> in tbody");
        body.push(readRow(tr, "td", false));
      }
    } else {
      throw new UnextractableBlock(`unsupported table part <${partTag}>`);
    }
  }
  if (!head) throw new UnextractableBlock("table without thead");
  return { t: "table", align, head, body };
}

function extractDeflist(el: ElementLike, options: SerializeOptions): BlockNode {
  const features = options.features ?? {};
  if (authorAttrs(el).length) throw new UnextractableBlock("author attrs on <dl>");
  const groups: Array<{ dt: InlineNode[]; dds: InlineNode[][] }> = [];
  let current: { dt: InlineNode[]; dds: InlineNode[][] } | null = null;
  for (const child of blockChildren(el)) {
    const tag = tagOf(child);
    if (tag === "dt") {
      if (authorAttrs(child).length) throw new UnextractableBlock("attrs on <dt>");
      current = { dt: trimInline(extractInlineChildren(child, features)), dds: [] };
      groups.push(current);
    } else if (tag === "dd") {
      if (!current) throw new UnextractableBlock("<dd> before <dt>");
      if (authorAttrs(child).length) throw new UnextractableBlock("attrs on <dd>");
      // Only tight (all-inline) definitions are in the closed set; loose or
      // multi-block <dd> content refuses (uncertain continuation indent).
      const kids = child.childNodes;
      for (let i = 0; i < kids.length; i++) {
        const k = kids[i]!;
        if (isElement(k) && BLOCK_TAGS.has(tagOf(k))) {
          throw new UnextractableBlock("block content in <dd>");
        }
      }
      current.dds.push(trimInline(extractInlineChildren(child, features)));
    } else {
      throw new UnextractableBlock(`<${tag}> inside <dl>`);
    }
  }
  return { t: "dl", groups };
}

// ────────────────────────────────────────────────────────────────────────────
// Content-block discovery
// ────────────────────────────────────────────────────────────────────────────

const CONTENT_BLOCK_TAGS = new Set([
  "p", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "ul", "ol",
  "table", "pre", "hr", "dl",
]);

/** The block's `data-source-range` value — fences carry it on the inner
 *  `<code>` (markdown-it applies fence token attrs there, never `<pre>`). */
export function findBlockRangeAttr(el: ElementLike): string | null {
  const own = el.getAttribute("data-source-range");
  if (own != null) return own;
  if (tagOf(el) === "pre") {
    const kids = el.childNodes;
    for (let i = 0; i < kids.length; i++) {
      const k = kids[i]!;
      if (isElement(k) && tagOf(k) === "code") {
        return k.getAttribute("data-source-range");
      }
    }
  }
  return null;
}

/**
 * Collect the OUTERMOST serializable content blocks under `root` — the
 * commit units of inline editing. Descends through everything that is not
 * itself a content block (layout wrappers `.page`/`.section`/…, the footnote
 * section's `ol`/`li` scaffolding, plugin component wrappers) and collects
 * elements that are (a) a known content tag and (b) source-annotated.
 * Nested annotated elements (`li`, `tr`, blockquote paragraphs) are covered
 * by their outermost block and never collected separately.
 *
 * `skip` lets callers exclude subtrees (e.g. viewer decoration in the live
 * preview DOM).
 */
export function discoverContentBlocks(
  root: ElementLike,
  opts?: { skip?: (el: ElementLike) => boolean },
): ElementLike[] {
  const out: ElementLike[] = [];
  const visit = (el: ElementLike): void => {
    const children = el.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (!isElement(child)) continue;
      if (opts?.skip?.(child)) continue;
      if (CONTENT_BLOCK_TAGS.has(tagOf(child)) && findBlockRangeAttr(child) != null) {
        out.push(child);
        continue;
      }
      visit(child);
    }
  };
  visit(root);
  return out;
}

// ────────────────────────────────────────────────────────────────────────────
// Model equality
// ────────────────────────────────────────────────────────────────────────────

/** Deep structural equality of two models (order- and attr-order-sensitive). */
export function modelsEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!modelsEqual(a[i], b[i])) return false;
    return true;
  }
  if (typeof a === "object" && typeof b === "object" && a && b) {
    const ka = Object.keys(a as object);
    const kb = Object.keys(b as object);
    if (ka.length !== kb.length) return false;
    for (const k of ka) {
      if (!modelsEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) {
        return false;
      }
    }
    return true;
  }
  return false;
}

// ────────────────────────────────────────────────────────────────────────────
// Emission: model → canonical markdown
// ────────────────────────────────────────────────────────────────────────────

/**
 * Escape one prose text run so it re-parses as plain text.
 *
 * Escapes markdown structure characters always; line-start constructs only at
 * line starts (canonical paragraphs are single-line, so "line start" means
 * block start or right after a hardbreak); linkify triggers get their
 * recognition broken. Typographer output needs NO protection — the model text
 * already holds the Unicode forms, which pass through unchanged; ASCII the
 * user typed re-renders to the smart form and the screen converges to it.
 */
export function escapeTextRun(text: string, opts: { atLineStart: boolean }): string {
  let out = text
    // `{`/`}` included: a literal brace run after an element or at a block
    // end would re-parse as markdown-it-attrs braces. `~`/`^` included: the
    // opt-in sub/sup plugins make single tildes/carets significant, and the
    // escape is harmless when they're disabled.
    .replace(/[\\*_[\]<`{}~^]/g, (m) => `\\${m}`)
    // Entities: `&name;` / `&#…;` would decode on re-render.
    .replace(/&(?=[a-zA-Z][a-zA-Z0-9]*;|#\d|#[xX])/g, "\\&")
    // `==` pairs are markdown-it-mark delimiters when that plugin is on.
    .replace(/==/g, "\\==")
    // Linkify triggers: break scheme/www/email recognition.
    .replace(/:\/\//g, "\\://")
    .replace(/\bwww\./gi, (m) => `${m.slice(0, 3)}\\.`)
    .replace(/(\S)@(?=\S+\.\S)/g, "$1\\@");
  if (opts.atLineStart) {
    out = out.replace(/^([#>+\-=|]|\d+[.)])/, (lead) =>
      lead.length === 1 ? `\\${lead}` : `${lead.slice(0, -1)}\\${lead.slice(-1)}`,
    );
  }
  return out;
}

function emitAttrBraces(attrs: AttrList): string {
  if (!attrs.length) return "";
  const parts: string[] = [];
  for (const [name, value] of attrs) {
    const lower = name.toLowerCase();
    if (lower === "class") {
      for (const c of value.split(/\s+/).filter(Boolean)) parts.push(`.${c}`);
    } else if (lower === "id") {
      parts.push(`#${value}`);
    } else if (value === "") {
      parts.push(name);
    } else if (/^[^\s"'=<>`{}]+$/.test(value)) {
      parts.push(`${name}=${value}`);
    } else if (!value.includes('"')) {
      parts.push(`${name}="${value}"`);
    } else {
      throw new UnextractableBlock(`attribute ${name} value contains a double quote`);
    }
  }
  return `{${parts.join(" ")}}`;
}

/** Emission context; carries slice-harvested facts. */
interface EmitContext {
  /** Author footnote labels in source order, harvested from the slice. */
  footnoteLabels: string[];
  footnoteCursor: number;
  /** `[^label]: ` prefix when the block being emitted is a footnote definition. */
  footnotePrefix: string;
  /** Fence style harvested from the slice; default ``` */
  fenceChar: string;
  fenceLen: number;
}

function emitInline(nodes: InlineNode[], ctx: EmitContext, atLineStart: boolean): string {
  let out = "";
  let lineStart = atLineStart;
  for (const n of nodes) {
    switch (n.t) {
      case "text":
        out += escapeTextRun(n.text, { atLineStart: lineStart });
        break;
      case "hardbreak":
        out += "\\\n";
        lineStart = true;
        continue;
      case "code": {
        const runs = n.text.match(/`+/g);
        const maxRun = runs ? Math.max(...runs.map((r) => r.length)) : 0;
        const fence = "`".repeat(maxRun + 1);
        const pad = n.text.startsWith("`") || n.text.endsWith("`") || n.text === "" ? " " : "";
        out += `${fence}${pad}${n.text}${pad}${fence}${emitAttrBraces(n.attrs)}`;
        break;
      }
      case "em":
        out += `*${emitInline(n.children, ctx, false)}*${emitAttrBraces(n.attrs)}`;
        break;
      case "strong":
        out += `**${emitInline(n.children, ctx, false)}**${emitAttrBraces(n.attrs)}`;
        break;
      case "s":
        out += `~~${emitInline(n.children, ctx, false)}~~${emitAttrBraces(n.attrs)}`;
        break;
      case "sup":
        out += `^${emitInline(n.children, ctx, false)}^${emitAttrBraces(n.attrs)}`;
        break;
      case "sub":
        out += `~${emitInline(n.children, ctx, false)}~${emitAttrBraces(n.attrs)}`;
        break;
      case "mark":
        out += `==${emitInline(n.children, ctx, false)}==${emitAttrBraces(n.attrs)}`;
        break;
      case "abbr":
        // Plain text; the `*[term]: title` definition re-wraps on render.
        out += escapeTextRun(n.text, { atLineStart: lineStart });
        break;
      case "link": {
        if (n.bare) {
          // Linkified/autolink form: emit the visible text verbatim so
          // linkify re-links it — escaping would break recognition.
          out += inlineText(n.children);
          break;
        }
        const label = emitInline(n.children, ctx, false);
        const dest = emitLinkDest(n.href);
        const title = n.title != null ? ` "${n.title.replace(/"/g, '\\"')}"` : "";
        out += `[${label}](${dest}${title})${emitAttrBraces(n.attrs)}`;
        break;
      }
      case "image": {
        const alt = n.alt.replace(/\\/g, "\\\\").replace(/[[\]]/g, (m) => `\\${m}`);
        const dest = emitLinkDest(n.src);
        const title = n.title != null ? ` "${n.title.replace(/"/g, '\\"')}"` : "";
        out += `![${alt}](${dest}${title})${emitAttrBraces(n.attrs)}`;
        break;
      }
      case "footnoteRef": {
        const label = ctx.footnoteLabels[ctx.footnoteCursor++];
        if (label == null) throw new UnextractableBlock("footnote ref without a source label");
        out += `[^${label}]`;
        break;
      }
    }
    lineStart = false;
  }
  return out;
}

function emitLinkDest(url: string): string {
  if (url === "") return "<>";
  if (/[\s()<>]/.test(url)) {
    return `<${url.replace(/([<>])/g, "\\$1")}>`;
  }
  return url;
}

/** Prefix every line of `text` (blank lines get the trimmed prefix). */
function prefixLines(text: string, first: string, rest: string): string {
  const restTrimmed = rest.replace(/ +$/, "");
  return text
    .split("\n")
    .map((line, i) => {
      if (i === 0) return `${first}${line}`;
      if (!line) return restTrimmed === "" ? "" : restTrimmed;
      return `${rest}${line}`;
    })
    .join("\n");
}

function emitBlock(node: BlockNode, ctx: EmitContext): string {
  switch (node.t) {
    case "p": {
      const braces = emitAttrBraces(node.attrs);
      const prefix = ctx.footnotePrefix;
      ctx.footnotePrefix = "";
      const body = emitInline(node.inline, ctx, prefix === "");
      return `${prefix}${body}${braces ? ` ${braces}` : ""}`;
    }
    case "h": {
      const braces = emitAttrBraces(node.attrs);
      return `${"#".repeat(node.level)} ${emitInline(node.inline, ctx, false)}${braces ? ` ${braces}` : ""}`;
    }
    case "blockquote":
      return prefixLines(emitBlocks(node.blocks, ctx), "> ", "> ");
    case "list":
      return emitList(node, ctx);
    case "table":
      return emitTable(node, ctx);
    case "fence": {
      const braces = emitAttrBraces(node.attrs);
      const runsRe = ctx.fenceChar === "~" ? /~{3,}/g : /`{3,}/g;
      const runs = node.code.match(runsRe);
      const maxRun = runs ? Math.max(...runs.map((r) => r.length)) : 0;
      const fence = ctx.fenceChar.repeat(Math.max(ctx.fenceLen, maxRun + 1, 3));
      const info = [node.language, braces].filter(Boolean).join(" ");
      return `${fence}${info}\n${node.code ? `${node.code}\n` : ""}${fence}`;
    }
    case "hr":
      return "---";
    case "dl": {
      const parts: string[] = [];
      for (const group of node.groups) {
        parts.push(emitInline(group.dt, ctx, true));
        for (const dd of group.dds) {
          parts.push(`: ${emitInline(dd, ctx, false)}`);
        }
      }
      return parts.join("\n");
    }
  }
}

function emitBlocks(blocks: BlockNode[], ctx: EmitContext): string {
  return blocks.map((b) => emitBlock(b, ctx)).join("\n\n");
}

function emitList(node: BlockNode & { t: "list" }, ctx: EmitContext): string {
  const parts: string[] = [];
  let n = node.start ?? 1;
  node.items.forEach((item, idx) => {
    const marker = node.ordered ? `${n}.` : "-";
    n++;
    const markerPad = `${marker} `;
    const cont = " ".repeat(markerPad.length);
    let body: string;
    if (item.lead != null && item.blocks == null) {
      body = emitInline(item.lead, ctx, true);
    } else if (item.lead != null) {
      // Tight item with a nested block (list/fence) after its text line.
      body = `${emitInline(item.lead, ctx, true)}\n${emitBlocks(item.blocks!, ctx)}`;
    } else {
      body = emitBlocks(item.blocks ?? [], ctx);
    }
    parts.push(prefixLines(body, markerPad, cont));
    if (node.loose && idx < node.items.length - 1) parts.push("");
  });
  return parts.join("\n");
}

function emitTable(node: BlockNode & { t: "table" }, ctx: EmitContext): string {
  const cell = (inline: InlineNode[]): string =>
    emitInline(inline, ctx, false).replace(/\|/g, "\\|");
  const row = (cells: InlineNode[][]): string => `| ${cells.map(cell).join(" | ")} |`;
  const alignCell = (a: TableAlign): string => {
    switch (a) {
      case "left":
        return ":--";
      case "center":
        return ":-:";
      case "right":
        return "--:";
      default:
        return "---";
    }
  };
  return [
    row(node.head),
    `| ${node.align.map(alignCell).join(" | ")} |`,
    ...node.body.map(row),
  ].join("\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Refusal scans on the source slice
// ────────────────────────────────────────────────────────────────────────────

/** Reference-style link/image usage (`[text][id]`, `[text][]`) — the
 *  definition line lives elsewhere; rewriting the usage inline would orphan
 *  it silently. Conservative: refuse the block. */
const REFERENCE_LINK_RE = /\[[^\]]*\]\s*\[[^\]]*\]/;

/** Footnote definition continuation (multi-paragraph footnote): the block
 *  model only covers the first paragraph. */
const FOOTNOTE_CONTINUATION_RE = /\n[ \t]*\n?[ \t]{4}/;

export interface RefusalScanResult {
  refused: boolean;
  reason?: string;
}

export function scanSliceForRefusals(slice: string): RefusalScanResult {
  if (REFERENCE_LINK_RE.test(slice)) {
    return { refused: true, reason: "reference-style link/image in source" };
  }
  if (/^[ \t]*\[(?!\^)[^\]]+\]:\s/m.test(slice)) {
    return { refused: true, reason: "link reference definition in source" };
  }
  if (/^[ \t]*\[\^/.test(slice) && FOOTNOTE_CONTINUATION_RE.test(slice)) {
    return { refused: true, reason: "multi-paragraph footnote definition" };
  }
  return { refused: false };
}

// ────────────────────────────────────────────────────────────────────────────
// Slice harvesting
// ────────────────────────────────────────────────────────────────────────────

const FOOTNOTE_LABEL_RE = /\[\^([^\]\s]+)\](?!:)/g;
const FOOTNOTE_DEF_RE = /^([ \t]*\[\^[^\]\s]+\]:[ \t]*)/;
const FENCE_OPEN_RE = /^[ \t]*(`{3,}|~{3,})/m;

function harvestContext(originalSlice: string): EmitContext {
  const footnoteLabels: string[] = [];
  const defMatch = FOOTNOTE_DEF_RE.exec(originalSlice);
  // A literal `[^…]` inside a code span is not a footnote ref — blank code
  // spans out before scanning for labels (backtick runs pair in order).
  const scannable = originalSlice
    .slice(defMatch ? defMatch[0].length : 0)
    .replace(/(`+)[^`]*\1/g, (m) => " ".repeat(m.length));
  for (const m of scannable.matchAll(FOOTNOTE_LABEL_RE)) {
    footnoteLabels.push(m[1]!);
  }
  const fence = FENCE_OPEN_RE.exec(originalSlice);
  return {
    footnoteLabels,
    footnoteCursor: 0,
    footnotePrefix: defMatch ? defMatch[1]! : "",
    fenceChar: fence ? fence[1]![0]! : "`",
    fenceLen: fence ? fence[1]!.length : 3,
  };
}

/**
 * markdown-it block maps (lists especially) often include the blank line(s)
 * separating the block from its successor. The canonical emission has no
 * trailing blanks, so the original slice's exact trailing newline run is
 * re-appended — dropping it would merge the block with its neighbor (the
 * same boundary rule the block overlay ships, plan §5.5).
 */
function preserveTrailingBlanks(originalSlice: string, text: string): string {
  const run = /(?:\n[ \t]*)+$/.exec(originalSlice);
  return run ? text + run[0] : text;
}

// ────────────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────────────

export type SerializeResult =
  | { kind: "unchanged" }
  | { kind: "replacement"; text: string }
  | { kind: "refused"; reason: string };

export interface SerializeBlockInput {
  /** The edited block element (live DOM in the frame; fixtures in tests). */
  edited: ElementLike;
  /** Model captured before edits began; enables the unchanged fast path. */
  pristineModel?: BlockNode | null;
  /** The block's current markdown source slice (line range resolved by the caller). */
  originalSlice: string;
  options?: SerializeOptions;
}

/**
 * Serialize one edited block back to markdown.
 *
 * Never throws for content reasons — extraction/emission failures surface as
 * `{kind:"refused"}` so callers have a single degrade signal.
 */
export function serializeBlock(input: SerializeBlockInput): SerializeResult {
  let model: BlockNode;
  try {
    model = extractBlockModel(input.edited, input.options);
  } catch (err) {
    if (err instanceof UnextractableBlock) return { kind: "refused", reason: err.message };
    throw err;
  }

  if (input.pristineModel && modelsEqual(model, input.pristineModel)) {
    return { kind: "unchanged" };
  }

  const scan = scanSliceForRefusals(input.originalSlice);
  if (scan.refused) return { kind: "refused", reason: scan.reason! };

  try {
    const ctx = harvestContext(input.originalSlice);
    const text = emitBlock(model, ctx);
    if (ctx.footnoteCursor !== ctx.footnoteLabels.length) {
      return { kind: "refused", reason: "footnote reference count changed" };
    }
    if (text.trim() === "") return { kind: "refused", reason: "block became empty" };
    return { kind: "replacement", text: preserveTrailingBlanks(input.originalSlice, text) };
  } catch (err) {
    if (err instanceof UnextractableBlock) return { kind: "refused", reason: err.message };
    throw err;
  }
}

/**
 * Canonical serialization of a pristine (unedited) block — the corpus gate's
 * probe: `render(canonicalize(extract(render(src))))` must model-equal
 * `render(src)`. Refusals are returned, not thrown.
 */
export function canonicalizeBlock(
  el: ElementLike,
  originalSlice: string,
  options: SerializeOptions = {},
): SerializeResult {
  return serializeBlock({ edited: el, pristineModel: null, originalSlice, options });
}
