/**
 * book-field.ts — the CodeMirror half of the CONTINUOUS BOOK DOCUMENT.
 *
 * `book-layout.ts` owns the pure segment math; this module owns the ONE piece
 * that has to live inside CodeMirror: keeping the boundary offsets correct as
 * the author types. Boundaries are carried in a `StateField` and mapped through
 * every transaction's changes, which is why the document needs no separator
 * text — there is nothing in the buffer for an author to delete or duplicate.
 *
 * Mapping uses `assoc: -1` so an insertion exactly ON a boundary leaves the
 * boundary BEFORE the new text: column 0 of a chapter's first line is that
 * chapter, and text typed there lands in that chapter's file.
 * `segmentIndexForPos`'s later-segment rule is the read side of the same
 * decision — change one and you must change the other.
 *
 * The field also provides the two bits of chrome that make a multi-file
 * document legible: a block widget naming each chapter at its boundary, and
 * per-chapter line numbers (line 1 restarts at every chapter, so the gutter
 * agrees with the preview's `sourceLine`, with `gutterpress validate` output,
 * and with anything else that speaks per-file lines).
 *
 * Browser-only CodeMirror + string math — no `node:*`, no lib value imports
 * (CLAUDE.md §8 / ADR 0004).
 */
import { StateEffect, StateField, type EditorState, type Extension } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  lineNumbers,
} from "@codemirror/view";
import {
  type BookLayout,
  type BookSegment,
  segmentIndexForLine,
  segmentIndexForPos,
} from "./book-layout";

/**
 * Install a layout wholesale. Used when the book document is (re)built, and by
 * the collapse repair below — which computes the layout it wants explicitly
 * rather than letting the field map its own change, because a zero-length
 * boundary cannot be split by position mapping alone (both sides of it sit at
 * the same offset, so no `assoc` moves one without the other).
 */
export const setBookLayout = StateEffect.define<BookLayout | null>();

/** Recompute every segment's `startLine` against `doc`. */
function withStartLines(layout: BookLayout, doc: EditorState["doc"]): BookLayout {
  return {
    segments: layout.segments.map((s) => ({
      ...s,
      startLine: doc.lineAt(Math.min(s.from, doc.length)).number,
    })),
  };
}

/**
 * The live segment table, or null when the view holds an ordinary single-file
 * document (CSS, or a markdown file that isn't part of the book).
 */
export const bookField: StateField<BookLayout | null> = StateField.define<BookLayout | null>({
  create: () => null,
  update(value, tr) {
    for (const effect of tr.effects) {
      if (effect.is(setBookLayout)) {
        return effect.value ? withStartLines(effect.value, tr.newDoc) : null;
      }
    }
    if (!value || !tr.docChanged) return value;
    const mapped: BookLayout = {
      segments: value.segments.map((s) => ({
        ...s,
        from: tr.changes.mapPos(s.from, -1),
      })),
    };
    return withStartLines(mapped, tr.newDoc);
  },
  provide: (f) => EditorView.decorations.compute([f], buildDecorations),
});

/**
 * Seed the field when an `EditorState` is created. Pass null to build an
 * ordinary single-file document.
 */
export function bookFieldInit(layout: BookLayout | null): Extension {
  return bookField.init((state) => (layout ? withStartLines(layout, state.doc) : null));
}

/** Read the live segment table off a state. */
export function bookLayout(state: EditorState): BookLayout | null {
  return state.field(bookField, false) ?? null;
}

/** The chapter-name divider drawn at each segment boundary. */
class ChapterHeaderWidget extends WidgetType {
  constructor(private readonly chapter: string) {
    super();
  }

  eq(other: ChapterHeaderWidget): boolean {
    return other.chapter === this.chapter;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement("div");
    wrap.className = "cm-chapter-header";
    wrap.setAttribute("data-chapter", this.chapter);
    // Decorative: the file name is already announced by the editor status bar
    // and the file tree, and a screen reader walking the document should hear
    // continuous prose, not a divider between every chapter.
    wrap.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.className = "cm-chapter-header-label";
    label.textContent = this.chapter;
    wrap.appendChild(label);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const layout = state.field(bookField, false);
  if (!layout || layout.segments.length === 0) return Decoration.none;
  const ranges = [];
  for (const segment of layout.segments) {
    // A BLOCK widget may only sit on a line boundary — CodeMirror throws
    // otherwise. A boundary normally is one (every segment ends with a
    // newline), but an author who deletes a chapter's last newline glues the
    // next chapter's first line onto it, putting the boundary mid-line. Drop
    // that one divider rather than take the whole editor down; the next edit
    // that restores the newline brings it back.
    if (state.doc.lineAt(segment.from).from !== segment.from) continue;
    ranges.push(
      Decoration.widget({
        widget: new ChapterHeaderWidget(segment.chapter),
        block: true,
        side: -1,
      }).range(segment.from),
    );
  }
  return Decoration.set(ranges, true);
}

/**
 * Line numbers that restart at 1 in every chapter. Falls back to the plain
 * document line number for a single-file document (no layout installed).
 */
export function bookLineNumbers(): Extension {
  return lineNumbers({
    formatNumber: (line, state) => {
      const layout = bookLayout(state);
      if (!layout) return String(line);
      const index = segmentIndexForLine(layout, line);
      if (index < 0) return String(line);
      return String(line - layout.segments[index]!.startLine + 1);
    },
  });
}

/**
 * The document positions where a segment has collapsed to zero length, paired
 * with the layout that repairs them.
 *
 * An author who selects across a chapter boundary and deletes — or empties a
 * chapter outright — leaves a segment with no characters at all. It shares its
 * offset with the next segment, so it is invisible, untypeable, and (by
 * `segmentIndexForPos`'s later-segment rule) any text put there would be
 * written into the WRONG file. Re-inserting the synthetic newline gives the
 * chapter a line to live on again; `padded` makes {@link segmentText} strip it
 * back off, so the file stays empty on disk.
 *
 * Returns null when nothing is collapsed. The repair transaction is dispatched
 * with `addToHistory: false` so it doesn't cost the author a second undo press;
 * an undo that re-fills the chapter may leave the synthetic newline as a stray
 * blank line, which is cosmetic and self-correcting on the next edit.
 */
export function repairCollapsedSegments(
  state: EditorState,
): { insertAt: number[]; layout: BookLayout } | null {
  const layout = bookLayout(state);
  if (!layout) return null;
  const docLength = state.doc.length;
  const insertAt: number[] = [];
  const segments: BookSegment[] = [];
  let shift = 0;
  for (let i = 0; i < layout.segments.length; i++) {
    const segment = layout.segments[i]!;
    const end = layout.segments[i + 1]?.from ?? docLength;
    const collapsed = end <= segment.from;
    segments.push({
      ...segment,
      from: segment.from + shift,
      padded: collapsed ? true : segment.padded,
    });
    if (collapsed) {
      insertAt.push(segment.from);
      shift += 1;
    }
  }
  if (insertAt.length === 0) return null;
  return { insertAt, layout: { segments } };
}

/** The segment a document position sits in, or null outside a book document. */
export function segmentAtPos(state: EditorState, pos: number): BookSegment | null {
  const layout = bookLayout(state);
  if (!layout) return null;
  const index = segmentIndexForPos(layout, pos);
  return index < 0 ? null : (layout.segments[index] ?? null);
}
