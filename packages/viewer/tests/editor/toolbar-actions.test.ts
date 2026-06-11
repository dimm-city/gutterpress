/**
 * toolbar-actions.test.ts (#31)
 *
 * Unit tests for the CodeMirror 6 toolbar action helpers. Tests work without a
 * browser DOM by operating directly on EditorState and applying transactions
 * through a thin wrapper that mimics EditorView.dispatch().
 */
import { test, expect } from "bun:test";
import { EditorState, EditorSelection, type Transaction } from "@codemirror/state";
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
