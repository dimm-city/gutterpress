import { expect, test, describe } from "bun:test";
import { EditorState } from "@codemirror/state";
import {
  buildBookDoc,
  bookLayoutsEqual,
  collapsedSegments,
  globalLineFor,
  localLineFor,
  segmentEnd,
  segmentIndexForChapter,
  segmentIndexForLine,
  segmentIndexForPath,
  segmentIndexForPos,
  segmentText,
  touchedSegments,
  unpad,
  withSegmentReplaced,
  type BookSection,
} from "../../src/lib/editor/book-layout";
import {
  bookField,
  bookFieldInit,
  bookLayout,
  repairCollapsedSegments,
  segmentAtPos,
  setBookLayout,
} from "../../src/lib/editor/book-field";

/**
 * The continuous book document's geometry.
 *
 * Two properties carry the whole feature and both are pinned here:
 *
 *  1. **Round trip** — every chapter's content comes back out of the document,
 *     aside from CodeMirror's standard LF line-ending normalization, including
 *     files with no trailing newline and empty files (which are shown padded
 *     so they have a line to live on). A failure here silently rewrites the
 *     author's files.
 *  2. **Boundary mapping** — the segment table is positions mapped through
 *     CodeMirror's own change sets, not separator text, so an edit anywhere in
 *     the book still attributes every chapter's content to the right file.
 */

const sections = (...parts: Array<[string, string]>): BookSection[] =>
  parts.map(([chapter, content]) => ({ path: `/proj/${chapter}`, chapter, content }));

describe("buildBookDoc", () => {
  test("concatenates chapters in order and records each one's start", () => {
    const { doc, layout } = buildBookDoc(
      sections(["01.md", "# One\n\nalpha\n"], ["02.md", "# Two\n"]),
    );
    expect(doc).toBe("# One\n\nalpha\n# Two\n");
    expect(layout.segments.map((s) => s.from)).toEqual([0, 13]);
    expect(layout.segments.map((s) => s.startLine)).toEqual([1, 4]);
    expect(layout.segments.map((s) => s.padded)).toEqual([false, false]);
  });

  test("pads a file with no trailing newline, and strips the padding back off", () => {
    const { doc, layout } = buildBookDoc(sections(["01.md", "no newline"], ["02.md", "next\n"]));
    expect(doc).toBe("no newline\nnext\n");
    expect(layout.segments[0]!.padded).toBe(true);
    // The file keeps its trailing-newline state — it must not be marked dirty
    // (and then rewritten with an extra newline) merely by being opened.
    expect(segmentText(doc, layout, 0)).toBe("no newline");
    expect(segmentText(doc, layout, 1)).toBe("next\n");
  });

  test("pads an EMPTY chapter so it still has a line the author can type on", () => {
    const { doc, layout } = buildBookDoc(sections(["01.md", ""], ["02.md", "b\n"]));
    expect(doc).toBe("\nb\n");
    expect(layout.segments.map((s) => s.from)).toEqual([0, 1]);
    expect(segmentText(doc, layout, 0)).toBe("");
  });

  test("round trips every chapter of a mixed book", () => {
    const input = sections(
      ["01.md", "# One\n"],
      ["02.md", "trailing-less"],
      ["03.md", ""],
      ["04.md", "# Four\n\nlast\n"],
    );
    const { doc, layout } = buildBookDoc(input);
    input.forEach((section, i) => {
      expect(segmentText(doc, layout, i)).toBe(section.content);
    });
  });

  test("normalizes line endings before calculating CodeMirror segment offsets", () => {
    const { doc, layout } = buildBookDoc(
      sections(["01.md", "one\r\ntwo\nthree\r"], ["02.md", "four\r\nfive\r\n"]),
    );
    const state = EditorState.create({ doc, extensions: [bookFieldInit(layout)] });
    const live = bookLayout(state)!;

    expect(state.doc.toString()).toBe("one\ntwo\nthree\nfour\nfive\n");
    expect(live.segments[1]!.from).toBe(14);
    expect(state.doc.lineAt(live.segments[1]!.from).text).toBe("four");
    expect(texts(state)).toEqual({
      "01.md": "one\ntwo\nthree\n",
      "02.md": "four\nfive\n",
    });
  });

  test("an empty book is an empty document", () => {
    const { doc, layout } = buildBookDoc([]);
    expect(doc).toBe("");
    expect(layout.segments).toEqual([]);
    expect(segmentIndexForPos(layout, 0)).toBe(-1);
    expect(localLineFor(layout, 1)).toBeNull();
  });
});

describe("bookLayoutsEqual", () => {
  test("rejects equal aggregate text with different file boundaries", () => {
    const first = buildBookDoc(sections(["01.md", "a\n"], ["02.md", "b\nc\n"]));
    const second = buildBookDoc(sections(["01.md", "a\nb\n"], ["02.md", "c\n"]));
    expect(first.doc).toBe(second.doc);
    expect(bookLayoutsEqual(first.layout, second.layout)).toBe(false);
  });

  test("includes path, chapter, and synthetic padding ownership", () => {
    const { layout } = buildBookDoc(sections(["01.md", "a"]));
    expect(bookLayoutsEqual(layout, { segments: layout.segments.map((s) => ({ ...s })) })).toBe(
      true,
    );
    expect(
      bookLayoutsEqual(layout, {
        segments: [{ ...layout.segments[0]!, path: "/proj/renamed.md" }],
      }),
    ).toBe(false);
    expect(
      bookLayoutsEqual(layout, {
        segments: [{ ...layout.segments[0]!, chapter: "renamed.md" }],
      }),
    ).toBe(false);
    expect(
      bookLayoutsEqual(layout, {
        segments: [{ ...layout.segments[0]!, padded: false }],
      }),
    ).toBe(false);
  });
});

describe("lookups", () => {
  const { doc, layout } = buildBookDoc(
    sections(["01.md", "a\nb\n"], ["02.md", "c\n"], ["03.md", "d\ne\n"]),
  );

  test("a position exactly ON a boundary belongs to the chapter that STARTS there", () => {
    // Column 0 of a chapter's first line is that chapter — so text typed there
    // lands in its file, matching book-field's `assoc: -1` mapping.
    expect(segmentIndexForPos(layout, layout.segments[1]!.from)).toBe(1);
    expect(segmentIndexForPos(layout, layout.segments[1]!.from - 1)).toBe(0);
    expect(segmentIndexForPos(layout, doc.length)).toBe(2);
  });

  test("segmentEnd is the next chapter's start, or the end of the book", () => {
    expect(segmentEnd(doc.length, layout, 0)).toBe(layout.segments[1]!.from);
    expect(segmentEnd(doc.length, layout, 2)).toBe(doc.length);
  });

  test("finds chapters by line, path, and chapter id", () => {
    expect(segmentIndexForLine(layout, 1)).toBe(0);
    expect(segmentIndexForLine(layout, 3)).toBe(1);
    expect(segmentIndexForLine(layout, 5)).toBe(2);
    expect(segmentIndexForPath(layout, "/proj/02.md")).toBe(1);
    expect(segmentIndexForPath(layout, "/proj/nope.md")).toBe(-1);
    expect(segmentIndexForChapter(layout, "03.md")).toBe(2);
    expect(segmentIndexForChapter(layout, "nope.md")).toBe(-1);
  });

  test("global ↔ chapter-local lines round trip — the whole of editor↔preview sync", () => {
    for (const [chapter, line, global] of [
      ["01.md", 1, 1],
      ["01.md", 2, 2],
      ["02.md", 1, 3],
      ["03.md", 2, 5],
    ] as const) {
      expect(globalLineFor(layout, chapter, line)).toBe(global);
      expect(localLineFor(layout, global)).toEqual({
        chapter,
        path: `/proj/${chapter}`,
        line,
      });
    }
  });

  test("globalLineFor returns null for a chapter this book doesn't build from", () => {
    // A preview render from before a file left `source.files` still names it.
    expect(globalLineFor(layout, "removed.md", 3)).toBeNull();
  });

  test("globalLineFor floors a nonsensical line at the chapter's first", () => {
    expect(globalLineFor(layout, "02.md", 0)).toBe(3);
    expect(globalLineFor(layout, "02.md", -5)).toBe(3);
  });
});

describe("touchedSegments", () => {
  const { layout } = buildBookDoc(
    sections(["01.md", "aaa\n"], ["02.md", "bbb\n"], ["03.md", "ccc\n"]),
  );
  // starts: 0, 4, 8

  test("an edit inside one chapter reports only that chapter", () => {
    expect(touchedSegments(layout, 5, 6)).toEqual({ first: 1, last: 1 });
  });

  test("an edit spanning chapters reports the whole run", () => {
    expect(touchedSegments(layout, 2, 9)).toEqual({ first: 0, last: 2 });
  });

  test("a change starting ON a boundary also reports the chapter BEFORE it", () => {
    // This is the data-loss case: a deletion running from chapter 1 into
    // chapter 2 collapses to a single position on chapter 2's boundary.
    // Chapter 1's tail was removed, so it MUST be written back too.
    expect(touchedSegments(layout, 4, 4)).toEqual({ first: 0, last: 1 });
    expect(touchedSegments(layout, 8, 8)).toEqual({ first: 1, last: 2 });
  });

  test("a change at the very start of the book has no earlier chapter to widen to", () => {
    expect(touchedSegments(layout, 0, 0)).toEqual({ first: 0, last: 0 });
  });

  test("a change at the end of the book stays in range", () => {
    expect(touchedSegments(layout, 12, 12)).toEqual({ first: 2, last: 2 });
  });

  test("an empty book has nothing to report", () => {
    expect(touchedSegments({ segments: [] }, 0, 0)).toBeNull();
  });
});

describe("unpad", () => {
  test("strips exactly one newline, and only from a padded segment", () => {
    expect(unpad("text\n", true)).toBe("text");
    expect(unpad("text\n\n", true)).toBe("text\n");
    expect(unpad("text\n", false)).toBe("text\n");
    // A padded segment whose newline the author deleted has nothing to strip.
    expect(unpad("text", true)).toBe("text");
  });
});

describe("withSegmentReplaced", () => {
  test("shifts every later chapter by the length delta", () => {
    const { layout } = buildBookDoc(sections(["01.md", "aa\n"], ["02.md", "b\n"], ["03.md", "c\n"]));
    const next = withSegmentReplaced(layout, 0, 3, 6, true);
    expect(next.segments.map((s) => s.from)).toEqual([0, 6, 8]);
    expect(next.segments[0]!.padded).toBe(true);
    expect(next.segments[1]!.padded).toBe(false);
  });
});

describe("collapsedSegments", () => {
  test("reports a chapter an edit emptied out of the document", () => {
    const { doc, layout } = buildBookDoc(sections(["01.md", "a\n"], ["02.md", "b\n"]));
    expect(collapsedSegments(doc.length, layout)).toEqual([]);
    // Both boundaries at 0 — what a select-all delete leaves behind.
    const flattened = { segments: layout.segments.map((s) => ({ ...s, from: 0 })) };
    expect(collapsedSegments(0, flattened)).toEqual([0, 1]);
  });
});

// ── The CodeMirror boundary field ────────────────────────────────────────────
// The segment table is only correct if it survives real edits. These drive the
// actual StateField with real ChangeSets rather than asserting on a fake.

function bookState(...parts: Array<[string, string]>): EditorState {
  const { doc, layout } = buildBookDoc(sections(...parts));
  return EditorState.create({ doc, extensions: [bookFieldInit(layout)] });
}

/** Every chapter's write-back text for a state holding a book document. */
function texts(state: EditorState): Record<string, string> {
  const layout = bookLayout(state)!;
  const doc = state.doc.toString();
  return Object.fromEntries(
    layout.segments.map((s, i) => [s.chapter, segmentText(doc, layout, i)]),
  );
}

describe("bookField", () => {
  test("a single-file document has no segment table", () => {
    const state = EditorState.create({ doc: "plain\n", extensions: [bookFieldInit(null)] });
    expect(bookLayout(state)).toBeNull();
    expect(segmentAtPos(state, 0)).toBeNull();
  });

  test("an edit inside one chapter changes only that chapter's text", () => {
    const state = bookState(["01.md", "one\n"], ["02.md", "two\n"], ["03.md", "three\n"]);
    const next = state.update({ changes: { from: 3, insert: " ALPHA" } }).state;
    expect(texts(next)).toEqual({
      "01.md": "one ALPHA\n",
      "02.md": "two\n",
      "03.md": "three\n",
    });
  });

  test("typing at column 0 of a chapter's first line lands in THAT chapter", () => {
    const state = bookState(["01.md", "one\n"], ["02.md", "two\n"]);
    const boundary = bookLayout(state)!.segments[1]!.from;
    const next = state.update({ changes: { from: boundary, insert: "X" } }).state;
    expect(texts(next)).toEqual({ "01.md": "one\n", "02.md": "Xtwo\n" });
    expect(segmentAtPos(next, boundary)!.chapter).toBe("02.md");
  });

  test("a deletion spanning a boundary moves text between the two files", () => {
    const state = bookState(["01.md", "keep\ndrop\n"], ["02.md", "gone\nstay\n"]);
    // Delete from mid-chapter-1 through mid-chapter-2.
    const next = state.update({ changes: { from: 5, to: 15 } }).state;
    expect(texts(next)).toEqual({ "01.md": "keep\n", "02.md": "stay\n" });
  });

  test("startLine tracks inserted lines so chapter-local lines stay correct", () => {
    const state = bookState(["01.md", "a\n"], ["02.md", "b\n"]);
    expect(globalLineFor(bookLayout(state)!, "02.md", 1)).toBe(2);
    const next = state.update({ changes: { from: 0, insert: "new\nlines\n" } }).state;
    expect(globalLineFor(bookLayout(next)!, "02.md", 1)).toBe(4);
    expect(localLineFor(bookLayout(next)!, 4)).toMatchObject({ chapter: "02.md", line: 1 });
  });

  test("setBookLayout replaces the table wholesale (the external-reload splice)", () => {
    const state = bookState(["01.md", "old\n"], ["02.md", "b\n"]);
    const layout = bookLayout(state)!;
    const replacement = "fresh\ntext\n";
    const next = state.update({
      changes: { from: 0, to: 4, insert: replacement },
      effects: setBookLayout.of(withSegmentReplaced(layout, 0, 4, replacement.length, false)),
    }).state;
    expect(texts(next)).toEqual({ "01.md": "fresh\ntext\n", "02.md": "b\n" });
  });

  test("setBookLayout(null) drops the book document back to a single file", () => {
    const state = bookState(["01.md", "a\n"]);
    const next = state.update({ effects: setBookLayout.of(null) }).state;
    expect(next.field(bookField)).toBeNull();
  });
});

describe("revealing across document shapes", () => {
  // The editor-side half of the guard `+page.svelte`'s `revealInEditor` relies
  // on: a chapter-local line is meaningless to a single-file document, and
  // applying it anyway would scroll whatever IS open (a stylesheet) to that
  // line number — the wrong document entirely.
  test("a chapter's line resolves against the book document", () => {
    const state = bookState(["01.md", "a\nb\n"], ["02.md", "c\nd\n"]);
    expect(globalLineFor(bookLayout(state)!, "02.md", 2)).toBe(4);
  });

  test("a single-file document has no layout to resolve a chapter against", () => {
    const state = EditorState.create({
      doc: "p { color: red }\n.x { color: blue }\n",
      extensions: [bookFieldInit(null)],
    });
    // No segment table at all — there is nothing for a chapter id to mean here,
    // which is exactly why revealLine refuses a chapter-scoped reveal.
    expect(bookLayout(state)).toBeNull();
  });
});

describe("collapse repair", () => {
  test("nothing to repair while every chapter has content", () => {
    expect(repairCollapsedSegments(bookState(["01.md", "a\n"], ["02.md", "b\n"]))).toBeNull();
  });

  test("an emptied chapter is given a line back, and still writes out empty", () => {
    const state = bookState(["01.md", "a\n"], ["02.md", "b\n"], ["03.md", "c\n"]);
    // Delete chapter 2 entirely.
    const emptied = state.update({ changes: { from: 2, to: 4 } }).state;
    const repair = repairCollapsedSegments(emptied)!;
    expect(repair.insertAt).toEqual([2]);

    const repaired = emptied.update({
      changes: repair.insertAt.map((pos) => ({ from: pos, insert: "\n" })),
      effects: setBookLayout.of(repair.layout),
    }).state;
    expect(repaired.doc.toString()).toBe("a\n\nc\n");
    // The chapter exists in the document again — so it can be typed into — but
    // its FILE is still empty.
    expect(texts(repaired)).toEqual({ "01.md": "a\n", "02.md": "", "03.md": "c\n" });
    expect(segmentAtPos(repaired, 2)!.chapter).toBe("02.md");
    expect(repairCollapsedSegments(repaired)).toBeNull();
  });

  test("repairs several chapters at once (select-all delete across the book)", () => {
    const state = bookState(["01.md", "a\n"], ["02.md", "b\n"], ["03.md", "c\n"]);
    const emptied = state.update({ changes: { from: 0, to: state.doc.length } }).state;
    const repair = repairCollapsedSegments(emptied)!;
    const repaired = emptied.update({
      changes: repair.insertAt.map((pos) => ({ from: pos, insert: "\n" })),
      effects: setBookLayout.of(repair.layout),
    }).state;
    expect(repaired.doc.toString()).toBe("\n\n\n");
    expect(texts(repaired)).toEqual({ "01.md": "", "02.md": "", "03.md": "" });
    expect(repairCollapsedSegments(repaired)).toBeNull();
  });
});
