import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  openHarnessSession,
  waitForHarnessReady,
  type HarnessSession,
} from "../browser-harness/index.ts";
import { generateMarkdownCorpus, KIB } from "./support/corpus.ts";

/**
 * SFE-P3d-sweep Lane D — D13 root-cause investigation, regression guard.
 *
 * ROOT-CAUSE FINDING THIS TEST PINS (full evidence in this run's
 * `p3d-sweep-audit.md` "## Lane D" section): the D13 250 KiB p95 budget
 * miss Lane B measured is NOT caused by `adapter.ts`'s host-echo handling
 * replacing the whole model text on every accepted edit — that code
 * already converges by comparison (matches the predicted echo's version
 * AND text before doing nothing) and was measured, live, at <1ms of
 * overhead per keystroke at 250 KiB. A differential "floor" measurement —
 * the fork's `EditorModel`/`EditorView`/`EditorController` mounted with NO
 * host and NO adapter at all — reproduced the SAME ~425-670ms per-keystroke
 * cost, proving the linear scaling lives inside
 * `packages/vscode-markdown-editor` itself (`EditorView._renderAutorun` ->
 * `_publishMeasurements`, which unconditionally remeasures every mounted
 * block's rect and per-line geometry via `Range.getClientRects()` on EVERY
 * render, regardless of how much of the document actually changed) — out
 * of this lane's write ownership (byte-pinned vendored fork; a fork change
 * is a PATCHES.md-governed event).
 *
 * What IS this lane's to guard: the mechanism the amendment paragraph
 * suspected — the echo-convergence comparison in `adapter.ts`'s
 * `host.subscribe` handler — genuinely matters (a regression there would
 * make an ALREADY bad number worse, and would reintroduce exactly the
 * anti-pattern the amendment described), so this test pins it directly,
 * without needing a 6-minute perf sweep to notice a regression.
 *
 * MECHANISM ASSERTED: `createVscodeEditorAdapter` reads `host.getSnapshot()`
 * exactly ONCE, at construction (see `adapter.ts`). Every ordinary accepted
 * edit updates the adapter's own `known` local directly from `applyEdit`'s
 * return value; `host.getSnapshot()` is called again ONLY on the
 * "genuinely external" branches (a rejection revert, or a notification
 * that does not match the predicted echo), both deferred to a microtask.
 * Against a document with no external replacement ever happening (this
 * harness's whole scenario — a lone `MemoryDocumentHost`, no second
 * writer), EVERY notification the adapter's own `host.subscribe` listener
 * receives is the synchronous echo of an edit THIS adapter just submitted.
 * So for N ordinary accepted keystrokes, the wrapped host's
 * `getSnapshot()` call count must stay at the single mount-time call — see
 * `support/echo-guard-entry.ts` and `support/snapshot-call-counting-host.ts`
 * for the counting mechanism (D5-clean: no package-internal import outside
 * `src/vscode-adapter/`).
 *
 * SABOTAGE (G-12/AP-21, pr158-lessons.md §11.2 — "may be performed locally
 * and documented; it does not need to remain committed"): verified locally
 * by making `adapter.ts`'s echo-match `if` always fail (forcing every
 * notification through the `queueMicrotask` -> `host.getSnapshot()` branch)
 * — with that sabotage in place this test's post-mount assertion fails
 * (`getSnapshotCallCount()` climbs to keystroke count instead of staying at
 * 1), confirming the assertion is live, not vacuous. Reverted before
 * committing; not left in the tree. Recorded in this run's audit doc.
 *
 * Wired into `bun run test:perf` via `perf-control.btest.ts`'s side-effect
 * import of this file — `packages/editor/package.json` is outside this
 * lane's write ownership, so a new `test:perf` script line is not
 * available; a side-effect import from an already-wired file is the
 * smallest way to reach the gate without it.
 */

const entryPath = resolve(import.meta.dir, "support/echo-guard-entry.ts");
const KEYSTROKES = 20;
/** 100 KiB: large enough that a regression's extra `getSnapshot()` calls
 * would be unmistakable against a real, non-trivial document, small enough
 * to keep this correctness check fast — this test asserts a CALL COUNT, not
 * a latency percentile, so it does not need D13's 250 KiB size to prove its
 * point. */
const DOC_BYTES = 100 * KIB;

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

describe("D13 root-cause regression guard — echo-convergence stays the fast path", () => {
  test(
    "N ordinary accepted keystrokes cause zero additional host.getSnapshot() calls",
    async () => {
      const text = generateMarkdownCorpus(DOC_BYTES);
      await harness.page.evaluate((t) => window.__gpEchoGuard.mount(t), text);

      const selector = await harness.page.evaluate(() => window.__gpEchoGuard.containerSelector);
      await harness.page.click(selector);
      await harness.page.keyboard.press("End");

      // AP-21 liveness: the counter must already be at its expected
      // post-mount baseline (exactly 1 — the adapter's own construction-time
      // read) before any keystroke, or this test would vacuously pass a
      // broken/never-mounted page too.
      const baseline = await harness.page.evaluate(() => window.__gpEchoGuard.getSnapshotCallCount());
      expect(baseline).toBe(1);

      // SFE-P3d-sweep+P3f repair round 1 (finding: "echo-guard's 'a real
      // edit did land' liveness check cannot fail — its tolerance is 10x
      // the signal"): captured BEFORE typing and compared against a
      // tolerance scaled to KEYSTROKES itself, matching
      // `measurement-guard.btest.ts:112-131`'s own pattern — the previous
      // absolute `-200` tolerance against a 100 KiB document was already
      // satisfied by the MOUNT alone, before a single keystroke, so a
      // silently-dropped-input regression (AP-21) would have passed this
      // wait for the wrong reason.
      const beforeTypingLength = await harness.page.evaluate(() => {
        const el = document.querySelector(window.__gpEchoGuard.containerSelector);
        return el?.textContent?.length ?? 0;
      });

      for (let i = 0; i < KEYSTROKES; i++) {
        await harness.page.keyboard.type("x");
      }

      // A real edit did land — proves the keystrokes were not silently
      // dropped (a no-op input path would trivially "pass" the count
      // assertion below for the wrong reason). Rendered textContent grows
      // by roughly KEYSTROKES characters (not exactly — markers/whitespace
      // rendering can add a little), so a generous lower bound scaled to
      // the signal itself, not a fixed constant far larger than it, is
      // enough.
      await harness.page.waitForFunction(
        ({ selector: sel, before, added }) => {
          const el = document.querySelector(sel);
          const length = el?.textContent?.length ?? 0;
          return length >= before + Math.floor(added * 0.5);
        },
        { selector, before: beforeTypingLength, added: KEYSTROKES },
        { timeout: 15_000 },
      );

      const finalCount = await harness.page.evaluate(() => window.__gpEchoGuard.getSnapshotCallCount());
      // The mechanism this test exists to pin: every one of the N accepted
      // edits above must have been recognized as this adapter's OWN echo
      // (matched by version + text) and handled with zero extra
      // `getSnapshot()` reads — not deferred to the "genuinely external"
      // branch, which is the only other path that reads it again.
      expect(finalCount).toBe(baseline);
    },
    60_000,
  );
});
