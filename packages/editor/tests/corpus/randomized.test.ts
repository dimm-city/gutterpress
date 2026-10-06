import { describe, expect, test } from "bun:test";
import { MemoryDocumentHost } from "../../src/core/memory-host.ts";
import { DIAGNOSTIC_CATEGORIES } from "../../src/core/diagnostics.ts";
import type { EditorCommand } from "../../src/core/commands.ts";
import {
  computeAgainstHost,
  fnv1aHash,
  mulberry32,
  normalizeSelection,
  randomCommand,
  randomSelectionPairMaybeOutOfRange,
  type CommandSelection,
} from "./support/command-harness.ts";
import { FIXTURE_NAMES, FIXTURES } from "./fixtures.ts";

/**
 * SFE-P2a Lane C — seeded randomized command corpus (DETAILS (4)).
 *
 * "mulberry32 with a FIXED seed constant ... N=300 iterations: random
 * fixture, random valid selection (random offsets clamped to length, both
 * orders), random command with random valid params; invariants: applyCommand
 * either returns a refusal Diagnostic (never throws) or an edit that applies
 * cleanly with locality + version monotonicity; determinism proven by
 * running the loop twice and comparing a transcript hash."
 *
 * REBASED (SFE-P2a Lane C2-reconcile) onto Lane B's real, committed-in-tree
 * `applyCommand` contract — see support/command-harness.ts's header. The
 * "both orders" selection generation still happens
 * (`randomSelectionPairMaybeOutOfRange`), then is normalized into the real
 * ordered `CommandSelection` shape (`normalizeSelection`) before it ever
 * reaches `applyCommand`, exactly as a real drag-selection UI would.
 *
 * SFE-P2a round-1 repair (G-12/AP-21): a PLAIN `randomSelectionPair` clamps
 * both offsets to `[0, textLength]` by construction, so `applyCommand`'s
 * `invalidSelection` refusal path could never fire from this corpus — the
 * refusal-path assertions below (DIAGNOSTIC_CATEGORIES membership, "a
 * REFUSED command still changed the document") were dead code that always
 * passed vacuously. `randomSelectionPairMaybeOutOfRange` deliberately
 * produces an out-of-range selection some of the time so those assertions
 * have something to actually prove. Separately, the fenced-code fixture
 * added to `fixtures.ts` this same round gives `set-heading`'s OWN named
 * refusal case (a caret inside a fenced code block) real, if occasional,
 * reach through this randomized selection space too — see the "liveness"
 * describe block below, which fails the run if EITHER refusal path never
 * actually fired.
 *
 * `SEED` is a fixed constant, never derived from wall-clock time,
 * `Math.random`, or any other non-deterministic source (SFE-P1a's binding
 * rule for the core property test, carried forward here) — changing it
 * changes which sequence this test exercises, a deliberate, reviewable
 * edit, not an accident of a flaky run. This corpus's `SEED` is its own
 * constant, distinct from `tests/core/property.test.ts`'s, so the two
 * seeded sequences never silently correlate.
 */

const SEED = 0x9e3779b9;
const ITERATIONS = 300;

interface IterationRecord {
  readonly fixtureName: string;
  readonly selection: CommandSelection;
  readonly command: EditorCommand;
  readonly outcome: string;
}

/**
 * Runs `ITERATIONS` independent random trials: EACH iteration constructs a
 * FRESH `MemoryDocumentHost` from the chosen fixture's ORIGINAL text at
 * version 0 (iterations never compound edits onto one another — every trial
 * starts from a known-clean state, matching pr158-lessons.md AP-25's
 * "committed fixtures are immutable inputs" and keeping each iteration's
 * invariant checks independent of trial order). Throws immediately, naming
 * the exact iteration/fixture/selection/command, on the first invariant
 * violation — including `applyCommand`/`host.applyEdit` throwing at all,
 * which D3 forbids outright ("Never throws — failures are reported through
 * the returned result").
 */
function runIterations(seed: number): IterationRecord[] {
  const rand = mulberry32(seed);
  const records: IterationRecord[] = [];

  for (let i = 0; i < ITERATIONS; i++) {
    const fixtureName = FIXTURE_NAMES[Math.floor(rand() * FIXTURE_NAMES.length)]!;
    const text = FIXTURES[fixtureName]!;
    const selection = normalizeSelection(randomSelectionPairMaybeOutOfRange(rand, text.length));
    const command = randomCommand(rand);
    const host = new MemoryDocumentHost({ text, version: 0 });

    let result: ReturnType<typeof computeAgainstHost>;
    try {
      result = computeAgainstHost(host, selection, command);
    } catch (error) {
      throw new Error(
        `iteration ${i}: applyCommand's computation, or the immediate host.applyEdit application of ` +
          `its result, THREW — D3/D14 forbid this ("Never throws — failures are reported through the ` +
          `returned result") — fixture=${fixtureName} selection=${JSON.stringify(selection)} ` +
          `command=${JSON.stringify(command)}: ${String(error)}`,
      );
    }

    if ("edit" in result) {
      const { edit } = result;
      const prefix = text.slice(0, edit.from);
      const suffix = text.slice(edit.to);
      const expected = prefix + edit.insert + suffix;
      const actual = host.getSnapshot().text;

      if (actual !== expected) {
        throw new Error(
          `iteration ${i}: edit locality violated — independent splice diverged from the host's ` +
            `post-edit text. fixture=${fixtureName} selection=${JSON.stringify(selection)} ` +
            `command=${JSON.stringify(command)} edit=${JSON.stringify(edit)}`,
        );
      }
      if (!actual.startsWith(prefix) || !actual.endsWith(suffix)) {
        throw new Error(
          `iteration ${i}: bytes outside [from,to) were touched. fixture=${fixtureName} ` +
            `edit=${JSON.stringify(edit)}`,
        );
      }
      if (host.getSnapshot().version !== 1) {
        throw new Error(
          `iteration ${i}: version did not increment by exactly 1 from a fresh version-0 host ` +
            `(was ${host.getSnapshot().version}). fixture=${fixtureName} command=${JSON.stringify(command)}`,
        );
      }
      records.push({
        fixtureName,
        selection,
        command,
        outcome: `accepted:${edit.from},${edit.to},${edit.insert.length}`,
      });
    } else {
      if (!DIAGNOSTIC_CATEGORIES.includes(result.refused.category)) {
        throw new Error(
          `iteration ${i}: refusal carried an unrecognized diagnostic category ` +
            `"${result.refused.category}" — not one of D14's stable categories. ` +
            `fixture=${fixtureName} command=${JSON.stringify(command)}`,
        );
      }
      if (host.getSnapshot().text !== text || host.getSnapshot().version !== 0) {
        throw new Error(
          `iteration ${i}: a REFUSED command still changed the document (D3: "changes nothing"). ` +
            `fixture=${fixtureName} command=${JSON.stringify(command)}`,
        );
      }
      // `safeAction` distinguishes the two DIFFERENT refusal reasons
      // `applyCommand` can produce (both share the same `category`) — see
      // the "liveness" describe block below, which needs to tell them apart
      // to prove BOTH paths actually fired, not just one of them twice.
      records.push({
        fixtureName,
        selection,
        command,
        outcome: `refused:${result.refused.category}:${result.refused.safeAction ?? ""}`,
      });
    }
  }

  return records;
}

function transcriptHash(records: readonly IterationRecord[]): string {
  const transcript = records
    .map(
      (r) =>
        `${r.fixtureName}|${r.selection.start}:${r.selection.endExclusive}|${JSON.stringify(r.command)}|${r.outcome}`,
    )
    .join("\n");
  return fnv1aHash(transcript);
}

describe("seeded randomized command corpus (SFE-P2a DETAILS (4))", () => {
  test(`${ITERATIONS} random iterations satisfy never-throws / locality / version-monotonicity`, () => {
    const records = runIterations(SEED);
    expect(records.length).toBe(ITERATIONS);

    // AP-21 liveness: the loop must not have silently refused everything.
    const acceptedCount = records.filter((r) => r.outcome.startsWith("accepted")).length;
    expect(acceptedCount).toBeGreaterThan(0);
  });

  test("the same fixed seed reproduces an identical transcript across two independent runs (determinism)", () => {
    const first = runIterations(SEED);
    const second = runIterations(SEED);
    expect(transcriptHash(second)).toBe(transcriptHash(first));
    expect(second).toEqual(first);
  });

  test("BOTH of applyCommand's refusal paths actually fired (G-12: a gate must prove it can fail)", () => {
    // Before this round's fix, `applyCommand` had exactly two refusal
    // paths — `invalidSelection` and `set-heading` inside a fenced code
    // block — and NEITHER was reachable from this corpus: every selection
    // was clamped valid by construction, and no fixture contained a fence.
    // These assertions are the sabotage-proof counterpart to the "at least
    // half accepted" liveness check above: an all-refused run is a broken
    // generator, but so is a run that NEVER refuses, or refuses only ONE of
    // the two named reasons — a regression that silently disabled either
    // refusal path would leave every OTHER assertion in this file green.
    const records = runIterations(SEED);
    const refused = records.filter((r) => r.outcome.startsWith("refused"));
    expect(refused.length).toBeGreaterThan(0);

    const outOfRangeRefusals = refused.filter((r) => r.outcome.endsWith(":Reload and reapply"));
    const fencedCodeRefusals = refused.filter((r) => r.outcome.endsWith(":Move outside the code block"));
    expect(outOfRangeRefusals.length).toBeGreaterThan(0);
    expect(fencedCodeRefusals.length).toBeGreaterThan(0);
  });
});
