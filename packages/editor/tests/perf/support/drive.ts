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
 * Focuses `selector`, moves the caret to the end of the mounted document,
 * then types `totalKeystrokes` characters cycled from `phrase` one at a
 * time, pacing `cadenceMs` between keystrokes (applied AFTER each
 * keystroke's measurement resolves, so pacing never race with measurement
 * capture). Returns every recorded edit-to-paint sample, in keystroke
 * order — callers slice off their own warm-up prefix.
 */
export async function typeAndMeasure(
  page: Page,
  selector: string,
  totalKeystrokes: number,
  cadenceMs: number,
  phrase: string,
): Promise<number[]> {
  await page.evaluate(() => window.__gpPerf.resetMeasurements());
  await page.click(selector);
  await page.keyboard.press("End");

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
