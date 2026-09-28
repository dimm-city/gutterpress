import type { Page } from "playwright-core";

/**
 * SFE-P3d-sweep Lane B — Node-side driving helpers shared by
 * `perf-sweep.btest.ts` and `perf-control.btest.ts`, so the mount/type/wait
 * sequence is written once rather than duplicated across both files.
 *
 * Keystrokes are dispatched with `page.keyboard`, Playwright's REAL,
 * trusted, CDP-level input path (real `keydown`/`keypress`/`input`/`keyup`
 * events, the same as `tests/web/mount.btest.ts` already uses) — never
 * `element.dispatchEvent(...)` from in-page script, which this run's own
 * DETAILS calls for ("dispatch real keyboard events").
 *
 * Every keystroke's actual edit-to-paint MILLISECOND VALUE is computed
 * entirely in-page (`support/entry.ts`, `KeyboardEvent.timeStamp` through a
 * `requestAnimationFrame` after the mutation is observed) — the
 * `waitForFunction` polling here only learns WHEN that value became
 * available; Node<->browser round-trip/IPC latency never contaminates the
 * measured value itself, only how quickly this loop notices it is ready.
 */

export interface MountResult {
  readonly selector: string;
  readonly mountMs: number;
}

export async function mountDocument(page: Page, text: string): Promise<MountResult> {
  const mountMs = await page.evaluate(
    (documentText) => window.__gpPerf.mountAndMeasureInteractive(documentText),
    text,
  );
  const selector = await page.evaluate(() => window.__gpPerf.containerSelector);
  return { selector, mountMs };
}

/**
 * Focuses `selector`, moves the caret to the END OF THE DOCUMENT, then types
 * `totalKeystrokes` characters cycled from `phrase` one at a time, pacing
 * `cadenceMs` between keystrokes (applied AFTER each keystroke's
 * measurement resolves, so pacing never races with measurement capture).
 * Returns every recorded edit-to-paint sample, in keystroke order -
 * callers slice off their own warm-up prefix.
 *
 * NAVIGATION (PERF-1, SFE-P3d-sweep audit follow-up): the caret is placed
 * with `Control+End`, the vendored fork's own `documentEnd` command (the
 * same key `measurement-guard.btest.ts` and the custom-view probes use),
 * NOT a bare `End`. `End` moves to the end of whatever LINE the preceding
 * coarse `page.click(selector)` landed on - for this container's huge,
 * unscrolled bounding box that is char ~937 of 256,018 in the 250 KiB
 * corpus, i.e. near-START typing, where every keystroke shifts every later
 * block's absoluteStart. The D13 gate's stated shape is end-of-document
 * typing, so every number this helper feeds the sweep used to be measuring
 * a different (more expensive) shape than the one the gate names.
 *
 * The sample buffer is reset AFTER the click + navigation, inside the second
 * of two `requestAnimationFrame` callbacks: activating the clicked block and
 * moving the caret to the document's end each produce their own DOM
 * mutations (block activation was observed at 9-30 ms), and with the old
 * reset-before-click order those landed in the buffer as a spurious extra
 * "keystroke" - the 81-vs-80 AP-21 liveness failure the sweep hit. Two
 * frames are needed because the in-page recorder itself pushes its value
 * from a `requestAnimationFrame` queued by the mutation observer: the first
 * frame lets that pending push land, the second clears it.
 *
 * SANDBOX CAVEAT: `test:perf` has no CI job. Every number recorded from this
 * helper (in the audit doc, lane notes, or PERF-3's table) is a number from
 * whichever sandbox happened to run it, under that sandbox's load at the
 * time - never a controlled-hardware figure. Compare runs only against runs
 * from the same machine and session.
 */
export async function typeAndMeasure(
  page: Page,
  selector: string,
  totalKeystrokes: number,
  cadenceMs: number,
  phrase: string,
): Promise<number[]> {
  await page.click(selector);
  await page.keyboard.press("Control+End");
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            window.__gpPerf.resetMeasurements();
            resolve();
          });
        });
      }),
  );
  // AP-21 liveness precheck: nothing may already be in the buffer before the
  // first keystroke, or the per-keystroke `>= i + 1` waits below would be
  // satisfied by the navigation's own sample rather than the keystroke's.
  const preTypingCount = await page.evaluate(() => window.__gpPerf.measurementCount());
  if (preTypingCount !== 0) {
    throw new Error(
      `typeAndMeasure: ${preTypingCount} measurement(s) already recorded before the first keystroke - ` +
        "the post-navigation reset did not discard the navigation's own sample",
    );
  }

  for (let i = 0; i < totalKeystrokes; i++) {
    const ch = phrase[i % phrase.length]!;
    await page.keyboard.type(ch);
    await page.waitForFunction(
      (expectedCount) => window.__gpPerf.measurementCount() >= expectedCount,
      i + 1,
      { timeout: 15_000 },
    );
    if (cadenceMs > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, cadenceMs));
    }
  }

  return page.evaluate(() => window.__gpPerf.measurements());
}
