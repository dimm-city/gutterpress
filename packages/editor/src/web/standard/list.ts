/**
 * `toggle-list {bullet|ordered|task}` (SFE-P2a Lane B, run spec "Command
 * list": "toggle-list bullet/ordered/task adds/removes the marker per line
 * (preserve existing indentation; ordered renumbering ONLY within the
 * touched contiguous list — smallest safe range)").
 *
 * Bullet: mirrors desktop `toolbar-actions.ts`'s existing
 * `applyUnorderedList` (all-or-nothing detect, canonical `"- "` on
 * toggle-ON, matching either `"- "` or `"* "` for toggle-OFF detection) —
 * see this run's report for the byte-identical desktop mapping. This
 * module ADDS leading-indentation preservation on top of that (desktop's
 * own regexes anchor at column 0 with no indent group, so an indented list
 * item never round-trips there today); no pinned desktop test exercises an
 * indented line, so this is a strict behavioral superset, not a divergence.
 *
 * Ordered: mirrors desktop's `applyOrderedList` for the pinned single-line
 * case (no adjacent numbered lines — see `contiguousOrderedBlock` below),
 * plus the run spec's "touched contiguous list" extension for toggle-ON:
 * when the touched range sits directly against an EXISTING ordered-list run
 * above or below it, the whole contiguous run is renumbered together
 * (1..N) rather than producing a colliding or discontinuous number.
 * Desktop's own `applyOrderedList` has no such extension (it renumbers only
 * the raw selection, `i + 1` per selected line) — again, no pinned test
 * exercises an adjacent existing list, so this is additive.
 *
 * Task: no desktop analog exists today (no `applyTaskList` in
 * `toolbar-actions.ts`) — GFM task-item syntax `- [ ] `/`- [x] `, same
 * indentation and all-or-nothing shape as bullet.
 */
import { lineAfter, lineBefore, touchedLines, type LineInfo } from "./line-utils.ts";
import type { ComputedEdit } from "./wrap-inline.ts";

export type ListVariant = "bullet" | "ordered" | "task";

const INDENT_RE = /^[ \t]*/;
const TASK_RE = /^([ \t]*)[*-] \[[ xX]\] /;
// Negative lookahead excludes a task marker's "[ ] "/"[x] " suffix, so a
// task-marked line is never ALSO read as a plain bullet — see
// `activeListVariant`'s own note on why the two must not overlap.
const BULLET_RE = /^([ \t]*)[*-] (?!\[[ xX]\] )/;
const ORDERED_RE = /^([ \t]*)\d+\. /;

function indentOf(lineText: string): string {
  return (INDENT_RE.exec(lineText) ?? [""])[0]!;
}

/** Shared shape for the two fixed-marker variants (bullet, task): detect
 *  via `re`, insert `indent + onMarker + content` on toggle-ON. */
function toggleFixedMarker(
  text: string,
  start: number,
  endExclusive: number,
  re: RegExp,
  onMarker: string,
): ComputedEdit {
  const lines = touchedLines(text, start, endExclusive);
  const allMarked = lines.every((l) => re.test(l.text));
  const from = lines[0]!.start;
  const to = lines[lines.length - 1]!.end;

  const insert = lines
    .map((l) => {
      const match = re.exec(l.text);
      if (allMarked && match) {
        return match[1] + l.text.slice(match[0].length);
      }
      const indent = indentOf(l.text);
      return indent + onMarker + l.text.slice(indent.length);
    })
    .join("\n");

  return { from, to, insert };
}

/** Extends `touched` upward/downward while the adjacent line is already an
 *  ordered-list item — the run spec's "touched contiguous list" range for
 *  toggle-ON renumbering. */
function contiguousOrderedBlock(text: string, touched: readonly LineInfo[]): LineInfo[] {
  const lines = [...touched];

  let before = lineBefore(text, lines[0]!.start);
  while (before && ORDERED_RE.test(before.text)) {
    lines.unshift(before);
    before = lineBefore(text, before.start);
  }

  let after = lineAfter(text, lines[lines.length - 1]!.end);
  while (after && ORDERED_RE.test(after.text)) {
    lines.push(after);
    after = lineAfter(text, after.end);
  }

  return lines;
}

function toggleOrdered(text: string, start: number, endExclusive: number): ComputedEdit {
  const touched = touchedLines(text, start, endExclusive);
  const allListed = touched.every((l) => ORDERED_RE.test(l.text));

  if (allListed) {
    const from = touched[0]!.start;
    const to = touched[touched.length - 1]!.end;
    const insert = touched
      .map((l) => {
        const match = ORDERED_RE.exec(l.text)!;
        return match[1] + l.text.slice(match[0].length);
      })
      .join("\n");
    return { from, to, insert };
  }

  const block = contiguousOrderedBlock(text, touched);
  const from = block[0]!.start;
  const to = block[block.length - 1]!.end;
  const insert = block
    .map((l, i) => {
      const match = ORDERED_RE.exec(l.text);
      const indent = match ? match[1]! : indentOf(l.text);
      const content = match ? l.text.slice(match[0].length) : l.text.slice(indent.length);
      return `${indent}${i + 1}. ${content}`;
    })
    .join("\n");
  return { from, to, insert };
}

export function computeToggleList(
  text: string,
  start: number,
  endExclusive: number,
  variant: ListVariant,
): ComputedEdit {
  switch (variant) {
    case "bullet":
      return toggleFixedMarker(text, start, endExclusive, BULLET_RE, "- ");
    case "task":
      return toggleFixedMarker(text, start, endExclusive, TASK_RE, "- [ ] ");
    case "ordered":
      return toggleOrdered(text, start, endExclusive);
  }
}

/** `active` half of `commandState`'s `toggle-list` entry: every touched
 *  line already carries `variant`'s marker. Bullet and task share the same
 *  `[*-] ` marker family, so `BULLET_RE`'s own negative lookahead (above)
 *  keeps a task-marked line from also reading as an active bullet. */
export function activeListVariant(text: string, start: number, endExclusive: number): ListVariant | null {
  const lines = touchedLines(text, start, endExclusive);
  if (lines.length === 0) return null;
  if (lines.every((l) => TASK_RE.test(l.text))) return "task";
  if (lines.every((l) => BULLET_RE.test(l.text))) return "bullet";
  if (lines.every((l) => ORDERED_RE.test(l.text))) return "ordered";
  return null;
}
