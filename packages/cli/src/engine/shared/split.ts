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

/** `data-gp-split-cont` parts start a page: the tab must head its page, not hang off the foot of the last. */
export const SPLIT_CSS = "[data-gp-split-cont] { break-before: page; }";

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
}

export type SplitDiagnosticCode =
  | "engine.split.unsplittable"
  | "engine.split.unconverged"
  | "engine.split.text-changed"
  | "engine.split.template"
  | "engine.split.page-drift";

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
 * One break fewer: the unit the head part may keep after the closed foot cost
 * it the room, or null when no unit would be left to keep (the split is then
 * reverted and the card stays native).
 */
export function pullBack(unit: number): number | null {
  return unit - 1 >= 1 ? unit - 1 : null;
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

export interface SplitResult extends SplitStats {
  ops: SplitOp[];
  diagnostics: SplitDiagnostic[];
  /** ids of the continuations (document order), for the page-drift check */
  continuations: string[];
  ms: number;
}

/** The one-line log: `split: N breaks, +P pages` and the scopes that grew. */
export function describeSplit(ops: SplitOp[], stats: SplitStats): string {
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
    (grown.length ? `; grew: ${grown.join(", ")}` : "")
  );
}
