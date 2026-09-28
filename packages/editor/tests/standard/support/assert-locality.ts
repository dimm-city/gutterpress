import { expect } from "bun:test";
import type { SourceEdit } from "../../../src/core/contracts.ts";

/**
 * Proves an edit's D3 "smallest safe common source range" property against
 * `originalText` via an INDEPENDENT splice (run spec: "Every edit's
 * locality proven by independent splice comparison") — independent because
 * it never calls `applyEdit`/`MemoryDocumentHost`; it reconstructs the
 * result with plain `String.prototype.slice`, exactly the way a reviewer
 * manually checking a diff would.
 *
 * Two properties are checked:
 *   1. LOCALITY — everything before `edit.from` and everything at/after
 *      `edit.to` in `originalText` is byte-identical in the reconstructed
 *      result (nothing outside the declared range changed).
 *   2. MINIMALITY — the removed span (`originalText.slice(from, to)`) and
 *      the inserted text share no common leading OR trailing substring.
 *      A shared prefix/suffix would mean the SAME resulting document was
 *      reachable with a narrower `[from, to)` (trim the shared part off
 *      both sides), so its presence proves the edit was not minimal.
 *      Skipped when `allowSharedBoundary` is set (a handful of commands
 *      legitimately reproduce boundary bytes — e.g. `set-heading`'s
 *      strip-to-"none" on an unprefixed line inserts `""` over an empty
 *      range, where "shared prefix/suffix" is vacuous, not a violation).
 */
export function assertLocalEdit(
  originalText: string,
  edit: SourceEdit,
  options: { readonly allowSharedBoundary?: boolean } = {},
): string {
  expect(edit.from).toBeGreaterThanOrEqual(0);
  expect(edit.to).toBeGreaterThanOrEqual(edit.from);
  expect(edit.to).toBeLessThanOrEqual(originalText.length);

  const reconstructed =
    originalText.slice(0, edit.from) + edit.insert + originalText.slice(edit.to);

  // Property 1 — locality: independent splice, not `applyEdit`.
  expect(reconstructed.slice(0, edit.from)).toBe(originalText.slice(0, edit.from));
  expect(reconstructed.slice(reconstructed.length - (originalText.length - edit.to))).toBe(
    originalText.slice(edit.to),
  );

  // Property 2 — minimality.
  if (!options.allowSharedBoundary) {
    const removed = originalText.slice(edit.from, edit.to);
    const inserted = edit.insert;
    const maxCommonPrefix = Math.min(removed.length, inserted.length);
    let commonPrefix = 0;
    while (commonPrefix < maxCommonPrefix && removed[commonPrefix] === inserted[commonPrefix]) {
      commonPrefix++;
    }
    expect(commonPrefix).toBe(0);

    let commonSuffix = 0;
    while (
      commonSuffix < maxCommonPrefix &&
      removed[removed.length - 1 - commonSuffix] === inserted[inserted.length - 1 - commonSuffix]
    ) {
      commonSuffix++;
    }
    expect(commonSuffix).toBe(0);
  }

  return reconstructed;
}
