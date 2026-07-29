/**
 * ARCH finding #49: browser-pool.ts (~87 lines) was the last CLI module named
 * in the architecture review with no direct tests. It is a pooled-Chromium
 * singleton wrapper around puppeteer-core (prewarmBrowser/getBrowser/
 * closeBrowser) — see build-runner.browser-lifecycle.test.ts for the
 * consumer-side try/finally guard around it (finding #50) and pagination.ts's
 * `puppeteerPdfRenderer` for the one caller of `getBrowser`. This file covers
 * the pool's OWN logic in isolation: singleton reuse, close-then-relaunch,
 * the no-op close, failure not poisoning the pool, prewarm idempotency, the
 * `disconnected`-listener auto-reset, and the launch-option wiring
 * (executablePath / protocolTimeout / GUTTERPRESS_CHROMIUM_ARGS parsing).
 *
 * Mocking strategy: browser-pool.ts only ever reaches puppeteer-core through
 * a lazy `(await import("puppeteer-core")).default` inside its private
 * `launchBrowser()` — there is no injection seam, and `launchBrowser` itself
 * isn't exported. Rather than `mock.module("puppeteer-core", ...)` (which, per
 * build-runner.browser-lifecycle.test.ts's header comment, replaces the
 * module in Bun's shared resolution registry for the WHOLE test run, not just
 * this file — it would leak a fake puppeteer-core into pagination.test.ts's
 * real-Chromium render smoke test), this file `spyOn`s `launch` directly on
 * the object a plain top-level `import puppeteerCore from "puppeteer-core"`
 * resolves to. ESM caches a module once per specifier, so that static import
 * and browser-pool.ts's dynamic import of the same specifier share the exact
 * same default-export object — spying on `launch` here intercepts the call
 * browser-pool.ts makes, with zero cross-file leakage. `./chromium`'s
 * `requireChromiumExecutable` is spied the same way (mirrors
 * build-runner.browser-lifecycle.test.ts). Every spy is restored, and the
 * pool drained, in `afterEach` so nothing survives into the next test (in
 * this file or any other).
 */
import { test, expect, spyOn, afterEach, mock } from "bun:test";
import puppeteerCore from "puppeteer-core";
import type { Browser } from "puppeteer-core";
import * as chromium from "./chromium.ts";
import { getBrowser, prewarmBrowser, closeBrowser } from "./browser-pool.ts";

/** Minimal fake satisfying the two Browser members browser-pool.ts touches. */
function makeFakeBrowser(): {
  browser: Browser;
  close: ReturnType<typeof mock>;
  emitDisconnected: () => void;
} {
  let disconnectedHandler: (() => void) | undefined;
  const close = mock(async () => {});
  const fake = {
    close,
    on: (event: string, handler: () => void) => {
      if (event === "disconnected") disconnectedHandler = handler;
      return fake;
    },
  };
  return {
    browser: fake as unknown as Browser,
    close,
    emitDisconnected: () => disconnectedHandler?.(),
  };
}

let requireChromiumMock: ReturnType<typeof spyOn> | undefined;
let launchMock: ReturnType<typeof spyOn> | undefined;

afterEach(async () => {
  // Drain the module-level pool between tests — browserPromise persists
  // across tests in this file unless explicitly closed.
  await closeBrowser();
  requireChromiumMock?.mockRestore();
  launchMock?.mockRestore();
  requireChromiumMock = undefined;
  launchMock = undefined;
});

function stubChromium(executablePath = "/fake/chrome"): void {
  requireChromiumMock = spyOn(chromium, "requireChromiumExecutable").mockImplementation(
    async () => executablePath
  );
}

test("two concurrent getBrowser() calls share a single launch (singleton semantics)", async () => {
  stubChromium();
  const { browser } = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch").mockImplementation(async () => browser);

  const [a, b] = await Promise.all([getBrowser(1000), getBrowser(1000)]);

  expect(a).toBe(browser);
  expect(b).toBe(browser);
  expect(launchMock).toHaveBeenCalledTimes(1);
});

test("a second, sequential getBrowser() call reuses the already-launched browser", async () => {
  stubChromium();
  const { browser } = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch").mockImplementation(async () => browser);

  const first = await getBrowser(1000);
  const second = await getBrowser(1000);

  expect(first).toBe(browser);
  expect(second).toBe(browser);
  expect(launchMock).toHaveBeenCalledTimes(1);
});

test("closeBrowser() closes the pooled browser and clears the pool so the next acquire relaunches", async () => {
  stubChromium();
  const first = makeFakeBrowser();
  const second = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch")
    .mockImplementationOnce(async () => first.browser)
    .mockImplementationOnce(async () => second.browser);

  const got1 = await getBrowser(1000);
  expect(got1).toBe(first.browser);

  await closeBrowser();
  expect(first.close).toHaveBeenCalledTimes(1);

  const got2 = await getBrowser(1000);
  expect(got2).toBe(second.browser);
  expect(got2).not.toBe(got1);
  expect(launchMock).toHaveBeenCalledTimes(2);
});

test("closeBrowser() is a no-op when nothing has ever been launched", async () => {
  stubChromium();
  launchMock = spyOn(puppeteerCore, "launch").mockImplementation(async () => {
    throw new Error("launch should not be called");
  });

  await expect(closeBrowser()).resolves.toBeUndefined();

  expect(launchMock).not.toHaveBeenCalled();
  expect(requireChromiumMock).not.toHaveBeenCalled();
});

test("closeBrowser() swallows a browser.close() failure (already-crashed browser)", async () => {
  stubChromium();
  const close = mock(async () => {
    throw new Error("already closed");
  });
  const browser = { close, on: () => browser } as unknown as Browser;
  launchMock = spyOn(puppeteerCore, "launch").mockImplementation(async () => browser);

  await getBrowser(1000);

  await expect(closeBrowser()).resolves.toBeUndefined();
  expect(close).toHaveBeenCalledTimes(1);
});

test("a failed launch propagates to the caller and does NOT poison the pool — the next acquire retries", async () => {
  stubChromium();
  const { browser: retryBrowser } = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch")
    .mockImplementationOnce(async () => {
      throw new Error("boom: chromium failed to start");
    })
    .mockImplementationOnce(async () => retryBrowser);

  let err: Error | undefined;
  try {
    await getBrowser(1000);
  } catch (e) {
    err = e as Error;
  }
  expect(err).toBeDefined();
  expect(err!.message).toContain("boom: chromium failed to start");

  // The pool must have reset itself (not stay wedged on the rejected promise)
  // so this second call launches again rather than re-throwing/hanging.
  const retried = await getBrowser(1000);
  expect(retried).toBe(retryBrowser);
  expect(launchMock).toHaveBeenCalledTimes(2);
});

test("prewarmBrowser() is idempotent — calling it twice only launches once", async () => {
  stubChromium();
  const { browser } = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch").mockImplementation(async () => browser);

  prewarmBrowser(1000);
  prewarmBrowser(1000); // second call must be a no-op (browserPromise already set)

  const got = await getBrowser(1000);
  expect(got).toBe(browser);
  expect(launchMock).toHaveBeenCalledTimes(1);
});

test("prewarmBrowser() resets the pool on a failed launch so a later call retries", async () => {
  stubChromium();
  const { browser: retryBrowser } = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch")
    .mockImplementationOnce(async () => {
      throw new Error("cold-start failure");
    })
    .mockImplementationOnce(async () => retryBrowser);

  prewarmBrowser(1000);
  // Nothing awaits the prewarm directly — give its internal .catch a tick to
  // run and reset browserPromise before the next call.
  await new Promise((resolve) => setTimeout(resolve, 10));

  const got = await getBrowser(1000);
  expect(got).toBe(retryBrowser);
  expect(launchMock).toHaveBeenCalledTimes(2);
});

test("a 'disconnected' event on the pooled browser drops it so the next getBrowser() relaunches", async () => {
  stubChromium();
  const first = makeFakeBrowser();
  const second = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch")
    .mockImplementationOnce(async () => first.browser)
    .mockImplementationOnce(async () => second.browser);

  const got1 = await getBrowser(1000);
  expect(got1).toBe(first.browser);

  first.emitDisconnected();
  // Let the identity-guarded reset handler run before the next acquire.
  await Promise.resolve();

  const got2 = await getBrowser(1000);
  expect(got2).toBe(second.browser);
  expect(launchMock).toHaveBeenCalledTimes(2);
  // Disconnection is not the same as an explicit close: the pool drops its
  // reference but never calls close() on a browser it didn't close itself.
  expect(first.close).not.toHaveBeenCalled();
});

test("a stale 'disconnected' handler cannot clear a newer browser (identity guard)", async () => {
  stubChromium();
  const first = makeFakeBrowser();
  const second = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch")
    .mockImplementationOnce(async () => first.browser)
    .mockImplementationOnce(async () => second.browser);

  const got1 = await getBrowser(1000);
  expect(got1).toBe(first.browser);

  // Explicitly close and relaunch BEFORE the first browser's disconnected
  // handler ever fires, then fire the stale handler afterwards.
  await closeBrowser();
  const got2 = await getBrowser(1000);
  expect(got2).toBe(second.browser);

  first.emitDisconnected();
  await Promise.resolve();

  // The stale handler must not have cleared the pool out from under the
  // current (second) browser.
  const got3 = await getBrowser(1000);
  expect(got3).toBe(second.browser);
  expect(launchMock).toHaveBeenCalledTimes(2);
});

test("launchBrowser resolves the executable via requireChromiumExecutable and forwards timeoutMs as protocolTimeout", async () => {
  stubChromium("/fake/resolved-chrome");
  const { browser } = makeFakeBrowser();
  launchMock = spyOn(puppeteerCore, "launch").mockImplementation(async () => browser);

  await getBrowser(4242);

  expect(requireChromiumMock).toHaveBeenCalledTimes(1);
  expect(launchMock).toHaveBeenCalledTimes(1);
  const opts = launchMock.mock.calls[0]![0] as Record<string, unknown>;
  expect(opts.executablePath).toBe("/fake/resolved-chrome");
  expect(opts.protocolTimeout).toBe(4242);
  expect(opts.headless).toBe(true);
});

test("GUTTERPRESS_CHROMIUM_ARGS is split on whitespace and forwarded as launch args", async () => {
  const prevArgs = process.env.GUTTERPRESS_CHROMIUM_ARGS;
  process.env.GUTTERPRESS_CHROMIUM_ARGS = "--no-sandbox   --disable-dev-shm-usage";
  try {
    stubChromium();
    const { browser } = makeFakeBrowser();
    launchMock = spyOn(puppeteerCore, "launch").mockImplementation(async () => browser);

    await getBrowser(1000);

    const opts = launchMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.args).toEqual(["--no-sandbox", "--disable-dev-shm-usage"]);
  } finally {
    if (prevArgs === undefined) delete process.env.GUTTERPRESS_CHROMIUM_ARGS;
    else process.env.GUTTERPRESS_CHROMIUM_ARGS = prevArgs;
  }
});

test("GUTTERPRESS_CHROMIUM_ARGS unset yields an empty args array (no stray empty-string token)", async () => {
  const prevArgs = process.env.GUTTERPRESS_CHROMIUM_ARGS;
  delete process.env.GUTTERPRESS_CHROMIUM_ARGS;
  try {
    stubChromium();
    const { browser } = makeFakeBrowser();
    launchMock = spyOn(puppeteerCore, "launch").mockImplementation(async () => browser);

    await getBrowser(1000);

    const opts = launchMock.mock.calls[0]![0] as Record<string, unknown>;
    expect(opts.args).toEqual([]);
  } finally {
    if (prevArgs !== undefined) process.env.GUTTERPRESS_CHROMIUM_ARGS = prevArgs;
  }
});
