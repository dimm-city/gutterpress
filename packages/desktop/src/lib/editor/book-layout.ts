/**
 * book-layout.ts — the pure segment math behind the CONTINUOUS BOOK DOCUMENT.
 *
 * The editor used to hold ONE chapter file at a time while the preview rendered
 * the WHOLE book. That mismatch is what every piece of scroll-sync machinery in
 * this app was paying for: scrolling stopped dead at each file's last line, and
 * following the preview across a chapter boundary meant opening another file,
 * polling for the async buffer swap, and re-issuing the reveal because the load
 * reset scroll to the top.
 *
 * The book document removes the mismatch: every markdown source file the book
 * builds from is concatenated, in manifest `source.files` order, into ONE
 * CodeMirror document. Scrolling is continuous across the whole book, and
 * `(chapter, line) ↔ global line` — the ONLY thing editor↔preview sync ever
 * needed — becomes a table lookup here.
 *
 * ## The segment table is positions, never sentinel text
 *
 * Boundaries are character offsets, carried in a CodeMirror `StateField` and
 * mapped through every transaction's changes (see `book-field.ts`). There is no
 * separator string in the document — nothing an author can accidentally delete,
 * retype, or paste a copy of. An edit that spans a boundary simply moves text
 * from one file to its neighbour, which is exactly what it looks like it does.
 *
 * ## The padding rule
 *
 * Segments abut with a ZERO-LENGTH boundary, so every segment must end with a
 * newline or the next chapter's first line would render glued to this one. A
 * file whose on-disk content doesn't end in `\n` (including an EMPTY file) is
 * displayed with one appended and flagged `padded`; {@link segmentText} strips
 * exactly one trailing newline back off a padded segment, so the file round
 * trips byte-for-byte and is never marked dirty just for being opened.
 *
 * Pure string/array math — no CodeMirror, no DOM, no `node:*` (CLAUDE.md §8 /
 * ADR 0004). Unit-tested in `tests/editor/book-layout.test.ts`.
 */

/** One source file's contribution to the book document. */
export interface BookSection {
  /** Absolute, OS-native path of the source file. */
  path: string;
  /**
   * Canonical forward-slash, project-relative chapter id — the same string the
   * rendered book carries as `data-chapter-src` and every preview
   * `sourceLine`/`chapter` payload names.
   */
  chapter: string;
  /** The file's content exactly as it sits on disk. */
  content: string;
}

/** A section's live placement inside the book document. */
export interface BookSegment {
  path: string;
  chapter: string;
  /** Character offset of this segment's first character. Always a line start. */
  from: number;
  /** 1-based line number of {@link from} within the book document. */
  startLine: number;
  /**
   * True when the document shows a trailing newline this file does not have on
   * disk. {@link segmentText} strips it back off so the file round trips.
   */
  padded: boolean;
}

/** The full boundary table for one book document. */
export interface BookLayout {
  segments: BookSegment[];
}

/** 1-based line number of `pos` within `text`. */
export function lineNumberAt(text: string, pos: number): number {
  let line = 1;
  for (let i = 0; i < pos && i < text.length; i++) {
    if (text.charCodeAt(i) === 10) line++;
  }
  return line;
}

/**
 * Concatenate `sections` into the book document and record where each one
 * starts. Sections are laid out in the order given — that order IS the book's
 * chapter order, so callers must pass manifest `source.files` order.
 */
export function buildBookDoc(sections: BookSection[]): { doc: string; layout: BookLayout } {
  const segments: BookSegment[] = [];
  let doc = "";
  let line = 1;
  for (const section of sections) {
    const padded = !section.content.endsWith("\n");
    const text = padded ? `${section.content}\n` : section.content;
    segments.push({
      path: section.path,
      chapter: section.chapter,
      from: doc.length,
      startLine: line,
      padded,
    });
    for (let i = 0; i < text.length; i++) {
      if (text.charCodeAt(i) === 10) line++;
    }
    doc += text;
  }
  return { doc, layout: { segments } };
}

/** Exclusive character offset where segment `index` ends. */
export function segmentEnd(docLength: number, layout: BookLayout, index: number): number {
  const next = layout.segments[index + 1];
  return next ? next.from : docLength;
}

/**
 * Turn a segment's raw document slice into the bytes that belong in its file:
 * a padded segment gives back the one synthetic trailing newline it was shown
 * with. THE one place the padding rule is applied — the editor slices segments
 * straight out of the CodeMirror `Text` (never materialising the whole book as
 * a string on every keystroke) and calls this, so both paths strip identically.
 */
export function unpad(raw: string, padded: boolean): string {
  return padded && raw.endsWith("\n") ? raw.slice(0, -1) : raw;
}

/**
 * The text to WRITE BACK to segment `index`'s file — the document slice, minus
 * the one synthetic trailing newline a `padded` segment carries (see the
 * padding rule in this module's header).
 */
export function segmentText(doc: string, layout: BookLayout, index: number): string {
  const segment = layout.segments[index];
  if (!segment) return "";
  return unpad(doc.slice(segment.from, segmentEnd(doc.length, layout, index)), segment.padded);
}

/**
 * The segment `pos` belongs to. A position exactly ON a boundary belongs to the
 * segment that STARTS there (the later one) — column 0 of a chapter's first
 * line is that chapter, so text typed there lands in that chapter's file. This
 * is the read side of the `assoc: -1` boundary mapping in `book-field.ts`; the
 * two must agree.
 *
 * Returns -1 for an empty layout, and 0 for a position before the first
 * segment (which cannot happen — segment 0 always starts at offset 0).
 */
export function segmentIndexForPos(layout: BookLayout, pos: number): number {
  const segments = layout.segments;
  if (segments.length === 0) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.from <= pos) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The segment a 1-based document line belongs to. Mirrors {@link segmentIndexForPos}. */
export function segmentIndexForLine(layout: BookLayout, line: number): number {
  const segments = layout.segments;
  if (segments.length === 0) return -1;
  let lo = 0;
  let hi = segments.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (segments[mid]!.startLine <= line) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** Index of the segment for an absolute file path, or -1. */
export function segmentIndexForPath(layout: BookLayout, path: string): number {
  return layout.segments.findIndex((s) => s.path === path);
}

/** Index of the segment for a canonical chapter id, or -1. */
export function segmentIndexForChapter(layout: BookLayout, chapter: string): number {
  return layout.segments.findIndex((s) => s.chapter === chapter);
}

/**
 * Book-document line for a chapter-local 1-based line. Returns null when the
 * chapter isn't in this book (e.g. the preview still shows a render from before
 * a file was removed from `source.files`).
 */
export function globalLineFor(
  layout: BookLayout,
  chapter: string,
  localLine: number,
): number | null {
  const index = segmentIndexForChapter(layout, chapter);
  if (index < 0) return null;
  return layout.segments[index]!.startLine + Math.max(1, localLine) - 1;
}

/** Chapter + chapter-local 1-based line for a book-document line. */
export function localLineFor(
  layout: BookLayout,
  line: number,
): { chapter: string; path: string; line: number } | null {
  const index = segmentIndexForLine(layout, line);
  if (index < 0) return null;
  const segment = layout.segments[index]!;
  return {
    chapter: segment.chapter,
    path: segment.path,
    line: Math.max(1, line - segment.startLine + 1),
  };
}

/**
 * The inclusive `[first, last]` segment range an edit touched, given the span
 * it changed in NEW-document coordinates.
 *
 * The low end is widened by one segment when the span starts exactly on a
 * boundary. A deletion running from chapter N into chapter N+1 collapses to a
 * single position sitting on N+1's mapped boundary — so N, whose tail the
 * deletion just removed, would be missed and its file left stale on disk. The
 * cost of widening is at worst re-reporting one unchanged chapter, which its
 * buffer discards as a no-op; the cost of NOT widening is silent data loss.
 *
 * Returns null for an empty layout.
 */
export function touchedSegments(
  layout: BookLayout,
  changedFrom: number,
  changedTo: number,
): { first: number; last: number } | null {
  const count = layout.segments.length;
  if (count === 0) return null;
  let first = segmentIndexForPos(layout, changedFrom);
  if (first > 0 && layout.segments[first]!.from >= changedFrom) first--;
  const last = Math.min(segmentIndexForPos(layout, changedTo), count - 1);
  return { first, last: Math.max(first, last) };
}

/**
 * The layout after segment `index`'s document text is replaced wholesale — the
 * external-reload splice. Positions cannot be derived by mapping here: the
 * replacement deletes the segment's whole range, and every `assoc` collapses
 * the NEXT segment's boundary onto the deletion start. The shift is explicit
 * instead.
 */
export function withSegmentReplaced(
  layout: BookLayout,
  index: number,
  oldLength: number,
  newLength: number,
  padded: boolean,
): BookLayout {
  const delta = newLength - oldLength;
  return {
    segments: layout.segments.map((s, i) => {
      if (i < index) return s;
      if (i === index) return { ...s, padded };
      return { ...s, from: s.from + delta };
    }),
  };
}

/**
 * Indices of segments the document has collapsed to zero length — an author
 * selected across a boundary and deleted, or emptied a chapter outright. A
 * zero-length segment shares its offset with the next one and, by
 * {@link segmentIndexForPos}'s later-segment rule, becomes untypeable: the
 * caret position that should be "inside" it resolves to its neighbour instead.
 * The editor repairs these by re-inserting the synthetic newline (which
 * {@link segmentText} strips again, so the file stays empty on disk).
 */
export function collapsedSegments(docLength: number, layout: BookLayout): number[] {
  const out: number[] = [];
  for (let i = 0; i < layout.segments.length; i++) {
    if (segmentEnd(docLength, layout, i) <= layout.segments[i]!.from) out.push(i);
  }
  return out;
}
