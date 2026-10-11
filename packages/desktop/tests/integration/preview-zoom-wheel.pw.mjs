#!/usr/bin/env node
/**
 * Behaviour drive: the preview's zoom and wheel are PRESENTATION, never
 * pagination.
 *
 *  1. Zoom re-presents pages, it never re-decides them (#318). The book is
 *     re-paginated in place under several zooms, in Edit (single page) and
 *     Read (spread), and every block's first AND last line must stay on the
 *     same page — a paragraph that splits differently moves its last line
 *     even when its first stays put. The preview↔print parity gate compares
 *     one fixed setup, so it cannot see a pagination that drifts with zoom;
 *     this drive is that guard.
 *  2. A wheel flick over the preview turns one step, and one gesture never
 *     turns two (#301). Wheel events over the cross-origin book never reach
 *     the host page, so only a REAL wheel over the frame proves the flip is
 *     wired where the events arrive.
 *  3. At fit to width nothing scrolls sideways (#353): page turns and a
 *     sideways swipe leave the current page wholly in view.
 *
 * Runs against the 74-page user guide (examples/gutterpress-user-guide) — the
 * book #318 was reported on: tables, images, spreads.
 *
 * Usage:
 *   node tests/integration/preview-zoom-wheel.pw.mjs <packaged-exe-or-out/main/main.js> [book-dir]
 *
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright-core";
import { waitForAppWindow } from "./app-window.mjs";
import { setWorkspaceMode } from "./workspace-mode.mjs";
import { cpSync, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

function log(msg) { console.log(`[zoom-wheel] ${msg}`); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const [, , targetArg, bookArg] = process.argv;
if (!targetArg) {
  console.error("usage: preview-zoom-wheel.pw.mjs <packaged-exe-or-out/main/main.js> [book-dir]");
  process.exit(1);
}
const target = resolve(targetArg);
const isMainJs = target.endsWith(".js");
const executablePath = isMainJs ? require_("electron") : target;
const srcBook = resolve(bookArg ?? join(desktopDir, "..", "..", "examples", "gutterpress-user-guide"));

// A temp COPY outside any git repository, so no fetch-on-open modal can pop.
const bookDir = mkdtempSync(join(tmpdir(), "gutterpress-zoomwheel-book-"));
cpSync(srcBook, bookDir, { recursive: true });
const userDataDir = mkdtempSync(join(tmpdir(), "gutterpress-zoomwheel-home-"));
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({ lastProjectDir: bookDir, leftPanel: { open: false }, showLandingAtStartup: false }),
);
// The drives write and publish, so they run as an author (the app defaults
// to a reader, who has no editor).
writeFileSync(join(userDataDir, "app-settings.json"), JSON.stringify({ workspace: { role: "author" } }));

const electronApp = await electron.launch({
  executablePath,
  args: [...(isMainJs ? [target] : []), `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
  timeout: 90_000,
});

const failures = [];
async function check(name, fn) {
  try {
    await fn();
    log(`PASS — ${name}`);
  } catch (e) {
    failures.push(name);
    log(`FAIL — ${name}: ${e?.message ?? e}`);
  }
}

try {
  const page = await waitForAppWindow(electronApp);
  await electronApp.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.setSize(1400, 900));
  const book = page.frameLocator('iframe[title="Gutterpress preview"]').frameLocator("#gutterpress-active");
  await book.locator(".gp-sheet").first().waitFor({ state: "attached", timeout: 120_000 });
  await book.locator("body").evaluate(() => new Promise((r) => {
    const done = () => (window.__GUTTERPRESS_RENDERED__ ? r() : setTimeout(done, 100));
    done();
  }));
  log("book opened and paginated");

  const zoomTo = async (label) => {
    await page.locator('summary[aria-label="Zoom level"]').click();
    await page.locator(".preview-toolbar .menu-panel button.menu-item", { hasText: label }).first().click();
    await page.waitForTimeout(400);
  };

  await check("pagination is identical at every preview zoom, in Edit and Read (#318)", async () => {
    const pagination = () => book.locator("body").evaluate(async () => {
      window.Gutterpress.refresh(); // re-paginate in place under the current zoom
      await new Promise((r) => setTimeout(r, 300));
      const sheets = [...document.querySelectorAll(".gp-sheet")].map((s) => ({ page: +s.dataset.page, r: s.getBoundingClientRect() }));
      const pageAt = (rect) => {
        const x = rect.left + rect.width / 2, y = rect.top + rect.height / 2;
        return sheets.find(({ r }) => x >= r.left && x <= r.right && y >= r.top && y <= r.bottom)?.page ?? null;
      };
      const map = {};
      for (const el of document.querySelectorAll("[data-source-line]")) {
        const rects = [...el.getClientRects()].filter((r) => r.width > 0 && r.height > 0);
        if (!rects.length) continue;
        const key = `${el.closest("[data-chapter-src]")?.getAttribute("data-chapter-src") ?? ""}:${el.getAttribute("data-source-line")}:${el.tagName}`;
        if (!(key in map)) map[key] = `${pageAt(rects[0])}-${pageAt(rects[rects.length - 1])}`;
      }
      const zoom = getComputedStyle(document.documentElement).getPropertyValue("--gutterpress-zoom").trim();
      return { total: window.Gutterpress.totalPages, zoom, map };
    });
    for (const mode of ["Edit", "Read"]) {
      await setWorkspaceMode(page, mode);
      await zoomTo("100%");
      const base = await pagination();
      if (base.total < 10) throw new Error(`book too short to test pagination (${base.total} pages)`);
      for (const label of ["25%", "Fit to width", "75%", "150%"]) {
        await zoomTo(label);
        const got = await pagination();
        const moved = Object.keys(base.map).filter((k) => got.map[k] !== base.map[k]);
        if (got.total !== base.total || moved.length) {
          throw new Error(
            `${mode} at ${label} (zoom ${got.zoom}): ${got.total} pages vs ${base.total} at 100%; ${moved.length} blocks moved, e.g. ` +
              moved.slice(0, 3).map((k) => `${k} ${base.map[k]} -> ${got.map[k]}`).join("; "),
          );
        }
      }
      log(`${mode}: ${base.total} pages, ${Object.keys(base.map).length} blocks identical at 100%, 25%, fit-width, 75% and 150%`);
    }
  });

  await check("at fit to width the book cannot move sideways, in Edit and Read (#353)", async () => {
    // At fit the stage used to be its own sideways scroller with off-screen
    // scrollbars: page turns (scrollIntoView) and a sideways swipe shifted the
    // page left with no way back. Turn pages and swipe, then the book must
    // still sit at scrollLeft 0 with the current sheet wholly in view.
    const frame = await page.locator('iframe[title="Gutterpress preview"]').boundingBox();
    for (const mode of ["Edit", "Read"]) {
      await setWorkspaceMode(page, mode);
      await zoomTo("Fit to width");
      await book.locator("body").evaluate(async () => {
        const api = window.previewAPI;
        api.goToPage(Math.max(1, api.getTotalPages() - 3));
        api.nextPage();
        await new Promise((r) => setTimeout(r, 300));
      });
      await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
      await page.mouse.wheel(240, 0);
      await page.waitForTimeout(400);
      const got = await book.locator("body").evaluate(() => {
        const d = document.documentElement;
        const sheet = document.querySelector(`.gp-sheet[data-page="${window.previewAPI.getCurrentPage()}"]`);
        const r = sheet.getBoundingClientRect();
        return {
          scrollX: window.scrollX, bodyScrollLeft: document.body.scrollLeft,
          range: d.scrollWidth - d.clientWidth, left: r.left, right: r.right, width: d.clientWidth,
        };
      });
      if (got.scrollX !== 0 || got.bodyScrollLeft !== 0 || got.range > 1 || got.left < -1 || got.right > got.width + 1) {
        throw new Error(`${mode}: ${JSON.stringify(got)}`);
      }
    }
  });

  await check("a wheel flick over the preview turns one spread; one gesture never turns two (#301)", async () => {
    await setWorkspaceMode(page, "Read");
    await zoomTo("50%"); // the whole spread fits, so a flick turns rather than reads down a tall page
    const current = () => book.locator("body").evaluate(() => window.previewAPI.getCurrentPage());
    await book.locator("body").evaluate(() => window.previewAPI.goToPage(1));
    await page.waitForTimeout(400);
    const frame = await page.locator('iframe[title="Gutterpress preview"]').boundingBox();
    await page.mouse.move(frame.x + frame.width / 2, frame.y + frame.height / 2);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(60);
    await page.mouse.wheel(0, 120); // same gesture: must not turn again
    await page.waitForTimeout(1000);
    // One spread forward: 2 or 3 whether page 1 shares a spread or stands
    // alone (the viewer reports a settled spread by its left page, as the
    // arrow keys do). 4 or 5 would mean one gesture turned twice.
    const after = await current();
    if (after !== 2 && after !== 3) throw new Error(`one flick should show the next spread, got page ${after}`);
    await page.mouse.wheel(0, -120);
    await page.waitForTimeout(1000);
    const back = await current();
    if (back !== 1) throw new Error(`scrolling back should return to page 1, got ${back}`);
  });
} catch (e) {
  failures.push(`uncaught: ${e?.message ?? e}`);
  console.error("[zoom-wheel] uncaught:", e);
} finally {
  await electronApp.close().catch(() => {});
  for (const dir of [bookDir, userDataDir]) rmSync(dir, { recursive: true, force: true });
}
if (failures.length) {
  log(`${failures.length} check(s) failed`);
  process.exit(1);
}
log("PASS: zoom never re-paginates; fit never scrolls sideways; the wheel turns one step per gesture");
