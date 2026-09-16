/**
 * `insert-table {rows, cols}` (SFE-P2a Lane B, run spec "Command list":
 * "insert-table generates the pipe skeleton rows x cols at the line
 * boundary").
 *
 * Column skeleton (header text, `------` separator cells, `Cell`
 * placeholder body cells) matches desktop `toolbar-actions.ts`'s existing
 * `applyTable` exactly, including its `[1, 10]` column clamp — so mapping
 * desktop's `applyTable(view, cols)` onto `applyCommand({kind:
 * "insert-table", rows: 1, cols})` is byte-identical (desktop always
 * inserts exactly one body row; `rows: 1` reproduces that). `rows` is new
 * (desktop's skeleton is fixed at one body row) — clamped to `[1, 50]`, a
 * sane guard against a pathological caller-supplied count, not a spec-
 * mandated bound.
 */
import { insertionPointAfterLine } from "./line-utils.ts";
import type { ComputedEdit } from "./wrap-inline.ts";

const MIN_COLS = 1;
const MAX_COLS = 10;
const MIN_ROWS = 1;
const MAX_ROWS = 50;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.trunc(value)));
}

export function computeInsertTable(
  text: string,
  caretOffset: number,
  rows: number,
  cols: number,
): ComputedEdit {
  const safeCols = clamp(cols, MIN_COLS, MAX_COLS);
  const safeRows = clamp(rows, MIN_ROWS, MAX_ROWS);

  const header = Array.from({ length: safeCols }, (_, i) => `Header ${i + 1}`);
  const sep = Array.from({ length: safeCols }, () => "------");
  const dataRow = "| " + Array.from({ length: safeCols }, () => "Cell").join(" | ") + " |";

  const headerRow = "| " + header.join(" | ") + " |";
  const sepRow = "| " + sep.join(" | ") + " |";
  const bodyRows = Array.from({ length: safeRows }, () => dataRow);

  const insert = "\n\n" + [headerRow, sepRow, ...bodyRows].join("\n") + "\n\n";
  const insertAt = insertionPointAfterLine(text, caretOffset);
  return { from: insertAt, to: insertAt, insert };
}
