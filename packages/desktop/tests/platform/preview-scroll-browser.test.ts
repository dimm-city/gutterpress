import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { closeBrowser, getBrowser } from "../../../cli/src/lib/browser-pool";
import { resolveChromiumExecutable } from "../../../cli/src/lib/chromium";

/**
 * Physical hit-testing contract for the preview loading scrim. The companion
 * source test pins the declarations; this one lets Chromium decide where a
 * wheel and click actually land when the scrim sits above an iframe.
 */
const component = readFileSync(
  path.resolve(import.meta.dir, "../../src/lib/components/LoadingOverlay.svelte"),
  "utf8",
);
const css = component.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error("LoadingOverlay.svelte has no style block");

const chromium = await resolveChromiumExecutable();
const browserTest = chromium ? test : test.skip;

// Launch Chromium HERE, at module scope, which bun does not apply a per-test
// timeout to. The test below budgets 30s, and puppeteer's own launch() budget
// is also 30s — so a cold start on a loaded runner had to fit inside the same
// 30s as the hit-testing this test actually measures, with no headroom by
// construction. That is what timed out at 30000.27ms in CI (~1 run in 9); the
// `Target closed` protocol errors were teardown aftermath, not the cause.
// Bumping the test timeout was tried once (680ff80) and set the very 30s that
// collides with launch(). getBrowser() below returns this same pooled promise,
// already resolved, so the test body pays nothing for the launch.
if (chromium) await getBrowser(60_000);

afterAll(async () => {
  await closeBrowser();
});

browserTest("wheel passes through the spinner to the iframe while Cancel remains clickable", async () => {
  const browser = await getBrowser(60_000);
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 640, height: 520 });
    await page.setContent(`<!doctype html>
      <style>
        :root {
          --app-overlay: rgba(0, 0, 0, .2);
          --app-spinner-track: #ccc;
          --app-spinner-head: #333;
          --app-text-secondary: #222;
          --app-border-strong: #555;
          --app-scrim-strong: rgba(0, 0, 0, .1);
        }
        html, body { margin: 0; width: 100%; height: 100%; }
        .preview-pane { position: relative; width: 640px; height: 520px; }
        iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; }
        ${css}
      </style>
      <div class="preview-pane">
        <iframe id="preview" srcdoc="<!doctype html><style>html,body{margin:0}main{height:3000px;background:linear-gradient(#fff,#999)}</style><main></main>"></iframe>
        <div class="loading-overlay variant-pane">
          <div class="spinner-wrap">
            <div class="spinner"></div>
            <p class="label">Rendering…</p>
            <button class="cancel-btn">Cancel</button>
          </div>
        </div>
      </div>`);

    await page.waitForSelector("#preview");
    const frame = page.frames().find((candidate) => candidate !== page.mainFrame());
    if (!frame) throw new Error("preview iframe did not load");
    await frame.waitForSelector("main");

    const spinner = await page.$(".spinner");
    const spinnerBox = await spinner?.boundingBox();
    if (!spinnerBox) throw new Error("spinner has no layout box");
    await page.mouse.move(
      spinnerBox.x + spinnerBox.width / 2,
      spinnerBox.y + spinnerBox.height / 2,
    );
    await page.mouse.wheel({ deltaY: 320 });
    // Wait for the scroll to propagate, not for a fixed 100ms. Under CI load
    // that sleep expired before the wheel reached the iframe and the assertion
    // read scrollY === 0 — the exact "Expected: > 0, Received: 0" this test
    // failed with. Polling the condition is also FASTER in the common case,
    // and a wheel that genuinely does not pass through still fails here, with
    // a timeout naming this wait.
    await frame.waitForFunction(() => scrollY > 0, { timeout: 10_000 });
    expect(await frame.evaluate(() => scrollY)).toBeGreaterThan(0);

    await page.evaluate(() => {
      document.querySelector(".cancel-btn")?.addEventListener("click", () => {
        document.body.dataset.cancelled = "yes";
      });
    });
    await page.click(".cancel-btn");
    expect(await page.evaluate(() => document.body.dataset.cancelled)).toBe("yes");
  } finally {
    await page.close();
  }
}, 30_000);
