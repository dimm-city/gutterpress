import { describe, expect, test } from "bun:test";
import { DIAGNOSTIC_CATEGORIES } from "../../src/core/diagnostics.ts";
import {
  applyOnFreshHost,
  computeAgainstHost,
  CORPUS_COMMAND_CASES,
  toggleOffSelection,
} from "./support/command-harness.ts";
import { FIXTURE_NAMES, FIXTURES } from "./fixtures.ts";

/**
 * SFE-P2a Lane C — command-layer byte identity (DETAILS (2)).
 *
 * "for each fixture x each command from Lane B's applyCommand ... applying
 * then UNDOING via toggle-off (where the command is a toggle) must return
 * the byte-identical original; for non-toggles, the edit's locality is the
 * assertion."
 *
 * This is the REAL byte-identity target this run cares about — the trivial
 * open/close-with-zero-edits case is already covered, with no Lane B
 * dependency, by fixtures.test.ts. REBASED (SFE-P2a Lane C2-reconcile) onto
 * Lane B's real, committed-in-tree `applyCommand` contract — see
 * support/command-harness.ts's header for the exact shapes. `applyCommand`
 * itself only COMPUTES an edit (or a refusal); `computeAgainstHost` makes
 * the "then apply it via host.applyEdit" step explicit, matching the real
 * two-step D3/D7 flow.
 */

let acceptedCount = 0;
let refusedCount = 0;

describe("command-layer byte identity across the full fixture x command cross-product", () => {
  for (const fixtureName of FIXTURE_NAMES) {
    for (const commandCase of CORPUS_COMMAND_CASES) {
      test(`${fixtureName} / ${commandCase.label}`, () => {
        const original = FIXTURES[fixtureName]!;
        const { host, selection, result: first } = applyOnFreshHost(original, commandCase.command);

        if ("refused" in first) {
          // Fail-closed refusal is a legitimate outcome (D3/D14) — but it
          // must be a REAL refusal, not a silent no-op: the diagnostic
          // category must be one of the stable D14 categories, and the
          // document must be provably untouched.
          expect(DIAGNOSTIC_CATEGORIES).toContain(first.refused.category);
          expect(host.getSnapshot().text).toBe(original);
          expect(host.getSnapshot().version).toBe(0);
          refusedCount++;
          return;
        }
        acceptedCount++;

        if (commandCase.isToggle) {
          // Toggle OFF by re-invoking the SAME command kind at the selection
          // a real toolbar/keyboard re-press would target next — see
          // toggleOffSelection's doc comment for why that selection differs
          // between wrap-based and line-based toggle commands.
          const secondSelection = toggleOffSelection(commandCase.command.kind, selection, first.edit);
          const second = computeAgainstHost(host, secondSelection, commandCase.command);
          expect("edit" in second).toBe(true);
          if ("edit" in second) {
            // The byte-identity assertion this test exists for: toggle-on
            // then toggle-off returns EXACTLY the original bytes, not a
            // normalized or merely-equivalent rendering of them.
            expect(host.getSnapshot().text).toBe(original);
            expect(host.getSnapshot().version).toBe(2);
          }
        } else {
          // Non-toggle: "the edit's locality is the assertion" — proven in
          // full by locality.test.ts; here, a direct sanity check that the
          // host's post-edit text matches an independent splice of the
          // ORIGINAL text against the returned edit.
          const spliced =
            original.slice(0, first.edit.from) + first.edit.insert + original.slice(first.edit.to);
          expect(host.getSnapshot().text).toBe(spliced);
        }
      });
    }
  }
});

describe("byte-identity corpus liveness (AP-21)", () => {
  test("at least half of the fixture x command combinations were ACCEPTED, not universally refused", () => {
    const total = acceptedCount + refusedCount;
    expect(total).toBeGreaterThan(0);
    expect(acceptedCount).toBeGreaterThan(total / 2);
  });
});
