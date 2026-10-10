import { afterAll, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

import { launchChromium, type Browser } from "../../../cli/src/engine/shared/cdp";
import { resolveChromiumExecutable } from "../../../cli/src/lib/chromium";

/**
 * Physical hit-testing contract for the preview loading scrim. The companion
 * source test pins the declarations; this one lets Chromium decide where a
 * wheel and click actually land when the scrim sits above an iframe.
 *
 * Driven over the engine's own raw-CDP session (`launchChromium`) — the one
 * Chrome launcher this repo has — so the test runs in exactly the browser the
 * CLI ships with, flags and all.
 */
const component = readFileSync(
  path.resolve(import.meta.dir, "../../src/lib/components/ActivityIndicator.svelte"),
  "utf8",
);
const css = component.match(/<style>([\s\S]*?)<\/style>/)?.[1];
if (!css) throw new Error("ActivityIndicator.svelte has no style block");

const chromium = await resolveChromiumExecutable();
const browserTest = chromium ? test : test.skip;

// Launch Chromium HERE, at module scope, which bun does not apply a per-test
// timeout to. The test below budgets 30s for the hit-testing it actually
// measures; a cold start on a loaded runner must not share that budget (that
// is what timed out at 30000.27ms in CI, ~1 run in 9, when launch and test
// shared one 30s window). Bumping the test timeout was tried once (680ff80)
// and only moved the collision.
const browser: Browser | undefined = chromium ? await launchChromium() : undefined;

afterAll(async () => {
  await browser?.close();
});

type Page = Awaited<ReturnType<Browser["newPage"]>>;

/** Poll a browser-side predicate (the raw CDP session has no waitForFunction). */
async function waitFor(page: Page, expr: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await page.evaluate<boolean>(`!!(${expr})`))) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${expr}`);
    await new Promise((r) => setTimeout(r, 50));
  }
}

/** Centre of an element's box, in CSS px — where a pointer event is dispatched. */
async function centerOf(page: Page, selector: string): Promise<{ x: number; y: number }> {
  const box = await page.evaluate<{ x: number; y: number } | null>(
    `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null;
       const r = el.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; })()`,
  );
  if (!box) throw new Error(`${selector} has no layout box`);
  return box;
}

browserTest("wheel passes through the indicator card to the iframe while Cancel remains clickable", async () => {
  const page = await browser!.newPage();
  try {
    await page.send("Emulation.setDeviceMetricsOverride", {
      width: 640,
      height: 520,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await page.setContent(`<!doctype html>
      <style>
        :root {
          --app-overlay: rgba(0, 0, 0, .2);
          --app-spinner-track: #ccc;
          --app-surface-raised: #fff;
          --app-border: #ccc;
          --app-text: #111;
          --app-text-muted: #666;
          --app-shadow-md: rgba(0, 0, 0, .2);
          --app-control-hover-border: #444;
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
        <div class="region overlay anchor-pane" role="status">
          <div class="layer">
            <div class="card">
              <span class="spinner"></span>
              <div class="text"><p class="label">Laying out pages…</p><p class="detail"></p></div>
              <div class="bar-slot"></div>
              <button class="cancel">Cancel</button>
            </div>
          </div>
        </div>
      </div>`);

    // The srcdoc iframe is same-origin, so its document is readable from here.
    const FRAME = `document.getElementById("preview")`;
    await waitFor(page, `${FRAME} && ${FRAME}.contentDocument && ${FRAME}.contentDocument.querySelector("main")`, 10_000);

    const spinner = await centerOf(page, ".card");
    await page.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: spinner.x, y: spinner.y });
    await page.send("Input.dispatchMouseEvent", {
      type: "mouseWheel",
      x: spinner.x,
      y: spinner.y,
      deltaX: 0,
      deltaY: 320,
    });
    // Wait for the scroll to propagate, not for a fixed 100ms. Under CI load
    // that sleep expired before the wheel reached the iframe and the assertion
    // read scrollY === 0 — the exact "Expected: > 0, Received: 0" this test
    // failed with. Polling the condition is also FASTER in the common case,
    // and a wheel that genuinely does not pass through still fails here, with
    // a timeout naming this wait.
    await waitFor(page, `${FRAME}.contentWindow.scrollY > 0`, 10_000);
    expect(await page.evaluate<number>(`${FRAME}.contentWindow.scrollY`)).toBeGreaterThan(0);

    await page.evaluate(`document.querySelector(".cancel").addEventListener("click", () => {
      document.body.dataset.cancelled = "yes";
    })`);
    const cancel = await centerOf(page, ".cancel");
    for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
      await page.send("Input.dispatchMouseEvent", {
        type,
        x: cancel.x,
        y: cancel.y,
        button: "left",
        clickCount: 1,
      });
    }
    expect(await page.evaluate<string | undefined>(`document.body.dataset.cancelled`)).toBe("yes");
  } finally {
    await page.close();
  }
}, 30_000);
