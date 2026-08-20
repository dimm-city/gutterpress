import { createMarkdownRenderer } from "gutterpress/render";
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { Window } from "happy-dom";
import { undo } from "prosemirror-history";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { blockAtDom, blockPosFor } from "../../src/lib/editor/rich-drag-handle";
import type {
  RichToolbarAction,
  ToolbarPayloadLike,
} from "../../src/lib/editor/rich-commands";
import {
  createEditorState,
  mountRichEditor,
  type ChromeState,
  type MountOptions,
} from "../../src/lib/editor/rich-editor";
import { createEditorRenderer, gutterpressSchema, serializeDoc } from "../../src/lib/editor/markdown-doc";
import {
  lineForPos,
  lineTable,
  posForLine,
  resetLineTableCache,
} from "../../src/lib/editor/rich-lines";

/**
 * The editing surface, headless.
 *
 * DOM is happy-dom (the harness `tests/platform/dialog.test.ts` uses). It does
 * no layout, so nothing here asserts geometry — pagination is CSS and is
 * covered by the engine's `live-document.test.ts` and the reasoning recorded in `engine/viewer/live-document.ts`'s
 * header.
 *
 * The property these tests exist for is the one the postmortem lost: an edit
 * must land in the author's file as the author's markdown, and the surface
 * must never be able to write back something the pipeline generated.
 */
const md = createEditorRenderer();

/**
 * ProseMirror's `EditorView` reads the globals directly — `window` for its
 * `MutationObserver` and `document` when building nodes — so a happy-dom
 * Window has to be installed globally for the duration of a test rather than
 * only passed in.
 */
function editor(
  content: string,
  onChange?: (s: string) => void,
  opts?: Pick<MountOptions, "onChrome" | "onAnchorLine">,
) {
  const win = new Window();
  const g = globalThis as unknown as Record<string, unknown>;
  const prior = { window: g.window, document: g.document };
  g.window = win;
  g.document = win.document;

  const doc = win.document as unknown as Document;
  const mount = doc.createElement("div");
  doc.body.appendChild(mount);
  const handle = mountRichEditor({ mount, md, content, onChange, ...opts });
  return {
    handle,
    mount,
    doc,
    win: win as unknown as Record<string, new (type: string, init?: unknown) => Event>,
    restore() {
      handle.destroy();
      g.window = prior.window;
      g.document = prior.document;
    },
  };
}

describe("document model wiring", () => {
  test("a mounted editor round-trips its content unchanged", () => {
    const src = "# Title\n\nSome **bold** and `code`.\n";
    const e = editor(src);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("onChange emits canonical markdown, not HTML or a doc", () => {
    const seen: string[] = [];
    const e = editor("Hello\n", (s) => seen.push(s));
    const { view } = e.handle;
    // Type " world" at the end of the paragraph.
    view.dispatch(view.state.tr.insertText(" world", view.state.doc.content.size - 1));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe("Hello world\n");
    e.restore();
  });

  test("onChange does NOT fire for a selection-only transaction", () => {
    const seen: string[] = [];
    const e = editor("Hello\n", (s) => seen.push(s));
    const { view } = e.handle;
    view.dispatch(view.state.tr.setMeta("pointer", true));
    expect(seen).toEqual([]);
    e.restore();
  });

  test("setContent replaces the document for a file switch", () => {
    const e = editor("# One\n");
    e.handle.setContent("# Two\n");
    expect(e.handle.getMarkdown()).toBe("# Two\n");
    e.restore();
  });

  test("setContent is not undoable back into the previous FILE", () => {
    // Undo crossing a file switch would write one chapter's text into another
    // — silently, and into a file the author is not looking at.
    const e = editor("# One\n");
    e.handle.setContent("# Two\n");
    const { view } = e.handle;
    expect(undo(view.state, view.dispatch)).toBe(false);
    expect(e.handle.getMarkdown()).toBe("# Two\n");
    e.restore();
  });

  test("an ordinary edit IS undoable", () => {
    // The guard above must come from a fresh history, not from history being
    // broken.
    const e = editor("Hello\n");
    const { view } = e.handle;
    view.dispatch(view.state.tr.insertText("!", view.state.doc.content.size - 1));
    expect(e.handle.getMarkdown()).toBe("Hello!\n");
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(e.handle.getMarkdown()).toBe("Hello\n");
    e.restore();
  });
});

describe("Gutterpress markers survive the surface", () => {
  test("layout markers round-trip verbatim", () => {
    const src = "@chapter Introduction\n\n@page .wide\n\nHello\n\n@page-break\n";
    const e = editor(src);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("a marker's classes reach the DOM so book CSS applies", () => {
    // This is what makes the editor look like the print output: the book
    // styles `.page` and the author's own `.wide`, and the editing view must
    // emit both.
    const e = editor("@page .wide\n\nHello\n");
    expect(e.mount.innerHTML).toContain("page wide");
    e.restore();
  });

  test("editing inside a marker does not disturb the marker line", () => {
    const src = "@page .wide\n\nHello\n";
    const e = editor(src);
    const { view } = e.handle;
    view.dispatch(view.state.tr.insertText("!", view.state.doc.content.size - 2));
    expect(e.handle.getMarkdown()).toBe("@page .wide\n\nHello!\n");
    e.restore();
  });
});

describe("generated content is the PIPELINE's, shown but never saved", () => {
  /**
   * What the PRINT path emits for this source — the authority the editor is
   * being held to. A separate instance on purpose: asserting against the
   * editor's own renderer would prove only that it agrees with itself.
   */
  const printRenderer = createMarkdownRenderer();
  const printed = (src: string) => printRenderer.render(src, {});

  test("the chapter opener is shown exactly when print emits one", () => {
    // `markers.js` injects the opener for a labelled chapter that opens a
    // `@page` — not for every labelled chapter. The editor used to apply the
    // looser rule from its own copy of it, so on a book whose chapters carry
    // no `@page` it invented an opener, showed the label as stray body text,
    // and pushed the chapter's own heading onto a second page. Measured on a
    // digest-format book; this pair is that bug.
    const withPage = "@chapter \"C.01\"\n\n@page\n\nBody text.\n";
    expect(printed(withPage)).toContain("chapter-opener");
    const shown = editor(withPage);
    expect(shown.mount.innerHTML).toContain("chapter-opener");
    expect(shown.mount.innerHTML).toContain("C.01");
    shown.restore();

    const noPage = "@chapter Introduction\n\nBody text.\n";
    expect(printed(noPage)).not.toContain("chapter-opener");
    const absent = editor(noPage);
    expect(absent.mount.innerHTML).not.toContain("chapter-opener");
    absent.restore();
  });

  test("it can never be written back to the file", () => {
    // The postmortem's failure mode was generated content becoming authored
    // content on save. `gp_generated` serializes to NOTHING, so there is no
    // path from it to the file — and the source round-trips unchanged.
    const src = "@chapter \"C.01\"\n\n@page\n\nBody text.\n";
    const e = editor(src);
    expect(e.mount.innerHTML).toContain("chapter-opener");
    expect(e.handle.getMarkdown()).toBe(src);
    expect(e.handle.getMarkdown()).not.toContain("chapter-opener");
    e.restore();
  });

  test("it is not editable content — the author cannot type into it", () => {
    const e = editor("@chapter \"C.01\"\n\n@page\n\nBody.\n");
    const el = e.mount.querySelector(".chapter-opener")?.closest("[contenteditable]");
    expect(el?.getAttribute("contenteditable")).toBe("false");
    e.restore();
  });
});

describe("raw HTML", () => {
  test("is carried verbatim rather than reinterpreted", () => {
    const src = '<div class="custom">\n  <span>raw</span>\n</div>\n';
    const e = editor(src);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });
});

describe("editor state", () => {
  test("createEditorState needs no DOM", () => {
    // Keeps the state layer testable and the component shell thin.
    const state = createEditorState(md, "# Hi\n");
    expect(state.doc.firstChild?.type.name).toBe("heading");
  });

  test("the surface carries history, input rules and a keymap", () => {
    const state = createEditorState(md, "x\n");
    // 6 plugins: keymap, baseKeymap, inputRules, history, dropCursor,
    // gapCursor. (The generated-content decoration plugin is gone: generated
    // markup is a document node the pipeline placed, not a widget this layer
    // re-derives — see the generated-content suite above.)
    expect(state.plugins.length).toBe(6);
  });
});

describe("toolbar actions", () => {
  /** Apply an action to `src` with the caret in the first block, return markdown. */
  function act(src: string, action: RichToolbarAction, payload?: ToolbarPayloadLike) {
    const e = editor(src);
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)));
    const applied = e.handle.runToolbarAction(action, payload);
    const out = e.handle.getMarkdown();
    e.restore();
    return { applied, out };
  }

  test("block actions produce the expected markdown", () => {
    expect(act("plain\n", "heading", { level: 2 }).out).toBe("## plain\n");
    expect(act("plain\n", "blockquote").out).toBe("> plain\n");
    expect(act("plain\n", "ul").out).toBe("* plain\n");
    expect(act("plain\n", "ol").out).toBe("1. plain\n");
  });

  test("heading toggles back to a paragraph at the same level", () => {
    // Matches the CodeMirror behaviour, so the button feels the same in both.
    expect(act("## already\n", "heading", { level: 2 }).out).toBe("already\n");
  });

  test("layout blocks emit real markers that round-trip", () => {
    const chapter = act("x\n", "layout-block", { kind: "chapter" }).out;
    expect(chapter).toContain('@chapter "Chapter Title"');
    expect(chapter).toContain("@page");

    const section = act("x\n", "layout-block", { kind: "section" }).out;
    expect(section).toContain("@section");
    expect(section).toContain("@end-section");

    const twoCol = act("x\n", "layout-block", { kind: "two-column" }).out;
    expect(twoCol).toContain("@section .gp-columns-2");
    expect(twoCol).toContain("@column-break");

    expect(act("x\n", "page-break").out).toContain("@page-break");
  });

  test("an inserted table keeps its structure", () => {
    const out = act("x\n", "table", { cols: 3 }).out;
    expect(out).toContain("| Header 1 | Header 2 | Header 3 |");
    expect(out).toContain("| Cell | Cell | Cell |");
  });

  test("image classes are built by the SAME code as source mode", () => {
    // buildImageAttrsString() is shared with toolbar-actions.ts, so the two
    // modes cannot drift on what `.gp-right .gp-small` means.
    const out = act("x\n", "image", {
      src: "a.png", alt: "Art", position: "right", size: "small",
    }).out;
    expect(out).toContain("![Art](a.png)");
    expect(out).toContain(".gp-right");
    expect(out).toContain(".gp-small");
  });

  test("an inserted width survives the save round-trip unquoted", () => {
    // `setWidth` quotes its value (`width="30%"`). A hand-rolled attrs split
    // here used to keep those quotes in the stored value, so the serializer
    // re-quoted them: the file said `width="&quot;30%&quot;"`.
    const out = act("x\n", "image", { src: "a.png", alt: "Art", width: "30%" }).out;
    expect(out).toContain("width=30%");
    expect(out).not.toContain("&quot;");
  });

  test("strikethrough works, and the file stays rich-editable", () => {
    const e = editor("plain\n");
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    expect(e.handle.runToolbarAction("strikethrough")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("~~plain~~\n");
    e.restore();
  });

  test("an action whose payload is missing reports false rather than guessing", () => {
    const e = editor("x\n");
    expect(e.handle.runToolbarAction("image")).toBe(false);
    expect(e.handle.runToolbarAction("layout-block")).toBe(false);
    expect(e.handle.getMarkdown()).toBe("x\n");
    e.restore();
  });
});

describe("source-offset edits (CommitEngine)", () => {
  test("applies when the document matches the file on disk", () => {
    const src = "Hello world\n";
    const e = editor(src);
    expect(e.handle.canApplySourceOffsets(src)).toBe(true);
    expect(e.handle.applyRangeEdit(src, 6, 11, "there")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("Hello there\n");
    e.restore();
  });

  test("REFUSES when the document does not match the offsets' basis", () => {
    // The canonical form of `__one__` is `**one**`, so a project that has not
    // been normalized has offsets that point somewhere else. Writing anyway
    // would corrupt the file at a position the author never chose.
    const onDisk = "__one__\n";
    const e = editor(onDisk);
    expect(e.handle.canApplySourceOffsets(onDisk)).toBe(false);
    expect(e.handle.applyRangeEdit(onDisk, 2, 5, "two")).toBe(false);
    expect(e.handle.getMarkdown()).toBe("**one**\n");
    e.restore();
  });

  test("REFUSES out-of-bounds offsets", () => {
    const src = "Hello\n";
    const e = editor(src);
    expect(e.handle.applyRangeEdit(src, 0, 999, "x")).toBe(false);
    expect(e.handle.applyRangeEdit(src, -1, 2, "x")).toBe(false);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("an applied edit is undoable — it is one history step", () => {
    const src = "Hello world\n";
    const e = editor(src);
    e.handle.applyRangeEdit(src, 6, 11, "there");
    const { view } = e.handle;
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });
});

describe("selection and snippets", () => {
  test("getSelectionText returns the selected text", () => {
    const e = editor("Hello world\n");
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    expect(e.handle.getSelectionText()).toBe("Hello");
    e.restore();
  });

  test("getSelectionText is empty with no selection", () => {
    const e = editor("Hello\n");
    expect(e.handle.getSelectionText()).toBe("");
    e.restore();
  });

  test("insertSnippet inserts at the caret", () => {
    const e = editor("Hello\n");
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 6)));
    e.handle.insertSnippet("!!");
    expect(e.handle.getMarkdown()).toBe("Hello!!\n");
    e.restore();
  });
});

/**
 * Press a key through ProseMirror's own keymap dispatch.
 *
 * Calling the command directly would prove the command works and say nothing
 * about whether anything is BOUND to it — and the binding is the part that
 * makes the reorder reachable without a mouse, which is the requirement.
 *
 * Module scope because both spellings of the reorder are tested: the keymap
 * below, and the drag handle, which has to agree with it.
 */
function press(e: ReturnType<typeof editor>, key: string): boolean {
  const event = new (e.win.KeyboardEvent as unknown as new (
    t: string,
    i: Record<string, unknown>,
  ) => KeyboardEvent)("keydown", { key, altKey: true, bubbles: true });
  return e.handle.view.someProp("handleKeyDown", (f) => f(e.handle.view, event)) === true;
}

/** Put the caret in the block containing `text`. */
function caretIn(e: ReturnType<typeof editor>, text: string): void {
  const { view } = e.handle;
  let found = -1;
  view.state.doc.descendants((node, pos) => {
    if (found === -1 && node.isTextblock && node.textContent === text) found = pos + 1;
    return found === -1;
  });
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, found)));
}

describe("moving blocks (the drag handle's keyboard equivalent)", () => {
  test("Alt-ArrowDown moves a block below its sibling", () => {
    const e = editor("Alpha\n\nBravo\n\nCharlie\n");
    caretIn(e, "Alpha");
    expect(press(e, "ArrowDown")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("Bravo\n\nAlpha\n\nCharlie\n");
    e.restore();
  });

  test("Alt-ArrowUp moves a block above its sibling", () => {
    const e = editor("Alpha\n\nBravo\n\nCharlie\n");
    caretIn(e, "Charlie");
    expect(press(e, "ArrowUp")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("Alpha\n\nCharlie\n\nBravo\n");
    e.restore();
  });

  test("the caret travels with the block, so a second press moves the same one", () => {
    const e = editor("Alpha\n\nBravo\n\nCharlie\n");
    caretIn(e, "Charlie");
    press(e, "ArrowUp");
    press(e, "ArrowUp");
    expect(e.handle.getMarkdown()).toBe("Charlie\n\nAlpha\n\nBravo\n");
    e.restore();
  });

  test("undo restores the original order", () => {
    const src = "Alpha\n\nBravo\n";
    const e = editor(src);
    caretIn(e, "Alpha");
    press(e, "ArrowDown");
    expect(e.handle.getMarkdown()).toBe("Bravo\n\nAlpha\n");
    const { view } = e.handle;
    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("the edge of the document reports false rather than swallowing the key", () => {
    // A command that returns true without doing anything would eat the key for
    // whatever binding comes after it.
    const e = editor("Alpha\n\nBravo\n");
    caretIn(e, "Alpha");
    expect(press(e, "ArrowUp")).toBe(false);
    expect(e.handle.getMarkdown()).toBe("Alpha\n\nBravo\n");
    e.restore();
  });

  test("a block moves WITHIN its marker, and the marker line is untouched", () => {
    const src = "@section .gp-columns-2\n\nOne\n\nTwo\n\n@end-section\n";
    const e = editor(src);
    caretIn(e, "One");
    expect(press(e, "ArrowDown")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("@section .gp-columns-2\n\nTwo\n\nOne\n\n@end-section\n");
    e.restore();
  });

  test("a list item moves, not the paragraph that is its only child", () => {
    // The search starts at the caret's own block and walks OUTWARD until it
    // finds a depth with a sibling to swap with — so the useful thing moves
    // without a special case for lists.
    const e = editor("* one\n* two\n* three\n");
    caretIn(e, "one");
    expect(press(e, "ArrowDown")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("* two\n* one\n* three\n");
    e.restore();
  });

  test("inside a table the whole TABLE moves — cells are not authored order", () => {
    const src = "Before\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n";
    const e = editor(src);
    caretIn(e, "1");
    expect(press(e, "ArrowUp")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("| A | B |\n| --- | --- |\n| 1 | 2 |\n\nBefore\n");
    e.restore();
  });

  test("a selection spanning two blocks refuses rather than moving one of them", () => {
    const src = "Alpha\n\nBravo\n\nCharlie\n";
    const e = editor(src);
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 3, 10)));
    expect(press(e, "ArrowDown")).toBe(false);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });
});

describe("the block drag handle", () => {
  /** The chrome the handle mounts into the FRAME's body. */
  function grip(e: ReturnType<typeof editor>): HTMLElement {
    return e.doc.body.querySelector(".gp-drag-handle") as HTMLElement;
  }

  /** Move the pointer over `el`, which is how the handle chooses its block. */
  function hover(e: ReturnType<typeof editor>, el: Element): void {
    el.dispatchEvent(
      new (e.win.MouseEvent as unknown as new (t: string, i: Record<string, unknown>) => Event)(
        "mousemove",
        { bubbles: true },
      ),
    );
  }

  /** A drag event carrying a real DataTransfer (happy-dom's init dict drops it). */
  function dragEvent(e: ReturnType<typeof editor>, type: string): Event {
    const win = e.win as unknown as Record<string, new (...a: unknown[]) => unknown>;
    const event = new (win.DragEvent as unknown as new (
      t: string,
      i: Record<string, unknown>,
    ) => Event)(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", {
      value: new win.DataTransfer!(),
      configurable: true,
    });
    return event;
  }

  test("the grip lives in the frame body — never in the document, never in the flow", () => {
    // The correctness constraint this whole design turns on: an affordance
    // that were a ProseMirror node would be written into the author's .md by
    // the serializer, and one inside `view.dom` would be reverted by
    // DOMObserver. It is a sibling of the editable root, so it is neither.
    const src = "@page .wide\n\nHello\n";
    const e = editor(src);
    expect(grip(e)).not.toBeNull();
    expect(e.mount.contains(grip(e))).toBe(false);
    expect(e.mount.innerHTML).not.toContain("gp-drag-handle");
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("destroying the editor takes its chrome with it", () => {
    const e = editor("Hello\n");
    expect(grip(e)).not.toBeNull();
    e.restore();
    expect(e.doc.body.querySelector(".gp-drag-handle")).toBeNull();
  });

  test("hovering a block resolves it, including nested and generated content", () => {
    // `After` gives the section a sibling of its own, so the pointer can
    // resolve the section as well as the paragraphs inside it.
    const e = editor("@section\n\nOne\n\nTwo\n\n@end-section\n\nAfter\n");
    const { view } = e.handle;
    const section = e.mount.firstElementChild as HTMLElement;
    const para = section.firstElementChild as HTMLElement;

    // The nested paragraph, not the section that wraps it: the handle grabs
    // whatever is directly under the pointer.
    expect(blockAtDom(view, para)?.pos).toBe(1);
    expect(view.state.doc.nodeAt(blockAtDom(view, para)!.pos)?.type.name).toBe("paragraph");
    // A text node inside it resolves the same way — the walk goes upward.
    expect(blockAtDom(view, para.firstChild)?.el).toBe(para);
    // The section itself, when the pointer is on its own box.
    expect(blockAtDom(view, section)?.pos).toBe(0);
    e.restore();
  });

  test("a table's internals offer no grip, but the table does", () => {
    // `Before` gives the table a sibling to be reordered among; without one
    // there is nowhere for it to go and no grip is offered at all (see the
    // agreement test below).
    const e = editor("Before\n\n| A |\n| --- |\n| 1 |\n");
    const { view } = e.handle;
    const table = e.mount.querySelector("table") as HTMLElement;
    const cell = e.mount.querySelector("td") as HTMLElement;
    expect(view.state.doc.nodeAt(blockAtDom(view, table)!.pos)?.type.name).toBe("table");
    // Walking up from a cell skips every table-internal parent and lands on
    // the table — the same answer the keyboard command gives.
    expect(blockAtDom(view, cell)?.el).toBe(table);
    e.restore();
  });

  test("the grip grabs the same block Alt+Arrow moves — including in a list", () => {
    // The divergence this pins: `reordersChildren(list_item)` is true, so a
    // handle that asked only that question stopped at the PARAGRAPH inside the
    // bullet and offered to drag it out of its own list item, while Alt+Arrow
    // at the same caret moved the whole item. `isReorderable()` is the
    // command's entire search condition, so both now stop at the same depth.
    const e = editor("* one\n* two\n* three\n");
    const { view } = e.handle;
    const item = e.mount.querySelectorAll("li")[1] as HTMLElement;
    const para = item.firstElementChild as HTMLElement;

    const found = blockAtDom(view, para)!;
    expect(view.state.doc.nodeAt(found.pos)?.type.name).toBe("list_item");
    expect(found.el).toBe(item);

    // And the keyboard, from a caret in that same paragraph, moves that item.
    caretIn(e, "two");
    expect(press(e, "ArrowUp")).toBe(true);
    expect(e.handle.getMarkdown()).toBe("* two\n* one\n* three\n");
    e.restore();
  });

  test("a block with nowhere to go offers no grip", () => {
    // Alt+Arrow returns false on the only block in the document, so a grip
    // beside it would be an affordance for an edit that cannot happen.
    const e = editor("| A |\n| --- |\n| 1 |\n");
    const table = e.mount.querySelector("table") as HTMLElement;
    expect(blockAtDom(e.handle.view, table)).toBeNull();
    caretIn(e, "1");
    expect(press(e, "ArrowUp")).toBe(false);
    e.restore();
  });

  test("the document's only top-level block offers no grip either", () => {
    // A chapter file that opens with `@page` and is never explicitly closed
    // parses as ONE top-level wrapper holding the whole file. Dragging that
    // would empty `doc` (`block+`), which PM refills with a paragraph before
    // re-inserting the slice — a stray blank line at the top of the author's
    // saved file. There is nowhere for it to go anyway.
    const e = editor("@page .wide\n\nAlpha\n\nBravo\n");
    const { view } = e.handle;
    expect(view.state.doc.childCount).toBe(1);
    expect(blockAtDom(view, e.mount.firstElementChild!)).toBeNull();
    // Its CHILDREN still move, among themselves.
    const alpha = e.mount.querySelector("p") as HTMLElement;
    expect(view.state.doc.nodeAt(blockAtDom(view, alpha)!.pos)?.type.name).toBe("paragraph");
    e.restore();
  });

  test("an element left over from the previous document resolves to nothing", () => {
    // `posAtDOM` reads the `pmViewDesc` ProseMirror hangs off the element, and
    // a detached one still carries a stale desc — so it answers from a tree
    // that no longer exists instead of refusing. Measured in Chromium 153:
    // this throws "Position -1 out of range", out of a mousemove listener.
    const e = editor("Alpha\n\nBravo\n");
    const stale = e.mount.lastElementChild as HTMLElement;
    e.handle.setContent("# Something else entirely\n");
    expect(() => blockPosFor(e.handle.view, stale)).not.toThrow();
    expect(blockPosFor(e.handle.view, stale)).toBeNull();
    expect(blockAtDom(e.handle.view, stale)).toBeNull();
    e.restore();
  });

  test("dragstart hands ProseMirror a slice and a node selection", () => {
    // This is what stops PM's drop handler from re-parsing the DataTransfer.
    // With `view.dragging` null it would rebuild the block from HTML — and the
    // layout nodes have no `parseDOM`, so an `@section` would come back as a
    // plain div AND the original would survive, i.e. a mangled duplicate.
    const e = editor("@section\n\nOne\n\n@end-section\n\nAfter\n");
    const { view } = e.handle;
    hover(e, e.mount.firstElementChild!);
    const event = dragEvent(e, "dragstart");
    grip(e).dispatchEvent(event);

    expect(view.dragging).not.toBeNull();
    expect(view.dragging!.move).toBe(true);
    expect(view.dragging!.slice.content.firstChild?.type.name).toBe("gp_section");
    // `copyMove`, the value prosemirror-view's own dragstart sets. A bare
    // `move` tells the user agent that the Ctrl/Option-modified copy the docs
    // promise is not permitted, and a drag the agent cannot resolve can end
    // with no drop event at all.
    expect((event as DragEvent).dataTransfer?.effectAllowed).toBe("copyMove");
    expect(view.state.selection).toBeInstanceOf(NodeSelection);
    // Starting a drag changes nothing on disk.
    expect(e.handle.getMarkdown()).toBe("@section\n\nOne\n\n@end-section\n\nAfter\n");
    e.restore();
  });

  test("a drag it cannot describe is refused outright", () => {
    // No hover means no block, so there is no slice to hand over. Cancelling
    // the drag is the only safe answer — see the test above for what a drag
    // with a null `view.dragging` does.
    const e = editor("Hello\n");
    const { view } = e.handle;
    const event = dragEvent(e, "dragstart");
    grip(e).dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(view.dragging).toBeNull();
    e.restore();
  });

  test("a completed drop reorders the file and nothing else", () => {
    // ProseMirror's own `editHandlers.drop` runs here — the module adds no
    // drop code of its own. Only the hit test is stubbed, because happy-dom
    // does no layout; everything downstream of it is upstream's.
    const e = editor("Alpha\n\nBravo\n\nCharlie\n");
    const { view } = e.handle;
    hover(e, e.mount.firstElementChild!);
    grip(e).dispatchEvent(dragEvent(e, "dragstart"));

    // Drop at the end of the document: pos 21 is after "Charlie".
    (view as unknown as { posAtCoords: () => { pos: number; inside: number } }).posAtCoords = () => ({
      pos: view.state.doc.content.size,
      inside: -1,
    });
    view.dom.dispatchEvent(dragEvent(e, "drop"));

    expect(e.handle.getMarkdown()).toBe("Bravo\n\nCharlie\n\nAlpha\n");
    // The grip is chrome, not content: it cannot have been carried along.
    expect(e.handle.getMarkdown()).not.toContain("gp-drag-handle");
    e.restore();
  });

  test("an undo puts a dropped block back where it was", () => {
    const src = "Alpha\n\nBravo\n\nCharlie\n";
    const e = editor(src);
    const { view } = e.handle;
    hover(e, e.mount.firstElementChild!);
    grip(e).dispatchEvent(dragEvent(e, "dragstart"));
    (view as unknown as { posAtCoords: () => { pos: number; inside: number } }).posAtCoords = () => ({
      pos: view.state.doc.content.size,
      inside: -1,
    });
    view.dom.dispatchEvent(dragEvent(e, "drop"));
    expect(e.handle.getMarkdown()).not.toBe(src);

    expect(undo(view.state, view.dispatch)).toBe(true);
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  /** Hover `el`, start a drag, and drop it at document position `pos`. */
  function dragTo(e: ReturnType<typeof editor>, el: Element, pos: number): void {
    const { view } = e.handle;
    hover(e, el);
    grip(e).dispatchEvent(dragEvent(e, "dragstart"));
    (view as unknown as { posAtCoords: () => { pos: number; inside: number } }).posAtCoords =
      () => ({ pos, inside: -1 });
    view.dom.dispatchEvent(dragEvent(e, "drop"));
  }

  /** The element whose whole text is `text`. */
  function elFor(e: ReturnType<typeof editor>, text: string): HTMLElement {
    for (const el of Array.from(e.mount.querySelectorAll("*"))) {
      if ((el as HTMLElement).textContent?.trim() === text) return el as HTMLElement;
    }
    throw new Error(`no element for ${text}`);
  }

  /**
   * A drop position a POINTER can actually produce: inside a textblock's text.
   *
   * `posAtCoords` is a binary search over text, so it never answers with a
   * boundary between two block nodes. An earlier version of these tests dropped
   * at exactly such a boundary and so certified a path no author could reach —
   * with the pointer drag completely dead for `@section`/`@page` wrappers, the
   * whole suite stayed green. `frac` says how far into the block the pointer
   * is, because the drop biases before/after the containing sibling at its
   * midpoint, the same way `dropPoint()` does.
   */
  function inText(e: ReturnType<typeof editor>, text: string, frac: number): number {
    let at = -1;
    e.handle.view.state.doc.descendants((node, pos) => {
      if (at < 0 && node.isTextblock && node.textContent === text) {
        at = pos + 1 + Math.round(frac * node.content.size);
      }
      return at < 0;
    });
    if (at < 0) throw new Error(`no textblock for ${text}`);
    return at;
  }

  test("a block dropped over another marker lands BESIDE it, not inside", () => {
    // The drag reorders among siblings, exactly as Alt+Arrow does. Upstream's
    // drop would insert at the deepest node under the pointer that can hold the
    // block — here, INSIDE the `@section` — which no keystroke can do and which
    // quietly changes which marker the author's text belongs to. So the drop is
    // re-targeted to the nearest slot in the block's own parent instead.
    const src = "Before\n\n@section .gp-columns-2\n\nInside\n\nAlso\n\n@end-section\n\nAfter\n";
    const e = editor(src);
    dragTo(e, elFor(e, "Before"), inText(e, "Also", 0.5));
    expect(e.handle.getMarkdown()).toBe(
      "@section .gp-columns-2\n\nInside\n\nAlso\n\n@end-section\n\nBefore\n\nAfter\n",
    );
    e.restore();
  });

  test("...and a block inside a marker cannot be dropped out of it", () => {
    const src = "Before\n\n@section .gp-columns-2\n\nInside\n\nAlso\n\n@end-section\n\nAfter\n";
    const e = editor(src);
    // `Inside` has a sibling, so the grip offers the PARAGRAPH; the drop point
    // is a top-level paragraph, whose parent is not the paragraph's.
    dragTo(e, elFor(e, "Inside"), inText(e, "After", 0.5));
    expect(e.handle.getMarkdown()).toBe(src);
    e.restore();
  });

  test("but it moves freely WITHIN its marker", () => {
    // The re-targeting above must not have cost the drag its actual job, and
    // the midpoint decides the direction: past the middle of a sibling puts the
    // block after it, before the middle puts it before — where it already was.
    const src = "Before\n\n@section\n\nOne\n\nTwo\n\n@end-section\n";
    const e = editor(src);
    dragTo(e, elFor(e, "One"), inText(e, "Two", 1));
    expect(e.handle.getMarkdown()).toBe("Before\n\n@section\n\nTwo\n\nOne\n\n@end-section\n");
    e.restore();

    const back = editor(src);
    dragTo(back, elFor(back, "One"), inText(back, "Two", 0));
    expect(back.handle.getMarkdown()).toBe(src);
    back.restore();
  });

  test("a wrapper whose siblings are all wrappers moves too", () => {
    // The shape of the shipped `examples/gutterpress-user-guide/00-cover.md`:
    // a `@page` holding two `@section`s and nothing else. Every position a
    // pointer can reach here is inside one of those sections' text, so a drop
    // rule that refused anything resolving into a sibling wrapper made this
    // file's grips completely inert — offered on both sections, moving neither,
    // while Alt+ArrowDown swapped them. Measured on the real file: 22 of the
    // 103 pointer-reachable positions now move a section, all to the same
    // result, markers and classes intact.
    const src =
      "@page cover .cover-page\n\n@section .cover-top\n\nAlpha\n\n@end-section\n\n" +
      "@section .cover-bottom\n\nBravo\n\n@end-section\n";
    const e = editor(src);
    expect(e.handle.getMarkdown()).toBe(src);
    // The grip is on the SECTION — each holds an only child, so `isReorderable`
    // walks out to the wrapper.
    const found = blockAtDom(e.handle.view, elFor(e, "Alpha"))!;
    expect(e.handle.view.state.doc.nodeAt(found.pos)?.type.name).toBe("gp_section");

    dragTo(e, elFor(e, "Alpha"), inText(e, "Bravo", 1));
    expect(e.handle.getMarkdown()).toBe(
      "@page cover .cover-page\n\n@section .cover-bottom\n\nBravo\n\n@end-section\n\n" +
        "@section .cover-top\n\nAlpha\n\n@end-section\n",
    );
    e.restore();
  });

  test("a wrapper is never left empty, so its marker lines cannot vanish", () => {
    // `layoutWrapper()` is `content: "block+"`, so PM's `deleteRange` removes a
    // wrapper whose last child leaves — taking `@section`/`@end-section` and
    // its classes with it, cascading outward through nested wrappers. Two
    // things stop that, and this asserts both: the grip is never offered on an
    // only child (it grabs the WRAPPER instead, which is what an author wants
    // anyway), and the drop re-targets into the parent rather than out of it.
    const src = "Before\n\n@section .gp-columns-2\n\nInside\n\n@end-section\n\nAfter\n";
    const e = editor(src);
    const { view } = e.handle;
    const found = blockAtDom(view, elFor(e, "Inside"))!;
    expect(view.state.doc.nodeAt(found.pos)?.type.name).toBe("gp_section");

    // Dragging what the grip DID offer moves the whole section, marker intact.
    dragTo(e, elFor(e, "Inside"), inText(e, "Before", 0));
    expect(e.handle.getMarkdown()).toBe(
      "@section .gp-columns-2\n\nInside\n\n@end-section\n\nBefore\n\nAfter\n",
    );
    e.restore();
  });

  test("a drop into a document that changed under the drag is refused", () => {
    // Upstream's `handleDrop` deletes the source with `tr.deleteSelection()`,
    // and after a wholesale state replacement — the folder watcher's
    // external-edit reload is the ordinary way to get one — the selection is
    // no longer the dragged block. Measured before this guard: the block was
    // inserted at the destination AND left in place at the source, i.e. a
    // duplicate that autosave wrote to the author's file.
    //
    // The replacement is SHORTER than what was captured, and that is the whole
    // point of the case. With a longer one every interesting drop position is
    // out of range in the captured document, so the guard's next line throws
    // and the drop aborts by exception — the assertion then passes whether the
    // guard is there or not. Shorter keeps every position valid in both
    // documents, so only the identity check can refuse: remove it and this
    // yields "Alpha\n\nBravo\n\nAlpha\n".
    const e = editor("Alpha\n\nBravo\n\nCharlie\n\nDelta\n");
    const { view } = e.handle;
    hover(e, e.mount.firstElementChild!);
    grip(e).dispatchEvent(dragEvent(e, "dragstart"));

    const fresh = "Alpha\n\nBravo\n";
    e.handle.setContent(fresh);
    (view as unknown as { posAtCoords: () => { pos: number; inside: number } }).posAtCoords =
      () => ({ pos: view.state.doc.content.size, inside: -1 });
    view.dom.dispatchEvent(dragEvent(e, "drop"));

    expect(e.handle.getMarkdown()).toBe(fresh);
    e.restore();
  });

  test("...and a LONGER replacement is refused without throwing", () => {
    // The other half: a drop position past the end of the captured document
    // must be turned away by the identity check, not by an exception escaping
    // the listener.
    const e = editor("Alpha\n\nBravo\n");
    const { view } = e.handle;
    hover(e, e.mount.firstElementChild!);
    grip(e).dispatchEvent(dragEvent(e, "dragstart"));

    const fresh = "Alpha\n\nBravo\n\nCharlie\n\nDelta\n";
    e.handle.setContent(fresh);
    (view as unknown as { posAtCoords: () => { pos: number; inside: number } }).posAtCoords =
      () => ({ pos: view.state.doc.content.size, inside: -1 });
    expect(() => view.dom.dispatchEvent(dragEvent(e, "drop"))).not.toThrow();

    expect(e.handle.getMarkdown()).toBe(fresh);
    e.restore();
  });

  test("a drag from outside the editor is left to ProseMirror", () => {
    // The guard must not swallow a file or a paste dragged in from another
    // application: with no drag of ours running it has nothing to say.
    const e = editor("Alpha\n\nBravo\n");
    const { view } = e.handle;
    (view as unknown as { posAtCoords: () => { pos: number; inside: number } }).posAtCoords =
      () => ({ pos: 1, inside: -1 });
    const drop = dragEvent(e, "drop");
    (drop as DragEvent).dataTransfer!.setData("text/plain", "dropped");
    view.dom.dispatchEvent(drop);
    expect(e.handle.getMarkdown()).toBe("droppedAlpha\n\nBravo\n");
    e.restore();
  });

  test("grabbing a block does not open the formatting bubble", () => {
    // The grip puts a NodeSelection on a whole block, which is non-empty and
    // has text — so the selection toolbar used to appear the instant the
    // author pressed the grip, sit between the pointer and the drop target for
    // the whole drag, and stay open on the moved block, offering to apply
    // `strong` to an entire `gp_section`.
    const seen: Array<ChromeState | null> = [];
    const e = editor("Alpha\n\nBravo\n", undefined, { onChrome: (s) => seen.push(s) });
    hover(e, e.mount.firstElementChild!);
    grip(e).dispatchEvent(
      new (e.win.MouseEvent as unknown as new (t: string, i: Record<string, unknown>) => Event)(
        "mousedown",
        { bubbles: true },
      ),
    );
    grip(e).dispatchEvent(dragEvent(e, "dragstart"));
    expect(seen.every((s) => s === null)).toBe(true);

    // ...but an ordinary text selection still gets one.
    const { view } = e.handle;
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 6)));
    expect(seen.at(-1)?.kind).toBe("selection");
    e.restore();
  });

  test("a click on the grip leaves focus in the editor", () => {
    // mousedown on a non-focusable element moves focus to `body` unless it is
    // prevented — and preventing it cancels the native drag this element
    // exists to start (both measured in Chromium 153). So focus is put back
    // afterwards; without it, Alt+Arrow and every other binding stop reaching
    // the view until the author clicks into the text.
    const e = editor("Alpha\n\nBravo\n");
    const { view } = e.handle;
    let focused = 0;
    (view as unknown as { focus: () => void }).focus = () => {
      focused += 1;
    };
    hover(e, e.mount.firstElementChild!);
    grip(e).dispatchEvent(
      new (e.win.MouseEvent as unknown as new (t: string, i: Record<string, unknown>) => Event)(
        "click",
        { bubbles: true },
      ),
    );
    expect(focused).toBe(1);
    // A drag that ends without a completed drop is the other way to get here.
    grip(e).dispatchEvent(dragEvent(e, "dragend"));
    expect(focused).toBe(2);
    e.restore();
  });

  test("the grip is a 32px pointer target with a 14px face, and needs hover", () => {
    // ux-design-contract.md: interactive targets are >=32x32 on pointer, and
    // hover-dependent UI exists only under `@media (hover: hover)`. The element
    // is built in TS, so no a11y lint sees it — this is the only gate.
    const e = editor("Alpha\n\nBravo\n");
    const css = Array.from(e.doc.head.querySelectorAll("style"))
      .map((s) => s.textContent)
      .join("\n");
    expect(css).toContain("width: 14px;");
    // 14+18 = 32 wide, 20+2*6 = 32 tall. The horizontal padding is all on the
    // LEFT: centred, the element's right edge landed 3px inside the block (the
    // offset backed out one PAD but the element had grown by two), so
    // `elementFromPoint` returned the handle for the first 3 CSS px of every
    // line and clicking there selected the block instead of placing the caret.
    expect(css).toContain("padding: 6px 0 6px 18px;");
    // Under `* { box-sizing: border-box }` — one of the commonest lines in a
    // book stylesheet — that padding would eat the grip instead of surrounding
    // it, and the paint must stay on the 14px face.
    expect(css).toContain("box-sizing: content-box;");
    expect(css).toContain("background-clip: content-box;");
    expect(css).toContain("@media (hover: none)");
    e.restore();
  });

  test("the hit area clears the block, and is not clamped on top of it", () => {
    // happy-dom does no layout, so this reads the arithmetic `point()` performs
    // rather than a measured rect: the element is positioned by its full width,
    // so its right edge sits GAP px left of the block at every offset —
    // including a block whose left edge is under 38px from the frame's own,
    // which `@page cover { margin: 0 }` and `.gp-bleed` both produce and which
    // a `Math.max(0, …)` clamp used to answer by parking a 32px dead zone over
    // the author's first line.
    const src = readFileSync(
      resolve(import.meta.dir, "../../src/lib/editor/rich-drag-handle.ts"),
      "utf8",
    );
    const point = src.slice(src.indexOf("function point(el: HTMLElement)"));
    const body = point.slice(0, point.indexOf("\n  }"));
    expect(body).toContain("`${rect.left + win.scrollX - GAP - WIDTH - PAD_LEFT}px`");
    expect(body).not.toContain("Math.max");
  });
});

describe("source lines (editor↔preview sync)", () => {
  const CHAPTER = "# Title\n\nFirst paragraph.\n\n## Section\n\nSecond paragraph.\n";

  test("every block reports the line it actually occupies on disk", () => {
    // The property the whole mapping rests on: the line comes from the SAME
    // serializer that writes the file, so it cannot drift from the file.
    const state = createEditorState(md, CHAPTER);
    const lines = CHAPTER.split("\n");
    const table = lineTable(state.doc);
    expect(table.length).toBe(4);
    for (const entry of table) {
      const node = state.doc.nodeAt(entry.pos)!;
      expect(lines[entry.line - 1]).toContain(node.textContent.split("\n")[0]!.slice(0, 10));
    }
    resetLineTableCache();
  });

  test("line numbers survive an edit — they are derived, never stored", () => {
    // Storing token.map on nodes would leave every line below an insertion
    // silently wrong. Inserting a block must shift the ones after it.
    const e = editor(CHAPTER);
    const { view } = e.handle;
    const before = lineTable(view.state.doc).map((b) => b.line);
    view.dispatch(view.state.tr.insert(0, gutterpressSchema.nodes.paragraph!.create(
      null, gutterpressSchema.text("Inserted."),
    )));
    const after = lineTable(view.state.doc).map((b) => b.line);
    expect(after[0]).toBe(1);
    // everything that was there is now two lines lower (block + blank line)
    expect(after.slice(1)).toEqual(before.map((l) => l + 2));
    resetLineTableCache();
    e.restore();
  });

  test("posForLine and lineForPos agree with each other", () => {
    const state = createEditorState(md, CHAPTER);
    for (const { pos, line } of lineTable(state.doc)) {
      expect(posForLine(state.doc, line)).toBe(pos);
      expect(lineForPos(state.doc, pos)).toBe(line);
    }
    resetLineTableCache();
  });

  test("two adjacent lists do not shift every line after them", () => {
    // The serializer puts TWO blank lines between same-shape sibling lists —
    // one blank would let re-parsing merge them into a single list. The table
    // used to assume one separator everywhere and reported every later block
    // a line early. This is the shape the list toolbar action produces when
    // used twice in a row, so it is reachable without writing it by hand.
    const li = (t: string) =>
      gutterpressSchema.nodes.list_item!.create(
        null,
        gutterpressSchema.nodes.paragraph!.create(null, gutterpressSchema.text(t)),
      );
    const list = (t: string) =>
      gutterpressSchema.nodes.bullet_list!.create({ tight: true }, [li(t)]);
    const doc = gutterpressSchema.nodes.doc!.create(null, [
      list("one"),
      list("two"),
      gutterpressSchema.nodes.paragraph!.create(null, gutterpressSchema.text("after")),
    ]);

    const saved = serializeDoc(doc).split("\n");
    for (const entry of lineTable(doc)) {
      const node = doc.nodeAt(entry.pos)!;
      // Every reported line must be where that block's text really is.
      expect(saved[entry.line - 1]).toContain(node.textContent.split("\n")[0]!);
    }
    resetLineTableCache();
  });

  test("a line inside a block resolves to that block, not the next one", () => {
    const state = createEditorState(md, "para one\n\npara two\n");
    const table = lineTable(state.doc);
    expect(table.map((t) => t.line)).toEqual([1, 3]);
    // line 2 is the blank separator — it belongs to the block before it
    expect(posForLine(state.doc, 2)).toBe(table[0]!.pos);
    resetLineTableCache();
  });

  test("onAnchorLine does NOT fire while typing", () => {
    // Emitting on every keystroke would yank the preview out from under the
    // author — the exact behaviour MarkdownEditor guards against.
    const seen: Array<[number, string]> = [];
    const e = editor(CHAPTER, undefined, {
      onAnchorLine: (line, origin) => seen.push([line, origin]),
    });
    const { view } = e.handle;
    view.dispatch(view.state.tr.insertText("x", 1));
    expect(seen).toEqual([]);

    // ...but a deliberate caret move does fire, with the right line.
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 24)));
    expect(seen.length).toBe(1);
    expect(seen[0]![1]).toBe("caret");

    e.restore();
    resetLineTableCache();
  });
});
