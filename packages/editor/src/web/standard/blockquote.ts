/**
 * `toggle-blockquote` (SFE-P2a Lane B, run spec "Command list": "toggle-
 * blockquote adds/removes '> ' per selected line").
 *
 * Mirrors desktop `toolbar-actions.ts`'s existing `applyBlockquote` exactly
 * (same all-or-nothing detection, same fixed 2-char `"> "` prefix) so the
 * desktop mapping in this run's `toolbar-actions.ts` is byte-identical —
 * see this module's sibling `line-utils.ts`'s `touchedLines` for why one
 * combined `[firstLine.start, lastLine.end)` edit produces the SAME text as
 * `toolbar-actions.ts`'s N per-line CodeMirror changes: the edits are
 * non-overlapping and never touch the newlines between touched lines, so
 * reconstructing via `lines.map(transform).join("\n")` is bytewise
 * equivalent to applying each line's change independently.
 */
import { touchedLines } from "./line-utils.ts";
import type { ComputedEdit } from "./wrap-inline.ts";

const QUOTE_PREFIX = "> ";

export function computeToggleBlockquote(text: string, start: number, endExclusive: number): ComputedEdit {
  const lines = touchedLines(text, start, endExclusive);
  const allQuoted = lines.every((l) => l.text.startsWith(QUOTE_PREFIX));

  const from = lines[0]!.start;
  const to = lines[lines.length - 1]!.end;
  const insert = lines
    .map((l) => (allQuoted ? l.text.slice(QUOTE_PREFIX.length) : QUOTE_PREFIX + l.text))
    .join("\n");

  return { from, to, insert };
}

/** `active` half of `commandState`'s `toggle-blockquote` entry: every
 *  touched line already carries the `"> "` prefix. */
export function isBlockquoteActive(text: string, start: number, endExclusive: number): boolean {
  return touchedLines(text, start, endExclusive).every((l) => l.text.startsWith(QUOTE_PREFIX));
}
