/**
 * `set-heading {level 1-6 | none}` (SFE-P2a Lane B, run spec "Command list").
 *
 * Run spec: "set-heading rewrites the line prefix ('#'.repeat(level) + ' ' —
 * level none strips; preserve setext headings honestly: a setext heading
 * gets its underline handled correctly — decide and document: converting
 * setext to ATX on explicit set-heading is an EXPLICIT edit and acceptable,
 * but ONLY the targeted heading's lines change)."
 *
 * Decision recorded here (the "decide and document" the spec asks for):
 * `set-heading` targets the ATX heading OR setext heading at
 * `selection.start`'s line only — mirrors desktop `toolbar-actions.ts`'s
 * existing `applyHeading`, which also inspects only `mainSel(view).from`'s
 * line, ignoring the rest of a multi-line selection. A setext heading
 * (`Text\n===` or `Text\n---`) is detected whether the caret sits on the
 * text line or the underline line, and `set-heading` always converts it to
 * a single ATX line (or, for `level: "none"`, to a bare paragraph line) —
 * the two original lines collapse into the ONE line D3's "smallest safe
 * common range spanning first-changed-line-start to last-changed-line-end"
 * describes for a multi-line command. No other line changes.
 */
import {
  fencedCodeBlockRanges,
  lineAfter,
  lineAt,
  lineBefore,
  minimalReplacement,
  type LineInfo,
} from "./line-utils.ts";
import type { ComputedEdit } from "./wrap-inline.ts";

export type HeadingLevel = 1 | 2 | 3 | 4 | 5 | 6;
export type SetHeadingLevel = HeadingLevel | "none";

const ATX_RE = /^(#{1,6}) /;
const SETEXT_UNDERLINE_RE = /^ {0,3}(=+|-+)[ \t]*$/;

/** A refusal reason distinct from `Diagnostic` itself (kept here, not in
 *  `core/diagnostics.ts`'s D14 taxonomy, which names PROTOCOL/host failure
 *  categories, not per-command semantic refusals — see `apply-command.ts`
 *  for how this maps onto the one D14 category ("EDITOR_INVALID_RANGE")
 *  that fits "this command's target location is unsafe to rewrite"). */
export interface HeadingRefusal {
  readonly reason: "inside-fenced-code-block";
}

function setextPair(text: string, line: LineInfo): { textLine: LineInfo; underlineLine: LineInfo } | undefined {
  if (SETEXT_UNDERLINE_RE.test(line.text) && line.text.trim().length > 0) {
    const prev = lineBefore(text, line.start);
    // A setext underline needs a non-blank text line immediately above it —
    // an underline directly at document start, or after a blank line, is
    // (per CommonMark) a thematic break / empty match, not a heading.
    if (prev && prev.text.trim().length > 0 && !ATX_RE.test(prev.text)) {
      return { textLine: prev, underlineLine: line };
    }
    return undefined;
  }
  const next = lineAfter(text, line.end);
  if (next && SETEXT_UNDERLINE_RE.test(next.text) && line.text.trim().length > 0 && !ATX_RE.test(line.text)) {
    return { textLine: line, underlineLine: next };
  }
  return undefined;
}

function prefixFor(level: SetHeadingLevel): string {
  return level === "none" ? "" : "#".repeat(level) + " ";
}

/**
 * Computes the `set-heading` edit, or a refusal when the target line falls
 * inside a fenced code block (run spec's named example refusal case:
 * rewriting a line prefix inside a fence would corrupt fenced content, which
 * is never a safe Markdown edit regardless of the requested level).
 */
export function computeSetHeading(
  text: string,
  caretOffset: number,
  level: SetHeadingLevel,
): { readonly edit: ComputedEdit } | { readonly refusal: HeadingRefusal } {
  const line = lineAt(text, caretOffset);

  const insideFence = fencedCodeBlockRanges(text).some(
    (r) => line.start >= r.start && line.start < r.end,
  );
  if (insideFence) {
    return { refusal: { reason: "inside-fenced-code-block" } };
  }

  const setext = setextPair(text, line);
  if (setext) {
    const { textLine, underlineLine } = setext;
    const oldText = text.slice(textLine.start, underlineLine.end);
    const newText = prefixFor(level) + textLine.text;
    return { edit: minimalReplacement(textLine.start, oldText, newText) };
  }

  const existing = ATX_RE.exec(line.text);
  const existingLen = existing ? existing[0].length : 0;
  const oldPrefix = line.text.slice(0, existingLen);
  const newPrefix = prefixFor(level);
  return { edit: minimalReplacement(line.start, oldPrefix, newPrefix) };
}

/** The heading level currently active at `caretOffset`'s line/setext pair,
 *  or `"none"` if it is not a heading — the `headingLevel` half of
 *  `commandState`'s `set-heading` entry. */
export function currentHeadingLevel(text: string, caretOffset: number): SetHeadingLevel {
  const line = lineAt(text, caretOffset);
  const setext = setextPair(text, line);
  if (setext) {
    return setext.underlineLine.text.trim().startsWith("=") ? 1 : 2;
  }
  const match = ATX_RE.exec(line.text);
  if (!match) return "none";
  return match[1]!.length as HeadingLevel;
}
