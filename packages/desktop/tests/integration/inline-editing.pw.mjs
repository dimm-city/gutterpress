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
 * UNLIKE the other `tests/integration/*.pw.mjs` scripts, this one launches
 * the UNPACKED build directly (`out/main/main.js` via the raw `electron`
 * binary from `node_modules`) rather than a packaged AppImage/exe — no
 * `npm run dist:*` required, only `npm run build && npm run electron:build`.
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
 * Exit 0 if every check passed, 1 if any failed. Each of the 7 plan
 * verifications is run independently (a failure in one does not stop the
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

const mainJsArg = process.argv[2];
const mainJs = resolve(mainJsArg || join(desktopDir, "out", "main", "main.js"));
if (!existsSync(mainJs)) {
  console.error(`[etest] FAIL: no ${mainJs} — run \`npm run build && npm run electron:build\` first`);
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

log(`launching ${mainJs} via ${electronBin}`);
const electronApp = await electron.launch({
  executablePath: electronBin,
  args: [mainJs, `--user-data-dir=${userDataDir}`, "--no-sandbox"],
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
    await book.locator(".pagedjs_page").first().waitFor({ state: "visible", timeout: 60_000 });
    const chapterAttr = await book.locator("[data-chapter-src]").first().getAttribute("data-chapter-src");
    if (chapterAttr !== "01-chapter.md") {
      throw new Error(`expected chapter 01-chapter.md open, got ${chapterAttr}`);
    }
  });

  const targetPara = book.locator("p", { hasText: "target paragraph for right click testing" });
  const marginBox = book.locator(".pagedjs_margin-top-center");

  async function boxOf(locator) {
    // Defensive: the fixture's chapter is long enough that later steps'
    // targets are not guaranteed to be on the first rendered page (Paged.js
    // renders every page into one continuously scrollable flow) — scroll
    // into view first so page.mouse's absolute coordinates are meaningful
    // regardless of which page the element ends up on.
    await locator.first().scrollIntoViewIfNeeded();
    const box = await locator.first().boundingBox();
    if (!box) throw new Error("locator has no bounding box (not visible?)");
    return box;
  }
  function centerOf(box) { return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; }

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
    // "Insert page break before" needs no window.prompt() — the app uses
    // window.prompt() for several menu actions (alt text, width, position,
    // link edit, marker edit); rather than stub/auto-accept that dialog, this
    // test picks the one block action that mutates with no prompt at all, per
    // the task's explicit allowance.
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
  });

  // ── 7. Click-to-source: clicking a preview block reveals it in the editor,
  //      opening the pane if closed ──────────────────────────────────────────
  const DEEP_TARGET_TEXT = "This deep paragraph is the click to source target";
  await step("7. clicking a preview block reveals it in the editor, opening the pane if closed", async () => {
    // Step 6's edit triggers an async settled-write -> chapter-splice
    // refresh; let it fully settle first (the loading overlay clears, the
    // book iframe re-attaches) so this step's coordinates are computed
    // against final, stable layout rather than a mid-reflow snapshot.
    await page.locator(".loading-overlay").waitFor({ state: "hidden", timeout: 15_000 }).catch(() => {});
    await book.locator("body").waitFor({ state: "attached", timeout: 15_000 });
    await page.waitForTimeout(300);

    const cmBefore = await page.locator(".cm-editor").count();
    if (cmBefore !== 0) {
      note(`editor pane was already open (.cm-editor count=${cmBefore}) before this step — "opens if closed" is not exercised, only "reveals the right line"`);
    }
    // The fixture's last paragraph sits ~20 paragraphs into the file
    // specifically so that revealing it requires the CodeMirror scroller to
    // actually move — with a short file the whole document fits in the pane
    // already and "revealed the right line" is untestable (scrollTop stays 0
    // regardless of whether the reveal logic ran at all). This was caught
    // empirically: an earlier, shorter fixture made this assertion vacuous.
    const deepPara = book.locator("p", { hasText: DEEP_TARGET_TEXT });
    await deepPara.first().waitFor({ state: "visible", timeout: 15_000 });

    // Retry the click a few times: a re-render landing between the
    // coordinate read and the click dispatch (both real async gaps) can make
    // a single attempt miss, which is a timing hazard of this harness, not a
    // feature behavior — confirmed by re-fetching fresh coordinates each try.
    let opened = false;
    for (let attempt = 0; attempt < 3 && !opened; attempt++) {
      const box = await boxOf(deepPara);
      const { x, y } = centerOf(box);
      await page.mouse.click(x, y, { button: "left" });
      opened = await page
        .locator(".cm-editor")
        .waitFor({ state: "visible", timeout: 5_000 })
        .then(() => true)
        .catch(() => false);
      if (!opened) note(`click-to-source attempt ${attempt + 1} did not open the editor within 5s — retrying`);
    }
    if (!opened) throw new Error("editor pane never opened after 3 click attempts");

    // Confirm it revealed the RIGHT line, not just "some editor opened" —
    // poll for the CodeMirror scroller to settle with the target line at (or
    // very near) its top, matching MarkdownEditor.svelte's revealLine()
    // (`EditorView.scrollIntoView(pos, { y: "start" })`), AND that the
    // scroller actually moved (scrollTop > 0) — proof this is real scroll
    // behavior, not a no-op that happens to already show the target.
    let settled = null;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline) {
      settled = await page.evaluate((needle) => {
        const scroller = document.querySelector(".cm-editor .cm-scroller");
        if (!scroller) return null;
        const line = Array.from(document.querySelectorAll(".cm-editor .cm-line")).find((l) =>
          l.textContent.includes(needle),
        );
        if (!line) return { found: false, scrollTop: scroller.scrollTop };
        const lineTop = line.getBoundingClientRect().top;
        const scrollerTop = scroller.getBoundingClientRect().top;
        return { found: true, offset: lineTop - scrollerTop, scrollTop: scroller.scrollTop };
      }, DEEP_TARGET_TEXT);
      // Tolerance: 200px (~27% of the 732px pane observed in this window
      // size) distinguishes "revealed near the top" from "scrolled to an
      // unrelated part of the document" (which misses by 500px+ in this
      // fixture) without demanding pixel-perfect flush-top alignment, which
      // the plan does not promise. Empirically, a fresh click lands within a
      // few px; a reveal issued right after a prior commit-engine edit (this
      // test's step 6 ran first) lands ~100-110px off — still clearly "near
      // the top", not a functional miss.
      if (settled?.found && Math.abs(settled.offset) < 200) break;
      await sleep(200);
    }
    if (!settled?.found) throw new Error("target line never appeared in the editor's rendered viewport");
    if (settled.scrollTop === 0) {
      throw new Error("editor scroller never left scrollTop 0 — reveal did not actually scroll (or the fixture is too short to tell)");
    }
    if (Math.abs(settled.offset) >= 200) {
      throw new Error(`editor did not scroll the target line near the top: offset ${settled.offset}px from scroller top (scrollTop ${settled.scrollTop})`);
    }
    log(`editor scrolled to target line (scrollTop=${settled.scrollTop}, offset from scroller top=${settled.offset}px)`);
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
