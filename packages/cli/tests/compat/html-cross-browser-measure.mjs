/**
 * One-off measurement script for native-engine-acceptance-gate.md §E:
 * does the published `--format html` artifact read as a PAGED document in
 * Chromium, Firefox, and WebKit (native needs the viewer script + multicol;
 * paged is a pre-paginated DOM snapshot and should need nothing)?
 *
 * NOT part of the automated suite (no .pw.ts suffix — see playwright.config.ts's
 * header for why that matters) and not CI-wired: it drives real system
 * browsers against build output that must exist first, and WebKit needs
 * host libraries this sandbox does not ship (see the gate doc's §E rows for
 * exactly what was missing and what was tried).
 *
 * Usage:
 *   gutterpress build examples/with-design-guide/design-guide --format html \
 *     --engine native --out /tmp/wpE-html/native
 *   gutterpress build examples/with-design-guide/design-guide --format html \
 *     --engine paged  --out /tmp/wpE-html/paged
 *   node tests/compat/html-cross-browser-measure.mjs
 *
 * Override the build output locations with GP_NATIVE_HTML_DIR / GP_PAGED_HTML_DIR.
 */
import { chromium, firefox, webkit } from "playwright";
import { serveDir } from "./serve-static.mjs";
import fs from "node:fs";

const LEGS = {
  native: { dir: process.env.GP_NATIVE_HTML_DIR || "/tmp/wpE-html/native", port: 4501 },
  paged: { dir: process.env.GP_PAGED_HTML_DIR || "/tmp/wpE-html/paged", port: 4502 },
};

const servers = {};
for (const [name, leg] of Object.entries(LEGS)) {
  servers[name] = await serveDir(leg.dir, leg.port);
  console.log(`serving ${name} on :${leg.port}`);
}

const BROWSERS = { chromium, firefox, webkit };

const results = [];

async function measure(browserName, launcher, legName, extraOpts = {}) {
  const leg = LEGS[legName];
  const url = `http://127.0.0.1:${leg.port}/book.html`;
  let browser;
  try {
    browser = await launcher.launch();
  } catch (e) {
    results.push({ browserName, legName, ok: false, error: "LAUNCH FAILED: " + e.message.split("\n")[0] });
    return;
  }
  const consoleErrors = [];
  const pageErrors = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1400, height: 900 }, ...extraOpts });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await page.goto(url, { waitUntil: "load", timeout: 30000 });
    // give native's multicol fragmentation JS time to settle
    await page.waitForTimeout(2000);

    const metrics = await page.evaluate(() => {
      const folioSheets = document.querySelectorAll(".folio-sheet").length;
      const folioStage = document.querySelectorAll(".folio-stage").length;
      const pagedPages = document.querySelectorAll(".pagedjs_page").length;
      const runningHeads = document.querySelectorAll(
        ".folio-marginbox, .pagedjs_margin-content"
      ).length;
      const bodyText = document.body ? document.body.innerText.length : 0;
      const scrollWidth = document.scrollingElement ? document.scrollingElement.scrollWidth : 0;
      const scrollHeight = document.scrollingElement ? document.scrollingElement.scrollHeight : 0;
      const viewportW = window.innerWidth;
      const viewportH = window.innerHeight;
      return { folioSheets, folioStage, pagedPages, runningHeads, bodyText, scrollWidth, scrollHeight, viewportW, viewportH };
    });

    // test scroll navigation: scroll and see if scrollLeft/scrollTop changes and is retained
    const before = await page.evaluate(() => ({
      x: document.scrollingElement.scrollLeft,
      y: document.scrollingElement.scrollTop,
    }));
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(300);
    const after = await page.evaluate(() => ({
      x: document.scrollingElement.scrollLeft,
      y: document.scrollingElement.scrollTop,
    }));
    const scrolled = before.x !== after.x || before.y !== after.y;

    const shotPath = `/tmp/wpE-html/shots/${browserName}-${legName}${extraOpts.javaScriptEnabled === false ? "-nojs" : ""}.png`;
    fs.mkdirSync("/tmp/wpE-html/shots", { recursive: true });
    await page.screenshot({ path: shotPath, fullPage: false });

    results.push({
      browserName,
      legName,
      jsDisabled: extraOpts.javaScriptEnabled === false,
      ok: true,
      metrics,
      scrolled,
      consoleErrors,
      pageErrors,
      shotPath,
    });
    await context.close();
  } catch (e) {
    results.push({ browserName, legName, ok: false, error: "RUN FAILED: " + e.message.split("\n")[0], consoleErrors, pageErrors });
  } finally {
    await browser.close();
  }
}

for (const legName of Object.keys(LEGS)) {
  for (const [browserName, launcher] of Object.entries(BROWSERS)) {
    await measure(browserName, launcher, legName);
  }
}

// JS-disabled test, chromium, native only
await measure("chromium", chromium, "native", { javaScriptEnabled: false });

for (const s of Object.values(servers)) s.close();

console.log(JSON.stringify(results, null, 2));
