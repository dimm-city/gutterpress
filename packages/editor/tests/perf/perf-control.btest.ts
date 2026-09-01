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
const CONTROL_TOTAL_KEYSTROKES = CONTROL_WARMUP_KEYSTROKES + CONTROL_SAMPLE_KEYSTROKES;
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
    "a synchronous ~150ms per-keystroke busy-wait raises the 250 KiB p95 by roughly the injected delay (differential control)",
    async () => {
      const text = generateMarkdownCorpus(250 * KIB);
      const { selector } = await mountDocument(harness.page, text);

      // Pass 1 — UNSLOWED baseline, same mount/session as the slowed pass
      // below, measured first so the differential is immune to whatever
      // this run's absolute baseline happens to be (see this file's header
      // for why a fixed threshold cannot do this).
      const unslowedAll = await typeAndMeasure(
        harness.page,
        selector,
        CONTROL_TOTAL_KEYSTROKES,
        CONTROL_CADENCE_MS,
        CONTROL_TYPING_PHRASE,
      );
      // AP-21 liveness before either behavioral assertion.
      expect(unslowedAll.length).toBe(CONTROL_TOTAL_KEYSTROKES);
      const unslowedSummary = summarize(unslowedAll.slice(CONTROL_WARMUP_KEYSTROKES));
      console.log(`[perf-control] 250 KiB, unslowed baseline: ${formatSummary(unslowedSummary)}`);

      // Pass 2 — SLOWED, same mount, same corpus (now with the unslowed
      // pass's own keystrokes already appended -- an immaterial ~20 extra
      // characters against a 250 KiB document).
      await harness.page.evaluate((ms) => window.__gpPerf.enableSlowdown(ms), CONTROL_SLOWDOWN_MS);
      let slowedAll: number[];
      try {
        slowedAll = await typeAndMeasure(
          harness.page,
          selector,
          CONTROL_TOTAL_KEYSTROKES,
          CONTROL_CADENCE_MS,
          CONTROL_TYPING_PHRASE,
        );
      } finally {
        await harness.page.evaluate(() => window.__gpPerf.disableSlowdown());
      }

      expect(slowedAll.length).toBe(CONTROL_TOTAL_KEYSTROKES);
      const slowedSummary = summarize(slowedAll.slice(CONTROL_WARMUP_KEYSTROKES));
      console.log(`[perf-control] 250 KiB, +${CONTROL_SLOWDOWN_MS}ms/keystroke: ${formatSummary(slowedSummary)}`);

      // The control's whole purpose, made DIFFERENTIAL (SFE-P3d-sweep+P3f
      // repair round 1 — see this file's header): the slowed run's p95
      // must exceed THIS SAME SESSION's own unslowed p95 by roughly the
      // injected delay. Fails the moment the harness stops observing the
      // injected cost, regardless of the absolute baseline that day —
      // unlike the fixed-threshold assertions this replaces, which were
      // satisfied by this sandbox's ordinary (unslowed) baseline alone.
      const delta = slowedSummary.p95 - unslowedSummary.p95;
      console.log(
        `[perf-control] p95 delta: ${delta.toFixed(1)}ms (injected ${CONTROL_SLOWDOWN_MS}ms/keystroke)`,
      );
      expect(delta).toBeGreaterThan(CONTROL_SLOWDOWN_MS * 0.5);
    },
    90_000,
  );
});
