import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../browser-harness/index.ts";
import { generateMarkdownCorpus, KIB } from "./support/corpus.ts";

/**
 * SFE-P3f, Lane A — D13 measurement-pass regression guard.
 *
 * ROOT-CAUSE FINDING THIS TEST PINS (full evidence in this run's
 * `p3d-sweep-audit.md` "## Lane E (P3f)" section and `PATCHES.md`'s new
 * hunk): SFE-P3d-sweep Lane D proved, by differential measurement, that
 * `EditorView._renderAutorun -> _publishMeasurements`
 * (`packages/vscode-markdown-editor/dist/index.js`) unconditionally
 * remeasured EVERY mounted top-level block's rect and per-visual-line
 * geometry — one `document.createRange()` + `Range.getClientRects()` call
 * per TEXT LEAF, for every block, on EVERY render — regardless of how much
 * of the document a given keystroke actually changed. That made the
 * measurement pass O(document) per keystroke. This lane's patch skips that
 * walk for a block whose view-node identity (and rendered `className`) the
 * fork's own `Y()` view-node factory already reused unchanged, translating
 * its previously computed geometry by the block's own freshly (cheaply)
 * remeasured position delta instead of re-walking it — see `PATCHES.md`.
 *
 * MECHANISM ASSERTED: for an ordinary keystroke that touches ONE block in a
 * large, otherwise-untouched document, `document.createRange()`'s call
 * count (see `support/measurement-guard-entry.ts`, which counts every call
 * to the real global, no production hook added) must stay bounded by a
 * small per-keystroke constant — NOT scale with the mounted document's
 * total size or block count. This document (250 KiB, several hundred
 * blocks — the same size D13's own gate uses) makes an O(document)
 * regression unmistakable against the small O(changed) bound: the
 * unpatched behavior would produce thousands of calls for a single
 * keystroke at this size (matching Lane D's ~2.1 ms/KiB scaling finding),
 * while this patch's bound (see PER_KEYSTROKE_RANGE_CALL_BUDGET below) is
 * generous enough for one ordinary paragraph's own leaves with real
 * headroom, and nowhere close to what a whole 250 KiB document would cost.
 *
 * AP-21 liveness: the pre-reset mount count is asserted nonzero first — a
 * counting hook that silently never fired (e.g. wired to the wrong global,
 * or a mount that produced no measurement at all) would otherwise let the
 * post-keystroke assertion pass for the wrong reason (0 <= budget is
 * trivially true).
 *
 * SABOTAGE (G-12/AP-21, pr158-lessons.md Sec.11.2 — "may be performed
 * locally and documented; it does not need to remain committed"): verified
 * locally by forcing `_publishMeasurements`'s `gpReusable` local to `false`
 * unconditionally (the exact "always remeasure everything" pre-patch
 * shape) — with that sabotage in place this test's post-keystroke
 * assertion failed by roughly two orders of magnitude (call count scaled
 * with the full ~800-block document, not with the ~20 keystrokes),
 * confirming the assertion is live, not vacuous. Reverted before finishing;
 * not left in the tree. Recorded in this run's audit doc.
 *
 * Wired into `bun run test:perf` via `perf-control.btest.ts`'s side-effect
 * import of this file — `packages/editor/package.json` is outside this
 * lane's write ownership, so a new `test:perf` script line is not
 * available; a side-effect import from an already-wired file is the
 * smallest way to reach the gate without it (the same technique Lane D's
 * `echo-guard.btest.ts` already uses for the identical reason).
 */

const entryPath = resolve(import.meta.dir, "support/measurement-guard-entry.ts");
const KEYSTROKES = 20;
/** 250 KiB: the same size D13's own gate uses, so an O(document) leak in
 * this mechanism is exercised at the exact size the real budget cares
 * about, not a smaller stand-in that might not reproduce it. */
const DOC_BYTES = 250 * KIB;
/** Generous per-keystroke allowance: comfortably covers one ordinary
 * paragraph's own text leaves (the corpus's paragraphs run a handful of
 * sentences) plus incidental overhead, while remaining far below what an
 * O(document) walk over several hundred blocks would cost for even ONE
 * keystroke (thousands of calls, per Lane D's differential). */
const PER_KEYSTROKE_RANGE_CALL_BUDGET = 60;

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

describe("D13 measurement-pass regression guard — per-keystroke Range creation stays bounded", () => {
  test(
    "N ordinary appended keystrokes cause O(changed), not O(document), Range creation",
    async () => {
      const text = generateMarkdownCorpus(DOC_BYTES);
      await harness.page.evaluate((t) => window.__gpMeasurementGuard.mount(t), text);

      const selector = await harness.page.evaluate(() => window.__gpMeasurementGuard.containerSelector);
      await harness.page.click(selector);
      // SFE-P3d-sweep+P3f repair round 1: `Control+End` (this fork's
      // document-end navigation — see
      // `vscode-adapter/custom-view/fork-hook.btest.ts`'s "case 6 (re-run,
      // first proof)" full-document-selection tests) is used here, not a
      // plain `End`.
      // `End` alone moves the caret to the end of whatever LINE the
      // preceding coarse `.click()` landed on — for this container's own
      // (huge, unscrolled) bounding box, that lands well under 1% into the
      // document, not at its end. Confirmed live: the same click+End this
      // test used to use lands a typed marker at character ~937 of 256,018
      // in a 250 KiB document. This test's own name and header comment are
      // explicit that it measures "N ordinary APPENDED keystrokes" against
      // an "otherwise-untouched document" — i.e. genuine end-of-document
      // typing, where every block BEFORE the caret is untouched (both DOM
      // and absoluteStart) and only the LAST block's own DOM changes. Typing
      // near the START instead touches every block's absoluteStart on every
      // keystroke, which is a different (and, for this patch's chosen
      // strategy, much more expensive) shape entirely — not the mechanism
      // this test exists to pin.
      await harness.page.keyboard.press("Control+End");

      // AP-21 liveness: mounting and settling this document must itself have
      // exercised document.createRange() (the initial full render measures
      // every block once) — a zero count here would mean the counting hook
      // never observed the real mechanism, which would make the assertion
      // below vacuous rather than meaningful.
      const mountCount = await harness.page.evaluate(() => window.__gpMeasurementGuard.getRangeCallCount());
      expect(mountCount).toBeGreaterThan(0);

      const beforeTypingLength = await harness.page.evaluate(() => {
        const el = document.querySelector(window.__gpMeasurementGuard.containerSelector);
        return el?.textContent?.length ?? 0;
      });
      await harness.page.evaluate(() => window.__gpMeasurementGuard.resetRangeCallCount());

      await harness.page.keyboard.type("x".repeat(KEYSTROKES));

      // A real edit did land — proves the keystrokes were not silently
      // dropped (a no-op input path would trivially "pass" the count
      // assertion below for the wrong reason). Rendered textContent grows
      // by roughly KEYSTROKES characters (not exactly — markers/whitespace
      // rendering can add a little), so a generous lower bound is enough.
      await harness.page.waitForFunction(
        ({ selector: sel, before, added }) => {
          const el = document.querySelector(sel);
          const length = el?.textContent?.length ?? 0;
          return length >= before + Math.floor(added * 0.5);
        },
        { selector, before: beforeTypingLength, added: KEYSTROKES },
        { timeout: 15_000 },
      );

      // Wait for the render pipeline to fully settle: poll the Range call
      // count until it stops changing for a few consecutive checks. The
      // count only ever grows while rendering is still catching up (each
      // accepted edit's own render calls document.createRange() a bounded
      // number of times; nothing outside a render touches it here, since
      // this test never queries an offset/point), so a stable reading is a
      // safe stand-in for "every one of the KEYSTROKES edits has now been
      // rendered and measured."
      let stableChecks = 0;
      let lastCount = -1;
      const settleDeadline = Date.now() + 15_000;
      while (stableChecks < 3 && Date.now() < settleDeadline) {
        const count = await harness.page.evaluate(() => window.__gpMeasurementGuard.getRangeCallCount());
        if (count === lastCount) {
          stableChecks++;
        } else {
          stableChecks = 0;
          lastCount = count;
        }
        if (stableChecks < 3) await new Promise((r) => setTimeout(r, 100));
      }

      const finalCount = await harness.page.evaluate(() => window.__gpMeasurementGuard.getRangeCallCount());
      const budget = KEYSTROKES * PER_KEYSTROKE_RANGE_CALL_BUDGET;
      // The mechanism this test exists to pin: KEYSTROKES ordinary,
      // same-block appended edits against a large, otherwise-untouched
      // document must cost a small, roughly constant number of
      // document.createRange() calls each — not one that scales with the
      // ~800-block, 250 KiB mounted document.
      expect(finalCount).toBeLessThan(budget);
    },
    60_000,
  );
});
