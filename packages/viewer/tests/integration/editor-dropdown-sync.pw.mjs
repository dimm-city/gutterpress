#!/usr/bin/env node
/**
 * UI regression test: the outline (Contents tab) must move the EDITOR (not just
 * the preview) when you jump to a heading in a DIFFERENT chapter.
 *
 * The bug: clicking an outline entry for another chapter scrolled the preview to
 * that chapter but left the editor on the previously-open file — the two panes
 * desynced. (The jump suppresses the scroll-driven cross-chapter follow, so the
 * jump handler must move the editor itself.)
 *
 * The chapter UI moved from a toolbar dropdown (.chapter-item) to the left
 * panel's Contents tab (.toc-item) — this test follows the current surface.
 *
 * This drives the packaged Electron viewer end-to-end via Playwright:
 *   - launches the app against a fresh userData seeded to auto-open the
 *     multi-chapter fixture with the left panel on the Contents tab,
 *   - opens the editor (auto-selects the first chapter file),
 *   - clicks the outline entry for the LAST chapter's heading,
 *   - asserts the editor's active file (Files tab) switched to that chapter.
 *
 * Usage:
 *   node tests/integration/editor-dropdown-sync.pw.mjs <packaged-exe-path> [fixture-dir]
 *
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright-core";
import { waitForAppWindow } from "./app-window.mjs";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

function log(msg) { console.log(`[etest] ${msg}`); }
function fail(msg) { console.error(`[etest] FAIL: ${msg}`); process.exit(1); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , exeArg, fixtureArg] = process.argv;
if (!exeArg) fail("usage: editor-dropdown-sync.pw.mjs <packaged-exe-path> [fixture-dir]");
const exePath = resolve(exeArg);
if (!existsSync(exePath)) fail(`packaged exe not found at ${exePath}`);

// Fixture defaults to the co-located one; overridable for callers that run the
// test from a different working directory.
const fixturePath = fixtureArg
  ? resolve(fixtureArg)
  : resolve(__dirname, "fixtures", "multichapter");
if (!existsSync(fixturePath)) fail(`fixture not found at ${fixturePath}`);

// Seed a throwaway userData so the app auto-opens the fixture on launch (the
// same path as picking it once before) — no native Open dialog needed.
const userDataDir = mkdtempSync(join(tmpdir(), "pmd-uitest-"));
writeFileSync(
  join(userDataDir, "viewer-prefs.json"),
  JSON.stringify({
    lastProjectDir: fixturePath,
    leftPanel: { open: true, activeTab: "toc", width: 300 },
  }),
);

log(`launching ${exePath}`);
const electronApp = await electron.launch({
  executablePath: exePath,
  args: [`--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
});

let exitCode = 0;
try {
  // firstWindow() would return the data:-URL SPLASH screen — wait for the
  // real SPA window on the app:// origin instead.
  const page = await waitForAppWindow(electronApp);
  log(`window at ${page.url()}`);

  // The fixture auto-opens; wait until the preview has rendered and the
  // Contents tab has been built from its outline.
  await page
    .locator(".toc-item")
    .first()
    .waitFor({ state: "visible", timeout: 120_000 });
  log("project auto-opened, Contents outline populated");

  // Open the editor pane (auto-selects the first chapter file). The active
  // file lives in the Files tab — its panel is display:none while Contents is
  // active, so assert on the ATTACHED state and read textContent.
  await page.locator('[aria-label="Toggle markdown editor"]').click();
  await page.locator(".cm-editor").waitFor({ timeout: 15_000 });
  await page
    .locator(".file-item.active")
    .waitFor({ state: "attached", timeout: 15_000 });

  const before = await page.locator(".file-item.active .file-name").textContent();
  log(`editor opened on: ${before}`);
  if (before === "03-gamma.md") {
    fail("editor unexpectedly started on the jump target; pick a different first file");
  }

  // Jump to the LAST chapter's heading via the Contents tab outline.
  await page
    .locator(".toc-item", { hasText: "Gamma Chapter" })
    .first()
    .click();
  log('clicked outline entry "Gamma Chapter" (a different chapter)');

  // The editor must follow to 03-gamma.md.
  try {
    await page
      .locator('.file-item.active .file-name', { hasText: "03-gamma.md" })
      .waitFor({ state: "attached", timeout: 10_000 });
  } catch {
    const after = await page
      .locator(".file-item.active .file-name")
      .textContent();
    fail(
      `editor did NOT follow the cross-chapter jump: still on "${after}" ` +
      `after clicking "Gamma Chapter" (expected 03-gamma.md). The outline and ` +
      `the editor/preview follow desynced.`,
    );
  }

  const after = await page.locator(".file-item.active .file-name").textContent();
  log(`editor followed to: ${after}`);
  log("PASS: the Contents outline moves the editor across chapters, in sync with the preview");
} catch (err) {
  console.error("[etest] uncaught:", err);
  exitCode = 1;
} finally {
  await electronApp.close();
}
process.exit(exitCode);
