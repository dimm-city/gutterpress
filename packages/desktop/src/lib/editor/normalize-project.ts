/**
 * Project-wide normalize-on-adoption.
 *
 * Rich editing rewrites a file canonically when it saves — bullet characters,
 * emphasis markers, wrapping. That bargain is what keeps the serializer small
 * enough to be correct (see `markdown-doc/serializer.ts`), but paid one file at
 * a time it scatters formatting churn across every later diff, and an author's
 * snapshot history stops being readable.
 *
 * So pay it once, deliberately: normalize the whole project in a single
 * commit, before rich editing is used on it. After that, saving a file the
 * author did not touch produces no diff at all.
 *
 * ## What this refuses to do
 *
 * Two refusals, and both are the point of the module rather than edge cases:
 *
 * 1. **A file the document model cannot represent is left alone.** Footnotes,
 *    deflists and unmodelled plugin constructs raise in the parser, and the
 *    file is reported rather than rewritten — the same fail-closed rule the
 *    editor uses to open a file in source mode.
 * 2. **A file whose normalization is not a FIXPOINT is left alone.** If
 *    `normalize(normalize(x)) !== normalize(x)`, then writing the normalized
 *    form does not settle the churn, it just moves it: the author's very next
 *    save would change the file again. Refusing surfaces a serializer bug
 *    instead of committing its output to somebody's book.
 *
 * Neither refusal is silent. A refusal that nobody can see is how the
 * postmortem's coverage thresholds hid real lossiness.
 *
 * ## The change is bigger than "bullets and emphasis" — know this before
 * ## running it
 *
 * Measured on the first-party corpus: **27 of 32 files change.** The dominant
 * edit is not bullet characters, it is UNWRAPPING — a hand-wrapped paragraph
 * comes back as one long line, because a soft line break inside a paragraph is
 * just a space in markdown and `prosemirror-markdown` does not re-wrap.
 *
 * Nothing is lost: the rendered output is identical and the result is
 * fixpoint-stable. The costs are that an author who hand-wraps will not get
 * that formatting back, and that lines on disk get long — median 238
 * characters, p95 877.
 *
 * **Re-wrapping was evaluated and rejected on measurement, not taste.** Across
 * 139 real paragraphs and 417 simulated single-word edits:
 *
 * | strategy            | adoption churn | changed lines/edit | worst | median line |
 * |---------------------|----------------|--------------------|-------|-------------|
 * | one line (this)     |     1045 lines |               2.00 |     2 |      238 ch |
 * | re-wrap at 80 cols  |     1826 lines |               2.90 |    14 |       75 ch |
 * | one sentence a line |     1504 lines |               2.04 |     3 |      113 ch |
 *
 * Wrapping loses on BOTH counts it would be adopted for: it nearly doubles the
 * one-time churn, and greedy re-flow cascades make an ordinary edit dirty up
 * to 14 lines where leaving paragraphs alone always dirties exactly 2. (It
 * also broke the fixpoint on a real corpus file in prototype.) So the long
 * lines are the deliberate trade, and re-opening this needs new numbers, not a
 * new opinion.
 *
 * Paying the churn once per project is the entire reason this module exists.
 * It is NOT something to discover halfway through a book — show the author the
 * plan (`planNormalize` writes nothing) and let them agree to it.
 */
import type MarkdownIt from "markdown-it";
import { createEditorRenderer, isFixpoint } from "./markdown-doc";

export interface NormalizeInput {
  /** Project-relative path, used only for reporting. */
  path: string;
  text: string;
}

export interface NormalizeReport {
  /** Files whose canonical form differs — these are the writes to make. */
  changed: Array<{ path: string; text: string }>;
  /** Files already canonical. Nothing to write. */
  unchanged: string[];
  /** Files deliberately not rewritten, each with a stated reason. */
  refused: Array<{ path: string; reason: string }>;
}

/**
 * Compute the normalization for a set of files WITHOUT writing anything.
 *
 * Pure and host-free, so the caller decides what to do with the result — the
 * desktop route writes the files, and a preview of the report can be shown to
 * the author first. That separation is what makes "one deliberate commit"
 * something an author can consent to rather than discover afterwards.
 */
export function planNormalize(
  files: readonly NormalizeInput[],
  md: MarkdownIt = createEditorRenderer(),
): NormalizeReport {
  const report: NormalizeReport = { changed: [], unchanged: [], refused: [] };

  for (const file of files) {
    let result: ReturnType<typeof isFixpoint>;
    try {
      result = isFixpoint(md, file.text);
    } catch (err) {
      report.refused.push({
        path: file.path,
        reason: err instanceof Error ? err.message : String(err),
      });
      continue;
    }

    if (!result.ok) {
      report.refused.push({
        path: file.path,
        reason:
          "normalizing is not stable for this file — a second save would change it again, " +
          "so it is left as the author wrote it",
      });
      continue;
    }

    if (result.normalized === file.text) report.unchanged.push(file.path);
    else report.changed.push({ path: file.path, text: result.normalized });
  }

  return report;
}

/** A one-line summary for a confirmation prompt or a commit message. */
export function summarizeNormalize(report: NormalizeReport): string {
  const parts = [`${report.changed.length} file(s) reformatted`];
  if (report.unchanged.length) parts.push(`${report.unchanged.length} already canonical`);
  if (report.refused.length) parts.push(`${report.refused.length} left unchanged`);
  return parts.join(", ");
}
