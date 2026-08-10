#!/usr/bin/env node
/**
 * Drive the real built Electron desktop app end-to-end for the native-engine
 * acceptance gate, in-app measurement pass. One run == one engine leg.
 *
 * Usage: node drive-app.mjs <fixtureDir> <engineLabel> <editChapterFile>
 */
import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, writeFileSync, readFileSync, appendFileSync, cpSync, rmSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const desktopDir = "/home/founder3/code/dimm-city/print-md/packages/desktop";
const require_ = createRequire(join(desktopDir, "package.json"));
const electronBin = require_("electron");
const mainJs = join(desktopDir, "out", "main", "main.js");

const [, , fixtureArgRaw, engineLabel, editFileRel, skipExportFlag] = process.argv;
const skipExport = skipExportFlag === "--skip-export";
if (!fixtureArgRaw || !engineLabel || !editFileRel) {
  console.error("usage: drive-app.mjs <fixtureDir> <engineLabel> <editChapterFile>");
  process.exit(1);
}
const fixtureArg = resolve(fixtureArgRaw);

function log(msg) { console.log(`[${engineLabel}] ${msg}`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const userDataDir = mkdtempSync(join(tmpdir(), `gutterpress-appdrive-${engineLabel}-`));
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({
    lastProjectDir: fixtureArg,
    leftPanel: { open: true, activeTab: "toc", width: 300 },
    showLandingAtStartup: false,
  }),
);

const results = {};

const t0 = Date.now();
const electronApp = await electron.launch({
  executablePath: electronBin,
  args: [mainJs, `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
  timeout: 90_000,
});

async function waitForAppWindow(app, timeoutMs = 90_000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const page = app.windows().find((w) => w.url().startsWith("app://"));
    if (page) { await page.waitForLoadState("domcontentloaded"); return page; }
    if (Date.now() > deadline) throw new Error("no app:// window");
    await sleep(200);
  }
}

let exitCode = 0;
try {
  const page = await waitForAppWindow(electronApp);
  const shell = page.frameLocator('iframe[title="Gutterpress preview"]');
  const book = shell.frameLocator("#gutterpress-active");
  const bookBody = book.locator("body");
  const bookEval = (fn, arg) => bookBody.evaluate(fn, arg);

  // ── 1. open -> first rendered preview timing ────────────────────────────
  await book.locator("body").waitFor({ state: "attached", timeout: 60_000 });
  // First visible page element differs by engine: paged uses .pagedjs_page,
  // native uses .gp-sheet.
  await Promise.race([
    book.locator(".pagedjs_page").first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {}),
    book.locator(".gp-sheet").first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {}),
  ]);
  const t1 = Date.now();
  results.openToFirstPreviewMs = t1 - t0;
  log(`1. open->first preview: ${results.openToFirstPreviewMs}ms`);

  // Sanity: which engine did we actually get?
  const sheetKind = await bookEval((doc) => {
    if (doc.ownerDocument.querySelector(".pagedjs_page")) return "paged";
    if (doc.ownerDocument.querySelector(".gp-sheet")) return "native";
    return "unknown";
  });
  results.detectedEngine = sheetKind;
  log(`detected DOM engine markers: ${sheetKind}`);

  // ── 2. hot reload, 3 samples ─────────────────────────────────────────────
  const editPath = join(fixtureArg, editFileRel);
  const original = readFileSync(editPath, "utf8");
  const hotReloadSamples = [];
  for (let i = 0; i < 3; i++) {
    const marker = `HOTRELOAD_MARK_${engineLabel}_${i}_${Date.now()}`;
    const content = original + `\n\nMarker paragraph ${marker}.\n`;
    const start = Date.now();
    writeFileSync(editPath, content, "utf8");
    // Poll the active iframe for the marker text.
    let found = false;
    while (Date.now() - start < 15_000) {
      try {
        found = await bookEval((el, m) => el.textContent.includes(m), marker);
      } catch { found = false; }
      if (found) break;
      await sleep(20);
    }
    const elapsed = Date.now() - start;
    hotReloadSamples.push(found ? elapsed : null);
    log(`hot reload sample ${i}: ${found ? elapsed + "ms" : "TIMEOUT"}`);
    writeFileSync(editPath, original, "utf8");
    // let the revert settle before next sample
    await sleep(1200);
  }
  results.hotReloadSamplesMs = hotReloadSamples;

  // ── 3. scroll to mid-book, reload, does position survive ────────────────
  const pageInfo = await page.evaluate(() => {
    const input = document.querySelector('input[aria-label="Go to page"]');
    return input ? input.value : null;
  }).catch(() => null);
  // Use previewAPI to go to a mid-book page directly for a controlled test.
  let midPage = null;
  try {
    const total = await bookEval((el) => el.ownerDocument.defaultView.previewAPI
      ? el.ownerDocument.defaultView.previewAPI.getTotalPages() : null);
    midPage = total ? Math.max(2, Math.floor(total / 2)) : null;
  } catch {}
  let survived = "n/a (previewAPI unavailable)";
  if (midPage) {
    await bookEval((el, p) => el.ownerDocument.defaultView.previewAPI.goToPage(p), midPage);
    await sleep(400);
    const before = await bookEval((el) => el.ownerDocument.defaultView.previewAPI.getCurrentPage());
    const marker2 = `RELOAD_POS_${engineLabel}_${Date.now()}`;
    writeFileSync(editPath, original + `\n\nMarker paragraph ${marker2}.\n`, "utf8");
    // wait for the marker to show up (reload happened)
    const start2 = Date.now();
    let found2 = false;
    while (Date.now() - start2 < 15_000) {
      try { found2 = await bookEval((el, m) => el.textContent.includes(m), marker2); } catch {}
      if (found2) break;
      await sleep(30);
    }
    await sleep(500);
    let after = null;
    try { after = await bookEval((el) => el.ownerDocument.defaultView.previewAPI.getCurrentPage()); } catch {}
    survived = { before, after, positionPreserved: before === after };
    writeFileSync(editPath, original, "utf8");
    await sleep(1000);
  }
  results.scrollReloadPositionSurvival = survived;
  log(`3. scroll+reload survival: ${JSON.stringify(survived)}`);

  // ── 4. toolbar page nav: last, first, middle — landed pages ─────────────
  const currentPageOf = () => bookEval((el) => el.ownerDocument.defaultView.previewAPI
    ? el.ownerDocument.defaultView.previewAPI.getCurrentPage() : null).catch(() => null);
  async function toolbarNav(label, btnAriaLabel) {
    await page.locator(`button[aria-label="${btnAriaLabel}"]`).click();
    await sleep(600);
    const landed = await currentPageOf();
    log(`toolbar nav ${label}: landed page ${landed}`);
    return landed;
  }
  const navLast = await toolbarNav("last", "Last page");
  const navFirst = await toolbarNav("first", "First page");
  // middle: use the "Go to page" input
  let navMiddle = null;
  try {
    const total = await bookEval((el) => el.ownerDocument.defaultView.previewAPI.getTotalPages());
    const mid = Math.max(1, Math.floor(total / 2));
    const select = page.locator('select[aria-label="Go to page"]');
    await select.selectOption(String(mid));
    await sleep(600);
    navMiddle = await currentPageOf();
    log(`toolbar nav middle: requested ${mid}, landed page ${navMiddle}`);
  } catch (e) { log(`middle nav failed: ${e.message}`); }
  results.toolbarNav = { last: navLast, first: navFirst, middleLanded: navMiddle };

  // ── 5. view modes toggle ─────────────────────────────────────────────────
  await page.locator('button[aria-label="Two pages side by side"]').click().catch(async () => {
    // collapsed toolbar: use the menu
    await page.locator('summary[aria-label="Page view mode"]').click();
    await page.locator('button[aria-label="Two pages side by side"]').click();
  });
  await sleep(500);
  const shotFn = (el) => {
    const doc = el.ownerDocument;
    const sheets = [...doc.querySelectorAll(".gp-sheet, .pagedjs_page")].slice(0, 4)
      .map((n) => { const r = n.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top) }; });
    return { bodyClass: doc.body.className, sheets };
  };
  const twoUpShot = await bookEval(shotFn);
  await page.locator('button[aria-label="Single page view"]').click().catch(async () => {
    await page.locator('summary[aria-label="Page view mode"]').click();
    await page.locator('button[aria-label="Single page view"]').click();
  });
  await sleep(500);
  const singleShot = await bookEval(shotFn);
  results.viewModes = { twoUp: twoUpShot, single: singleShot };
  log(`5. view modes: two-up=${JSON.stringify(twoUpShot)} single=${JSON.stringify(singleShot)}`);

  // ── 6. click-to-edit sync ────────────────────────────────────────────────
  await bookEval((el) => el.ownerDocument.defaultView.previewAPI.firstPage());
  await sleep(500);
  const para = book.locator("p").filter({ hasText: /.{25,}/ }).first();
  try {
    await para.scrollIntoViewIfNeeded();
    const paraText = (await para.textContent())?.trim().slice(0, 40) ?? "";
    const box = await para.boundingBox();
    // boundingBox() from frameLocator is relative to the outer page already
    // in Playwright (it composes iframe offsets), so click on page directly.
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(10, box.height / 2));
    await sleep(600);
    const editorState = await page.evaluate((needle) => {
      const cm = document.querySelector(".cm-editor");
      if (!cm) return { hasEditor: false };
      const lines = [...cm.querySelectorAll(".cm-line")].map((l) => l.textContent);
      const activeText = cm.querySelector(".cm-activeLine")?.textContent ?? null;
      const firstWords = needle.split(/\s+/).slice(0, 4).join(" ");
      const matched = lines.some((l) => l.includes(firstWords));
      return { hasEditor: true, activeLineText: activeText, visibleLinesMatchClickedParagraph: matched, needle: firstWords };
    }, paraText);
    results.clickToEdit = editorState;
    log(`6. click-to-edit: ${JSON.stringify(editorState)}`);
  } catch (e) {
    results.clickToEdit = { error: e.message };
    log(`6. click-to-edit FAILED: ${e.message}`);
  }

  // ── 7. export PDF via app UI ─────────────────────────────────────────────
  if (skipExport) {
    results.exportAttempt = { skipped: true, reason: "large fixture — measured separately via a small fixture (PDF wall-clock is explicitly out of gate scope)" };
    log(`7. export skipped for this large fixture`);
  } else
  try {
    const outPath = join(tmpdir(), `gutterpress-appdrive-${engineLabel}-export.pdf`);
    // The success poll below is `existsSync(outPath)`, so a leftover PDF from
    // an earlier run would report instant success with a stale size/page
    // count. Always start from a clean slate.
    rmSync(outPath, { force: true });
    // Stub Electron's native save dialog so the real app UI flow (Export
    // button -> dialog -> "Export PDF") can run headlessly end to end,
    // exactly the app code path a user drives, minus the native file picker
    // Playwright cannot see.
    await electronApp.evaluate(({ dialog }, out) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
    }, outPath);

    await page.locator('button.export-btn').click();
    await sleep(400);
    // Export dialog: find and click the PDF export action.
    const exportBtn = page.locator('button', { hasText: /Export PDF/ }).first();
    await exportBtn.click({ timeout: 5000 });
    // Wait for the file to exist (a ~300pp illustrated book's full Chromium
    // pagination + printToPDF can take a couple of minutes).
    const deadline = Date.now() + 180_000;
    let done = false;
    while (Date.now() < deadline) {
      if (existsSync(outPath)) { done = true; break; }
      await sleep(500);
    }
    let pageCount = null, fileSize = null;
    if (done) {
      const stat = await import("node:fs").then((m) => m.statSync(outPath));
      fileSize = stat.size;
      try {
        const { execSync } = await import("node:child_process");
        const info = execSync(`pdfinfo ${JSON.stringify(outPath)}`).toString();
        const m = info.match(/Pages:\s+(\d+)/);
        pageCount = m ? Number(m[1]) : null;
      } catch {}
    }
    results.exportAttempt = { done, outPath, fileSize, pageCount };
    log(`7. export via app UI: ${JSON.stringify(results.exportAttempt)}`);
  } catch (e) {
    results.exportAttempt = { error: e.message };
    log(`7. export FAILED: ${e.message}`);
  }

  log(`RESULTS_JSON ${JSON.stringify(results)}`);
} catch (e) {
  exitCode = 1;
  console.error(`[${engineLabel}] FATAL: ${e.stack || e.message}`);
} finally {
  await electronApp.close().catch(() => {});
}
process.exit(exitCode);
