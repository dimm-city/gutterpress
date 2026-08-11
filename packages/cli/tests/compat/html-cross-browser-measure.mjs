/**
 * One-off measurement script for native-engine-acceptance-gate.md §E:
 * does the published `--format html` artifact read as a PAGED document in
 * Chromium, Firefox, and WebKit (the native viewer script paginates the
 * multicol document client-side)?
 *
 * Paged.js has been removed (native-only-migration-plan.md Phase 6) — this
 * used to A/B the native leg against a `--engine paged` build; now it
 * measures the native artifact only.
 *
 * NOT part of the automated suite (no .pw.ts suffix — see playwright.config.ts's
 * header for why that matters) and not CI-wired: it drives real system
 * browsers against build output that must exist first.
 *
 * Usage:
 *   gutterpress build examples/with-design-guide/design-guide --format html \
 *     --out /tmp/wpE-html/native
 *   node tests/compat/html-cross-browser-measure.mjs
 *
 * Override the build output location with GP_NATIVE_HTML_DIR.
 *
 * RUNNING WEBKIT ON AN UNSUPPORTED LINUX (e.g. Ubuntu 26.04)
 * ----------------------------------------------------------
 * `playwright install webkit` refuses on too-new distros; force the download
 * with PLAYWRIGHT_HOST_PLATFORM_OVERRIDE=ubuntu24.04-x64. The downloaded
 * MiniBrowser then wants 7 host sonames the distro no longer ships. The WPE
 * runtime itself (libWPEWebKit / libwpe / libWPEBackend-fdo) DOES ship inside
 * the bundle's own `minibrowser-wpe/lib` — do not chase those.
 *
 * `minibrowser-wpe/MiniBrowser` OVERWRITES `LD_LIBRARY_PATH`, so pointing that
 * variable at a vendored prefix does nothing. Use LD_PRELOAD with absolute
 * paths instead (the loader registers each soname, satisfying the deps):
 *
 *   # extract these .debs into $P (dpkg-deb -x, no root needed):
 *   #   libicu74, libxml2 (2.9.x), libwoff1, libbacktrace0, libjxl0.10
 *   #   (+ libmanette / libenchant-2-2 only for the non-headless GTK browser)
 *   # libjxl 0.8 is gone from the archives; a symlink from the 0.10 build
 *   # satisfies the 0.8 soname and works for HTML rendering:
 *   ln -sf libjxl.so.0.10 $P/libjxl.so.0.8
 *   export LD_PRELOAD="$P/libicudata.so.74 $P/libicuuc.so.74 \
 *     $P/libicui18n.so.74 $P/libbacktrace.so.0 $P/libxml2.so.2 \
 *     $P/libwoff2common.so.1.0.2 $P/libwoff2dec.so.1.0.2 \
 *     $P/libjxl_cms.so.0.10 $P/libjxl.so.0.8"
 */
import { chromium, firefox, webkit } from "playwright";
import { serveDir } from "./serve-static.mjs";
import fs from "node:fs";

const SHOTS = process.env.GP_SHOT_DIR || "/tmp/wpE-html/shots";

const LEGS = {
  native: { dir: process.env.GP_NATIVE_HTML_DIR || "/tmp/wpE-html/native", port: 4501 },
};

const servers = {};
for (const [name, leg] of Object.entries(LEGS)) {
  servers[name] = await serveDir(leg.dir, leg.port);
  console.log(`serving ${name} on :${leg.port}`);
}

const BROWSERS = { chromium, firefox, webkit };

const results = [];

async function measure(browserName, launcher, legName, javaScriptEnabled) {
  const leg = LEGS[legName];
  const url = `http://127.0.0.1:${leg.port}/book.html`;
  const tag = `${browserName}-${legName}${javaScriptEnabled ? "" : "-nojs"}`;
  let browser;
  try {
    browser = await launcher.launch();
  } catch (e) {
    results.push({ tag, ok: false, error: "LAUNCH FAILED: " + e.message.split("\n")[0] });
    return;
  }
  const consoleErrors = [];
  const pageErrors = [];
  try {
    const context = await browser.newContext({
      viewport: { width: 1400, height: 900 },
      javaScriptEnabled,
    });
    const page = await context.newPage();
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await page.goto(url, { waitUntil: "load", timeout: 60000 });
    // give native's multicol fragmentation JS time to settle
    await page.waitForTimeout(8000);

    // screenshot at the TOP of the document, BEFORE any scrolling — a shot
    // taken after a wheel event lands at an engine-dependent offset and is
    // not comparable across browsers.
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: `${SHOTS}/${tag}-top.png` });

    const metrics = await page.evaluate(() => {
      const q = (s) => document.querySelectorAll(s).length;
      const se = document.scrollingElement;
      const sheets = [...document.querySelectorAll(".gp-sheet")];
      return {
        gpSheets: q(".gp-sheet"),
        gpStage: q(".gp-stage"),
        runningHeads: q(".gp-marginbox"),
        bodyText: document.body ? document.body.innerText.length : 0,
        scrollWidth: se ? se.scrollWidth : 0,
        scrollHeight: se ? se.scrollHeight : 0,
        // first four page boxes, to tell a real page grid from a single flow
        firstPageRects: sheets.slice(0, 4).map((el) => {
          const r = el.getBoundingClientRect();
          return [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)];
        }),
        // per-page text, so a page-count divergence can be located exactly
        pageTexts: sheets.map((el) => (el.innerText || "").replace(/\s+/g, " ").trim().slice(0, 60)),
      };
    });

    const before = await page.evaluate(() => ({
      x: document.scrollingElement.scrollLeft,
      y: document.scrollingElement.scrollTop,
    }));
    await page.mouse.wheel(0, 3000);
    await page.waitForTimeout(500);
    const after = await page.evaluate(() => ({
      x: document.scrollingElement.scrollLeft,
      y: document.scrollingElement.scrollTop,
    }));
    const scrolled = before.x !== after.x || before.y !== after.y;
    await page.screenshot({ path: `${SHOTS}/${tag}-scrolled.png` });

    results.push({ tag, ok: true, metrics, scrolled, consoleErrors, pageErrors });
    await context.close();
  } catch (e) {
    results.push({ tag, ok: false, error: "RUN FAILED: " + e.message.split("\n")[0], consoleErrors, pageErrors });
  } finally {
    await browser.close();
  }
}

// Measured with AND without JavaScript: the no-JS run is native's fallback —
// the document must remain readable (a true graceful fallback) even though
// the paginated view is the product.
for (const legName of Object.keys(LEGS)) {
  for (const [browserName, launcher] of Object.entries(BROWSERS)) {
    await measure(browserName, launcher, legName, true);
    await measure(browserName, launcher, legName, false);
  }
}

for (const s of Object.values(servers)) s.close();

console.log(JSON.stringify(results, null, 2));
