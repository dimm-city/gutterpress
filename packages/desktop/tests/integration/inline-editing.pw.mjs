#!/usr/bin/env node
/**
 * Genuine end-to-end smoke test for inline editing in the paginated preview
 * (docs/inline-editing-plan.md, docs/adr/0009-inline-editing-source-ranges.md).
 *
 * Everything upstream of this file is fakes-based unit tests (per the plan's
 * §7.4 test-plan table, the integration layer is explicitly NOT CI-gated).
 * This is the first test that actually launches the built Electron app, opens
 * a real project, and drives the real preview iframe with real mouse/keyboard
 * input (Playwright `page.mouse.click(x, y, {button})` / `page.keyboard`) —
 * not `element.dispatchEvent(...)`. It follows the conventions of the other
 * `tests/integration/*.pw.mjs` scripts (electron-driver.pw.mjs,
 * editor-dropdown-sync.pw.mjs): plain Node + `playwright-core`'s
 * `_electron`, a fresh `--user-data-dir` per run, a fresh temp copy of a
 * fixture project, `[etest]`-prefixed logging, exit 0/1.
 *
 * When passed a packaged executable this test launches that exact artifact.
 * With no argument it falls back to the unpacked development build.
 *
 * DOM topology this test relies on (verified empirically, not assumed):
 *   main app:// page
 *     └─ <iframe title="Gutterpress preview">        (shell, served by the
 *          preview http server; PreviewFrame.svelte)
 *          └─ <iframe id="gutterpress-active">        (the actual paginated
 *               book document; preview-shell.js creates/swaps this)
 * The context menu itself (`.context-menu` / `.context-menu-item`) renders in
 * the MAIN app document, not either iframe — ContextMenu.svelte is mounted by
 * +page.svelte and absolutely-positioned over the preview pane.
 *
 * Usage:
 *   xvfb-run -a node tests/integration/inline-editing.pw.mjs [path/to/out/main/main.js]
 *
 * (No DISPLAY is set in this environment — wrap the invocation in `xvfb-run
 * -a`, exactly as render-perf-gate.yml does for the other packaged-app CI
 * gates. Locally, with a real display, drop the xvfb-run wrapper.)
 *
 * Exit 0 if every check passed, 1 if any failed. Each verification is run
 * independently (a failure in one does not stop the
 * others from running) and reported in a summary at the end.
 */
import { _electron as electron } from "playwright-core";
import { waitForAppWindow } from "./app-window.mjs";
import { cpSync, existsSync, mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(__dirname, "..", "..");

function log(msg) { console.log(`[etest] ${msg}`); }

const cliArgs = process.argv.slice(2);
const requirePackaged = cliArgs.includes("--require-packaged");
const executableArg = cliArgs.find((arg) => !arg.startsWith("--"));
const desktopVersion = JSON.parse(readFileSync(join(desktopDir, "package.json"), "utf8")).version;
const defaultTarget = requirePackaged
  ? join(desktopDir, "dist", `Gutterpress-${desktopVersion}.AppImage`)
  : join(desktopDir, "out", "main", "main.js");
const launchTarget = resolve(executableArg || defaultTarget);
if (!existsSync(launchTarget)) {
  console.error(`[etest] FAIL: no ${launchTarget} — build the desktop first`);
  process.exit(1);
}

const require_ = createRequire(join(desktopDir, "package.json"));
let electronBin;
try {
  electronBin = require_("electron"); // path to the real electron binary
} catch (e) {
  console.error(`[etest] FAIL: electron binary unavailable (${e.message.split("\n")[0]})`);
  process.exit(1);
}

const srcFixture = resolve(__dirname, "fixtures", "inline-editing");
if (!existsSync(srcFixture)) {
  console.error(`[etest] FAIL: fixture not found at ${srcFixture}`);
  process.exit(1);
}

// Fresh temp copy OUTSIDE this git repo (mirrors editor-dropdown-sync.pw.mjs's
// rationale: a project living inside the Gutterpress repo makes the desktop
// think it's a syncable/git-aware project and can pop network-dependent
// modals mid-test).
const fixturePath = mkdtempSync(join(tmpdir(), "gutterpress-inline-edit-fixture-"));
cpSync(srcFixture, fixturePath, { recursive: true });
const chapterPath = join(fixturePath, "01-chapter.md");
const originalChapterContent = readFileSync(chapterPath, "utf8");

// Fresh userData, seeded to auto-open the fixture with the outline tab
// showing and the welcome landing suppressed (`showLandingAtStartup: false`)
// — the landing is an interactive full-window overlay that sits ABOVE the
// preview at launch and swallows every click aimed at it until dismissed;
// without suppressing it, coordinate-based clicks on the preview land on the
// landing instead and this test's "kind: none" observations become
// indistinguishable from a genuine preview miss. (Discovered empirically:
// early runs of this test right-clicked the paragraph and got a NATIVE
// context menu instead of the Gutterpress one, tracing back to a Playwright
// `locator.click()` failure report naming
// `<input id="set-git-author-email">` inside `<section class="landing">` as
// the element actually intercepting the pointer.)
const userDataDir = mkdtempSync(join(tmpdir(), "gutterpress-inline-edit-userdata-"));
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({
    lastProjectDir: fixturePath,
    leftPanel: { open: true, activeTab: "toc", width: 300 },
    showLandingAtStartup: false,
  }),
);

const packaged = /(?:\.AppImage|\.exe)$/i.test(launchTarget) || launchTarget.includes(".app/");
if (requirePackaged && !packaged) {
  console.error(`[etest] FAIL: --require-packaged received a development build: ${launchTarget}`);
  process.exit(1);
}
log(`launching ${packaged ? "packaged app" : "development build"}: ${launchTarget}`);
const electronApp = await electron.launch({
  executablePath: packaged ? launchTarget : electronBin,
  args: packaged
    ? [`--user-data-dir=${userDataDir}`, "--no-sandbox"]
    : [launchTarget, `--user-data-dir=${userDataDir}`, "--no-sandbox"],
  env: { ...process.env, ELECTRON_DISABLE_GPU: "1" },
  timeout: 60_000,
});

// ── Result bookkeeping ───────────────────────────────────────────────────────
const results = [];
async function step(name, fn) {
  try {
    await fn();
    results.push({ name, ok: true });
    log(`PASS — ${name}`);
  } catch (e) {
    results.push({ name, ok: false, error: e?.message || String(e) });
    log(`FAIL — ${name}: ${e?.message || e}`);
  }
}
/** A non-fatal sub-observation recorded on the CURRENT step without aborting it. */
const notes = [];
function note(msg) {
  notes.push(msg);
  log(`NOTE — ${msg}`);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

let exitCode = 0;
try {
  const page = await waitForAppWindow(electronApp);
  log(`window at ${page.url()}`);

  // Test-side-only instrumentation: an ADDITIONAL listener on the real
  // `webContents` "context-menu" event, alongside the app's own handler
  // (electron/main.ts ~L731). This does not modify, remove, or race the
  // app's own listener — Node EventEmitters run every registered listener —
  // it only counts whether Chromium ever requested a native context menu for
  // this window, which is exactly the plan's PR-3 go/no-go signal (ADR 0009
  // §5 records the same technique: "0 fires suppressed vs 1 unsuppressed").
  await electronApp.evaluate(({ BrowserWindow }) => {
    globalThis.__gutterpressNativeCtxCount = 0;
    const win = BrowserWindow.getAllWindows()[0];
    win.webContents.on("context-menu", () => {
      globalThis.__gutterpressNativeCtxCount = (globalThis.__gutterpressNativeCtxCount || 0) + 1;
    });
  });
  const nativeCtxCount = () => electronApp.evaluate(() => globalThis.__gutterpressNativeCtxCount || 0);

  const shell = page.frameLocator('iframe[title="Gutterpress preview"]');
  const book = shell.frameLocator("#gutterpress-active");

  // ── 1. App launches, a project opens, the preview paginates ────────────────
  await step("1. app launches, project opens, preview paginates", async () => {
    await page.locator(".toc-item").first().waitFor({ state: "visible", timeout: 120_000 });
    await book.locator("body").waitFor({ state: "attached", timeout: 30_000 });
    await book.locator(".gp-sheet").first().waitFor({ state: "visible", timeout: 60_000 });
    const chapterAttr = await book.locator("[data-chapter-src]").first().getAttribute("data-chapter-src");
    if (chapterAttr !== "01-chapter.md") {
      throw new Error(`expected chapter 01-chapter.md open, got ${chapterAttr}`);
    }
  });

  const targetPara = book.locator("p", { hasText: "target paragraph for right click testing" });
  const marginBox = book.locator('.gp-marginbox[data-box="top-center"]');

  function isFrameSwapError(error) {
    return /Cannot find context|Execution context was destroyed|Frame was detached/i.test(
      error?.message || String(error),
    );
  }

  async function boxOf(locator) {
    // Defensive: the fixture's chapter is long enough that later steps'
    // targets are not guaranteed to be on the first rendered page (the viewer
    // stacks every sheet into one continuously scrollable stage) — scroll
    // into view first so page.mouse's absolute coordinates are meaningful
    // regardless of which page the element ends up on.
    let lastError;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      try {
        await locator.first().scrollIntoViewIfNeeded();
        const box = await locator.first().boundingBox();
        if (!box) throw new Error("locator has no bounding box (not visible?)");
        return box;
      } catch (error) {
        if (!isFrameSwapError(error)) throw error;
        lastError = error;
      }
      // A successful edit intentionally swaps #gutterpress-active. Reacquire
      // the FrameLocator target if that atomic swap lands during this read.
      await sleep(200);
    }
    throw lastError;
  }
  function centerOf(box) { return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }

  async function assertEditorClosed(action) {
    if (await page.locator(".cm-editor").count()) {
      throw new Error(`${action} opened the editor pane`);
    }
  }

  async function dismissMenuViaOutsideClick() {
    // Escape does not reliably close the menu (see step 4's note) — click a
    // known-inert point in the MAIN document (never inside either iframe:
    // mousedown inside an iframe does not bubble to the top document's
    // `window` listener that ContextMenu.svelte relies on for outside-click
    // dismissal). (5,5) resolves to the static `.identity-banner` status
    // strip, confirmed to have no click handler.
    await page.mouse.click(5, 5, { button: "left" });
    await page.waitForTimeout(150);
  }

  // ── 2 & 3. Right-click a paragraph -> Gutterpress menu; native menu absent ──
  let menuItemLabels = [];
  await step("2. right-click on a paragraph opens the Gutterpress context menu", async () => {
    const box = await boxOf(targetPara);
    const { x, y } = centerOf(box);
    await page.mouse.click(x, y, { button: "right" });
    await page.locator(".context-menu").waitFor({ state: "visible", timeout: 10_000 });
    menuItemLabels = await page.locator(".context-menu-item").allTextContents();
    log(`menu items: ${JSON.stringify(menuItemLabels)}`);
    if (!menuItemLabels.some((t) => t.includes("Insert page break before"))) {
      throw new Error(`expected "Insert page break before" among menu items, got ${JSON.stringify(menuItemLabels)}`);
    }
  });

  await step("3. the native Electron context menu does NOT also appear", async () => {
    // The right-click that opened the (still-open) menu in step 2 is the one
    // under test here — read the counter it left behind rather than
    // right-clicking again (a second right-click would just re-open/re-
    // position the SAME menu, per §4.2's "second right-click" dismissal rule,
    // which is a different code path than what we want to isolate).
    const count = await nativeCtxCount();
    if (count !== 0) {
      throw new Error(`expected 0 native context-menu events after an in-page menu click, got ${count}`);
    }
  });

  await step("3b. the real block-menu action opens an operable inline editor", async () => {
    await page.locator(".context-menu-item", { hasText: "Edit this block" }).click();
    const overlay = page.locator(".block-edit-overlay");
    await overlay.waitFor({ state: "visible", timeout: 10_000 });
    const input = overlay.locator(".cm-content");
    await input.click();
    await page.keyboard.press("End");
    await page.keyboard.type(" test");
    const text = await input.textContent();
    if (!text?.includes("test")) throw new Error("typing did not reach the inline block editor");
    await page.keyboard.press("Escape");
    await overlay.waitFor({ state: "hidden", timeout: 10_000 });
    await assertEditorClosed("inline block editing");
  });

  await dismissMenuViaOutsideClick();

  // ── 4. Shift+F10 opens the menu too (keyboard path, listener lives in the
  //      cross-origin book iframe) ────────────────────────────────────────────
  await step("4. Shift+F10 opens the context menu (keyboard path)", async () => {
    // Left-click a NEUTRAL point first — the margin box has no
    // data-source-line, so this cannot trigger elementActivated/click-to-
    // source (which would steal focus back into the editor and confound the
    // "does Shift+F10 reach the iframe" observation). A plain left click
    // reliably transfers browsing-context focus into the book iframe
    // (verified empirically: `document.hasFocus()` inside the iframe flips
    // true within one tick of this click, with no other setup needed).
    const mbox = await boxOf(marginBox);
    const { x, y } = centerOf(mbox);
    await page.mouse.click(x, y, { button: "left" });
    await page.waitForTimeout(150);

    await page.keyboard.press("Shift+F10");
    await page.locator(".context-menu").waitFor({ state: "visible", timeout: 10_000 });
    const items = await page.locator(".context-menu-item").allTextContents();
    log(`keyboard-opened menu items: ${JSON.stringify(items)}`);
    if (items.length === 0) throw new Error("keyboard-opened menu has no items");

    // Keyboard OPERABILITY once open (Escape closes, per ContextMenu.svelte's
    // own header comment and plan §4.2's dismissal list) is a SEPARATE claim
    // from "the menu opens". Check it for real rather than assuming it from
    // "the menu opened".
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    const stillOpenAfterEscape = await page.locator(".context-menu").isVisible().catch(() => false);
    if (stillOpenAfterEscape) {
      note(
        "BUG: Escape did not close the keyboard-opened menu — see this test's final report " +
        "(ContextMenu.svelte's onMount->focusFirstEnabled() never actually moves focus into " +
        "the menu while the preview iframe holds input focus, so its own onkeydown Escape " +
        "handler never receives the key). Falling back to outside-click to un-wedge the run.",
      );
      await dismissMenuViaOutsideClick();
      throw new Error(
        "menu opened via Shift+F10 but Escape did not close it (keyboard-accessibility bug — " +
        "see NOTE above and this test's final report; recovered via outside-click to continue)",
      );
    }
    await assertEditorClosed("keyboard menu use");
  });
  // Belt-and-braces: whatever step 4 left open, make sure it's actually closed
  // before step 5 asserts "no menu appears".
  if (await page.locator(".context-menu").isVisible().catch(() => false)) {
    await dismissMenuViaOutsideClick();
  }

  // ── 5. Right-click on a running header / margin box: no menu, no
  //      suppression of native behavior ──────────────────────────────────────
  await step("5. right-click on a margin box opens neither menu, and does not suppress native behavior", async () => {
    const before = await nativeCtxCount();
    const mbox = await boxOf(marginBox);
    const { x, y } = centerOf(mbox);
    await page.mouse.click(x, y, { button: "right" });
    await page.waitForTimeout(500);
    const spaMenuVisible = await page.locator(".context-menu").isVisible().catch(() => false);
    if (spaMenuVisible) throw new Error("Gutterpress menu opened for a margin-box (kind: none) right-click");
    const after = await nativeCtxCount();
    if (after <= before) {
      throw new Error(
        `expected the native context-menu event to fire UNSUPPRESSED for a margin-box click ` +
        `(kind: none skips preventDefault) — count stayed at ${before}`,
      );
    }
  });

  // ── 6. An actual edit round-trips to disk (only the intended region
  //      changes) ─────────────────────────────────────────────────────────────
  await step("6. a menu action's edit round-trips to disk, touching only the intended region", async () => {
    // Use a no-dialog action here so this step isolates exact boundary editing.
    // Step 8 separately drives the real in-app property dialog.
    const box = await boxOf(targetPara);
    const { x, y } = centerOf(box);
    await page.mouse.click(x, y, { button: "right" });
    await page.locator(".context-menu").waitFor({ state: "visible", timeout: 10_000 });
    const btn = page.locator(".context-menu-item", { hasText: "Insert page break before" });
    await btn.click();
    await page.locator(".context-menu").waitFor({ state: "hidden", timeout: 10_000 });

    // Poll disk — the commit engine flushes immediately (plan §4.7 step 5)
    // rather than waiting out the autosave debounce, but the write is still
    // asynchronous from this script's point of view.
    let content = originalChapterContent;
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      content = readFileSync(chapterPath, "utf8");
      if (content !== originalChapterContent) break;
      await sleep(100);
    }
    if (content === originalChapterContent) {
      throw new Error(`chapter file on disk did not change within 15s of the commit`);
    }

    const needle = "This is the target paragraph for right click testing";
    const lines = originalChapterContent.split("\n");
    const idx = lines.findIndex((l) => l.includes(needle));
    if (idx === -1) throw new Error("fixture drifted: target paragraph line not found in original content");
    const expected = [...lines.slice(0, idx), "@page-break", "", ...lines.slice(idx)].join("\n");
    if (content !== expected) {
      throw new Error(
        `disk content after the commit does not match the expected byte-exact insertion.\n` +
        `--- expected ---\n${expected}\n--- actual ---\n${content}`,
      );
    }
    log("disk content matches the expected exact insertion (only the boundary before the target block changed)");
    await assertEditorClosed("a preview menu edit");
  });

  // ── 7. Passive preview interaction never opens the editor ────────────────
  const DEEP_TARGET_TEXT = "This deep paragraph is the click to source target";
  await step("7. clicking a preview block leaves the closed editor closed", async () => {
    // Step 6's edit triggers an async settled-write -> chapter-splice
    // refresh; let it fully settle first (the loading overlay clears, the
    // book iframe re-attaches) so this step's coordinates are computed
    // against final, stable layout rather than a mid-reflow snapshot.
    await page.locator(".loading-overlay").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
    await book.locator("body").waitFor({ state: "attached", timeout: 15_000 });
    await page.waitForTimeout(300);

    if (await page.locator(".cm-editor").count()) throw new Error("editor started open");
    const deepPara = book.locator("p", { hasText: DEEP_TARGET_TEXT });
    await deepPara.first().waitFor({ state: "visible", timeout: 15_000 });
    const box = await boxOf(deepPara);
    const { x, y } = centerOf(box);
    await page.mouse.click(x, y, { button: "left" });
    await page.waitForTimeout(750);
    await assertEditorClosed("a normal preview click");

    await page.mouse.click(x, y, { button: "right" });
    await page.locator(".context-menu").waitFor({ state: "visible", timeout: 10_000 });
    const sourceItem = page.locator(".context-menu-item", { hasText: "Go to source" });
    if (await sourceItem.isEnabled()) throw new Error("Go to source is enabled while the editor is closed");
    await dismissMenuViaOutsideClick();
    await assertEditorClosed("the preview source menu");
  });

  // ── 8. Image menus expose real property actions and a clear unwrap action ─
  await step("8. right-clicking an image exposes usable property and unwrap actions", async () => {
    const image = book.locator('img[alt="Wrapped test image"]');
    const box = await boxOf(image);
    const { x, y } = centerOf(box);
    await page.mouse.click(x, y, { button: "right" });
    await page.locator(".context-menu").waitFor({ state: "visible", timeout: 10_000 });
    const labels = (await page.locator(".context-menu-item").allTextContents()).map((s) => s.trim());
    for (const expected of ["Edit alt text…", "Set custom width…", "Set position…", "Set size…"]) {
      if (!labels.includes(expected)) throw new Error(`missing image action ${JSON.stringify(expected)}; got ${JSON.stringify(labels)}`);
    }
    const widthItem = page.locator(".context-menu-item", { hasText: "Set custom width…" });
    if (!(await widthItem.isEnabled())) throw new Error("image property actions are disabled");

    let pendingPreviewRevision = null;
    const previewRevision = async () => shell.locator("#gutterpress-active").evaluate(
      (frame) => Number(frame.__gutterpressRevision) || 0,
    );
    const submitImagePrompt = async () => {
      pendingPreviewRevision = await previewRevision();
      await page.locator('.text-prompt button[type="submit"]').click();
      await page.locator(".text-prompt").waitFor({ state: "hidden", timeout: 10_000 });
    };
    const waitForPendingPreview = async () => {
      if (pendingPreviewRevision == null) return;
      const prior = pendingPreviewRevision;
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) {
        if (await previewRevision().catch(() => prior) > prior) {
          pendingPreviewRevision = null;
          await page.locator(".loading-overlay").waitFor({ state: "hidden", timeout: 15_000 });
          return;
        }
        await sleep(100);
      }
      throw new Error(`preview did not advance past revision ${prior} after image edit`);
    };

    await widthItem.click();
    const prompt = page.locator(".text-prompt");
    await prompt.waitFor({ state: "visible", timeout: 10_000 });
    await prompt.locator("input").fill("55%");
    await submitImagePrompt();
    let source = readFileSync(chapterPath, "utf8");
    const widthDeadline = Date.now() + 15_000;
    while (Date.now() < widthDeadline && !source.includes('width="55%"')) {
      await sleep(100);
      source = readFileSync(chapterPath, "utf8");
    }
    if (!source.includes('width="55%"')) throw new Error("Set width did not update the real markdown file");
    if (!source.includes('"Preserved image title"')) throw new Error("Set width deleted the image title");

    const sourceAfterWidth = source;
    const openImageAction = async (label) => {
      await waitForPendingPreview();
      const currentImage = book.locator('img[alt="Wrapped test image"]');
      const currentBox = await boxOf(currentImage);
      const currentPoint = centerOf(currentBox);
      log(`opening ${label} at ${JSON.stringify(currentBox)}`);
      await page.mouse.click(currentPoint.x, currentPoint.y, { button: "right" });
      await page.locator(".context-menu").waitFor({ state: "visible", timeout: 10_000 });
      await page.locator(".context-menu-item", { hasText: label }).click();
      await page.locator(".text-prompt").waitFor({ state: "visible", timeout: 10_000 });
    };

    await openImageAction("Set position…");
    const positionSelect = page.locator(".text-prompt select");
    if (!(await positionSelect.count())) throw new Error("Set position did not provide a select list");
    const positionOptions = await positionSelect.locator("option").allTextContents();
    for (const expected of ["None — no position class", "Center — .gp-center", "Float right — .gp-right", "Full bleed (own page, edge-to-edge) — .gp-bleed", "Pin to page — .gp-pin"]) {
      if (!positionOptions.includes(expected)) {
        throw new Error(`missing position option ${JSON.stringify(expected)}; got ${JSON.stringify(positionOptions)}`);
      }
    }
    await positionSelect.selectOption("gp-right");
    await submitImagePrompt();
    const positionDeadline = Date.now() + 15_000;
    source = readFileSync(chapterPath, "utf8");
    while (Date.now() < positionDeadline && !source.includes(".gp-right")) {
      await sleep(100);
      source = readFileSync(chapterPath, "utf8");
    }
    if (!source.includes(".gp-right")) throw new Error("Set position did not apply the selected class");
    if (!source.includes('"Preserved image title"')) throw new Error("Set position deleted the image title");

    await openImageAction("Set position…");
    await page.locator(".text-prompt select").selectOption("gp-pin");
    await submitImagePrompt();
    const pinDeadline = Date.now() + 15_000;
    while (Date.now() < pinDeadline && !readFileSync(chapterPath, "utf8").includes(".gp-pin")) await sleep(100);
    if (!readFileSync(chapterPath, "utf8").includes(".gp-pin")) throw new Error("Set position did not apply .gp-pin");

    await openImageAction("Set pin alignment…");
    const alignmentSelect = page.locator(".text-prompt select");
    const alignmentOptions = await alignmentSelect.locator("option").allTextContents();
    for (const expected of ["Centered — no edge classes", "Top left — .gp-top .gp-left", "Bottom right — .gp-bottom .gp-right"]) {
      if (!alignmentOptions.includes(expected)) {
        throw new Error(`missing pin alignment option ${JSON.stringify(expected)}; got ${JSON.stringify(alignmentOptions)}`);
      }
    }
    await alignmentSelect.selectOption("bottom-right");
    await submitImagePrompt();
    const alignmentDeadline = Date.now() + 15_000;
    while (Date.now() < alignmentDeadline && !readFileSync(chapterPath, "utf8").includes(".gp-pin .gp-bottom .gp-right")) await sleep(100);
    if (!readFileSync(chapterPath, "utf8").includes(".gp-pin .gp-bottom .gp-right")) {
      throw new Error("Set pin alignment did not apply the selected edge classes");
    }

    await openImageAction("Set position…");
    await page.locator(".text-prompt select").selectOption("gp-right");
    await submitImagePrompt();
    const unpinDeadline = Date.now() + 15_000;
    source = readFileSync(chapterPath, "utf8");
    while (Date.now() < unpinDeadline && (source.includes(".gp-pin") || source.includes(".gp-bottom"))) {
      await sleep(100);
      source = readFileSync(chapterPath, "utf8");
    }
    if (source.includes(".gp-pin") || source.includes(".gp-bottom") || !source.includes(".gp-right")) {
      throw new Error("Switching from pin back to float right left stale pin classes");
    }

    await openImageAction("Set size…");
    const sizeSelect = page.locator(".text-prompt select");
    if (!(await sizeSelect.count())) throw new Error("Set size did not provide a select list");
    const sizeOptions = await sizeSelect.locator("option").allTextContents();
    for (const expected of ["None — no preset size class", "Small (25%) — .gp-small", "Medium (50%) — .gp-medium", "Large (75%) — .gp-large"]) {
      if (!sizeOptions.includes(expected)) {
        throw new Error(`missing size option ${JSON.stringify(expected)}; got ${JSON.stringify(sizeOptions)}`);
      }
    }
    await sizeSelect.selectOption("gp-small");
    await submitImagePrompt();
    const sizeDeadline = Date.now() + 15_000;
    source = readFileSync(chapterPath, "utf8");
    while (Date.now() < sizeDeadline && !source.includes(".gp-small")) {
      await sleep(100);
      source = readFileSync(chapterPath, "utf8");
    }
    if (!source.includes(".gp-small")) throw new Error("Set size did not apply the selected class");
    if (!source.includes('"Preserved image title"')) throw new Error("Set size deleted the image title");

    await openImageAction("Set size…");
    await page.locator(".text-prompt select").selectOption("gp-large");
    await page.keyboard.press("Escape");
    await page.locator(".text-prompt").waitFor({ state: "hidden", timeout: 10_000 });
    if (readFileSync(chapterPath, "utf8") !== source) throw new Error("Escape changed the image source");

    await openImageAction("Set float spacing…");
    const spacingSelect = page.locator(".text-prompt select");
    const spacingOptions = await spacingSelect.locator("option").allTextContents();
    for (const expected of ["Default (1em) — no spacing class", "Tight (0.5em) — .gp-tight", "Loose (2em) — .gp-loose"]) {
      if (!spacingOptions.includes(expected)) {
        throw new Error(`missing spacing option ${JSON.stringify(expected)}; got ${JSON.stringify(spacingOptions)}`);
      }
    }
    await spacingSelect.selectOption("gp-tight");
    await submitImagePrompt();
    const spacingDeadline = Date.now() + 15_000;
    source = readFileSync(chapterPath, "utf8");
    while (Date.now() < spacingDeadline && !source.includes(".gp-tight")) {
      await sleep(100);
      source = readFileSync(chapterPath, "utf8");
    }
    if (!source.includes(".gp-tight")) throw new Error("Set float spacing did not apply the selected class");
    if (!source.includes('"Preserved image title"')) throw new Error("Set float spacing deleted the image title");

    await waitForPendingPreview();
    const updatedImage = book.locator('img[alt="Wrapped test image"]');
    const updatedBox = await boxOf(updatedImage);
    const updatedPoint = centerOf(updatedBox);
    await page.mouse.click(updatedPoint.x, updatedPoint.y, { button: "right" });
    await page.locator(".context-menu").waitFor({ state: "visible", timeout: 10_000 });
    const unwrap = page.locator(".context-menu-item", { hasText: "Unwrap image" });
    if (!(await unwrap.count())) {
      const updatedLabels = (await page.locator(".context-menu-item").allTextContents()).map((s) => s.trim());
      throw new Error(`missing "Unwrap image" after property edit; got ${JSON.stringify(updatedLabels)}`);
    }
    await unwrap.click();
    const unwrapDeadline = Date.now() + 15_000;
    while (Date.now() < unwrapDeadline && /^\[!\[Wrapped test image\]/m.test(source)) {
      await sleep(100);
      source = readFileSync(chapterPath, "utf8");
    }
    if (/\[!\[Wrapped test image\]/.test(source)) throw new Error("Unwrap image did not remove the image link wrapper");
    if (!source.includes('![Wrapped test image](media/wrapped-test.svg "Preserved image title"){width="55%" .gp-right .gp-small .gp-tight}')) {
      throw new Error("Unwrap image did not preserve the complete image token");
    }
    await assertEditorClosed("image property and unwrap actions");
  });

  // ── 9. A real watcher-driven update keeps the exact preview viewport ─────
  await step("9. a real preview update preserves the two-column scroll position", async () => {
    await dismissMenuViaOutsideClick();
    if (await page.locator(".cm-editor").count()) {
      await page.locator('[aria-label="Toggle markdown editor"]').click();
      await page.locator(".cm-editor").waitFor({ state: "detached", timeout: 10_000 });
    }

    await book.locator("body").evaluate(() => window.previewAPI.setViewMode("two-column", true));
    const deepPara = book.locator("p", { hasText: DEEP_TARGET_TEXT });
    await deepPara.scrollIntoViewIfNeeded();
    await book.locator("body").evaluate(() => window.scrollBy({ left: -80, top: 0, behavior: "instant" }));
    await page.waitForTimeout(250);
    const before = await book.locator("body").evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      page: window.previewAPI.getCurrentPage(),
    }));
    if (before.x === 0 && before.y === 0) throw new Error("fixture did not produce a nonzero preview scroll position");

    const active = shell.locator("#gutterpress-active");
    const oldSrc = await active.getAttribute("src");
    const current = readFileSync(chapterPath, "utf8");
    writeFileSync(chapterPath, `${current}\n<!-- packaged viewport stability probe -->\n`);

    const deadline = Date.now() + 20_000;
    let newSrc = oldSrc;
    while (Date.now() < deadline && newSrc === oldSrc) {
      await sleep(100);
      newSrc = await active.getAttribute("src");
    }
    if (newSrc === oldSrc) throw new Error("preview frame was not replaced after the real file update");
    await page.locator(".loading-overlay").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(500);

    const after = await book.locator("body").evaluate(() => ({
      x: window.scrollX,
      y: window.scrollY,
      page: window.previewAPI.getCurrentPage(),
    }));
    const dx = Math.abs(after.x - before.x);
    const dy = Math.abs(after.y - before.y);
    if (dx > 4 || dy > 4) {
      throw new Error(`viewport jumped from ${JSON.stringify(before)} to ${JSON.stringify(after)} (dx=${dx}, dy=${dy})`);
    }
  });

  // ── 10. Every adjacent page has the same visible gap ─────────────────────
  await step("10. page spacing is consistent in the packaged preview", async () => {
    await book.locator("body").evaluate(() => window.previewAPI.setViewMode("single", true));
    await page.waitForTimeout(500);
    const geometry = await book.locator("body").evaluate(() => {
      const sheets = Array.from(document.querySelectorAll(".gp-sheet"))
        .sort((a, b) => Number(a.getAttribute("data-page")) - Number(b.getAttribute("data-page")))
        .map((sheet) => {
          const rect = sheet.getBoundingClientRect();
          return {
            page: Number(sheet.getAttribute("data-page")),
            run: Array.from(document.querySelectorAll(".gp-run")).indexOf(sheet.closest(".gp-run")),
            top: rect.top,
            bottom: rect.bottom,
          };
        });
      return {
        pages: sheets.length,
        runs: document.querySelectorAll(".gp-run").length,
        gaps: sheets.slice(1).map((sheet, i) => Math.round(sheet.top - sheets[i].bottom)),
        runBoundaryGaps: sheets.flatMap((sheet, i) =>
          i > 0 && sheet.run !== sheets[i - 1].run
            ? [Math.round(sheet.top - sheets[i - 1].bottom)]
            : [],
        ),
      };
    });
    if (geometry.gaps.length < 2) {
      throw new Error(`fixture produced only ${geometry.pages} pages; spacing check needs at least 3`);
    }
    if (geometry.runs < 2 || geometry.runBoundaryGaps.length < 1) {
      throw new Error(`fixture produced ${geometry.runs} page runs; cross-run spacing was not exercised`);
    }
    const smallest = Math.min(...geometry.gaps);
    const largest = Math.max(...geometry.gaps);
    log(`single-page visual gaps: ${JSON.stringify(geometry.gaps)}`);
    if (largest - smallest > 1) {
      throw new Error(`page gaps are inconsistent: ${JSON.stringify(geometry.gaps)}`);
    }
    if (geometry.runBoundaryGaps.some((gap) => Math.abs(gap - geometry.gaps[0]) > 1)) {
      throw new Error(`named-page boundary gaps differ: ${JSON.stringify(geometry.runBoundaryGaps)}`);
    }
  });
} catch (err) {
  console.error("[etest] uncaught:", err);
  exitCode = 1;
} finally {
  log("closing electron");
  await electronApp.close();
}

// ── Summary ──────────────────────────────────────────────────────────────────
log("──────────────────────────────────────────────────────");
for (const r of results) {
  log(`${r.ok ? "PASS" : "FAIL"} — ${r.name}${r.ok ? "" : ` (${r.error})`}`);
}
const failed = results.filter((r) => !r.ok);
log(`${results.length - failed.length}/${results.length} checks passed`);
if (notes.length > 0) {
  log("notes recorded during the run:");
  for (const n of notes) log(`  - ${n}`);
}
if (failed.length > 0) exitCode = 1;
process.exit(exitCode);
