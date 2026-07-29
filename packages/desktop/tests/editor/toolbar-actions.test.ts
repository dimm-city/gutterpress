/**
 * toolbar-actions.test.ts (#31)
 *
 * Unit tests for the CodeMirror 6 toolbar action helpers. Tests work without a
 * browser DOM by operating directly on EditorState and applying transactions
 * through a thin wrapper that mimics EditorView.dispatch().
 */
import { test, expect } from "bun:test";
import { EditorState, EditorSelection, type Transaction } from "@codemirror/state";
import { createMarkdownRenderer } from "gutterpress/render";
import {
  applyBold,
  applyItalic,
  applyStrikethrough,
  applyInlineCode,
  applyLink,
  applyBlockquote,
  applyUnorderedList,
  applyOrderedList,
  applyHeading,
  applyHr,
  applyPageBreak,
  applyTable,
  applyImage,
  applyLayoutBlock,
  applyChapterBlock,
  applySectionBlock,
  applyTwoColumnBlock,
  applySpreadBlock,
  LAYOUT_BLOCK_ITEMS,
  TOOLBAR_ITEMS,
  visibleToolbarItems,
} from "../../src/lib/editor/toolbar-actions";
import type { EditorView } from "@codemirror/view";

// ── Minimal headless EditorView mock ─────────────────────────────────────────
// The toolbar-action functions accept an `EditorView` and call `.dispatch()`,
// `.state.doc`, and `.state.selection`. We mock that surface without a DOM.

function makeMockView(docStr: string, from = docStr.length, to = docStr.length): {
  state: EditorState;
  dispatch: (...specs: Parameters<EditorView["dispatch"]>) => void;
  focus: () => void;
} {
  let state = EditorState.create({
    doc: docStr,
    selection: EditorSelection.range(from, to),
  });

  const view = {
    get state() { return state; },
    dispatch(...specs: Array<Transaction | Parameters<EditorView["dispatch"]>[0]>) {
      for (const spec of specs) {
        if (spec && typeof spec === "object" && !("effects" in spec && Array.isArray((spec as Transaction).effects)) && "changes" in spec) {
          // TransactionSpec
          state = state.update(spec as Parameters<EditorState["update"]>[0]).state;
        } else if (spec && "state" in spec) {
          // Already a Transaction
          state = (spec as Transaction).state;
        } else {
          state = state.update(spec as Parameters<EditorState["update"]>[0]).state;
        }
      }
    },
    focus() {},
  };

  return view as unknown as typeof view;
}

function getDoc(view: ReturnType<typeof makeMockView>): string {
  return view.state.doc.toString();
}

function getSel(view: ReturnType<typeof makeMockView>): { from: number; to: number } {
  const m = view.state.selection.main;
  return { from: m.from, to: m.to };
}

// ── Bold ─────────────────────────────────────────────────────────────────────

test("applyBold: no selection inserts ** ** with cursor inside", () => {
  const v = makeMockView("hello ");
  applyBold(v as unknown as EditorView);
  expect(getDoc(v)).toBe("hello ****");
  expect(getSel(v)).toEqual({ from: 8, to: 8 });
});

test("applyBold: wraps selection", () => {
  const v = makeMockView("hello world", 6, 11);
  applyBold(v as unknown as EditorView);
  expect(getDoc(v)).toBe("hello **world**");
  expect(getSel(v)).toEqual({ from: 8, to: 13 });
});

test("applyBold: unwraps already-bold text", () => {
  const v = makeMockView("**world**", 2, 7);
  applyBold(v as unknown as EditorView);
  expect(getDoc(v)).toBe("world");
});

// ── Italic ────────────────────────────────────────────────────────────────────

test("applyItalic: wraps selection with underscores", () => {
  const v = makeMockView("hello world", 6, 11);
  applyItalic(v as unknown as EditorView);
  expect(getDoc(v)).toBe("hello _world_");
});

test("applyItalic: no selection inserts _ _ with cursor inside", () => {
  const v = makeMockView("x ");
  applyItalic(v as unknown as EditorView);
  expect(getDoc(v)).toBe("x __");
  expect(getSel(v)).toEqual({ from: 3, to: 3 });
});

// ── Strikethrough ─────────────────────────────────────────────────────────────

test("applyStrikethrough: wraps selection", () => {
  const v = makeMockView("old text", 0, 8);
  applyStrikethrough(v as unknown as EditorView);
  expect(getDoc(v)).toBe("~~old text~~");
});

// ── Inline code ───────────────────────────────────────────────────────────────

test("applyInlineCode: wraps selection", () => {
  const v = makeMockView("type console.log here", 5, 16);
  applyInlineCode(v as unknown as EditorView);
  expect(getDoc(v)).toBe("type `console.log` here");
});

test("applyInlineCode: no selection inserts backticks", () => {
  const v = makeMockView("");
  applyInlineCode(v as unknown as EditorView);
  expect(getDoc(v)).toBe("``");
  expect(getSel(v)).toEqual({ from: 1, to: 1 });
});

// ── Link ─────────────────────────────────────────────────────────────────────

test("applyLink: selection becomes link text", () => {
  const v = makeMockView("click here to continue", 6, 10);
  applyLink(v as unknown as EditorView);
  expect(getDoc(v)).toBe("click [here](url) to continue");
  // Cursor should select "url".
  expect(getSel(v)).toEqual({ from: 13, to: 16 });
});

test("applyLink: no selection inserts template", () => {
  const v = makeMockView("");
  applyLink(v as unknown as EditorView);
  expect(getDoc(v)).toBe("[link text](url)");
  // "link text" is selected.
  expect(getSel(v)).toEqual({ from: 1, to: 10 });
});

// ── Blockquote ───────────────────────────────────────────────────────────────

test("applyBlockquote: adds > prefix to current line", () => {
  const v = makeMockView("some text", 0, 0);
  applyBlockquote(v as unknown as EditorView);
  expect(getDoc(v)).toBe("> some text");
});

test("applyBlockquote: removes > prefix when already quoted", () => {
  const v = makeMockView("> some text", 0, 0);
  applyBlockquote(v as unknown as EditorView);
  expect(getDoc(v)).toBe("some text");
});

// ── Unordered list ────────────────────────────────────────────────────────────

test("applyUnorderedList: adds - prefix", () => {
  const v = makeMockView("item one");
  applyUnorderedList(v as unknown as EditorView);
  expect(getDoc(v)).toBe("- item one");
});

test("applyUnorderedList: removes - prefix when already listed", () => {
  const v = makeMockView("- item one");
  applyUnorderedList(v as unknown as EditorView);
  expect(getDoc(v)).toBe("item one");
});

// ── Ordered list ─────────────────────────────────────────────────────────────

test("applyOrderedList: adds numbered prefix", () => {
  const v = makeMockView("first item");
  applyOrderedList(v as unknown as EditorView);
  expect(getDoc(v)).toBe("1. first item");
});

// ── Heading ───────────────────────────────────────────────────────────────────

test("applyHeading: inserts H2 prefix", () => {
  const v = makeMockView("Chapter title");
  applyHeading(v as unknown as EditorView, 2);
  expect(getDoc(v)).toBe("## Chapter title");
});

test("applyHeading: replaces existing heading level", () => {
  const v = makeMockView("## Old heading");
  applyHeading(v as unknown as EditorView, 3);
  expect(getDoc(v)).toBe("### Old heading");
});

test("applyHeading: removes heading when same level applied", () => {
  const v = makeMockView("## Same level");
  applyHeading(v as unknown as EditorView, 2);
  expect(getDoc(v)).toBe("Same level");
});

test("applyHeading: inserts H1 prefix", () => {
  const v = makeMockView("Title");
  applyHeading(v as unknown as EditorView, 1);
  expect(getDoc(v)).toBe("# Title");
});

test("applyHeading: inserts H4 prefix", () => {
  const v = makeMockView("Sub");
  applyHeading(v as unknown as EditorView, 4);
  expect(getDoc(v)).toBe("#### Sub");
});

// ── Horizontal rule ───────────────────────────────────────────────────────────

test("applyHr: inserts --- after current line", () => {
  const v = makeMockView("paragraph text");
  applyHr(v as unknown as EditorView);
  expect(getDoc(v)).toContain("paragraph text\n\n---\n\n");
});

// ── Page break ───────────────────────────────────────────────────────────────

test("applyPageBreak: inserts @page-break after current line", () => {
  const v = makeMockView("end of section");
  applyPageBreak(v as unknown as EditorView);
  expect(getDoc(v)).toBe("end of section\n\n@page-break\n\n");
});

test("applyPageBreak: uses correct canonical token", () => {
  const v = makeMockView("x");
  applyPageBreak(v as unknown as EditorView);
  // Must be exactly @page-break (not @break, not page-break, not @@page-break)
  expect(getDoc(v)).toContain("@page-break");
  expect(getDoc(v)).not.toMatch(/@break\n/);
});

// ── Table ─────────────────────────────────────────────────────────────────────

test("applyTable: inserts a table with the given column count", () => {
  const v = makeMockView("before");
  applyTable(v as unknown as EditorView, 2);
  const result = getDoc(v);
  expect(result).toContain("| Header 1 | Header 2 |");
  expect(result).toContain("| ------ | ------ |");
  expect(result).toContain("| Cell | Cell |");
});

test("applyTable: clamps columns minimum to 1", () => {
  const v = makeMockView("");
  applyTable(v as unknown as EditorView, 0);
  expect(getDoc(v)).toContain("| Header 1 |");
});

test("applyTable: clamps columns maximum to 10", () => {
  const v = makeMockView("");
  applyTable(v as unknown as EditorView, 99);
  const rows = getDoc(v).split("\n");
  const headerRow = rows.find((r) => r.includes("Header"));
  // Pipe count minus one = number of columns
  const colCount = (headerRow?.match(/\|/g) ?? []).length - 1;
  expect(colCount).toBeLessThanOrEqual(10);
});

// ── Image ─────────────────────────────────────────────────────────────────────

test("applyImage: inserts basic image markdown", () => {
  const v = makeMockView("text");
  applyImage(v as unknown as EditorView, "assets/photo.jpg", "A photo");
  expect(getDoc(v)).toContain("![A photo](assets/photo.jpg)");
});

test("applyImage: includes width attribute when provided", () => {
  const v = makeMockView("text");
  applyImage(v as unknown as EditorView, "assets/wide.png", "Wide image", "80%");
  expect(getDoc(v)).toContain('![Wide image](assets/wide.png){width="80%"}');
});

test("applyImage: includes position class when provided", () => {
  const v = makeMockView("text");
  applyImage(v as unknown as EditorView, "assets/left.jpg", "Left float", undefined, "float-left");
  expect(getDoc(v)).toContain("![Left float](assets/left.jpg){.float-left}");
});

test("applyImage: includes both width and position", () => {
  const v = makeMockView("text");
  applyImage(v as unknown as EditorView, "assets/img.jpg", "Img", "300px", "center");
  expect(getDoc(v)).toContain('![Img](assets/img.jpg){width="300px" .center}');
});

test("applyImage: no attrs when neither width nor position given", () => {
  const v = makeMockView("text");
  applyImage(v as unknown as EditorView, "assets/img.jpg", "Plain");
  expect(getDoc(v)).toContain("![Plain](assets/img.jpg)\n");
  expect(getDoc(v)).not.toContain("{");
});

// ── L6: empty-selection toggle must not pile up marker debris ───────────────
// Repeated Ctrl+B (or Ctrl+I / Ctrl+Shift+X / Ctrl+`) on an empty selection
// used to insert a brand-new marker pair every time instead of noticing the
// cursor already sits directly between an existing pair, so pressing Bold
// twice on an empty document produced "****" -> "******" instead of toggling
// back off.

test("applyBold: toggling twice on an empty selection does not pile up marker debris", () => {
  const v = makeMockView("");
  applyBold(v as unknown as EditorView);
  expect(getDoc(v)).toBe("****");
  applyBold(v as unknown as EditorView);
  expect(getDoc(v)).toBe("");
  expect(getSel(v)).toEqual({ from: 0, to: 0 });
});

test("applyBold: empty selection sitting between existing ** markers removes them", () => {
  // "abc" + "**" + "**" + "def" with the cursor collapsed exactly between the
  // two marker pairs (position 5).
  const v = makeMockView("abc****def", 5, 5);
  applyBold(v as unknown as EditorView);
  expect(getDoc(v)).toBe("abcdef");
  expect(getSel(v)).toEqual({ from: 3, to: 3 });
});

test("applyItalic: toggling twice on an empty selection does not pile up marker debris", () => {
  const v = makeMockView("");
  applyItalic(v as unknown as EditorView);
  expect(getDoc(v)).toBe("__");
  applyItalic(v as unknown as EditorView);
  expect(getDoc(v)).toBe("");
});

test("applyBold: empty selection NOT between markers still inserts a fresh pair", () => {
  const v = makeMockView("hello", 5, 5);
  applyBold(v as unknown as EditorView);
  expect(getDoc(v)).toBe("hello****");
});

// ── M23: toolbar/More-menu share one declarative item array ─────────────────
// The main toolbar groups and the narrow-width More menu must render from the
// exact same filtered item list so an item can never exist in one surface and
// not the other (the bug: Save and Snippet were hand-omitted from the old
// hand-duplicated More menu list).

test("visibleToolbarItems: includes save and desktop-only items when both flags are true", () => {
  const items = visibleToolbarItems({ hasSave: true, desktop: true });
  expect(items.some((i) => i.id === "save")).toBe(true);
  expect(items.some((i) => i.id === "snippet")).toBe(true);
  expect(items.some((i) => i.id === "image")).toBe(true);
});

test("visibleToolbarItems: drops save item when hasSave is false", () => {
  const items = visibleToolbarItems({ hasSave: false, desktop: true });
  expect(items.some((i) => i.id === "save")).toBe(false);
});

test("visibleToolbarItems: drops desktop-only items (image, snippet) when desktop is false", () => {
  const items = visibleToolbarItems({ hasSave: true, desktop: false });
  expect(items.some((i) => i.id === "image")).toBe(false);
  expect(items.some((i) => i.id === "snippet")).toBe(false);
  // Non-desktop-only items are unaffected.
  expect(items.some((i) => i.id === "bold")).toBe(true);
});

test("visibleToolbarItems: every visible item belongs to exactly one known group (no orphans dropped from the More menu)", () => {
  const items = visibleToolbarItems({ hasSave: true, desktop: true });
  const groups = ["save", "primary", "block", "insert"];
  for (const item of items) {
    expect(groups).toContain(item.group);
  }
  // The same array (filtered per-group for the toolbar, unfiltered for the
  // More menu) must account for every visible item exactly once.
  const total = groups
    .map((g) => items.filter((i) => i.group === g).length)
    .reduce((a, b) => a + b, 0);
  expect(total).toBe(items.length);
});

test("TOOLBAR_ITEMS: declares Save and Snippet exactly once each (the drift this array prevents)", () => {
  expect(TOOLBAR_ITEMS.filter((i) => i.id === "save")).toHaveLength(1);
  expect(TOOLBAR_ITEMS.filter((i) => i.id === "snippet")).toHaveLength(1);
});

// ── M26: "Insert layout block" picker ────────────────────────────────────────
// A small picker offering Chapter / Section / Two columns / Page break /
// Spread, inserting the correct core `@marker` skeleton at the cursor. Each
// helper is block-level (operates on the current line, blank-line padded —
// same convention as applyHr/applyPageBreak above), not the inline
// completion-popup insertion in marker-completions.ts.

test("LAYOUT_BLOCK_ITEMS: offers exactly Chapter / Section / Two columns / Page break / Spread", () => {
  const kinds = LAYOUT_BLOCK_ITEMS.map((i) => i.kind);
  expect(kinds).toEqual(["chapter", "section", "two-column", "page-break", "spread"]);
  for (const item of LAYOUT_BLOCK_ITEMS) {
    expect(item.label.length).toBeGreaterThan(0);
  }
});

test("applyChapterBlock: inserts @chapter with a QUOTED, selected title placeholder, plus a nested @page", () => {
  const v = makeMockView("intro");
  applyChapterBlock(v as unknown as EditorView);
  const doc = getDoc(v);
  // Quoting is load-bearing — see applyChapterBlock's doc comment and the
  // round-trip test below. An unquoted multi-word label silently loses
  // data-chapter-label / .chapter-opener.
  expect(doc).toBe('intro\n\n@chapter "Chapter Title"\n\n@page\n\n');
  const sel = getSel(v);
  // Selection covers the label only, not the surrounding quotes.
  expect(v.state.sliceDoc(sel.from, sel.to)).toBe("Chapter Title");
});

test("applyChapterBlock: the produced block renders data-chapter-label + .chapter-opener through the real plugin", () => {
  const v = makeMockView("intro");
  applyChapterBlock(v as unknown as EditorView);
  const doc = getDoc(v);

  const md = createMarkdownRenderer();
  const html = md.render(doc);

  expect(html).toContain('data-chapter-label="Chapter Title"');
  expect(html).toContain('class="chapter-opener"');
  // Must NOT regress to the broken junk-class form.
  expect(html).not.toContain('class="chapter Chapter Title"');
});

test("applySectionBlock: inserts the @section/@end-section pair with cursor on the blank line between", () => {
  const v = makeMockView("stats");
  applySectionBlock(v as unknown as EditorView);
  const doc = getDoc(v);
  expect(doc).toBe("stats\n\n@section\n\n@end-section\n\n");
  const sel = getSel(v);
  expect(sel.from).toBe(sel.to);
  expect(v.state.doc.lineAt(sel.from).text).toBe("");
});

test("applyTwoColumnBlock: uses .col-split (not bare .two-column) so @column-break actually breaks under Paged.js", () => {
  const v = makeMockView("before");
  applyTwoColumnBlock(v as unknown as EditorView);
  const doc = getDoc(v);
  expect(doc).toContain("@section .col-split");
  expect(doc).toContain("@column-break");
  expect(doc).toContain("@end-section");
  // Marker order: section open, column-break, section close.
  expect(doc.indexOf("@section .col-split")).toBeLessThan(doc.indexOf("@column-break"));
  expect(doc.indexOf("@column-break")).toBeLessThan(doc.lastIndexOf("@end-section"));
});

test("applySpreadBlock: inserts @spread with a nested @page", () => {
  const v = makeMockView("x");
  applySpreadBlock(v as unknown as EditorView);
  const doc = getDoc(v);
  expect(doc).toBe("x\n\n@spread\n\n@page\n\n");
});

test("applyLayoutBlock: dispatches to the right helper for each kind", () => {
  for (const kind of ["chapter", "section", "two-column", "page-break", "spread"] as const) {
    const v = makeMockView("content");
    applyLayoutBlock(v as unknown as EditorView, kind);
    const doc = getDoc(v);
    expect(doc.length).toBeGreaterThan("content".length);
  }
});

test("applyLayoutBlock('page-break') reuses the canonical @page-break token", () => {
  const v = makeMockView("content");
  applyLayoutBlock(v as unknown as EditorView, "page-break");
  expect(getDoc(v)).toBe("content\n\n@page-break\n\n");
});

test("TOOLBAR_ITEMS: declares an insert-layout-block control in the insert group", () => {
  const item = TOOLBAR_ITEMS.find((i) => i.id === "layout-block");
  expect(item).toBeDefined();
  expect(item?.group).toBe("insert");
});

// ── M26: image dialog Position must offer .full-bleed (documented but missing) ─

test("toolbar-actions.ts documents .full-bleed as a supported image position class", () => {
  const v = makeMockView("text");
  applyImage(v as unknown as EditorView, "assets/cover.jpg", "Cover", undefined, "full-bleed");
  expect(getDoc(v)).toContain("![Cover](assets/cover.jpg){.full-bleed}");
});
