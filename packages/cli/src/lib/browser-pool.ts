import type { Browser } from "puppeteer-core";
import { requireChromiumExecutable } from "./chromium";

/**
 * Shared, pre-warmable headless-Chromium instance.
 *
 * Launching Chromium is a ~1–2s fixed cost. The build needs it for exactly one
 * thing — paginating the staged HTML — but that launch otherwise sits on the
 * critical path. This pool lets us:
 *
 *   1. **Pre-warm** — kick the launch off WITHOUT awaiting, so the cold start
 *      overlaps with markdown rendering + asset copy + staging.
 *   2. **Reuse** — keep one browser alive across many renders in the same
 *      process. A one-shot CLI build closes it at the end; a long-lived
 *      preview/watch server keeps it warm so every rebuild pays ZERO launch
 *      cost (just the pagination itself).
 *
 * Callers create a fresh `page` per render and close the PAGE, never the
 * browser — the browser lifecycle is owned here.
 */
let browserPromise: Promise<Browser> | null = null;

async function launchBrowser(timeoutMs: number): Promise<Browser> {
  const executablePath = await requireChromiumExecutable();
  // Lazy-load puppeteer-core (biggest dep; only needed for rendered output).
  const puppeteer = (await import("puppeteer-core")).default;
  // Extra Chromium flags via GUTTERPRESS_CHROMIUM_ARGS (containers/CI:
  // "--no-sandbox --disable-dev-shm-usage").
  const extraChromiumArgs = (process.env.GUTTERPRESS_CHROMIUM_ARGS ?? "")
    .split(/\s+/)
    .filter(Boolean);
  return puppeteer.launch({
    headless: true,
    executablePath,
    args: extraChromiumArgs,
    protocolTimeout: timeoutMs,
  });
}

/**
 * Start the Chromium launch in the background without awaiting it, so the cold
 * start overlaps with other build work. Safe to call repeatedly; only the first
 * call launches. If the launch fails, the pool resets so a later call retries.
 */
export function prewarmBrowser(timeoutMs: number): void {
  if (browserPromise) return;
  const p = launchBrowser(timeoutMs);
  browserPromise = p;
  p.then((browser) => {
    // If a long-lived preview/watch server's pooled Chromium crashes or is
    // otherwise disconnected, drop it so the next getBrowser() relaunches
    // instead of handing out — and awaiting — a dead instance forever. Guard on
    // identity so a stale handler can't clear a newer browser.
    browser.on("disconnected", () => {
      if (browserPromise === p) browserPromise = null;
    });
  }).catch(() => {
    // Suppress unhandled-rejection if nothing awaits before a failure; real
    // awaiters (getBrowser) still observe the rejection. Reset so we can retry.
    if (browserPromise === p) browserPromise = null;
  });
}

/**
 * Get the shared browser, launching (and pre-warming) on first use. Reused
 * across renders in the same process.
 */
export async function getBrowser(timeoutMs: number): Promise<Browser> {
  if (!browserPromise) prewarmBrowser(timeoutMs);
  return browserPromise!;
}

/**
 * Get the shared browser and open a fresh page on it, tolerating a browser
 * that died between the last health check and this call (e.g. a CI runner
 * that OOM-kills Chromium under memory pressure, or the pooled instance's own
 * devtools connection dropping): `browser.newPage()` on a disconnected
 * browser rejects with a websocket/"Connection ended"-shaped error rather
 * than triggering the `disconnected` listener in time to save this caller.
 * One retry after dropping the stale pool entry converts that into a clean
 * relaunch instead of a hard failure — the same shape of resilience
 * `getBrowser`/`prewarmBrowser` already give a launch that fails outright.
 */
export async function getBrowserPage(
  timeoutMs: number
): Promise<{ browser: Browser; page: Awaited<ReturnType<Browser["newPage"]>> }> {
  try {
    const browser = await getBrowser(timeoutMs);
    const page = await browser.newPage();
    return { browser, page };
  } catch (e) {
    // Drop whatever the pool is holding (closeBrowser() swallows a
    // close() failure on an already-dead browser) so getBrowser() below
    // launches fresh rather than handing back the same broken instance.
    await closeBrowser();
    const browser = await getBrowser(timeoutMs);
    const page = await browser.newPage();
    return { browser, page };
  }
}

/**
 * Close the shared browser. A one-shot CLI build calls this when done so the
 * process can exit; a preview/watch server calls it on shutdown.
 */
export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  try {
    const b = await p;
    await b.close();
  } catch {
    /* already failed/closed */
  }
}
