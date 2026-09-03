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
 * This drives the Electron desktop end-to-end via Playwright, either a
 * packaged executable or the unpacked `out/main/main.js` the CI behaviour job
 * builds:
 *   - launches the app against a fresh userData seeded to auto-open the
 *     multi-chapter fixture with the left panel on the Contents tab,
 *   - opens the editor (auto-selects the first chapter file),
 *   - edits the first and last lines of that one-file document,
 *   - proves both neighboring chapter files stayed byte-for-byte unchanged,
 *   - clicks the outline entry for the LAST chapter's heading,
 *   - asserts the editor's active file and document switched to that chapter.
 *
 * Usage:
 *   node tests/integration/editor-dropdown-sync.pw.mjs <packaged-exe-or-out/main/main.js> [fixture-dir]
 *
 * Exit 0 on pass, 1 on fail.
 */

import { _electron as electron } from "playwright-core";
import { waitForAppWindow } from "./app-window.mjs";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";

function log(msg) { console.log(`[etest] ${msg}`); }
function fail(msg) { console.error(`[etest] FAIL: ${msg}`); process.exit(1); }

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const [, , targetArg, fixtureArg] = process.argv;
if (!targetArg) fail("usage: editor-dropdown-sync.pw.mjs <packaged-exe-or-out/main/main.js> [fixture-dir]");
const target = resolve(targetArg);
if (!existsSync(target)) fail(`desktop target not found at ${target}`);
// Accepts EITHER a packaged executable OR the unpacked `out/main/main.js` the
// CI behaviour job builds — same `isMainJs ? require_("electron") : target`
// pattern problems-last-hop.pw.mjs already uses, so this drive's unique
// outline<->editor sync coverage can run in that job instead of needing its
// own AppImage packaging step. Packaged-binary mode keeps working unchanged
// for run-ui.mjs / `bun run test:ui`.
const isMainJs = target.endsWith(".js");
const executablePath = isMainJs ? require_("electron") : target;

// Fixture defaults to the co-located one; overridable for callers that run the
// test from a different working directory.
const srcFixture = fixtureArg
  ? resolve(fixtureArg)
  : resolve(__dirname, "fixtures", "multichapter");
if (!existsSync(srcFixture)) fail(`fixture not found at ${srcFixture}`);

// Open a temp COPY outside any git repository. The committed fixture lives
// inside the Gutterpress repo, so the app sees a syncable project and the
// fetch-on-open "New changes online" modal can pop mid-test (network-timing
// dependent) and its backdrop intercepts the outline click.
const fixturePath = mkdtempSync(join(tmpdir(), "gutterpress-uitest-fixture-"));
cpSync(srcFixture, fixturePath, { recursive: true });
const alphaPath = join(fixturePath, "01-alpha.md");
const betaPath = join(fixturePath, "02-beta.md");
const gammaPath = join(fixturePath, "03-gamma.md");
const originalAlpha = readFileSync(alphaPath, "utf8");
const originalBeta = readFileSync(betaPath, "utf8");
const originalGamma = readFileSync(gammaPath, "utf8");

// Seed a throwaway userData so the app auto-opens the fixture on launch (the
// same path as picking it once before) — no native Open dialog needed.
const userDataDir = mkdtempSync(join(tmpdir(), "gutterpress-uitest-"));
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({
    lastProjectDir: fixturePath,
    leftPanel: { open: true, activeTab: "toc", width: 300 },
    showLandingAtStartup: false,
  }),
);
writeFileSync(
  join(userDataDir, "app-settings.json"),
  JSON.stringify({ preview: { paneMode: "edit" } }),
);

log(`launching ${target}`);
const electronApp = await electron.launch({
  executablePath,
  args: [
    ...(isMainJs ? [target] : []),
    `--user-data-dir=${userDataDir}`,
    "--no-sandbox",
  ],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
  timeout: 90_000,
});

let exitCode = 0;
try {
  // firstWindow() would return the data:-URL SPLASH screen — wait for the
  // real SPA window on the app:// origin instead.
  const page = await waitForAppWindow(electronApp);
  await electronApp.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
    win?.setSize(760, 800);
  });
  log(`window at ${page.url()}`);

  // The fixture auto-opens; wait until the preview has rendered and the
  // Contents tab has been built from its outline.
  await page
    .locator(".toc-item")
    .first()
    .waitFor({ state: "visible", timeout: 120_000 });
  log("project auto-opened, Contents outline populated");
  await page.waitForTimeout(300);
  if (await page.locator(".cm-editor").count()) {
    fail("a persisted narrow Edit preference opened the editor without an explicit action");
  }

  // The narrow startup assertion is complete. Widen the real window for the
  // remaining editor/file-isolation interactions so the open Contents panel
  // is a sidebar instead of a modal scrim over the toolbar.
  await electronApp.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1200, 800);
  });

  /**
   * Choose a workspace mode however the toolbar is currently laid out. Below
   * a container width of 1150px the inline mode buttons collapse into a menu
   * (AppToolbar's own "collapse stages"), and with the Contents panel open at
   * 1200px the toolbar is on the far side of that line — so a drive that
   * clicks only the inline button waits forever on a hidden element.
   */
  async function setMode(label) {
    const inline = page.locator(`.mode-group [aria-label="${label}"]`);
    if (await inline.isVisible().catch(() => false)) {
      await inline.click();
      return;
    }
    await page.locator('.mode-menu > summary').click();
    await page.locator(`.mode-menu .menu-item:has-text("${label}")`).click();
  }

  // This drive is about the SOURCE editor: one file per document, byte-exact
  // edits at the first and last line. That surface is Edit mode - Read mounts
  // the paged editor, which renders the book rather than the source and has no
  // lines to click. The one-file invariant belongs to the shared buffer, so it
  // holds for both surfaces; only the source editor can be asserted line by line.
  await setMode("Edit");
  await page.locator(".cm-editor").waitFor({ timeout: 15_000 });
  await page
    .locator(".file-item.active")
    .waitFor({ state: "attached", timeout: 15_000 });

  const before = await page.locator(".file-item.active .file-name").textContent();
  log(`editor opened on: ${before}`);
  if (before === "03-gamma.md") {
    fail("editor unexpectedly started on the jump target; pick a different first file");
  }

  // The editor must contain one file, never the old concatenated whole-book
  // document. Exercise physical clicks at both edges of the document—the
  // exact interaction that used to cross a zero-length chapter boundary and
  // corrupt a neighboring file.
  const editor = page.locator(".cm-content");
  const initialEditorText = await editor.textContent();
  if (!initialEditorText?.includes("Alpha Chapter")) fail("alpha content is not visible in the editor");
  if (initialEditorText.includes("Beta Chapter") || initialEditorText.includes("Gamma Chapter")) {
    fail("editor contains neighboring chapter text; expected exactly one file");
  }

  await editor.locator(".cm-line").first().click({ position: { x: 2, y: 8 } });
  await page.keyboard.press("Home");
  await page.keyboard.insertText("<!-- FIRST-FILE-EDGE -->\n");
  await page.keyboard.press("Control+End");
  await editor.locator(".cm-line").last().click({ position: { x: 4, y: 8 } });
  await page.keyboard.press("End");
  await page.keyboard.insertText("\n<!-- LAST-FILE-EDGE -->");

  const saveDeadline = Date.now() + 15_000;
  let savedAlpha = originalAlpha;
  while (Date.now() < saveDeadline) {
    savedAlpha = readFileSync(alphaPath, "utf8");
    if (savedAlpha.includes("FIRST-FILE-EDGE") && savedAlpha.includes("LAST-FILE-EDGE")) break;
    await page.waitForTimeout(100);
  }
  if (!savedAlpha.includes("FIRST-FILE-EDGE") || !savedAlpha.includes("LAST-FILE-EDGE")) {
    fail("first/last-line edits were not saved to the active chapter");
  }
  const expectedAlpha = `<!-- FIRST-FILE-EDGE -->\n${originalAlpha}\n<!-- LAST-FILE-EDGE -->`;
  if (savedAlpha !== expectedAlpha) {
    fail("active chapter bytes were not exactly the two intended edge insertions");
  }
  if (readFileSync(betaPath, "utf8") !== originalBeta || readFileSync(gammaPath, "utf8") !== originalGamma) {
    fail("editing the active chapter changed a neighboring chapter file");
  }
  log("first/last-line clicks saved only the active file; neighboring files are byte-identical");

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
  const gammaEditorText = await editor.textContent();
  if (!gammaEditorText?.includes("Gamma Chapter") || gammaEditorText.includes("Alpha Chapter")) {
    fail("file navigation changed the active filename but not the one-file editor document");
  }
  log(`editor followed to: ${after}`);
  log("PASS: the Contents outline moves the editor across chapters, in sync with the preview");
} catch (err) {
  console.error("[etest] uncaught:", err);
  exitCode = 1;
} finally {
  await electronApp.close();
  rmSync(fixturePath, { recursive: true, force: true });
  rmSync(userDataDir, { recursive: true, force: true });
}
process.exit(exitCode);
