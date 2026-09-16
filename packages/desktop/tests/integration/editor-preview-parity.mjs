#!/usr/bin/env node
/**
 * Editor↔preview parity gate.
 *
 * The paged editor (`src/lib/editor/paged-surface.ts`) and the preview
 * iframe paginate the same chapter with the same engine and the same CSS, so
 * they must break it into the same pages. This gate is what proves it, and
 * it is why the preview pane stays: it is the reference the editor is
 * measured against.
 *
 * WHAT IT COMPARES, and why that and not more. For each chapter it asks each
 * side, in that side's own terms, how many pages the chapter occupies:
 *
 *   - the preview through the viewer's own `Gutterpress.pageRangeOf()` — the
 *     same call the app uses for page navigation, so this is the book's own
 *     answer rather than a guess about it;
 *   - the editor by counting the sheets its paged surface drew, which is
 *     that side's own answer for the same reason.
 *
 * An earlier version matched individual blocks by text and located each one
 * geometrically. It was wrong in both directions — the two renderers
 * legitimately produce different DOM (the editor has marker chips and its
 * own code-block structure), and geometric page lookup under-counted
 * multi-column pages — so it reported divergence that was not there while
 * hiding some that was. Page count per chapter is the claim the product
 * actually makes, and measuring it through each side's own authority is what
 * makes the number trustworthy.
 *
 * It compares BOTH shapes of the paged editor (Read mode): locked, which is
 * the reader's view, and unlocked, which is the same pages made editable in
 * place. A marker chip hangs its tag in the page margin and keeps no height
 * in the text flow, so unlocked has no excuse to paginate differently.
 *
 * Usage:
 *   node tests/integration/editor-preview-parity.mjs [book-dir]
 * Exit 0 when every chapter agrees, 1 otherwise.
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const { _electron: electron } = require_("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[parity] ${m}`);

const bookArg = process.argv.slice(2).find((a) => !a.startsWith("--"));
const srcBook = resolve(bookArg ?? join(desktopDir, "tests", "fixtures", "plugin-book"));
if (!existsSync(srcBook)) {
  console.error(`[parity] FAIL: no book at ${srcBook}`);
  process.exit(1);
}
/**
 * The gate normally works on a COPY so a run cannot touch the book. A real
 * project often reaches outside its own folder for the things that decide
 * its pages — the Dimm City Field Guide's stylesheets and its plugin live in
 * a sibling directory — and a copy of the book alone leaves those dangling,
 * so the editor gets no book CSS and paginates nothing. `--in-place` runs
 * against the book where it lives, for pointing this gate at a real one.
 */
const inPlace = process.argv.includes("--in-place");

/**
 * Copy the book AND whatever it reaches for outside itself.
 *
 * A manifest that says `../dc-design-guide/css/dc-tokens.css` is describing a
 * normal layout: one design system shared by several books beside it. Copying
 * the book alone left every one of those references dangling, the projection
 * failed with "Missing stylesheet", and the editor then had no `@page`
 * geometry to paginate with at all — which reads from outside as "the editor
 * never paginated" and cost several runs to tell apart from a real fault.
 */
function copyBookWithSiblings() {
  const root = mkdtempSync(join(tmpdir(), "gutterpress-parity-"));
  const dest = join(root, basename(srcBook));
  cpSync(srcBook, dest, { recursive: true });
  let manifest = "";
  for (const name of ["manifest.yaml", "manifest.yml"]) {
    const at = join(srcBook, name);
    if (existsSync(at)) manifest = readFileSync(at, "utf8");
  }
  for (const sibling of new Set([...manifest.matchAll(/\.\.\/([^/\s"']+)\//g)].map((m) => m[1]))) {
    const from = resolve(srcBook, "..", sibling);
    if (existsSync(from)) cpSync(from, join(root, sibling), { recursive: true });
  }
  return dest;
}

const bookDir = inPlace ? srcBook : copyBookWithSiblings();
const fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-parity-home-"));
const userDataDir = join(fakeHome, "userData");
mkdirSync(userDataDir, { recursive: true });
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({ lastProjectDir: bookDir, leftPanel: { open: true, activeTab: "files", width: 260 } }),
);
writeFileSync(
  join(userDataDir, "app-settings.json"),
  JSON.stringify({ settingsSchemaVersion: 2, preview: { mode: "editor", defaultZoom: "1" } }),
);

const mainJs = join(desktopDir, "out", "main", "main.js");
if (!existsSync(mainJs)) {
  console.error(`[parity] FAIL: no ${mainJs} — run \`npm run build && npm run electron:build\` first`);
  process.exit(1);
}

const app = await electron.launch({
  executablePath: require_("electron"),
  args: [mainJs, "--no-sandbox", `--user-data-dir=${userDataDir}`],
  cwd: desktopDir,
  env: {
    ...process.env,
    HOME: fakeHome,
    XDG_CONFIG_HOME: join(fakeHome, ".config"),
    XDG_CACHE_HOME: join(fakeHome, ".cache"),
    XDG_DATA_HOME: join(fakeHome, ".local", "share"),
    ELECTRON_DISABLE_GPU: "1",
  },
  timeout: 120_000,
});

const startedWholeRun = Date.now();
const rows = [];
let failures = 0;
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(60_000);
  await app.evaluate(({ BrowserWindow }) => {
    // The app window, not whichever window happens to be first: the app
    // opens a hidden engine window per render pass (electron/engine-browser.ts).
    const w =
      BrowserWindow.getAllWindows().find(
        (candidate) => !candidate.isDestroyed() && candidate.webContents.getURL().startsWith("app://"),
      ) ?? BrowserWindow.getAllWindows()[0];
    // Wide enough that BOTH panes hold a Letter page at 1:1. The paged
    // surface fits a page narrower than its pane by zooming the stage down,
    // and CSS zoom changes layout (see prepareBook): at 1800px the editor
    // pane came out a hair under 1:1 and one dense chapter paginated a page
    // longer than it does at 1:1.
    w.setSize(2560, 1400);
  });
  await page.waitForSelector(".file-item, .toc-item", { timeout: 120_000 });
  const close = page.locator('button[aria-label="Close this screen"]');
  if (await close.count()) await close.first().click().catch(() => {});

  /** The preview's book frame — re-acquired after a mode switch, which can swap it. */
  async function bookFrame() {
    for (let attempt = 0; attempt < 60; attempt++) {
      for (const f of page.frames()) {
        if (f === page.mainFrame()) continue;
        const ready = await f
          .evaluate(() => !!window.Gutterpress?.pageRangeOf && document.querySelectorAll(".gp-sheet").length > 0)
          .catch(() => false);
        if (ready) return f;
      }
      await sleep(1000);
    }
    throw new Error("no paginated preview frame appeared — nothing to compare against");
  }

  let frame = await bookFrame();
  log(`preview frame: ${frame.url()}`);

  /**
   * Put the book in the state its page counts are read in: single pages,
   * every font and plate loaded, and laid out at 1:1.
   *
   * 1:1 is the zoom the PDF is laid out at. The preview pane fits the page
   * to its width (`--gutterpress-zoom` ~ 0.7 here), and CSS `zoom` changes
   * layout, not just its rendering: Chromium snaps every border to whole
   * device pixels in the zoomed space, so a 1pt table rule becomes 1.4px at
   * 0.7 and 1px at 1:1 -  measured as a 5.8px difference over one
   * fourteen-row table, enough to move a page break in a dense chapter. The
   * editor pane is wider than a page at this window size and already at
   * 1:1. The relayout waits for the fonts: one before they arrive
   * paginates fallback faces and is not repeated when they do, which made
   * the book's own count move between runs.
   */
  async function prepareBook() {
    await frame.evaluate(async () => {
      window.Gutterpress?.setSpread?.(false);
      await document.fonts?.ready;
      await Promise.all(
        [...document.images]
          .filter((img) => !img.complete)
          .map(
            (img) =>
              new Promise((resolve) => {
                img.addEventListener("load", resolve, { once: true });
                img.addEventListener("error", resolve, { once: true });
              }),
          ),
      );
      document.documentElement.style.setProperty("--gutterpress-zoom", "1");
      document.body.style.removeProperty("--gutterpress-fit-zoom");
      window.Gutterpress?.refresh?.();
      window.Gutterpress?.setSpread?.(false);
    });
    // The book's own page counts are read ONCE, so they have to be read
    // after the viewer has finished paginating -  not after a fixed sleep.
    for (let last = -1, stableSince = Date.now(), deadline = Date.now() + 60_000; Date.now() < deadline; ) {
      const now = await frame.evaluate(() => document.querySelectorAll(".gp-sheet").length);
      if (now !== last) {
        last = now;
        stableSince = Date.now();
      } else if (now > 0 && Date.now() - stableSince >= 600) {
        break;
      }
      await sleep(100);
    }
  }

  /**
   * Evaluate in the book, surviving the app swapping its preview frame under
   * us (a re-render replaces the iframe): re-acquire the frame, put it back
   * in the measured state, and try again.
   */
  async function inBook(fn, attempts = 3) {
    for (let attempt = 1; ; attempt++) {
      try {
        return await frame.evaluate(fn);
      } catch (error) {
        if (attempt >= attempts || !/detached|closed|context/i.test(String(error))) throw error;
        log(`preview frame was replaced (${String(error).split("\n")[0]}); re-acquiring`);
        frame = await bookFrame();
        await prepareBook();
      }
    }
  }

  for (let attempt = 1; ; attempt++) {
    try {
      await prepareBook();
      break;
    } catch (error) {
      if (attempt >= 3 || !/detached|closed|context/i.test(String(error))) throw error;
      log(`preview frame was replaced during setup; re-acquiring`);
      frame = await bookFrame();
    }
  }

  /**
   * The app renders its preview twice on startup (the first frame is
   * replaced once the project is fully loaded), and a read that lands on the
   * first frame reports pages of a book that is not the final one -  one run
   * in three read a chapter a page short. So the read is trusted only once
   * the frame it came from has survived a moment; otherwise the new frame
   * is prepared and read instead.
   */
  const readBookPages = () => {
    const api = window.Gutterpress;
    const out = {};
    const sources = new Set(
      [...document.querySelectorAll("[data-chapter-src]")].map((e) => e.getAttribute("data-chapter-src")),
    );
    for (const src of sources) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const el of document.querySelectorAll(`[data-chapter-src="${src}"]`)) {
        try {
          const [first, last] = api.pageRangeOf(el);
          if (first >= 0) {
            lo = Math.min(lo, first);
            hi = Math.max(hi, last);
          }
        } catch {
          // an element the viewer cannot place contributes nothing
        }
      }
      out[src] = hi >= lo ? { pages: hi - lo + 1, first: lo } : null;
    }
    return out;
  };
  let bookPages;
  for (let attempt = 1; ; attempt++) {
    bookPages = await inBook(readBookPages);
    await sleep(1500);
    const live = await bookFrame();
    if (live === frame || attempt >= 4) break;
    log("preview frame was replaced after its pages were read; reading the new one");
    frame = live;
    await prepareBook();
  }

  // The book's own page counts were read above, while Edit had the preview
  // on screen. Read is the whole book in one scroll: every chapter mounts
  // in book order, each paginated on its own, and the folios run on from
  // one chapter to the next. The gate waits for all of them, reads each
  // chapter's sheets inside its own wrapper, then unlocks - which remounts
  // every chapter editable - and reads them again.
  await page.click('button[aria-label="Read"]');
  try {
    await page.waitForSelector(".book-surface", { timeout: 120_000 });
  } catch (e) {
    const state = await page
      .evaluate(() => ({
        mode: [...document.querySelectorAll("button[aria-pressed='true']")].map((b) => b.getAttribute("aria-label")),
        loading: [...document.querySelectorAll(".editor-loading")].map((el) => el.textContent?.trim()),
        surface: !!document.querySelector(".book-surface"),
        chapters: document.querySelectorAll(".book-chapter").length,
        activeFile: document.querySelector(".file-item.active")?.textContent?.trim() ?? null,
      }))
      .catch(() => null);
    console.error(`[parity] the book never mounted after the Read click - pane state: ${JSON.stringify(state)}`);
    throw e;
  }

  const chapters = await page
    .locator(".file-item")
    .evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((t) => /\.md$/i.test(t)));
  for (const chapter of chapters) if (!bookPages[chapter]) log(`skip ${chapter}: not part of the built book`);
  const expected = chapters.filter((chapter) => bookPages[chapter]);

  /** Every chapter wrapper in book order: its sheets, its layout counter, its lock state, and its first folio. */
  const readChapters = () =>
    page.evaluate(() => {
      const order = [];
      const byName = {};
      for (const el of document.querySelectorAll(".book-chapter[data-chapter-path]")) {
        const name = el.getAttribute("data-chapter-path").replace(/\\/g, "/").split("/").pop();
        const doc = el.querySelector(".md-document");
        order.push(name);
        byName[name] = {
          sheets: el.querySelectorAll(".gp-sheet").length,
          layout: Number(doc?.dataset.gpLayout ?? -1),
          editor: !!el.querySelector(".md-editor"),
          readonly: !!el.querySelector(".md-editor.md-readonly"),
          firstFolio: Number(el.querySelector(".gp-sheet")?.dataset.page ?? -1),
        };
      }
      return { order, byName };
    });

  /**
   * Wait until every expected chapter has laid out in the given lock state
   * and none is still re-paginating: the paged surface publishes a layout
   * counter per document (`data-gp-layout`), and it lays out more than once
   * by design (render, fonts, art). This waits for the SUM of the counters
   * to hold still, with the fonts and images waited for first - the same
   * wait the book side got - rather than sleeping past the slowest chapter.
   */
  async function allSettled(lockState, quietMs = 800, timeoutMs = 300_000) {
    const deadline = Date.now() + timeoutMs;
    let last = null;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const state = await readChapters().catch(() => ({ order: [], byName: {} }));
      const ready = expected.every((c) => {
        const chapter = state.byName[c];
        return chapter?.editor && chapter.layout >= 0 && chapter.readonly === lockState;
      });
      const sum = expected.reduce((n, c) => n + (state.byName[c]?.layout ?? -1), 0);
      if (!ready) {
        last = null;
      } else if (sum !== last) {
        last = sum;
        stableSince = Date.now();
      } else if (Date.now() - stableSince >= quietMs) {
        await page
          .evaluate(async () => {
            await document.fonts?.ready;
            await Promise.all(
              [...document.querySelectorAll(".rich-editor-host img")]
                .filter((img) => !img.complete)
                .map(
                  (img) =>
                    new Promise((resolve) => {
                      img.addEventListener("load", resolve, { once: true });
                      img.addEventListener("error", resolve, { once: true });
                    }),
                ),
            );
          })
          .catch(() => {});
        const again = await readChapters();
        const sumAgain = expected.reduce((n, c) => n + (again.byName[c]?.layout ?? -1), 0);
        if (sumAgain === sum) return again;
        last = sumAgain;
        stableSince = Date.now();
      }
      await sleep(250);
    }
    throw new Error(`the book did not finish laying out ${lockState ? "locked" : "unlocked"} within ${timeoutMs}ms`);
  }

  const lockedAt = Date.now();
  let locked;
  try {
    locked = await allSettled(true);
  } catch (e) {
    // A gate that only reports "never laid out" sends the next hour to
    // guessing why. Say what the editor pane actually contains.
    const state = await page
      .evaluate(() => ({
        chapters: [...document.querySelectorAll(".book-chapter[data-chapter-path]")].map((el) => ({
          name: el.getAttribute("data-chapter-path").split("/").pop(),
          editor: !!el.querySelector(".md-editor"),
          blocks: el.querySelectorAll(".md-block").length,
          sheets: el.querySelectorAll(".gp-sheet").length,
          layout: el.querySelector(".md-document")?.dataset.gpLayout ?? null,
          readonly: !!el.querySelector(".md-editor.md-readonly"),
        })),
        loading: [...document.querySelectorAll(".editor-loading")].map((el) => el.textContent?.trim()),
        bookCss: Math.max(0, ...[...document.querySelectorAll("style")].map((el) => el.textContent?.length ?? 0)),
        activeFile: document.querySelector(".file-item.active")?.textContent?.trim() ?? null,
        mode: [...document.querySelectorAll("button[aria-pressed='true']")].map((b) => b.getAttribute("aria-label")),
      }))
      .catch(() => null);
    console.error(`[parity] the book never finished laying out - pane state: ${JSON.stringify(state)}`);
    // The app's own log, which is where its renderer faults land now.
    try {
      const { readdirSync, readFileSync } = await import("node:fs");
      const logDir = join(userDataDir, "logs");
      for (const name of readdirSync(logDir)) {
        if (!name.endsWith(".log")) continue;
        const body = readFileSync(join(logDir, name), "utf8").trim().split("\n").slice(-12).join("\n");
        console.error(`[parity] ${name}:\n${body}`);
      }
    } catch (logErr) {
      console.error(`[parity] no app log to read: ${logErr}`);
    }
    throw e;
  }
  log(`locked: ${expected.length} chapter(s) laid out in ${Date.now() - lockedAt}ms`);

  // The whole book unlocked: every chapter remounts editable, and no count
  // may move.
  await page.click('button[aria-label="Unlock"]');
  const unlockedAt = Date.now();
  const unlocked = await allSettled(false);
  log(`unlocked: ${expected.length} chapter(s) laid out in ${Date.now() - unlockedAt}ms`);

  for (const chapter of expected) {
    const book = bookPages[chapter];
    const editorPages = locked.byName[chapter]?.sheets ?? 0;
    const unlockedPages = unlocked.byName[chapter]?.sheets ?? 0;
    const ok = editorPages === book.pages && unlockedPages === book.pages;
    rows.push({ chapter, editorPages, unlockedPages, bookPages: book.pages, ok });
    if (ok) log(`ok   ${chapter}: ${editorPages} page(s), unlocked ${unlockedPages}`);
    else {
      failures += 1;
      console.error(
        `[parity] FAIL ${chapter}: editor paginates it into ${editorPages} page(s) locked and ${unlockedPages} unlocked, the book into ${book.pages}`,
      );
    }
  }

  // The folios run on through the book: each chapter's first sheet is
  // numbered one past the last sheet of the chapter before it.
  for (const state of [locked, unlocked]) {
    let offset = 0;
    for (const name of state.order) {
      const chapter = state.byName[name];
      if (!chapter || !expected.includes(name)) continue;
      if (chapter.firstFolio !== offset + 1) {
        failures += 1;
        console.error(`[parity] FAIL ${name}: its first page is numbered ${chapter.firstFolio}, the book's count puts it at ${offset + 1}`);
      }
      offset += chapter.sheets;
    }
  }
  log(`folios run 1..${Object.values(locked.byName).reduce((n, c) => n + c.sheets, 0)} through the book`);
} finally {
  await app.close().catch(() => {});
  if (!inPlace) rmSync(bookDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
}

log(`${rows.filter((r) => r.ok).length}/${rows.length} chapter(s) agree in ${Math.round((Date.now() - startedWholeRun) / 1000)}s`);
if (failures > 0) process.exit(1);
process.exit(0);
