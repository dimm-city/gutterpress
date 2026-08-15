/**
 * Shared helper for the chromium edit-mode tests (edit-mode.test.ts,
 * preview/edit-live.test.ts). Test-only — imported by nothing in any build
 * entry.
 */

/**
 * Await the autosync batch that contains the COMPLETE typed edit, and return
 * the last such batch.
 *
 * `page.keyboard.type` sends one CDP round-trip per key; on a loaded CI
 * runner a stall longer than the test's `autosyncDelayMs` splits one logical
 * edit across several proposal batches, so "the first batch" may carry a
 * partial replacement (observed in CI: 2 of 13 keystrokes). The edit module
 * re-proposes on every debounce with the same `expected` until acked, so the
 * correct anchor is the LAST batch whose replacement contains the full typed
 * text — superseded partial proposals are simply never acked.
 */
export async function batchWithReplacement(
  page: {
    waitForFunction(expr: string): Promise<unknown>;
    evaluate(expr: string): Promise<unknown>;
  },
  needle: string,
): Promise<unknown> {
  const has = `(b) => b.patches[0] && b.patches[0].replacement.includes(${JSON.stringify(needle)})`;
  await page.waitForFunction(`window.__batches.some(${has})`);
  return page.evaluate(`window.__batches.findLast(${has})`);
}
