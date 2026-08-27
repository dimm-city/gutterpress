/**
 * `toggle-code-block {lang?}` (SFE-P2a Lane B, run spec "Command list":
 * "toggle-code-block fences the selection (```lang) or unfences when the
 * selection is exactly a fenced block").
 *
 * No desktop `toolbar-actions.ts` analog exists today (only inline
 * `` ` `` code via `applyInlineCode`) — brand new, block-level toggle.
 */
import { fencedCodeBlockRanges, touchedLines } from "./line-utils.ts";
import type { ComputedEdit } from "./wrap-inline.ts";

const FENCE = "```";

/**
 * `true` when the touched lines' extent is EXACTLY one fenced code block —
 * first touched line is that block's opening fence line, last touched line
 * is its closing fence line. A selection that merely overlaps PART of a
 * fenced block (or spans a fence plus surrounding prose) does not qualify —
 * "exactly a fenced block" per the run spec — and falls through to
 * toggle-ON (which would then wrap the fence lines themselves in another
 * fence; see this module's `computeToggleCodeBlock` doc comment for why
 * that is left as an unsupported/no-op-shaped edit rather than refused).
 */
function touchedRangeIsExactFence(
  text: string,
  firstLineStart: number,
  lastLineEnd: number,
): boolean {
  return fencedCodeBlockRanges(text).some((r) => {
    const blockEndBoundary = lastLineEnd < text.length ? lastLineEnd + 1 : text.length;
    return r.start === firstLineStart && r.end === blockEndBoundary;
  });
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

  if (lines.length >= 2 && touchedRangeIsExactFence(text, first.start, last.end)) {
    // Unfence: drop the opening and closing fence lines, keep the content
    // lines between them verbatim (possibly none, for an empty fenced block).
    const contentLines = lines.slice(1, -1);
    return { from: first.start, to: last.end, insert: contentLines.map((l) => l.text).join("\n") };
  }

  const openLine = FENCE + (lang ?? "");
  const insert = [openLine, ...lines.map((l) => l.text), FENCE].join("\n");
  return { from: first.start, to: last.end, insert };
}

/** `active` half of `commandState`'s `toggle-code-block` entry: the touched
 *  lines are exactly one fenced code block. */
export function isExactFencedBlock(text: string, start: number, endExclusive: number): boolean {
  const lines = touchedLines(text, start, endExclusive);
  if (lines.length < 2) return false;
  const first = lines[0]!;
  const last = lines[lines.length - 1]!;
  return touchedRangeIsExactFence(text, first.start, last.end);
}
