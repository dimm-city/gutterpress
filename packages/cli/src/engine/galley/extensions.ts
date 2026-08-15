/**
 * Galley schema — the Tiptap extension set for the inline editing surface.
 *
 * DOM-contract rule: every node/mark here renders the SAME element shape the
 * markdown renderer emits for the equivalent construct (markers.js +
 * markdown-it defaults), so the book's own CSS styles the editor identically
 * to the print path. Marker nodes replay the exact attribute list the marker
 * plugin computed onto their tokens (`domAttrs`), which makes parity
 * structural rather than re-derived. galley.test.ts asserts this contract
 * against the real renderer.
 *
 * Headless-safe: this module must import cleanly under bun (the round-trip
 * gate builds the schema with `getSchema`) — no DOM access outside functions
 * that only the browser editor invokes (nodeViews live in editor.ts, not
 * here).
 */
import { Extension, Mark, Node, getSchema, mergeAttributes } from "@tiptap/core";
import type { Extensions } from "@tiptap/core";
import type { Schema } from "@tiptap/pm/model";
import StarterKit from "@tiptap/starter-kit";
import { Table, TableRow, TableHeader, TableCell } from "@tiptap/extension-table";

// ── authored `{...}` attribute suffix ───────────────────────────────────────

/**
 * Parse a markdown-it-attrs brace suffix ("{#id .a .b key=val}") into DOM
 * attributes. Inverse of the reconstruction the doc build performs from
 * token attrs; the round trip is exact for the grammar markdown-it-attrs
 * accepts.
 */
export function braceDomAttrs(gpAttrs: string): Record<string, string> {
  const m = /^\{(.*)\}$/s.exec(gpAttrs.trim());
  if (!m) return {};
  const out: Record<string, string> = {};
  const classes: string[] = [];
  for (const part of m[1]!.split(/\s+/).filter(Boolean)) {
    if (part.startsWith("#")) out.id = part.slice(1);
    else if (part.startsWith(".")) classes.push(part.slice(1));
    else {
      const eq = part.indexOf("=");
      if (eq > 0) out[part.slice(0, eq)] = part.slice(eq + 1);
    }
  }
  if (classes.length) out.class = classes.join(" ");
  return out;
}

/**
 * The authored-attrs slot. `gpAttrs` holds the verbatim reconstructed brace
 * suffix; it renders into the editor DOM (so `{.gp-right}` floats the image
 * while editing exactly as in print) and serializes back as braces. The raw
 * string also rides along as `data-gp-attrs` so editor-internal copy/paste
 * keeps byte fidelity.
 */
const GpAttrs = Extension.create({
  name: "gpAttrs",
  addGlobalAttributes() {
    return [
      {
        types: [
          "paragraph",
          "heading",
          "blockquote",
          "codeBlock",
          "bulletList",
          "orderedList",
          "listItem",
          "image",
          "table",
        ],
        attributes: {
          gpAttrs: {
            default: "",
            parseHTML: (el: HTMLElement) => el.getAttribute("data-gp-attrs") ?? "",
            renderHTML: (attrs: Record<string, unknown>) => {
              const raw = (attrs.gpAttrs as string) || "";
              if (!raw) return {};
              return { ...braceDomAttrs(raw), "data-gp-attrs": raw };
            },
          },
          /**
           * 1-based source line at parse time (token.map). Rendered as
           * data-source-line so the source-pane scroll sync keeps working
           * over the editing DOM; staleness after edits matches the old
           * surface's behavior and heals on the next build. Never
           * serialized (INJECTED_ATTRS filters it on the way back in).
           */
          gpLine: {
            default: null as number | null,
            parseHTML: (el: HTMLElement) => {
              const v = el.getAttribute("data-source-line");
              return v ? Number(v) : null;
            },
            renderHTML: (attrs: Record<string, unknown>) =>
              attrs.gpLine ? { "data-source-line": String(attrs.gpLine) } : {},
          },
        },
      },
    ];
  },
});

// ── chapter file wrapper ────────────────────────────────────────────────────

/**
 * One source file's content. Mirrors assemble.ts's incremental-preview
 * wrapper (`div.gutterpress-chapter[data-chapter-src]`) so the book CSS and
 * the viewer see the same shape they always did. Whole-file saves serialize
 * each chapterFile's children independently.
 */
export const ChapterFile = Node.create({
  name: "chapterFile",
  group: "block",
  content: "block*",
  defining: true,
  isolating: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "div.gutterpress-chapter[data-chapter-src]",
        getAttrs: (el: HTMLElement) => ({ src: el.getAttribute("data-chapter-src") ?? "" }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "div",
      { class: "gutterpress-chapter", "data-chapter-src": node.attrs.src as string },
      0,
    ];
  },
});

// ── structural markers ──────────────────────────────────────────────────────

/** [name, value] pairs exactly as the marker plugin attached them. */
export type DomAttrList = Array<[string, string]>;

const replay = (domAttrs: DomAttrList): Record<string, string> =>
  Object.fromEntries(domAttrs);

/**
 * `@chapter` / `@spread` / `@page` / `@section` — a content-bearing wrapper.
 * `src` is the verbatim marker line (serialized back untouched); `domAttrs`
 * is the token's computed attribute list (class="section …", data-*-label,
 * …) replayed verbatim for exact renderer parity.
 *
 * `isolating` so backspace at a region's first block cannot silently merge
 * two layout regions; structure edits are explicit commands.
 */
export const MarkerWrap = Node.create({
  name: "markerWrap",
  group: "block",
  content: "block*",
  defining: true,
  isolating: true,
  addAttributes() {
    return {
      kind: { default: "section" },
      src: { default: "" },
      domAttrs: { default: [] as DomAttrList },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-gp-marker-kind]",
        getAttrs: (el: HTMLElement) => ({
          kind: el.getAttribute("data-gp-marker-kind") ?? "section",
          src: el.getAttribute("data-gp-marker-src") ?? "",
          domAttrs: [...el.attributes]
            .filter((a) => !a.name.startsWith("data-gp-marker-"))
            .map((a) => [a.name, a.value]),
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        ...replay(node.attrs.domAttrs as DomAttrList),
        "data-gp-marker-kind": node.attrs.kind as string,
        "data-gp-marker-src": node.attrs.src as string,
      },
      0,
    ];
  },
});

/**
 * `@page-break` / `@column-break` — a standalone marker with no content.
 * Atom + selectable so it can be clicked and deleted as a unit; gapcursor
 * (StarterKit) provides caret placement around it.
 */
export const MarkerAtom = Node.create({
  name: "markerAtom",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return {
      src: { default: "" },
      domAttrs: { default: [] as DomAttrList },
    };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-gp-marker-atom]",
        getAttrs: (el: HTMLElement) => ({
          src: el.getAttribute("data-gp-marker-atom") ?? "",
          domAttrs: [...el.attributes]
            .filter((a) => a.name !== "data-gp-marker-atom")
            .map((a) => [a.name, a.value]),
        }),
      },
    ];
  },
  renderHTML({ node }) {
    return [
      "div",
      {
        ...replay(node.attrs.domAttrs as DomAttrList),
        "data-gp-marker-atom": node.attrs.src as string,
      },
    ];
  },
});

/**
 * The renderer-injected `.chapter-opener` badge. Generated content (no
 * source lines back it), so it displays but serializes to NOTHING — the
 * print path re-injects its own copy from the `@chapter` marker.
 */
export const ChapterOpener = Node.create({
  name: "chapterOpener",
  group: "block",
  atom: true,
  selectable: false,
  addAttributes() {
    return { label: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "div.chapter-opener",
        getAttrs: (el: HTMLElement) => ({
          label: el.getAttribute("data-chapter-label") ?? el.textContent ?? "",
        }),
      },
    ];
  },
  renderHTML({ node }) {
    const label = node.attrs.label as string;
    return ["div", { class: "chapter-opener", "data-chapter-label": label }, label];
  },
});

// ── opaque fallbacks (the zero-loss invariant) ──────────────────────────────

/**
 * A block-level run the schema does not model. `src` is the verbatim source
 * slice; editor.ts overrides the view to display the REAL renderer's HTML
 * for it. Non-editable inline; edited as source via the block overlay.
 */
export const RawBlock = Node.create({
  name: "rawBlock",
  group: "block",
  atom: true,
  selectable: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "div[data-gp-raw-block]",
        getAttrs: (el: HTMLElement) => ({ src: el.getAttribute("data-gp-raw-block") ?? "" }),
      },
      // Viewer chrome must NEVER parse into the document when ProseMirror
      // re-reads DOM near it (spacers sit between content blocks inside the
      // editable flow). These ignore rules ride along on this node's list.
      { tag: "div.gp-layer", ignore: true },
      { tag: "div.gp-sheet", ignore: true },
      { tag: "div.gp-marginbox", ignore: true },
      { tag: "div.gp-wrap-spacer", ignore: true },
      { tag: "div.gp-column-break-spacer", ignore: true },
      { tag: "div.gp-recto-spacer", ignore: true },
    ];
  },
  renderHTML({ node }) {
    return ["div", { class: "gp-raw-block", "data-gp-raw-block": node.attrs.src as string }];
  },
});

/** Inline construct kept verbatim (footnote refs, inline HTML). */
export const RawInline = Node.create({
  name: "rawInline",
  group: "inline",
  inline: true,
  atom: true,
  selectable: true,
  addAttributes() {
    return { src: { default: "" } };
  },
  parseHTML() {
    return [
      {
        tag: "span[data-gp-raw-inline]",
        getAttrs: (el: HTMLElement) => ({ src: el.getAttribute("data-gp-raw-inline") ?? "" }),
      },
    ];
  },
  renderHTML({ node }) {
    return ["span", { class: "gp-raw-inline", "data-gp-raw-inline": node.attrs.src as string }];
  },
});

// ── inline constructs the renderer emits beyond StarterKit ──────────────────

/** Inline image, exactly `<img src alt title>` (+ gpAttrs classes). */
export const GpImage = Node.create({
  name: "image",
  inline: true,
  group: "inline",
  draggable: true,
  addAttributes() {
    return {
      src: { default: "" },
      alt: { default: "" },
      title: { default: null as string | null },
    };
  },
  parseHTML() {
    return [
      {
        tag: "img[src]",
        getAttrs: (el: HTMLElement) => ({
          src: el.getAttribute("src") ?? "",
          alt: el.getAttribute("alt") ?? "",
          title: el.getAttribute("title"),
        }),
      },
    ];
  },
  renderHTML({ node, HTMLAttributes }) {
    // HTMLAttributes carries the GpAttrs global attribute's output — the
    // brace-derived classes that make `{.gp-right}` float in the editor and
    // the data-gp-attrs fidelity attr. Node-owned attrs win on conflict.
    const attrs: Record<string, string> = {
      src: node.attrs.src as string,
      alt: node.attrs.alt as string,
    };
    if (node.attrs.title) attrs.title = node.attrs.title as string;
    return ["img", mergeAttributes(HTMLAttributes, attrs)];
  },
});

/** `<a href title>` with none of Tiptap Link's target/rel injection. */
export const GpLink = Mark.create({
  name: "link",
  inclusive: false,
  addAttributes() {
    return { href: { default: "" }, title: { default: null as string | null } };
  },
  parseHTML() {
    return [
      {
        tag: "a[href]",
        getAttrs: (el: HTMLElement) => ({
          href: el.getAttribute("href") ?? "",
          title: el.getAttribute("title"),
        }),
      },
    ];
  },
  renderHTML({ mark }) {
    const attrs: Record<string, string> = { href: mark.attrs.href as string };
    if (mark.attrs.title) attrs.title = mark.attrs.title as string;
    return ["a", attrs, 0];
  },
});

const simpleMark = (name: string, tag: string) =>
  Mark.create({
    name,
    parseHTML() {
      return [{ tag }];
    },
    renderHTML() {
      return [tag, 0];
    },
  });

export const GpSub = simpleMark("sub", "sub");
export const GpSup = simpleMark("sup", "sup");
/** markdown-it-mark's `==text==` → `<mark>`. */
export const GpHighlight = simpleMark("highlight", "mark");

/** markdown-it-abbr's `<abbr title>`; the definition lines round-trip as raw blocks. */
export const GpAbbr = Mark.create({
  name: "abbr",
  addAttributes() {
    return { title: { default: "" } };
  },
  parseHTML() {
    return [
      { tag: "abbr", getAttrs: (el: HTMLElement) => ({ title: el.getAttribute("title") ?? "" }) },
    ];
  },
  renderHTML({ mark }) {
    return ["abbr", { title: mark.attrs.title as string }, 0];
  },
});

// ── definition lists (markdown-it-deflist) ──────────────────────────────────

export const DefList = Node.create({
  name: "defList",
  group: "block",
  content: "(defTerm | defDesc)+",
  parseHTML() {
    return [{ tag: "dl" }];
  },
  renderHTML() {
    return ["dl", 0];
  },
});
export const DefTerm = Node.create({
  name: "defTerm",
  content: "inline*",
  defining: true,
  parseHTML() {
    return [{ tag: "dt" }];
  },
  renderHTML() {
    return ["dt", 0];
  },
});
export const DefDesc = Node.create({
  name: "defDesc",
  content: "block+",
  defining: true,
  parseHTML() {
    return [{ tag: "dd" }];
  },
  renderHTML() {
    return ["dd", 0];
  },
});

// ── tables (pipe-table alignment carried per cell) ──────────────────────────

const alignAttr = {
  gpAlign: {
    default: null as string | null,
    parseHTML: (el: HTMLElement) => {
      const m = /text-align:\s*(left|center|right)/.exec(el.getAttribute("style") ?? "");
      return m ? m[1] : null;
    },
    renderHTML: (attrs: Record<string, unknown>) =>
      attrs.gpAlign ? { style: `text-align:${attrs.gpAlign as string}` } : {},
  },
};

export const GpTableCell = TableCell.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttr };
  },
});
export const GpTableHeader = TableHeader.extend({
  addAttributes() {
    return { ...this.parent?.(), ...alignAttr };
  },
});

// ── the assembled set ───────────────────────────────────────────────────────

export function galleyExtensions(): Extensions {
  return [
    StarterKit.configure({
      // No markdown equivalent — keep the schema closed over what serializes.
      underline: false,
      // Replaced by GpLink: Tiptap's Link injects target/rel, which the
      // renderer never emits.
      link: false,
    }),
    GpAttrs,
    ChapterFile,
    MarkerWrap,
    MarkerAtom,
    ChapterOpener,
    RawBlock,
    RawInline,
    GpImage,
    GpLink,
    GpSub,
    GpSup,
    GpHighlight,
    GpAbbr,
    DefList,
    DefTerm,
    DefDesc,
    Table,
    TableRow,
    GpTableHeader,
    GpTableCell,
  ];
}

/** Compiled PM schema — headless-safe (used by the round-trip gate). */
export function galleySchema(): Schema {
  return getSchema(galleyExtensions());
}
