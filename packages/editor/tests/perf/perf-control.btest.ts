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
import { CONTROL_SLOWDOWN_MS, D13_BUDGET_MS } from "./support/constants.ts";
// SFE-P3d-sweep Lane D — side-effect import wires `echo-guard.btest.ts`
// (the D13 root-cause regression guard) into `bun run test:perf` without a
// new package.json script line (`packages/editor/package.json` is outside
// this lane's write ownership). Registers its own `describe`/`beforeAll`/
// `afterAll` independently of this file's — see that file's own header for
// what it guards and why.
import "./echo-guard.btest.ts";

/**
 * SFE-P3d-sweep Lane B — G-12/AP-20 control for `perf-sweep.btest.ts`'s
 * edit-to-paint measurement: pr158-lessons.md G-12 requires every gate to
 * "prove it ran and prove it can fail"; AP-20's replacement principle is
 * "CI/release workflow invocation tests, fail-closed fixture discovery,
 * and explicit result counts" — a measurement that can only ever pass is
 * indistinguishable from a measurement that measures nothing.
 *
 * This test mounts the SAME 250 KiB corpus the real gate uses, enables a
 * synchronous ~150ms busy-wait on every keydown (`support/entry.ts`'s
 * `enableSlowdown` — a listener added by THIS test file, at the test
 * level; no production file is touched, per this run's DETAILS), runs the
 * identical mount/type/measure path, and asserts the resulting p95
 * EXCEEDS the D13 budget. If this ever measured a p95 UNDER the budget
 * while the busy-wait was active, that would mean the harness had stopped
 * observing the real edit-to-paint path — the same failure mode AP-20
 * names ("a gate that exists but is never invoked" is operationally
 * identical to a gate that runs but cannot detect the defect it exists
 * to catch).
 *
 * This test itself is ALWAYS expected to pass — it asserts p95 IS worse
 * than the budget, not that it meets it — the "permanently-green control"
 * pattern already used elsewhere in this repo (e.g.
 * `packages/editor/scripts/check-browser-purity.test.mjs`'s per-specifier
 * sabotage fixtures). A future change that accidentally weakens the
 * measurement (e.g. resolving on an unrelated mutation, or losing the
 * `KeyboardEvent.timeStamp` anchor) is exactly the kind of regression this
 * test is positioned to catch: it would start passing for the wrong
 * reason (silently), or, in this design, would need the busy-wait to stop
 * mattering — the tighter sanity-margin assertion below makes an "it
 * barely limped over the line" false pass much less likely to hide such a
 * regression than a bare `> 100` check would.
 *
 * Uses its own small warm-up/sample counts (not `perf-sweep.btest.ts`'s
 * D13-sized 20+60) — proving sensitivity to an injected ~150ms-per-
 * keystroke slowdown does not need 60 samples; a small, fast sample is
 * sufficient and keeps this control cheap to run on every `test:perf`
 * invocation.
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
    "a synchronous ~150ms per-keystroke busy-wait blows the 250 KiB p95 budget",
    async () => {
      const text = generateMarkdownCorpus(250 * KIB);
      const { selector } = await mountDocument(harness.page, text);

      await harness.page.evaluate((ms) => window.__gpPerf.enableSlowdown(ms), CONTROL_SLOWDOWN_MS);
      let all: number[];
      try {
        all = await typeAndMeasure(
          harness.page,
          selector,
          CONTROL_TOTAL_KEYSTROKES,
          CONTROL_CADENCE_MS,
          CONTROL_TYPING_PHRASE,
        );
      } finally {
        await harness.page.evaluate(() => window.__gpPerf.disableSlowdown());
      }

      // AP-21 liveness before the behavioral assertion.
      expect(all.length).toBe(CONTROL_TOTAL_KEYSTROKES);

      const samples = all.slice(CONTROL_WARMUP_KEYSTROKES);
      const summary = summarize(samples);
      console.log(`[perf-control] 250 KiB, +${CONTROL_SLOWDOWN_MS}ms/keystroke: ${formatSummary(summary)}`);

      // The control's whole purpose: this must be a FAILING relationship to
      // the real gate's assertion (p95 < D13_BUDGET_MS) — i.e. this
      // assertion (p95 > D13_BUDGET_MS) must PASS, proving the measurement
      // is sensitive to a real, injected slowdown on the exact path it
      // measures.
      expect(summary.p95).toBeGreaterThan(D13_BUDGET_MS);
      // Sanity margin: comfortably over the line by roughly the injected
      // delay itself (not merely a few stray milliseconds over 100), so a
      // measurement that degraded to near-noise would still be caught here
      // rather than scraping a bare pass.
      expect(summary.p95).toBeGreaterThan(CONTROL_SLOWDOWN_MS * 0.5);
    },
    60_000,
  );
});
