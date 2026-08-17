/**
 * toolbar-actions.ts (#31)
 *
 * CodeMirror 6 transaction helpers that implement the EditorToolbar's named
 * edit actions. Each function accepts an EditorView and applies a single,
 * undoable transaction.
 *
 * Design rules:
 * - Every action is a SINGLE transaction (one undo step).
 * - Wrap/unwrap: with a non-empty selection, wrap the selected text;
 *   without a selection, insert the syntax with the cursor between the markers.
 * - Block-level actions (headings, blockquote, lists, hr, page-break) operate
 *   on the CURRENT line(s), not just the caret offset.
 * - The functions are pure CodeMirror state mutations — zero Svelte imports.
 */
import type { EditorView } from "@codemirror/view";
import { EditorSelection } from "@codemirror/state";
import {
  IMAGE_POSITION_OPTIONS,
  IMAGE_SIZE_OPTIONS,
  normalizeClassInput,
  serializeImageAttrs,
  setPositionClass,
  setShapeClass,
  setSizeClass,
  setWidth,
} from "./image-classes";

// ── Helper: single-range accessor ────────────────────────────────────────────

function mainSel(view: EditorView) {
  return view.state.selection.main;
}

/**
 * The document offset just after the line the cursor is on — the insertion
 * point every "insert a block after the current line" action uses (audit E4:
 * this three-statement idiom was hand-repeated in 8 functions below).
 */
function insertionPointAfterCurrentLine(view: EditorView): number {
  const { from } = mainSel(view);
  return view.state.doc.lineAt(from).to;
}

function selectedText(view: EditorView): string {
  const { from, to } = mainSel(view);
  return view.state.doc.sliceString(from, to);
}

// ── Inline wrap helpers ───────────────────────────────────────────────────────

/**
 * Toggle an inline marker pair around the current selection.
 * With a selection: wrap it (or unwrap if already wrapped).
 * Without a selection: insert `marker…marker` with cursor between.
 */
function toggleInlineWrap(view: EditorView, marker: string): void {
  const { from, to } = mainSel(view);
  const sel = selectedText(view);
  const mLen = marker.length;

  if (from === to) {
    // Empty selection: if the cursor already sits directly between an
    // existing marker pair, remove it (toggle off) instead of inserting a
    // nested pair. Without this check, repeated Ctrl+B on an empty selection
    // piled up marker debris: "" -> "****" -> "******" -> "********" ... (L6).
    const existingBefore = view.state.doc.sliceString(Math.max(0, from - mLen), from);
    const existingAfter = view.state.doc.sliceString(to, to + mLen);
    if (existingBefore === marker && existingAfter === marker) {
      view.dispatch({
        changes: [
          { from: from - mLen, to: from, insert: "" },
          { from: to, to: to + mLen, insert: "" },
        ],
        selection: EditorSelection.cursor(from - mLen),
      });
      return;
    }
    // No selection: insert both markers and place cursor inside.
    view.dispatch({
      changes: { from, to, insert: marker + marker },
      selection: EditorSelection.cursor(from + mLen),
    });
    return;
  }

  // Check if the selection is already wrapped.
  const before = view.state.doc.sliceString(Math.max(0, from - mLen), from);
  const after = view.state.doc.sliceString(to, to + mLen);
  if (before === marker && after === marker) {
    // Unwrap: remove the surrounding markers.
    view.dispatch({
      changes: [
        { from: from - mLen, to: from, insert: "" },
        { from: to, to: to + mLen, insert: "" },
      ],
      selection: EditorSelection.range(from - mLen, to - mLen),
    });
    return;
  }

  // Wrap the selection.
  view.dispatch({
    changes: { from, to, insert: marker + sel + marker },
    selection: EditorSelection.range(from + mLen, to + mLen),
  });
}

// ── Bold ─────────────────────────────────────────────────────────────────────

export function applyBold(view: EditorView): void {
  toggleInlineWrap(view, "**");
}

// ── Italic ───────────────────────────────────────────────────────────────────

export function applyItalic(view: EditorView): void {
  toggleInlineWrap(view, "_");
}

// ── Strikethrough ─────────────────────────────────────────────────────────────

export function applyStrikethrough(view: EditorView): void {
  toggleInlineWrap(view, "~~");
}

// ── Inline code ───────────────────────────────────────────────────────────────

export function applyInlineCode(view: EditorView): void {
  toggleInlineWrap(view, "`");
}

// ── Link ─────────────────────────────────────────────────────────────────────

export function applyLink(view: EditorView): void {
  const { from, to } = mainSel(view);
  const sel = selectedText(view);

  if (from === to) {
    // No selection: insert template [text](url) and select "text".
    const insert = "[link text](url)";
    view.dispatch({
      changes: { from, to, insert },
      selection: EditorSelection.range(from + 1, from + 10),
    });
    return;
  }

  // Selection becomes the link text: [selected](url), cursor on "url".
  const insert = `[${sel}](url)`;
  const urlStart = from + sel.length + 3;
  view.dispatch({
    changes: { from, to, insert },
    selection: EditorSelection.range(urlStart, urlStart + 3),
  });
}

// ── Blockquote ───────────────────────────────────────────────────────────────

/** Toggle `> ` prefix on every selected line. */
export function applyBlockquote(view: EditorView): void {
  const { from, to } = mainSel(view);
  const doc = view.state.doc;
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(to).number;

  const lines = [];
  for (let n = startLine; n <= endLine; n++) {
    lines.push(doc.line(n));
  }

  const allQuoted = lines.every((l) => l.text.startsWith("> "));
  const changes = lines.map((l) =>
    allQuoted
      ? { from: l.from, to: l.from + 2, insert: "" }
      : { from: l.from, to: l.from, insert: "> " },
  );
  view.dispatch({ changes });
}

// ── Unordered list ────────────────────────────────────────────────────────────

export function applyUnorderedList(view: EditorView): void {
  const { from, to } = mainSel(view);
  const doc = view.state.doc;
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(to).number;

  const lines = [];
  for (let n = startLine; n <= endLine; n++) {
    lines.push(doc.line(n));
  }

  const allListed = lines.every((l) => /^[*-] /.test(l.text));
  const changes = lines.map((l) =>
    allListed
      ? { from: l.from, to: l.from + 2, insert: "" }
      : { from: l.from, to: l.from, insert: "- " },
  );
  view.dispatch({ changes });
}

// ── Ordered list ─────────────────────────────────────────────────────────────

export function applyOrderedList(view: EditorView): void {
  const { from, to } = mainSel(view);
  const doc = view.state.doc;
  const startLine = doc.lineAt(from).number;
  const endLine = doc.lineAt(to).number;

  const lines = [];
  for (let n = startLine; n <= endLine; n++) {
    lines.push(doc.line(n));
  }

  const allListed = lines.every((l) => /^\d+\. /.test(l.text));
  const changes = lines.map((l, i) =>
    allListed
      ? { from: l.from, to: l.from + (l.text.match(/^\d+\. /)?.[0].length ?? 3), insert: "" }
      : { from: l.from, to: l.from, insert: `${i + 1}. ` },
  );
  view.dispatch({ changes });
}

// ── Heading ───────────────────────────────────────────────────────────────────

export function applyHeading(view: EditorView, level: 1 | 2 | 3 | 4): void {
  const { from } = mainSel(view);
  const line = view.state.doc.lineAt(from);
  const prefix = "#".repeat(level) + " ";

  // If the line already has a heading prefix, replace it; otherwise prepend.
  const existingMatch = line.text.match(/^(#+) /);
  if (existingMatch) {
    const existingLen = existingMatch[0].length;
    if (existingMatch[1].length === level) {
      // Same level — remove the heading.
      view.dispatch({
        changes: { from: line.from, to: line.from + existingLen, insert: "" },
        selection: EditorSelection.cursor(line.from),
      });
      return;
    }
    // Different level — replace.
    view.dispatch({
      changes: { from: line.from, to: line.from + existingLen, insert: prefix },
      selection: EditorSelection.cursor(line.from + prefix.length),
    });
    return;
  }

  view.dispatch({
    changes: { from: line.from, to: line.from, insert: prefix },
    selection: EditorSelection.cursor(line.from + prefix.length),
  });
}

// ── Horizontal rule ───────────────────────────────────────────────────────────

export function applyHr(view: EditorView): void {
  // Insert after the current line (blank line before and after for correct
  // markdown parsing).
  const insertAt = insertionPointAfterCurrentLine(view);
  const nl = "\n\n---\n\n";
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: nl },
    selection: EditorSelection.cursor(insertAt + nl.length),
  });
}

// ── Page break ───────────────────────────────────────────────────────────────
// The canonical Gutterpress author token is `@page-break` on its own line.
// Source: packages/cli/src/lib/markdown/markers.js line 13.

export function applyPageBreak(view: EditorView): void {
  const insertAt = insertionPointAfterCurrentLine(view);
  const insert = "\n\n@page-break\n\n";
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.cursor(insertAt + insert.length),
  });
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function applyTable(view: EditorView, cols: number): void {
  const safeCols = Math.max(1, Math.min(10, cols));

  const header = Array.from({ length: safeCols }, (_, i) => `Header ${i + 1}`);
  const sep = Array.from({ length: safeCols }, () => "------");
  const row = Array.from({ length: safeCols }, () => "Cell");

  const headerRow = "| " + header.join(" | ") + " |";
  const sepRow = "| " + sep.join(" | ") + " |";
  const dataRow = "| " + row.join(" | ") + " |";

  const insert = "\n\n" + [headerRow, sepRow, dataRow].join("\n") + "\n\n";
  const insertAt = insertionPointAfterCurrentLine(view);
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.cursor(insertAt + insert.length),
  });
}

// ── Image ─────────────────────────────────────────────────────────────────────
// The supported class vocabulary (positions, sizes, and their permanent
// legacy aliases) lives in ONE place: `$lib/editor/image-classes` — the
// option tables there drive the insert dialog, the context menu, and the
// attrs round-trip helpers alike.

/**
 * Build the `{…}` markdown-it-attrs suffix for a NEW image from the insert
 * dialog's width/position/size/shape picks (empty string when none are
 * set). Position/size inputs are canonicalized through the option tables,
 * so a caller still holding a removed legacy name ("full-bleed") writes the
 * live gp-* class, never a dead one. Extracted out of `applyImage` below
 * (inline-editing plan §4.4) so the context menu's image actions can share
 * the exact same suffix rule — though for EXISTING tokens they go through
 * image-classes' tokenize → set-facet → serialize instead, which preserves
 * attrs this builder doesn't know about.
 */
export function buildImageAttrsString(
  width?: string,
  position?: string,
  size?: string,
  shape?: boolean,
): string {
  let tokens: string[] = [];
  tokens = setWidth(tokens, width || null);
  tokens = setPositionClass(
    tokens,
    position ? (normalizeClassInput(IMAGE_POSITION_OPTIONS, position) ?? null) : null,
  );
  tokens = setSizeClass(
    tokens,
    size ? (normalizeClassInput(IMAGE_SIZE_OPTIONS, size) ?? null) : null,
  );
  tokens = setShapeClass(tokens, shape === true);
  return serializeImageAttrs(tokens);
}

export function applyImage(
  view: EditorView,
  src: string,
  alt: string,
  width?: string,
  position?: string,
  size?: string,
  shape?: boolean,
): void {
  const attrStr = buildImageAttrsString(width, position, size, shape);
  const snippet = `\n\n![${alt}](${src})${attrStr}\n\n`;
  const insertAt = insertionPointAfterCurrentLine(view);
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: snippet },
    selection: EditorSelection.cursor(insertAt + snippet.length),
  });
}

// ── Insert layout block (UX M26) ─────────────────────────────────────────────
// The toolbar previously exposed none of Gutterpress's own layout primitives
// beyond @page-break (UX finding M26). These helpers insert a correct core
// `@marker` skeleton (the core marker whitelist — chapter/spread/
// page/section/continue/page-break/column-break/end-section; see the
// plugin's own header comment) as its own block after the CURRENT line,
// blank-line padded — the same convention applyHr/applyPageBreak above
// already use. Project-plugin markers (@sidebar, @callout, …) are NOT core
// (CLAUDE.md §5/§6) and have no helper here; a project plugin that wants a
// picker entry should contribute its own toolbar item, not extend this one.

/** Which layout skeleton `applyLayoutBlock` inserts. */
export type LayoutBlockKind = "chapter" | "section" | "two-column" | "page-break" | "spread";

/** `@chapter` + a nested `@page`, with the title placeholder selected so
 *  typing immediately replaces it (mirrors applyLink's "select link text"
 *  placeholder pattern above).
 *
 *  The placeholder is QUOTED (`@chapter "Chapter Title"`), not bare. A bare
 *  multi-word label tokenizes into more than one bare token in
 *  `parseMarkerLine`, which fails its "exactly one bare token" name rule and
 *  silently degrades to no `data-chapter-label` / no `.chapter-opener` —
 *  exactly the opposite of what this control advertises. Quoting collapses
 *  the label to a single token regardless of internal spaces, so it actually
 *  produces the label + chapter-opener (verified against the core marker
 *  renderer). See marker-completions.ts's
 *  `applyChapterCompletion` for the identical fix applied to the completion
 *  source's `@chapter` template. */
export function applyChapterBlock(view: EditorView): void {
  const insertAt = insertionPointAfterCurrentLine(view);
  const label = "Chapter Title";
  const prefix = '\n\n@chapter "';
  const suffix = '"';
  const labelStart = insertAt + prefix.length;
  const insert = `${prefix}${label}${suffix}\n\n@page\n\n`;
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.range(labelStart, labelStart + label.length),
  });
}

/** `@section` / `@end-section` pair, cursor left on the blank line between
 *  them (same shape as the marker-completions.ts inline template, just
 *  block-inserted after the current line instead of typed in place). */
export function applySectionBlock(view: EditorView): void {
  const insertAt = insertionPointAfterCurrentLine(view);
  const prefix = "\n\n@section\n";
  const insert = `${prefix}\n@end-section\n\n`;
  const cursorPos = insertAt + prefix.length;
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.cursor(cursorPos),
  });
}

/** A working two-column section with a fixed, authored split.
 *
 *  Emits the CORE column utility `.gp-columns-2` (gutterpress-css.ts:195),
 *  not `.col-split`. `.col-split` used to make the renderer emit explicit
 *  `<div class="col">` wrappers because Paged.js stripped
 *  `break-after: column`; that path was removed 2026-08-17 after measuring
 *  that native `break-after: column` reproduces the fixed split exactly
 *  (5/0 with a forced break vs 3/2 when balancing, Chromium 153).
 *
 *  The old comment here claimed "plain CSS multicol does not create the
 *  explicit left/right wrappers the fixed split needs" — that was wrong. A
 *  fixed split needs a forced BREAK, not wrappers, and `@column-break`
 *  already emits `.gp-column-break { break-after: column }`. `.col-split`
 *  alone also never set `column-count`, so this snippet only appeared to
 *  work because the wrapper path faked the columns. */
export function applyTwoColumnBlock(view: EditorView): void {
  const insertAt = insertionPointAfterCurrentLine(view);
  const prefix = "\n\n@section .gp-columns-2\n";
  const insert = `${prefix}\n@column-break\n\nRight column content.\n\n@end-section\n\n`;
  const cursorPos = insertAt + prefix.length;
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.cursor(cursorPos),
  });
}

/** `@spread` with a first nested `@page`, cursor left ready to write. */
export function applySpreadBlock(view: EditorView): void {
  const insertAt = insertionPointAfterCurrentLine(view);
  const insert = "\n\n@spread\n\n@page\n\n";
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.cursor(insertAt + insert.length),
  });
}

/** Dispatches to the right layout-block helper for `kind`. `"page-break"`
 *  reuses the existing {@link applyPageBreak} — one canonical implementation
 *  of the `@page-break` token, not a second copy. */
export function applyLayoutBlock(view: EditorView, kind: LayoutBlockKind): void {
  switch (kind) {
    case "chapter":     applyChapterBlock(view); break;
    case "section":     applySectionBlock(view); break;
    case "two-column":  applyTwoColumnBlock(view); break;
    case "page-break":  applyPageBreak(view); break;
    case "spread":      applySpreadBlock(view); break;
  }
}

/** Picker entries for the "Insert layout block" toolbar control — the order
 *  shown in the popup. */
export interface LayoutBlockItem {
  kind: LayoutBlockKind;
  label: string;
  detail: string;
}

export const LAYOUT_BLOCK_ITEMS: readonly LayoutBlockItem[] = [
  { kind: "chapter", label: "Chapter", detail: "@chapter — wraps content, auto chapter-opener" },
  { kind: "section", label: "Section", detail: "@section … @end-section — keeps content together" },
  { kind: "two-column", label: "Two columns", detail: "@section .gp-columns-2 … @column-break … @end-section" },
  { kind: "page-break", label: "Page break", detail: "@page-break — hard break, no page wrapper" },
  { kind: "spread", label: "Spread", detail: "@spread — a two-page facing spread" },
] as const;

// ── Toolbar item declarations (single source of truth — M23) ────────────────
//
// EditorToolbar renders BOTH the always-visible toolbar groups AND the
// narrow-width "More" overflow menu from this ONE array. Previously the More
// menu was a hand-duplicated second list of buttons that had already drifted
// from the toolbar — it silently omitted Save and Snippet, so Save vanished
// entirely once the container narrowed enough to hide the primary group.
// Deriving both surfaces from the same filtered list makes that class of
// drift structurally impossible: an item is either in this array (and shows
// up everywhere it should) or it isn't declared at all.
//
// Pure data + a pure filter function — zero Svelte imports, so it is testable
// the same way the transaction helpers above are.

/** Which visually-grouped section of the always-visible toolbar an item renders in. */
type ToolbarGroup = "save" | "primary" | "block" | "insert";

/**
 * How an item behaves when activated:
 * - "save"/"action": a single button that fires a callback directly.
 * - "heading"/"table"/"image"/"layout-block": opens a picker (popup or
 *   dialog) — the component supplies the bespoke markup for these, but
 *   membership, ordering, and group/visibility rules still come from this
 *   array.
 */
type ToolbarItemKind = "save" | "action" | "heading" | "table" | "image" | "layout-block";

export interface ToolbarItemDef {
  /** Stable identity — also the {#each} key. */
  id: string;
  kind: ToolbarItemKind;
  /** For kind "action": the ToolbarAction name fired via onAction(action). */
  action?: string;
  /** Icon name (EditorToolbar resolves this against its own IconName type). */
  icon: string;
  /** Tooltip (title attribute) for the icon-only toolbar button. */
  title: string;
  /** aria-label for the icon-only toolbar button (may differ from the More-menu label). */
  ariaLabel: string;
  /** Plain-text label shown for this item inside the More menu. */
  label: string;
  group: ToolbarGroup;
  /** Only shown when isDesktop() — image insert and snippet need host IPCs. */
  desktopOnly?: boolean;
}

export const TOOLBAR_ITEMS: ToolbarItemDef[] = [
  {
    id: "save",
    kind: "save",
    icon: "save",
    title: "Save changes now",
    ariaLabel: "Save changes now",
    label: "Save",
    group: "save",
  },
  {
    id: "bold",
    kind: "action",
    action: "bold",
    icon: "bold",
    title: "Bold (Ctrl+B)",
    ariaLabel: "Bold",
    label: "Bold",
    group: "primary",
  },
  {
    id: "italic",
    kind: "action",
    action: "italic",
    icon: "italic",
    title: "Italic (Ctrl+I)",
    ariaLabel: "Italic",
    label: "Italic",
    group: "primary",
  },
  {
    id: "strikethrough",
    kind: "action",
    action: "strikethrough",
    icon: "strikethrough",
    title: "Strikethrough",
    ariaLabel: "Strikethrough",
    label: "Strikethrough",
    group: "primary",
  },
  {
    id: "code",
    kind: "action",
    action: "code",
    icon: "code",
    title: "Inline code",
    ariaLabel: "Inline code",
    label: "Inline code",
    group: "primary",
  },
  {
    id: "link",
    kind: "action",
    action: "link",
    icon: "link-2",
    title: "Link (Ctrl+K)",
    ariaLabel: "Insert link",
    label: "Link",
    group: "primary",
  },
  {
    id: "blockquote",
    kind: "action",
    action: "blockquote",
    icon: "quote",
    title: "Blockquote",
    ariaLabel: "Blockquote",
    label: "Blockquote",
    group: "block",
  },
  {
    id: "ul",
    kind: "action",
    action: "ul",
    icon: "list",
    title: "Bullet list",
    ariaLabel: "Unordered list",
    label: "Bullet list",
    group: "block",
  },
  {
    id: "ol",
    kind: "action",
    action: "ol",
    icon: "list-ordered",
    title: "Numbered list",
    ariaLabel: "Ordered list",
    label: "Numbered list",
    group: "block",
  },
  {
    id: "heading",
    kind: "heading",
    icon: "heading",
    title: "Insert heading",
    ariaLabel: "Insert heading",
    label: "Heading",
    group: "block",
  },
  {
    id: "hr",
    kind: "action",
    action: "hr",
    icon: "minus",
    title: "Horizontal rule",
    ariaLabel: "Insert horizontal rule",
    label: "Horizontal rule",
    group: "insert",
  },
  {
    id: "layout-block",
    kind: "layout-block",
    icon: "columns-2",
    title: "Insert layout block (chapter, section, columns, spread…)",
    ariaLabel: "Insert layout block",
    label: "Insert layout block…",
    group: "insert",
  },
  {
    id: "page-break",
    kind: "action",
    action: "page-break",
    icon: "file-separator",
    title: "Page break (@page-break)",
    ariaLabel: "Insert page break",
    label: "Page break",
    group: "insert",
  },
  {
    id: "table",
    kind: "table",
    icon: "table",
    title: "Insert table",
    ariaLabel: "Insert table",
    label: "Insert table…",
    group: "insert",
  },
  {
    id: "image",
    kind: "image",
    icon: "image",
    title: "Insert image",
    ariaLabel: "Insert image",
    label: "Insert image…",
    group: "insert",
    desktopOnly: true,
  },
  {
    id: "snippet",
    kind: "action",
    action: "snippet",
    icon: "puzzle",
    title: "Insert snippet (Ctrl/Cmd+Shift+S)",
    ariaLabel: "Insert snippet",
    label: "Insert snippet",
    group: "insert",
    desktopOnly: true,
  },
  {
    // Focus mode lives on the EDITOR toolbar (not the main toolbar): it is an
    // editing posture, and this bar stays visible inside focus mode so the
    // same button toggles back out (Esc works too).
    id: "focus-mode",
    kind: "action",
    action: "focus-mode",
    icon: "maximize",
    title: "Focus mode (Ctrl+Shift+F)",
    ariaLabel: "Toggle focus mode",
    label: "Focus mode",
    group: "insert",
  },
];

/**
 * Filters `TOOLBAR_ITEMS` down to what should be visible right now. Both the
 * grouped toolbar buttons (filtered further by `.group`) and the flat More
 * menu (rendered unfiltered) must be derived from this same list so neither
 * surface can omit an item the other one shows.
 */
export function visibleToolbarItems(opts: {
  hasSave: boolean;
  desktop: boolean;
}): ToolbarItemDef[] {
  return TOOLBAR_ITEMS.filter((item) => {
    if (item.kind === "save" && !opts.hasSave) return false;
    if (item.desktopOnly && !opts.desktop) return false;
    return true;
  });
}
