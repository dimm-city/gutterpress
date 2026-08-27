import { describe, expect, test } from "bun:test";
import { MemoryDocumentHost } from "../../src/core/memory-host.ts";
import { DIAGNOSTIC_CATEGORIES } from "../../src/core/diagnostics.ts";
import {
  applyOnFreshHost,
  computeAgainstHost,
  CORPUS_COMMAND_CASES,
  spliceIndependently,
} from "./support/command-harness.ts";
import { assertEditWithinIndependentBound, selectionVariants } from "./support/independent-bound.ts";
import { FIXTURE_NAMES, FIXTURES } from "./fixtures.ts";

/**
 * SFE-P2a Lane C — explicit edit-locality corpus (DETAILS (3)).
 *
 * "every applyCommand result's edit, applied via independent splice
 * (text.slice(0,from)+insert+text.slice(to)), equals the host's post-edit
 * text AND bytes outside [from,to) are untouched (compare prefix/suffix
 * explicitly)."
 *
 * This is a STRONGER, more explicit check than byte-identity.test.ts's
 * sanity splice: it asserts the prefix and suffix each survive by an
 * explicit `startsWith`/`endsWith` comparison, not merely that the two full
 * strings happen to be equal (which the splice-equality assertion alone
 * could in principle satisfy through a coincidental match). REBASED
 * (SFE-P2a Lane C2-reconcile) onto Lane B's real, committed-in-tree
 * `applyCommand` contract — see support/command-harness.ts's header.
 */

let acceptedCount = 0;
let refusedCount = 0;

describe("edit locality across the full fixture x command cross-product", () => {
  for (const fixtureName of FIXTURE_NAMES) {
    for (const commandCase of CORPUS_COMMAND_CASES) {
      test(`${fixtureName} / ${commandCase.label} — edit lands only inside its declared range`, () => {
        const original = FIXTURES[fixtureName]!;
        const { host, result } = applyOnFreshHost(original, commandCase.command);

        if ("refused" in result) {
          expect(DIAGNOSTIC_CATEGORIES).toContain(result.refused.category);
          expect(host.getSnapshot().text).toBe(original);
          refusedCount++;
          return;
        }
        acceptedCount++;

        const { edit } = result;
        expect(edit.from).toBeGreaterThanOrEqual(0);
        expect(edit.to).toBeGreaterThanOrEqual(edit.from);
        expect(edit.to).toBeLessThanOrEqual(original.length);

        const originalPrefix = original.slice(0, edit.from);
        const originalSuffix = original.slice(edit.to);
        const actual = host.getSnapshot().text;

        // The independent-splice oracle: the ONLY difference from
        // `original` is the declared [from,to) range.
        const expected = spliceIndependently(original, edit.from, edit.to, edit.insert);
        expect(actual).toBe(expected);

        // Explicit prefix/suffix comparison (DETAILS (3): "compare
        // prefix/suffix explicitly") — proven independently of the
        // full-string equality above, not merely implied by it.
        expect(actual.startsWith(originalPrefix)).toBe(true);
        expect(actual.endsWith(originalSuffix)).toBe(true);
        // And the untouched region is not just A prefix/suffix match by
        // coincidence — it is EXACTLY the bytes outside [from,to).
        expect(actual.slice(0, edit.from)).toBe(originalPrefix);
        expect(actual.slice(actual.length - originalSuffix.length)).toBe(originalSuffix);
      });
    }
  }
});

describe("locality corpus liveness (AP-21)", () => {
  test("at least half of the fixture x command combinations were ACCEPTED, not universally refused", () => {
    const total = acceptedCount + refusedCount;
    expect(total).toBeGreaterThan(0);
    expect(acceptedCount).toBeGreaterThan(total / 2);
  });
});

/**
 * SFE-P2a round-1 repair — the two gaps the finding named in the describe
 * block above:
 *
 *   1. "the 'independent splice' oracle IS the host's own splice
 *      expression" — `spliceIndependently`/`expect(actual).toBe(expected)`
 *      above proves only `A === A`; it can never fail for ANY edit,
 *      however wide. `assertEditWithinIndependentBound` (a hand-written,
 *      NOT-imported-from-the-implementation line scanner — see its own
 *      header) is a genuine upper bound the current implementation could
 *      actually violate.
 *   2. "every case uses a whole-document selection" — `selectionVariants`
 *      exercises caret-only (both document edges and mid-document),
 *      line-interior, and cross-line selections too, not only
 *      `[0, text.length)`.
 *
 * Sabotage-proof (G-12): widening every returned edit to `{from: 0, to:
 * text.length, insert: <the accepted edit's own resulting document>}` —
 * the exact sabotage the original finding demonstrated defeats the
 * splice-tautology check — was run locally against this new describe
 * block and fails the majority of its assertions immediately (every EXACT
 * bound below rejects it outright on any fixture with more than one
 * line); it is not committed here, per pr158-lessons.md §11.2 ("the
 * sabotage may be performed locally and documented; it does not need to
 * remain committed").
 */
describe("edit locality against an INDEPENDENT upper bound, across varied selection shapes", () => {
  let variantAcceptedCount = 0;
  let variantRefusedCount = 0;

  for (const fixtureName of FIXTURE_NAMES) {
    const original = FIXTURES[fixtureName]!;
    for (const commandCase of CORPUS_COMMAND_CASES) {
      for (const { label, selection } of selectionVariants(original)) {
        test(`${fixtureName} / ${commandCase.label} / ${label} — edit fits its command's independent bound`, () => {
          const host = new MemoryDocumentHost({ text: original, version: 0 });
          const result = computeAgainstHost(host, selection, commandCase.command);

          if ("refused" in result) {
            expect(DIAGNOSTIC_CATEGORIES).toContain(result.refused.category);
            expect(host.getSnapshot().text).toBe(original);
            variantRefusedCount++;
            return;
          }
          variantAcceptedCount++;
          assertEditWithinIndependentBound(commandCase.command, original, selection, result.edit);
        });
      }
    }
  }

  test("liveness (AP-21): this variant sweep was not universally refused either", () => {
    const total = variantAcceptedCount + variantRefusedCount;
    expect(total).toBeGreaterThan(0);
    expect(variantAcceptedCount).toBeGreaterThan(0);
  });
});
