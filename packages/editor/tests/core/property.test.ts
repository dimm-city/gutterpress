import { describe, expect, test } from "bun:test";
import { MemoryDocumentHost } from "../../src/core/memory-host.ts";

/**
 * Deterministic PRNG (mulberry32). SFE-P1a: "a SEEDED deterministic
 * randomized property test ... no Math.random, determinism is binding."
 * SEED is a fixed constant and must never be derived from wall-clock time,
 * `Math.random`, or any other non-deterministic source — changing it
 * changes which sequence this test exercises, which is a deliberate,
 * reviewable edit, not an accident of a flaky run.
 */
function mulberry32(seed: number): () => number {
  let t = seed >>> 0;
  return function next(): number {
    t = (t + 0x6d2b79f5) >>> 0;
    let r = t;
    r = Math.imul(r ^ (r >>> 15), r | 1);
    r ^= r + Math.imul(r ^ (r >>> 7), r | 61);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

const SEED = 0x5f3759df;
const ITERATIONS = 500;
const INITIAL_TEXT = "seed text to start the property test from";

// A mix of plain ASCII, whitespace/punctuation, and UTF-16 multi-code-unit
// content (emoji surrogate pair, combining mark, ZWJ sequence member) so
// random inserts also exercise the UTF-16 splice semantics this contract
// requires, not just single-code-unit ASCII.
const ALPHABET = ["a", "b", "c", " ", "\n", ".", "!", "\u{1F600}", "é", "‍"];

function randomInt(rand: () => number, maxExclusive: number): number {
  return Math.floor(rand() * maxExclusive);
}

function randomInsert(rand: () => number, maxLength: number): string {
  const length = randomInt(rand, maxLength + 1);
  let out = "";
  for (let i = 0; i < length; i++) {
    const symbol = ALPHABET[randomInt(rand, ALPHABET.length)];
    out += symbol ?? "";
  }
  return out;
}

/**
 * Runs ITERATIONS random-but-always-valid edits through a fresh
 * MemoryDocumentHost, checking after EVERY edit that:
 *   - the edit was accepted (it is always constructed to be valid);
 *   - the resulting text matches an independently computed
 *     String.prototype.substring splice (the mirror-model oracle);
 *   - the version incremented by exactly 1;
 *   - the snapshot captured immediately BEFORE the edit is untouched by
 *     applying it (proves snapshots are values, never mutated in place).
 * Returns the final snapshot for the determinism test to compare across
 * two independent runs with the same seed.
 */
function runRandomEditSequence(): { text: string; version: number } {
  const rand = mulberry32(SEED);
  const host = new MemoryDocumentHost({ text: INITIAL_TEXT, version: 0 });

  for (let i = 0; i < ITERATIONS; i++) {
    const snapshotBefore = host.getSnapshot();
    const { text: textBefore, version } = snapshotBefore;

    const length = textBefore.length;
    const from = randomInt(rand, length + 1);
    const to = from + randomInt(rand, length + 1 - from); // from <= to <= length, always valid
    const insert = randomInsert(rand, 6);

    const result = host.applyEdit({ from, to, insert, expectedVersion: version });

    if (!result.ok) {
      throw new Error(
        `unexpected rejection at iteration ${i} (reason: ${result.reason}) — every edit in ` +
          "this sequence is constructed to be in-range with the correct expectedVersion",
      );
    }

    const expected = textBefore.substring(0, from) + insert + textBefore.substring(to);
    if (result.snapshot.text !== expected) {
      throw new Error(
        `iteration ${i}: snapshot text diverged from the String.prototype.substring mirror model`,
      );
    }
    if (result.snapshot.version !== version + 1) {
      throw new Error(
        `iteration ${i}: version did not increment by exactly 1 (was ${version}, now ${result.snapshot.version})`,
      );
    }
    if (host.getSnapshot().text !== expected || host.getSnapshot().version !== version + 1) {
      throw new Error(`iteration ${i}: host.getSnapshot() diverged from the returned result`);
    }
    // Immutability: the snapshot captured before this edit must be
    // untouched by applying it — a new snapshot object is returned, never
    // an in-place mutation of the old one.
    if (snapshotBefore.text !== textBefore || snapshotBefore.version !== version) {
      throw new Error(`iteration ${i}: the pre-edit snapshot object was mutated in place`);
    }
  }

  return host.getSnapshot();
}

describe("applyEdit / MemoryDocumentHost — seeded randomized property test", () => {
  test(`${ITERATIONS} random valid edits stay consistent with a substring mirror model, with strictly monotonic version and immutable snapshots`, () => {
    const final = runRandomEditSequence();
    expect(final.version).toBe(ITERATIONS);
    expect(typeof final.text).toBe("string");
  });

  test("the same fixed seed reproduces the exact same sequence and end state (determinism is binding)", () => {
    const first = runRandomEditSequence();
    const second = runRandomEditSequence();
    expect(second).toEqual(first);
  });
});
