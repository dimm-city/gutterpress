#!/usr/bin/env node
// Focused check: click-to-edit sync + real PDF export via app UI, on a SMALL
// fixture (fast open + fast export) — items 6 & 7 of the in-app measurement
// pass. Usage: node click-and-export.pw.mjs <fixtureDir> <engineLabel>
import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, writeFileSync, statSync, rmSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

// Resolve from THIS FILE, never a hardcoded absolute path: the literal that
// used to sit here pointed at one developer's machine
// (`/home/founder3/code/dimm-city/print-md/...`), so this script could not run
// anywhere else — including CI and every other checkout. Same convention as
// inline-editing.pw.mjs.
const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const electronBin = require_("electron");
const mainJs = join(desktopDir, "out", "main", "main.js");
const [, , fixtureArgRaw, engineLabel] = process.argv;
const fixtureArg = fixtureArgRaw;
function log(m) { console.log(`[${engineLabel}] ${m}`); }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

const userDataDir = mkdtempSync(join(tmpdir(), `gutterpress-clickexport-${engineLabel}-`));
writeFileSync(join(userDataDir, "gutterpress-prefs.json"), JSON.stringify({
  lastProjectDir: fixtureArg, leftPanel: { open: true, activeTab: "toc", width: 300 }, showLandingAtStartup: false,
}));

const electronApp = await electron.launch({
  executablePath: electronBin,
  args: [mainJs, `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
  timeout: 90_000,
});
async function waitForAppWindow(app) {
  for (;;) {
    const p = app.windows().find((w) => w.url().startsWith("app://"));
    if (p) { await p.waitForLoadState("domcontentloaded"); return p; }
    await sleep(200);
  }
}
const results = {};
let exitCode = 0;
try {
  const page = await waitForAppWindow(electronApp);
  const shell = page.frameLocator('iframe[title="Gutterpress preview"]');
  const book = shell.frameLocator("#gutterpress-active");
  const bookBody = book.locator("body");

  await bookBody.waitFor({ state: "attached", timeout: 60_000 });
  await Promise.race([
    book.locator(".pagedjs_page").first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {}),
    book.locator(".gp-sheet").first().waitFor({ state: "visible", timeout: 60_000 }).catch(() => {}),
  ]);

  // ── 6. click-to-edit sync ─────────────────────────────────────────────
  const para = book.locator("p").filter({ hasText: /.{25,}/ }).first();
  try {
    await para.scrollIntoViewIfNeeded();
    const paraText = (await para.textContent())?.trim() ?? "";
    const box = await para.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + Math.min(10, box.height / 2));
    await sleep(700);
    const editorState = await page.evaluate((needle) => {
      const cm = document.querySelector(".cm-editor");
      if (!cm) return { hasEditor: false };
      const lines = [...cm.querySelectorAll(".cm-line")].map((l) => l.textContent);
      const activeText = cm.querySelector(".cm-activeLine")?.textContent ?? null;
      const firstWords = needle.split(/\s+/).slice(0, 5).join(" ");
      const matched = lines.some((l) => l.includes(firstWords));
      return { hasEditor: true, activeLineText: activeText, visibleLinesMatchClickedParagraph: matched, needle: firstWords, visibleLines: lines };
    }, paraText);
    results.clickToEdit = editorState;
    log(`6. click-to-edit: ${JSON.stringify(editorState)}`);
  } catch (e) {
    results.clickToEdit = { error: e.message };
    log(`6. click-to-edit FAILED: ${e.message}`);
  }

  // ── 7. export PDF via app UI ─────────────────────────────────────────
  try {
    const outPath = join(tmpdir(), `gutterpress-clickexport-${engineLabel}.pdf`);
    // The success poll below is `existsSync(outPath)`, so a leftover PDF from
    // an earlier run would report instant success with a stale size/page
    // count. Always start from a clean slate.
    rmSync(outPath, { force: true });
    await electronApp.evaluate(({ dialog }, out) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: out });
    }, outPath);
    await page.locator("button.export-btn").click();
    await sleep(500);
    await page.locator("button", { hasText: /Export PDF/ }).first().click({ timeout: 5000 });
    const deadline = Date.now() + 90_000;
    let done = false;
    while (Date.now() < deadline) {
      if (existsSync(outPath)) { done = true; break; }
      await sleep(400);
    }
    let pageCount = null, fileSize = null, mediaBox = null;
    if (done) {
      await sleep(500); // let the write finish flushing
      fileSize = statSync(outPath).size;
      try {
        const info = execSync(`pdfinfo ${JSON.stringify(outPath)}`).toString();
        const m = info.match(/Pages:\s+(\d+)/);
        pageCount = m ? Number(m[1]) : null;
        const mb = info.match(/Page size:\s+([\d.]+ x [\d.]+ pts.*)/);
        mediaBox = mb ? mb[1] : null;
      } catch {}
    }
    results.exportAttempt = { done, outPath, fileSize, pageCount, mediaBox };
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
