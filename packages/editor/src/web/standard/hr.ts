/**
 * `insert-horizontal-rule` (SFE-P2a Lane B, run spec "Command list":
 * "insert-horizontal-rule inserts '---' on its own line at the caret's line
 * boundary"). Matches desktop `toolbar-actions.ts`'s existing `applyHr`
 * byte-for-byte: same `"\n\n---\n\n"` snippet at the same insertion point
 * (one past the caret's line — `selection.endExclusive` is ignored, exactly
 * as `applyHr` ignores everything but `mainSel(view).from`).
 */
import { insertionPointAfterLine } from "./line-utils.ts";
import type { ComputedEdit } from "./wrap-inline.ts";

export function computeInsertHorizontalRule(text: string, caretOffset: number): ComputedEdit {
  const insertAt = insertionPointAfterLine(text, caretOffset);
  return { from: insertAt, to: insertAt, insert: "\n\n---\n\n" };
}
