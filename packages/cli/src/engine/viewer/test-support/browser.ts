/**
 * Test-only browser access for the viewer tests, on top of the engine's own
 * launcher (`engine/shared/cdp.ts`'s `launchChromium`) — the ONE Chrome
 * launcher this repo has, so these tests run in exactly the Chromium, with
 * exactly the flags, that the CLI builds with.
 *
 * The raw CDP `Session` has `evaluate(expression: string)` and nothing else
 * these tests want; this wraps it in the small page surface they actually
 * use — `goto`, `waitForFunction`, `evaluate(fn | string, ...args)`,
 * `setViewport`, `pdf`, `close` — so a test can keep writing its browser-side
 * code as a typed closure (this program has the DOM lib; `fn.toString()` is
 * the transpiled JS, which is what gets sent). A closure here must be
 * self-contained, exactly as it had to be under the previous driver.
 *
 * One browser per test file: `getBrowser()` launches on first use and
 * `closeBrowser()` (from the file's `afterAll`) tears it down. Not a product
 * pool — the product (`lib/build-runner.ts`) launches one browser per build.
 */
import { launchChromium, type Browser, type Session } from "../../shared/cdp.ts";

export interface TestPage {
  goto(url: string): Promise<void>;
  setContent(html: string): Promise<void>;
  setViewport(v: { width: number; height: number }): Promise<void>;
  evaluate<T = unknown>(fnOrExpr: string | ((...a: any[]) => T | Promise<T>), ...args: unknown[]): Promise<T>;
  waitForFunction(fnOrExpr: string | (() => unknown), opts?: { timeout?: number }): Promise<void>;
  pdf(opts?: Record<string, unknown>): Promise<Uint8Array>;
  /** Chromium's page counters (`Performance.getMetrics`): `RecalcStyleCount`, `LayoutCount`, … */
  metrics(): Promise<Record<string, number>>;
  close(): Promise<void>;
}

export interface TestBrowser {
  newPage(): Promise<TestPage>;
}

function toExpression(fnOrExpr: string | ((...a: any[]) => unknown), args: unknown[]): string {
  if (typeof fnOrExpr === "string") return fnOrExpr;
  return `(${fnOrExpr.toString()})(${args.map((a) => JSON.stringify(a)).join(", ")})`;
}

function wrap(session: Session): TestPage {
  return {
    goto: (url) => session.navigate(url),
    setContent: (html) => session.setContent(html),
    async setViewport({ width, height }) {
      await session.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
    },
    evaluate: <T,>(fnOrExpr: string | ((...a: any[]) => T | Promise<T>), ...args: unknown[]) =>
      session.evaluate<T>(toExpression(fnOrExpr, args)),
    async waitForFunction(fnOrExpr, opts) {
      const expr = toExpression(fnOrExpr, []);
      const deadline = Date.now() + (opts?.timeout ?? 30_000);
      while (!(await session.evaluate<boolean>(`!!(${expr})`))) {
        if (Date.now() > deadline) throw new Error(`waitForFunction timed out: ${expr}`);
        await new Promise((r) => setTimeout(r, 50));
      }
    },
    pdf: (opts = {}) => session.printToPDF(opts),
    async metrics() {
      await session.send("Performance.enable");
      const { metrics } = await session.send<{ metrics: Array<{ name: string; value: number }> }>(
        "Performance.getMetrics",
      );
      return Object.fromEntries(metrics.map((m) => [m.name, m.value]));
    },
    close: () => session.close(),
  };
}

let browserPromise: Promise<Browser> | null = null;

export async function getBrowser(): Promise<TestBrowser> {
  browserPromise ??= launchChromium();
  const browser = await browserPromise;
  return { newPage: async () => wrap(await browser.newPage()) };
}

export async function closeBrowser(): Promise<void> {
  const p = browserPromise;
  browserPromise = null;
  if (!p) return;
  try {
    await (await p).close();
  } catch {
    /* already gone */
  }
}
