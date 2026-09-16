import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../browser-harness/index.ts";
import { generateMarkdownCorpus, KIB } from "./support/corpus.ts";
import { mountDocument, typeAndMeasure } from "./support/drive.ts";
import { formatSummary, summarize } from "./support/stats.ts";
import { CONTROL_SLOWDOWN_MS } from "./support/constants.ts";
// SFE-P3d-sweep Lane D — side-effect import wires `echo-guard.btest.ts`
// (the D13 root-cause regression guard) into `bun run test:perf` without a
// new package.json script line (`packages/editor/package.json` is outside
// this lane's write ownership). Registers its own `describe`/`beforeAll`/
// `afterAll` independently of this file's — see that file's own header for
// what it guards and why.
import "./echo-guard.btest.ts";
// SFE-P3f Lane A — the same technique, for the same reason, wiring in this
// run's own mechanism-pinning regression guard: per-keystroke
// document.createRange() calls stay O(changed), not O(document), through
// the vendored fork's measurement pass this run patched. See that file's
// own header for the full mechanism and evidence.
import "./measurement-guard.btest.ts";

/**
 * SFE-P3d-sweep Lane B — G-12/AP-20 control for `perf-sweep.btest.ts`'s
 * edit-to-paint measurement: pr158-lessons.md G-12 requires every gate to
 * "prove it ran and prove it can fail"; AP-20's replacement principle is
 * "CI/release workflow invocation tests, fail-closed fixture discovery,
 * and explicit result counts" — a measurement that can only ever pass is
 * indistinguishable from a measurement that measures nothing.
 *
 * This test mounts the SAME 250 KiB corpus the real gate uses, measures an
 * UNSLOWED baseline pass, then enables a synchronous ~150ms busy-wait on
 * every keydown (`support/entry.ts`'s `enableSlowdown` — a listener added
 * by THIS test file, at the test level; no production file is touched, per
 * this run's DETAILS) and measures a SECOND, slowed pass over the same
 * mount, and asserts the SLOWED run's p95 exceeds the UNSLOWED run's own
 * p95 — measured in the same session — by roughly the injected delay.
 *
 * SFE-P3d-sweep+P3f repair round 1 (finding: "the G-12/AP-20 measurement
 * control is vacuous"): an earlier version of this test asserted only
 * `p95 > D13_BUDGET_MS` (100ms) and `p95 > CONTROL_SLOWDOWN_MS * 0.5`
 * (75ms) against the SLOWED run alone. Both are true at every point this
 * project has been in so far — this sandbox's real, UNSLOWED 250 KiB p95
 * already runs 290-630ms across every recorded invocation (see the audit
 * doc's Lane B/D/E sections), i.e. well above both thresholds with ZERO
 * injected slowdown. A fixed absolute threshold is therefore unfalsifiable
 * against any baseline this project has ever measured: if `enableSlowdown`
 * silently became a no-op, if the capture-phase keydown listener stopped
 * being installed, or if the busy-wait returned immediately, this test
 * would still have passed. Comparing the SLOWED run's p95 against this
 * SAME session's own UNSLOWED p95 — not a fixed constant — is immune to
 * that: the delta can only be large when the busy-wait actually ran.
 *
 * This test itself is ALWAYS expected to pass — it asserts the slowed run
 * IS worse than the unslowed one by roughly the injected amount, not that
 * either meets the budget — the "permanently-green control" pattern
 * already used elsewhere in this repo (e.g.
 * `packages/editor/scripts/check-browser-purity.test.mjs`'s per-specifier
 * sabotage fixtures). A future change that accidentally weakens the
 * measurement (e.g. resolving on an unrelated mutation, or losing the
 * `KeyboardEvent.timeStamp` anchor) is exactly the kind of regression this
 * test is positioned to catch, regardless of what the absolute baseline
 * happens to be that day.
 *
 * Uses its own small warm-up/sample counts (not `perf-sweep.btest.ts`'s
 * D13-sized 20+60) — proving sensitivity to an injected ~150ms-per-
 * keystroke slowdown does not need 60 samples; a small, fast sample is
 * sufficient and keeps this control cheap to run on every `test:perf`
 * invocation, even measured twice (once unslowed, once slowed).
 */

const entryPath = resolve(import.meta.dir, "support/entry.ts");
const CONTROL_WARMUP_KEYSTROKES = 5;
const CONTROL_SAMPLE_KEYSTROKES = 15;
/** No realism-motivated pacing here (contrast `CADENCE_MS` in the real
 * sweep) — the busy-wait itself already dominates the per-keystroke
 * timeline, so added pacing would only slow this control down for no
 * evidentiary benefit. */
const CONTROL_CADENCE_MS = 0;
const CONTROL_TYPING_PHRASE = "sabotage proof text ";

let harness: HarnessSession;
let closeHarness: () => Promise<void>;

beforeAll(async () => {
  const opened = await openHarnessSession(entryPath);
  harness = opened.session;
  closeHarness = opened.close;
  await waitForHarnessReady(harness.page);
}, 30_000);

afterAll(async () => {
  await closeHarness();
});

describe("D13 performance harness control (G-12/AP-20)", () => {
  test(
    "a synchronous ~150ms per-keystroke busy-wait raises the 250 KiB p50 by roughly the injected delay (interleaved differential control)",
    async () => {
      const text = generateMarkdownCorpus(250 * KIB);
      const { selector } = await mountDocument(harness.page, text);

      // Warm-up — unslowed, discarded (first-keystroke JIT / first
      // round-trip costs; same rationale as the real sweep's warm-up).
      const warmup = await typeAndMeasure(
        harness.page,
        selector,
        CONTROL_WARMUP_KEYSTROKES,
        CONTROL_CADENCE_MS,
        CONTROL_TYPING_PHRASE,
      );
      // AP-21 liveness before any behavioral assertion.
      expect(warmup.length).toBe(CONTROL_WARMUP_KEYSTROKES);

      // INTERLEAVED sampling (repair round 3 of SFE-P3d-sweep+P3f — this
      // control's third shape, each forced by real evidence). Round 1 made
      // it differential (two sequential passes, slowed-minus-unslowed p95)
      // after the fixed-threshold version proved vacuous. The gate run then
      // showed the SEQUENTIAL differential is exposed to time-varying
      // sandbox load: with the baseline pass inflated to p95=691.9ms by
      // contention that eased before the slowed pass, the measured delta
      // was 63.3ms of an injected 150ms — under the 75ms bar, a false
      // negative from drift, not from any harness defect. Alternating the
      // condition PER KEYSTROKE inside ONE run pairs the two conditions in
      // time, so load drift hits both sample sets equally and cancels in
      // the difference; comparing p50s (medians of the two interleaved
      // sets) rather than p95s drops the tail sensitivity that made the
      // old comparison noisy at small n. What the control PROVES is
      // unchanged: the measurement pipeline observes a real injected
      // per-keystroke cost, regardless of that day's absolute baseline.
      const slowedSamples: number[] = [];
      const unslowedSamples: number[] = [];
      for (let i = 0; i < CONTROL_SAMPLE_KEYSTROKES * 2; i++) {
        const slowed = i % 2 === 0;
        if (slowed) {
          await harness.page.evaluate((ms) => window.__gpPerf.enableSlowdown(ms), CONTROL_SLOWDOWN_MS);
        }
        try {
          const measured = await typeAndMeasure(
            harness.page,
            selector,
            1,
            CONTROL_CADENCE_MS,
            CONTROL_TYPING_PHRASE[i % CONTROL_TYPING_PHRASE.length]!,
          );
          expect(measured.length).toBe(1);
          (slowed ? slowedSamples : unslowedSamples).push(measured[0]!);
        } finally {
          if (slowed) {
            await harness.page.evaluate(() => window.__gpPerf.disableSlowdown());
          }
        }
      }

      expect(slowedSamples.length).toBe(CONTROL_SAMPLE_KEYSTROKES);
      expect(unslowedSamples.length).toBe(CONTROL_SAMPLE_KEYSTROKES);
      const slowedSummary = summarize(slowedSamples);
      const unslowedSummary = summarize(unslowedSamples);
      console.log(`[perf-control] 250 KiB, interleaved unslowed: ${formatSummary(unslowedSummary)}`);
      console.log(
        `[perf-control] 250 KiB, interleaved +${CONTROL_SLOWDOWN_MS}ms/keystroke: ${formatSummary(slowedSummary)}`,
      );

      // The control's whole purpose: the slowed samples' MEDIAN must exceed
      // the time-paired unslowed samples' median by roughly the injected
      // delay. Fails the moment the harness stops observing the injected
      // cost — if enableSlowdown became a no-op, the listener stopped being
      // installed, or the busy-wait returned immediately, both medians
      // would be equal and the delta would sit near zero.
      const delta = slowedSummary.p50 - unslowedSummary.p50;
      console.log(
        `[perf-control] p50 delta: ${delta.toFixed(1)}ms (injected ${CONTROL_SLOWDOWN_MS}ms/keystroke)`,
      );
      expect(delta).toBeGreaterThan(CONTROL_SLOWDOWN_MS * 0.5);
    },
    120_000,
  );
});
