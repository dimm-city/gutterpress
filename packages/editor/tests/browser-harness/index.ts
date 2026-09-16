import type { Browser, Page } from "playwright-core";
import { launchHarnessBrowser } from "./browser.ts";
import { buildBrowserEntry } from "./bundle.ts";
import { loadMarkdownEditorCssAssets } from "./package-assets.ts";
import { startHarnessServer } from "./server.ts";

/**
 * SFE-P1b Lane A — reusable REAL-Chromium browser test harness (run spec
 * "Harness requirements"). `openHarnessSession` drives the full pipeline
 * every browser test needs: (1) bun-build the test entry into a
 * self-contained ESM bundle, (2) serve it plus `@vscode/markdown-editor`'s
 * CSS over `node:http` on an OS-assigned loopback port, (3) launch Chromium
 * via `playwright-core` (default resolution, falling back to
 * `/opt/pw-browsers`), (4) hand the caller a live `Page` plus captured
 * console/page errors. `withHarnessPage` wraps that in a single
 * build-run-teardown call for a one-off scenario; `openHarnessSession` is
 * the lower-level form for a `beforeAll`/`afterAll` pair that shares ONE
 * browser session across many `test()` cases in one file.
 *
 * Session reuse is not merely an optimization here: launching a FRESH
 * Chromium process per `test()` (i.e. calling `withHarnessPage` once per
 * case) was measured live, in this exact sandboxed environment, to hang
 * launching the second/subsequent Chromium instance (30s timeout, every
 * time, at a fixed position) while a single shared session driving the
 * same scenarios sequentially via `window.__gp.mount()`/`dispose()`
 * completed in ~1.5s — so `tests/vscode-adapter/browser.cases.btest.ts`
 * uses `openHarnessSession` + `beforeAll`/`afterAll`, not one
 * `withHarnessPage` call per `test()`.
 *
 * Harness contract every test entry (tests/vscode-adapter/support/*.ts)
 * must follow: after mounting/whatever the scenario needs, set
 * `window.__gpReady = true`. `waitForHarnessReady` below is how a test
 * observes that the entry finished its own async setup before making
 * assertions — this is the harness's half of AP-21 ("liveness assertions
 * precede behavioral assertions"): a test that queries the DOM or a driver
 * object before this resolves is checking a page that may not have
 * mounted anything yet.
 */
export interface HarnessSession {
  readonly page: Page;
  /** Every `console.error`-level message the page produced, in order. */
  readonly consoleErrors: readonly string[];
  /** Every uncaught in-page exception (`pageerror`), in order. */
  readonly pageErrors: readonly string[];
}

export interface OpenHarnessSessionResult {
  readonly session: HarnessSession;
  /** Closes the browser and the HTTP server. Idempotent-safe to call once. */
  close(): Promise<void>;
}

/**
 * Builds `entryPath`, serves it, launches Chromium, and navigates to the
 * served page. The caller owns the returned session until it calls
 * `close()` — intended for a `beforeAll`/`afterAll` pair sharing one
 * session across multiple `test()` cases in a file. A Chromium launch
 * failure propagates as a thrown `Error` (see browser.ts) before any
 * resource is left dangling — never a silent skip (AP-20).
 */
export async function openHarnessSession(entryPath: string): Promise<OpenHarnessSessionResult> {
  const [bundle, css] = await Promise.all([
    buildBrowserEntry(entryPath),
    loadMarkdownEditorCssAssets(),
  ]);
  const server = await startHarnessServer(bundle.code, css);

  let browser: Browser | undefined;
  try {
    browser = await launchHarnessBrowser();
    const page = await browser.newPage();

    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    await page.goto(server.url);

    const openedBrowser = browser;
    return {
      session: { page, consoleErrors, pageErrors },
      async close(): Promise<void> {
        try {
          await openedBrowser.close();
        } catch (closeError) {
          console.error("browser harness: error closing the browser (ignored):", closeError);
        }
        try {
          await server.close();
        } catch (closeError) {
          console.error("browser harness: error closing the server (ignored):", closeError);
        }
      },
    };
  } catch (error) {
    // Launch or navigation failed before a session could be handed back —
    // nothing above owns cleanup yet, so this catch does.
    try {
      await browser?.close();
    } catch {
      // best-effort; the original error is what matters.
    }
    await server.close().catch(() => {});
    throw error;
  }
}

/**
 * Convenience wrapper around `openHarnessSession` for a single-scenario
 * test: builds, serves, launches, invokes `run`, then tears everything
 * down — even if `run` throws. Prefer `openHarnessSession` +
 * `beforeAll`/`afterAll` when a file drives multiple `test()` cases (see
 * this module's header comment for why).
 */
export async function withHarnessPage(
  entryPath: string,
  run: (session: HarnessSession) => Promise<void>,
): Promise<void> {
  const { session, close } = await openHarnessSession(entryPath);
  try {
    await run(session);
  } finally {
    await close();
  }
}

/**
 * Waits for the harness contract's readiness flag (`window.__gpReady ===
 * true`, set by the test entry once its own async mount/setup finishes).
 * Every browser case test calls this BEFORE any behavioral assertion
 * (AP-21) — see the header comment above.
 */
export async function waitForHarnessReady(page: Page, timeoutMs = 10_000): Promise<void> {
  await page.waitForFunction("window.__gpReady === true", { timeout: timeoutMs });
}

export { launchHarnessBrowser } from "./browser.ts";
export { buildBrowserEntry, type BuiltBrowserBundle } from "./bundle.ts";
export { loadMarkdownEditorCssAssets, type HarnessCssAssets } from "./package-assets.ts";
export { startHarnessServer, type HarnessServer } from "./server.ts";
