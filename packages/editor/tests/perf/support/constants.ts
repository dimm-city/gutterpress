/**
 * SFE-P3d-sweep Lane B — the knobs shared by `perf-sweep.btest.ts` and
 * `perf-control.btest.ts`, defined once so the budget and methodology
 * numbers documented in the audit doc are provably the same numbers the
 * tests actually use.
 */

/** D13's own stated gate: "repeated ordinary typing in a 250 KiB document
 * must maintain p95 edit-to-paint below 100 ms after warm-up." */
export const D13_BUDGET_MS = 100;

/**
 * Warm-up keystrokes typed and measured but EXCLUDED from the reported
 * percentiles. 20 is enough to get past first-keystroke one-off costs
 * (initial JIT warm-up of the hot input-handling path, the first
 * MutationObserver/rAF round trip in a fresh mount) without materially
 * extending the run — chosen as a clear, round, stated number rather than
 * tuned to produce a particular result.
 */
export const WARMUP_KEYSTROKES = 20;

/** Keystrokes measured and included in the reported percentiles — D13's
 * stated minimum. */
export const SAMPLE_KEYSTROKES = 60;

/**
 * Milliseconds paced between keystrokes (applied after each keystroke's
 * measurement resolves, before the next is dispatched). 70ms models a fast,
 * sustained typist (~14 chars/sec, ~170wpm at 5 chars/word) — realistic
 * ordinary typing cadence, not a synthetic as-fast-as-possible hammer. The
 * measured edit-to-paint LATENCY itself does not depend on this pacing
 * choice; it only paces how quickly the next keystroke is dispatched.
 */
export const CADENCE_MS = 70;

/** Ordinary prose, cycled character-by-character for however many
 * keystrokes a test needs — plain ASCII letters and spaces only, so every
 * keystroke is an ordinary same-shape character insertion. */
export const TYPING_PHRASE = "the quick brown fox jumps over the lazy dog and revises the chapter proof ";

/** G-12/AP-20 control: the synchronous per-keystroke busy-wait injected at
 * the test level (never a production change) that the slowed run must
 * blow the budget by. */
export const CONTROL_SLOWDOWN_MS = 150;
