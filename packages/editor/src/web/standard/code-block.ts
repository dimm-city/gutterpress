/**
 * `toggle-code-block {lang?}` (SFE-P2a Lane B, run spec "Command list":
 * "toggle-code-block fences the selection (```lang) or unfences when the
 * selection is exactly a fenced block").
 *
 * No desktop `toolbar-actions.ts` analog exists today (only inline
 * `` ` `` code via `applyInlineCode`) — brand new, block-level toggle.
 */
import { fencedCodeBlockRanges, touchedLines, type LineInfo } from "./line-utils.ts";
import type { ComputedEdit } from "./wrap-inline.ts";

const FENCE = "```";

interface ExactFenceMatch {
  /**
   * `true` when the ONLY thing after the closing fence line is the
   * document's own trailing newline — the empty "phantom" final line
   * `lineAt`/`touchedLines` reports one past a trailing `\n` (mirroring
   * CodeMirror's own `Text.lineAt`, which creates the identical extra empty
   * final line for a trailing-newline document — see `line-utils.ts`). When
   * `true`, the unfenced result keeps that trailing newline so the
   * document's trailing-newline shape survives the round trip.
   */
  readonly trailingNewline: boolean;
}

/**
 * `true` when the touched lines' extent is EXACTLY one CLOSED fenced code
 * block: `first` is that block's opening fence line, and `last` is its
 * closing fence line — compared by the closing fence LINE's own `[start,
 * end)` (from `fencedCodeBlockRanges`), never by arithmetic on `range.end`
 * (which is one PAST the closing line, through its trailing newline, and so
 * cannot distinguish "last touched line IS the closing fence" from "last
 * touched line is some OTHER line that merely ends at the same offset" — the
 * bug this function used to have).
 *
 * The one exception: when the document ends immediately after the closing
 * fence's own trailing newline, `last` is the empty phantom line one past
 * it (see `ExactFenceMatch.trailingNewline` above) — still exact, since
 * nothing was authored beyond that newline.
 *
 * An UNCLOSED fence never matches (there is no closing line to compare
 * against), and a selection that stops short of / overshoots the closing
 * fence line never matches either — "exactly a fenced block" per the run
 * spec — both fall through to toggle-ON, which wraps the touched lines in a
 * NEW fence rather than guessing at a destructive unfence.
 */
function exactFenceMatch(text: string, first: LineInfo, last: LineInfo): ExactFenceMatch | undefined {
  const range = fencedCodeBlockRanges(text).find((r) => r.start === first.start);
  if (!range || !range.closed) return undefined;
  const closeLineStart = range.closeLineStart!;
  const closeLineEnd = range.closeLineEnd!;

  if (closeLineStart === last.start && closeLineEnd === last.end) {
    return { trailingNewline: false };
  }
  const isTrailingPhantomLine =
    last.text === "" && last.end === text.length && last.start === closeLineEnd + 1;
  if (isTrailingPhantomLine) {
    return { trailingNewline: true };
  }
  return undefined;
}

export function computeToggleCodeBlock(
  text: string,
  start: number,
  endExclusive: number,
  lang: string | undefined,
): ComputedEdit {
  const lines = touchedLines(text, start, endExclusive);
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;

  if (lines.length >= 2) {
    const match = exactFenceMatch(text, first, last);
    if (match) {
      // Unfence: drop the opening and closing fence lines, keep every other
      // touched line verbatim (including a trailing blank line, and possibly
      // none at all, for an empty fenced block) — see `exactFenceMatch`'s
      // doc comment for the trailing-newline case.
      const closeLineIndex = match.trailingNewline ? lines.length - 2 : lines.length - 1;
      const contentLines = lines.slice(1, closeLineIndex);
      const insert = contentLines.map((l) => l.text).join("\n") + (match.trailingNewline ? "\n" : "");
      return { from: first.start, to: last.end, insert };
    }
  }

  const openLine = FENCE + (lang ?? "");
  const insert = [openLine, ...lines.map((l) => l.text), FENCE].join("\n");
  return { from: first.start, to: last.end, insert };
}

/** `active` half of `commandState`'s `toggle-code-block` entry: the touched
 *  lines are exactly one fenced code block (see `exactFenceMatch`) — the
 *  SAME predicate `computeToggleCodeBlock` uses to decide whether to
 *  unfence, so `commandState.active` can never advertise a toggle that
 *  would actually fence (or vice versa). */
export function isExactFencedBlock(text: string, start: number, endExclusive: number): boolean {
  const lines = touchedLines(text, start, endExclusive);
  if (lines.length < 2) return false;
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  return exactFenceMatch(text, first, last) !== undefined;
}
