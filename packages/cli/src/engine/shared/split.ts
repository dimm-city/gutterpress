/**
 * Measured split — the pure policy.
 *
 * An element marked `data-gp-split` whose content spans a page boundary is cut
 * at the measured break into a head part and a continuation, moving whole
 * units (block children, list items, table rows, declared units). Every rule
 * that DECIDES something lives here as a pure function with a direct unit
 * test, as `synthesis.ts` does for blank pages (DESIGN-RULES.md §1). The DOM
 * work is `split-dom.ts`; the measuring loop is `viewer/split.ts`. The
 * compiler and the preview run that same loop, and the print page replays its
 * recorded operations, so none of the three has a policy of its own.
 */

/** Viewer-only measure passes the split loop may take (separate from the print `maxPasses`). */
export const SPLIT_PASS_CAP = 24;

/**
 * `data-gp-split-cont` parts start a page: the tab must head its page, not hang off the foot of the
 * last. A forced break keeps the margin that touches it (an unforced one drops it), so a continuation
 * with a negative top margin, as a card whose tab overhangs its top has, would start in the last
 * 4px of the page before and print a hairline of its tab there: its top margin is dropped, as the
 * browser drops it for a card that falls on a new page by itself.
 */
export const SPLIT_CSS = "[data-gp-split-cont] { break-before: page; margin-block-start: 0; }";

/** What a unit is, for the census the build logs. */
export type SplitKind = "block" | "list-item" | "table-row" | "unit" | "paragraph";

/**
 * One recorded split. `n` is the card's ordinal among `[data-gp-split]`
 * elements in document order at the moment the op ran; `unit` the flat index
 * of the first unit moved to the continuation. Replaying the ops in order on
 * the same document reproduces the same DOM.
 */
export interface SplitOp {
  n: number;
  unit: number;
  kind: SplitKind;
  /** a paragraph unit is cut before this word (0-based, whitespace-separated); absent = break before the unit */
  word?: number;
}

export type SplitDiagnosticCode =
  | "engine.split.unsplittable"
  | "engine.split.unconverged"
  | "engine.split.text-changed"
  | "engine.split.template"
  | "engine.split.page-drift"
  | "engine.split.failed"
  | "engine.split.head-spill";

export interface SplitDiagnostic {
  code: SplitDiagnosticCode;
  message: string;
}

/**
 * The first unit that is not wholly on the page the card starts on, or -1.
 * `lastPages[i]` is the last page unit `i` occupies. Everything before the
 * returned unit is final: a split only adds height after its break.
 */
export function firstCrossingUnit(startPage: number, lastPages: number[]): number {
  return lastPages.findIndex((p) => p > startPage);
}

/**
 * The cut point moved back over units that must stay with the next one
 * (`break-after: avoid` on the unit before, `break-before: avoid` on the
 * unit itself), so a sub-heading never ends a head part. `joined[i]` is true
 * when no break is allowed before unit `i`. Stops at 1: a head keeps a unit.
 */
export function stepBackOverAvoid(k: number, joined: boolean[]): number {
  let i = k;
  while (i > 1 && joined[i]) i--;
  return joined[i] && i === 1 ? k : i;
}

/**
 * Where the print starts to disagree with the preview: the continuations
 * whose page offset (print minus preview) differs from the one before it.
 * An offset that holds from there on is the layouts drifting once, upstream
 * of any cut, and is reported once, not once per continuation.
 */
export function driftOrigins(offsets: Array<number | undefined>): number[] {
  const origins: number[] = [];
  let prev = 0;
  offsets.forEach((o, i) => {
    if (o === undefined) return;
    if (o !== prev) origins.push(i);
    prev = o;
  });
  return origins;
}

/**
 * One break fewer: the unit the head part may keep after the closed foot cost
 * it the room, or null when no unit would be left to keep (the split is then
 * reverted and the card stays native).
 */
export function pullBack(unit: number): number | null {
  return unit - 1 >= 1 ? unit - 1 : null;
}

/** Lines a paragraph keeps on each side of a cut (orphans and widows). */
export const MIN_LINES = 2;

/** One word of a paragraph as measured: its line (consecutive, in order) and the last page it touches. */
export interface WordPos {
  line: number;
  lastPage: number;
}

/**
 * Where to cut a paragraph that starts on the card's page and runs onto the
 * next: before the first word not wholly on the start page (a word broken at
 * a hyphen across the boundary moves whole), but never leaving fewer than
 * `MIN_LINES` lines on either side. Null means break before the whole
 * paragraph instead.
 */
export function chooseWordBreak(words: WordPos[], startPage: number): number | null {
  let i = words.findIndex((w) => w.lastPage > startPage);
  if (i < 1) return null;
  const lastLine = words[words.length - 1]!.line;
  if (lastLine - words[i]!.line + 1 < MIN_LINES) {
    i = words.findIndex((w) => w.line === lastLine - (MIN_LINES - 1));
    if (i < 1) return null;
  }
  return words[i - 1]!.line - words[0]!.line + 1 >= MIN_LINES ? i : null;
}

/**
 * One line fewer for a head part that still spans a page: the cut moves to the
 * start of the head's last line, or null (cut before the whole paragraph) if
 * that would leave fewer than `MIN_LINES` lines.
 */
export function pullBackWord(lines: number[]): number | null {
  if (!lines.length) return null;
  const last = lines[lines.length - 1]!;
  if (last - lines[0]! + 1 < MIN_LINES + 1) return null;
  return lines.findIndex((l) => l === last);
}

/**
 * At most one split per scope per pass: the first card of each scope that
 * still spans pages. A scope's cards share one flow, so a split moves every
 * later one; separate scopes start on their own pages and cannot influence
 * each other, so they go in the same pass.
 */
export function pickPerScope(cards: Array<{ scope: string; spans: boolean }>): number[] {
  const seen = new Set<string>();
  const picked: number[] = [];
  cards.forEach((c, i) => {
    if (!c.spans || seen.has(c.scope)) return;
    seen.add(c.scope);
    picked.push(i);
  });
  return picked;
}

/** The words of a text, whitespace-normalised: the invariant a split must keep. */
export function wordsOf(text: string): string[] {
  return text.split(/\s+/).filter(Boolean);
}

export function sameWords(before: string[], after: string[]): boolean {
  return before.length === after.length && before.every((w, i) => w === after[i]);
}

/** Pages a scope occupies, from its cards' page ranges (inclusive, 0-based). */
export function spanPages(ranges: Array<[number, number]>): number {
  if (!ranges.length) return 0;
  return Math.max(...ranges.map((r) => r[1])) - Math.min(...ranges.map((r) => r[0])) + 1;
}

export interface SplitStats {
  pagesBefore: number;
  pagesAfter: number;
  passes: number;
  kinds: Record<string, number>;
  scopes: Array<{ scope: string; before: number; after: number }>;
}

/** What the build reads back from print: where each continuation and the last unit of its head landed. */
export interface SplitIds {
  /** ids of the continuations' flow elements, in document order */
  continuations: string[];
  /** id of the last unit of the part each continuation was cut from (same order) */
  heads: string[];
}

export interface SplitResult extends SplitStats, SplitIds {
  ops: SplitOp[];
  diagnostics: SplitDiagnostic[];
  ms: number;
}

/** The one-line log: `split: N breaks, +P pages` and the scopes that grew. */
export function describeSplit(ops: SplitOp[], stats: SplitStats, ms?: number): string {
  const grown = stats.scopes
    .filter((s) => s.after !== s.before)
    .map((s) => `${s.scope || "(all)"} ${s.before}->${s.after}`);
  const kinds = Object.entries(stats.kinds)
    .map(([k, n]) => `${n} ${k}`)
    .join(", ");
  const delta = stats.pagesAfter - stats.pagesBefore;
  return (
    `split: ${ops.length} break(s)${kinds ? ` (${kinds})` : ""}, ` +
    `${stats.pagesBefore}pp -> ${stats.pagesAfter}pp (${delta >= 0 ? "+" : ""}${delta}), ` +
    `${stats.passes} pass(es)` +
    (ms === undefined ? "" : ` in ${(ms / 1000).toFixed(1)}s`) +
    (grown.length ? `; grew: ${grown.join(", ")}` : "")
  );
}
