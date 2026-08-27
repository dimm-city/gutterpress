/**
 * Line-local helpers shared by every command in `web/standard/**` (SFE-P2a
 * Lane B). Pure string math — no DOM, no CodeMirror, no host dependency
 * (D2/D3: a command computes an edit from the CURRENT snapshot + selection
 * only). Deliberately hand-rolled instead of reusing a CodeMirror `Text`
 * object: `packages/editor` stays framework-free (D4), and these functions
 * are simple enough (line lookup, line iteration, a bounded fence scan) that
 * a dependency would cost more than it saves.
 */

/** One line's extent within `text`. `start`/`end` exclude the line's own
 *  terminating `\n` (a line at end-of-document with no trailing newline has
 *  `end === text.length`, matching every other line's "one past the last
 *  content character" meaning). */
export interface LineInfo {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const NEWLINE = 10; // "\n".charCodeAt(0)

/**
 * The line containing `offset`. Mirrors CodeMirror's `Text.lineAt`
 * convention (and therefore `toolbar-actions.ts`'s existing
 * `doc.lineAt(...)` calls this package's commands replace): a position
 * exactly one past a `\n` belongs to the FOLLOWING line, not the one that
 * newline ends. `offset` is clamped into `[0, text.length]` — callers pass
 * already-validated selection offsets, but clamping keeps this function
 * total rather than trusting every caller.
 */
export function lineAt(text: string, offset: number): LineInfo {
  const clamped = Math.min(Math.max(offset, 0), text.length);
  let start = clamped;
  while (start > 0 && text.charCodeAt(start - 1) !== NEWLINE) start--;
  let end = clamped;
  while (end < text.length && text.charCodeAt(end) !== NEWLINE) end++;
  return { start, end, text: text.slice(start, end) };
}

/**
 * Every line touched by the half-open range `[start, endExclusive)` — i.e.
 * `lineAt(start)` through `lineAt(endExclusive)` inclusive, exactly the
 * `doc.lineAt(from).number` .. `doc.lineAt(to).number` loop every multi-line
 * `toolbar-actions.ts` helper (blockquote, lists) already runs today. A
 * caret selection (`start === endExclusive`) yields exactly one line.
 */
export function touchedLines(text: string, start: number, endExclusive: number): LineInfo[] {
  const first = lineAt(text, start);
  const last = lineAt(text, endExclusive);
  if (first.start === last.start) return [first];

  const lines: LineInfo[] = [first];
  let cursor = first.end + 1; // skip the newline that ends `first`
  while (cursor <= last.start) {
    const line = lineAt(text, cursor);
    lines.push(line);
    if (line.start === last.start) break;
    cursor = line.end + 1;
  }
  return lines;
}

/** The line immediately BEFORE the line starting at `lineStart` (`null` at
 *  document start). `lineStart - 1` is the separating `\n`, and `lineAt` of
 *  a position exactly ON a `\n` returns the line that newline terminates —
 *  see `lineAt`'s own doc comment. */
export function lineBefore(text: string, lineStart: number): LineInfo | null {
  if (lineStart <= 0) return null;
  return lineAt(text, lineStart - 1);
}

/** The line immediately AFTER the line ending at `lineEnd` (`null` at
 *  document end / no trailing newline). `lineEnd` is the separating `\n`
 *  itself (or `text.length` with no trailing newline, handled by the guard
 *  above), so the next line starts at `lineEnd + 1`. */
export function lineAfter(text: string, lineEnd: number): LineInfo | null {
  if (lineEnd >= text.length) return null;
  return lineAt(text, lineEnd + 1);
}

/** The offset one past the end of the line containing `offset` — the
 *  insertion point every "insert a block after the current line" command
 *  uses (mirrors `toolbar-actions.ts`'s own `insertionPointAfterCurrentLine`
 *  helper, ported here so the shared commands need no CodeMirror `EditorView`
 *  to compute it). */
export function insertionPointAfterLine(text: string, offset: number): number {
  return lineAt(text, offset).end;
}

/**
 * The `[start, end)` ranges of every fenced code block in `text`, using a
 * deliberately bounded (not full-CommonMark) fence rule sufficient for this
 * run's ONE consumer — `set-heading`'s "refuse inside a fenced code block"
 * case (behavior table) — not a general-purpose Markdown parser:
 *
 *   - an opening fence is a line whose content, after up to 3 leading
 *     spaces, is 3-or-more of the SAME fence character (`` ` `` or `~`) and
 *     nothing else but the character itself (an info string after the
 *     fence, e.g. ` ```lang`, is still an opening fence — CommonMark allows
 *     it for backtick fences; this scanner allows it for either character,
 *     which only widens what counts as "inside a fence", never narrows it —
 *     the safe direction for a refusal check);
 *   - the block closes at the next line whose OWN fence run (same
 *     character, no info string, `` ` `` fences may not close with
 *     unescaped backticks after — this scanner does not special-case that
 *     escaping nuance) has length >= the opening run's length;
 *   - an unclosed fence runs to end-of-document (CommonMark's own rule),
 *     so `set-heading` still refuses rather than guessing where it ends.
 *
 * Ranges are LINE-aligned (`start` is the opening fence line's start,
 * `end` is one past the closing fence line's end, or `text.length` for an
 * unclosed fence) so a range boundary is never inside a line.
 */
export function fencedCodeBlockRanges(text: string): Array<{ start: number; end: number }> {
  const ranges: Array<{ start: number; end: number }> = [];
  const openFence = /^ {0,3}(`{3,}|~{3,})/;

  let offset = 0;
  while (offset <= text.length) {
    const line = lineAt(text, offset);
    const openMatch = openFence.exec(line.text);
    if (openMatch) {
      const fenceChar = openMatch[1]![0];
      const fenceLen = openMatch[1]!.length;
      const closeFence = new RegExp(`^ {0,3}\\${fenceChar}{${fenceLen},}\\s*$`);

      let cursor = line.end + 1;
      let closed = false;
      while (cursor <= text.length) {
        const candidate = lineAt(text, cursor);
        if (closeFence.test(candidate.text)) {
          // `+ 1` skips the newline after the closing fence line — capped
          // at `text.length` for a closing fence with no trailing newline
          // (i.e. the fence is the last line in the document), so `end`
          // never reports a position past the document's own length.
          const end = Math.min(candidate.end + 1, text.length);
          ranges.push({ start: line.start, end });
          offset = candidate.end + 1;
          closed = true;
          break;
        }
        if (candidate.end >= text.length) break;
        cursor = candidate.end + 1;
      }
      if (closed) continue;

      // Unclosed: runs to end-of-document.
      ranges.push({ start: line.start, end: text.length });
      break;
    }
    if (line.end >= text.length) break;
    offset = line.end + 1;
  }

  return ranges;
}

/** Whether `offset` falls inside any fenced code block in `text` (D14
 *  `set-heading` refusal case). `offset === range.end` is OUTSIDE — that
 *  position is the start of whatever line follows the closing fence. */
export function isInsideFencedCodeBlock(text: string, offset: number): boolean {
  return fencedCodeBlockRanges(text).some((r) => offset >= r.start && offset < r.end);
}

/**
 * Narrows a "replace `oldText` (currently occupying `[start, start +
 * oldText.length)`) with `newText`" edit to the smallest range that still
 * produces the identical result, by trimming any common leading and
 * trailing substring shared by `oldText`/`newText` (D3: "the smallest safe
 * common source range"). Used by `heading.ts`, whose ATX/setext rewrites
 * would otherwise replace an entire prefix (or an entire setext pair) even
 * when only one character actually changes — e.g. `"## "` -> `"### "` is,
 * byte-for-byte, a single `"#"` INSERTION between the existing `"##"` and
 * the trailing space, not a full 3-for-4-character replacement.
 */
export function minimalReplacement(
  start: number,
  oldText: string,
  newText: string,
): { readonly from: number; readonly to: number; readonly insert: string } {
  const maxPrefix = Math.min(oldText.length, newText.length);
  let prefix = 0;
  while (prefix < maxPrefix && oldText[prefix] === newText[prefix]) prefix++;

  const maxSuffix = Math.min(oldText.length - prefix, newText.length - prefix);
  let suffix = 0;
  while (
    suffix < maxSuffix &&
    oldText[oldText.length - 1 - suffix] === newText[newText.length - 1 - suffix]
  ) {
    suffix++;
  }

  return {
    from: start + prefix,
    to: start + oldText.length - suffix,
    insert: newText.slice(prefix, newText.length - suffix),
  };
}
