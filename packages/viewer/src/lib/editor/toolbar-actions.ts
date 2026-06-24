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

// ── Helper: single-range accessor ────────────────────────────────────────────

function mainSel(view: EditorView) {
  return view.state.selection.main;
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
export function toggleInlineWrap(view: EditorView, marker: string): void {
  const { from, to } = mainSel(view);
  const sel = selectedText(view);
  const mLen = marker.length;

  if (from === to) {
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
  const { from } = mainSel(view);
  const line = view.state.doc.lineAt(from);
  // Insert after the current line (with a blank line before and after for
  // correct markdown parsing).
  const insertAt = line.to;
  const nl = "\n\n---\n\n";
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: nl },
    selection: EditorSelection.cursor(insertAt + nl.length),
  });
}

// ── Page break ───────────────────────────────────────────────────────────────
// The canonical print-md author token is `@page-break` on its own line.
// Source: packages/cli/src/lib/markdown/markdown-it-paged.js line 13.

export function applyPageBreak(view: EditorView): void {
  const { from } = mainSel(view);
  const line = view.state.doc.lineAt(from);
  const insertAt = line.to;
  const insert = "\n\n@page-break\n\n";
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.cursor(insertAt + insert.length),
  });
}

// ── Table ─────────────────────────────────────────────────────────────────────

export function applyTable(view: EditorView, cols: number): void {
  const safeCols = Math.max(1, Math.min(10, cols));
  const { from } = mainSel(view);
  const line = view.state.doc.lineAt(from);

  const header = Array.from({ length: safeCols }, (_, i) => `Header ${i + 1}`);
  const sep = Array.from({ length: safeCols }, () => "------");
  const row = Array.from({ length: safeCols }, () => "Cell");

  const headerRow = "| " + header.join(" | ") + " |";
  const sepRow = "| " + sep.join(" | ") + " |";
  const dataRow = "| " + row.join(" | ") + " |";

  const insert = "\n\n" + [headerRow, sepRow, dataRow].join("\n") + "\n\n";
  const insertAt = line.to;
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert },
    selection: EditorSelection.cursor(insertAt + insert.length),
  });
}

// ── Image ─────────────────────────────────────────────────────────────────────
// Supported positioning classes come from the print-md user guide (ch03):
//   {.float-left}, {.float-right}, {.center}, {.full-width}, {.full-bleed}
// Width is via markdown-it-attrs: {width="300px"}.

export function applyImage(
  view: EditorView,
  src: string,
  alt: string,
  width?: string,
  position?: string,
): void {
  const { from } = mainSel(view);
  const line = view.state.doc.lineAt(from);

  const attrs: string[] = [];
  if (width) attrs.push(`width="${width}"`);
  if (position) attrs.push(`.${position}`);

  const attrStr = attrs.length > 0 ? `{${attrs.join(" ")}}` : "";
  const snippet = `\n\n![${alt}](${src})${attrStr}\n\n`;
  const insertAt = line.to;
  view.dispatch({
    changes: { from: insertAt, to: insertAt, insert: snippet },
    selection: EditorSelection.cursor(insertAt + snippet.length),
  });
}
