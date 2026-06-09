#!/usr/bin/env node
/**
 * UI regression test: the chapter-jump dropdown must move the EDITOR (not just
 * the preview) when you jump to a heading in a DIFFERENT chapter.
 *
 * The bug: clicking a dropdown entry for another chapter scrolled the preview to
 * that chapter but left the editor on the previously-open file — the two panes
 * desynced. (The jump suppresses the scroll-driven cross-chapter follow, so the
 * jump handler must move the editor itself.)
 *
 * This drives the packaged Electron viewer end-to-end via Playwright:
 *   - launches the app against a fresh userData seeded to auto-open the
 *     multi-chapter fixture,
 *   - opens the editor (auto-selects the first chapter file),
 *   - opens the chapter dropdown and clicks a heading in the LAST chapter,
 *   - asserts the editor's active file switched to that chapter's file.
 *
 * Usage:
 *   node tests/integration/editor-dropdown-sync.test.mjs <packaged-exe-path> [fixture-dir]
 *
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright-core";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

function log(msg) { console.log(`[etest] ${msg}`); }
function fail(msg) { console.error(`[etest] FAIL: ${msg}`); process.exit(1); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const [, , exeArg, fixtureArg] = process.argv;
if (!exeArg) fail("usage: editor-dropdown-sync.test.mjs <packaged-exe-path> [fixture-dir]");
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
  JSON.stringify({ lastProjectDir: fixturePath }),
);

log(`launching ${exePath}`);
const electronApp = await electron.launch({
  executablePath: exePath,
  args: [`--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
});

let exitCode = 0;
try {
  const page = await electronApp.firstWindow({ timeout: 30_000 });
  await page.waitForLoadState("domcontentloaded");
  log(`window at ${page.url()}`);

  // The fixture auto-opens; wait until the preview has rendered and the
  // chapter-jump dropdown has been built from its outline. The items live inside
  // a closed <details>, so wait for ATTACHED (present), not visible.
  await page
    .locator(".chapter-item")
    .first()
    .waitFor({ state: "attached", timeout: 60_000 });
  log("project auto-opened, chapter dropdown populated");

  // Open the editor pane (auto-selects the first chapter file).
  await page.locator('[aria-label="Toggle markdown editor"]').click();
  await page.locator(".cm-editor").waitFor({ timeout: 15_000 });
  await page.locator(".file-item.active").waitFor({ timeout: 15_000 });

  const before = await page.locator(".file-item.active .file-name").textContent();
  log(`editor opened on: ${before}`);
  if (before === "03-gamma.md") {
    fail("editor unexpectedly started on the jump target; pick a different first file");
  }

  // Open the chapter dropdown and jump to the LAST chapter's heading.
  await page.locator(".chapter-summary").click();
  await page
    .locator(".chapter-item", { hasText: "Gamma Chapter" })
    .first()
    .click();
  log('clicked dropdown entry "Gamma Chapter" (a different chapter)');

  // The editor must follow to 03-gamma.md.
  try {
    await page
      .locator('.file-item.active .file-name', { hasText: "03-gamma.md" })
      .waitFor({ timeout: 10_000 });
  } catch {
    const after = await page
      .locator(".file-item.active .file-name")
      .textContent();
    fail(
      `editor did NOT follow the cross-chapter jump: still on "${after}" ` +
      `after clicking "Gamma Chapter" (expected 03-gamma.md). The dropdown and ` +
      `the editor/preview follow desynced.`,
    );
  }

  const after = await page.locator(".file-item.active .file-name").textContent();
  log(`editor followed to: ${after}`);
  log("PASS: chapter dropdown moves the editor across chapters, in sync with the preview");
} catch (err) {
  console.error("[etest] uncaught:", err);
  exitCode = 1;
} finally {
  await electronApp.close();
}
process.exit(exitCode);
