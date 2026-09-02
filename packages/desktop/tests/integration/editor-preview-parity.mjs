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
 * It compares the LOCKED editor (Read mode): unlocked, the editor shows
 * marker chips that occupy space the printed page does not, so it
 * legitimately paginates differently there.
 *
 * Usage:
 *   node tests/integration/editor-preview-parity.mjs [book-dir]
 * Exit 0 when every chapter agrees, 1 otherwise.
 */
import { createRequire } from "node:module";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const desktopDir = resolve(here, "..", "..");
const require_ = createRequire(join(desktopDir, "package.json"));
const { _electron: electron } = require_("playwright-core");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[parity] ${m}`);

const srcBook = resolve(process.argv[2] ?? join(desktopDir, "tests", "fixtures", "plugin-book"));
if (!existsSync(srcBook)) {
  console.error(`[parity] FAIL: no book at ${srcBook}`);
  process.exit(1);
}
const bookDir = mkdtempSync(join(tmpdir(), "gutterpress-parity-"));
cpSync(srcBook, bookDir, { recursive: true });
const fakeHome = mkdtempSync(join(tmpdir(), "gutterpress-parity-home-"));
const userDataDir = join(fakeHome, "userData");
mkdirSync(userDataDir, { recursive: true });
writeFileSync(
  join(userDataDir, "gutterpress-prefs.json"),
  JSON.stringify({ lastProjectDir: bookDir, leftPanel: { open: true, activeTab: "files", width: 260 } }),
);
writeFileSync(
  join(userDataDir, "app-settings.json"),
  JSON.stringify({ settingsSchemaVersion: 2, preview: { mode: "editor" } }),
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

const rows = [];
let failures = 0;
try {
  const page = await app.firstWindow();
  page.setDefaultTimeout(60_000);
  await app.evaluate(({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows()[0];
    w.setSize(1800, 1000);
  });
  await page.waitForSelector(".file-item, .toc-item", { timeout: 120_000 });
  const close = page.locator('button[aria-label="Close this screen"]');
  if (await close.count()) await close.first().click().catch(() => {});
  await page.waitForSelector(".rich-editor-host .gp-sheet", { timeout: 90_000 });

  // Read mode: the locked editor is the one that must match the page.
  await page.click('button[aria-label="Read"]');
  await page.waitForSelector(".rich-editor-host .md-editor.md-readonly", { timeout: 30_000 });
  await sleep(2500);

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

  const frame = await bookFrame();
  log(`preview frame: ${frame.url()}`);
  await frame.evaluate(() => window.Gutterpress?.setSpread?.(false));
  await sleep(1200);

  // The book's own answer for every chapter, in one call.
  const bookPages = await frame.evaluate(() => {
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
  });

  const chapters = await page
    .locator(".file-item")
    .evaluateAll((els) => els.map((e) => e.textContent.trim()).filter((t) => /\.md$/i.test(t)));

  for (const chapter of chapters) {
    const book = bookPages[chapter];
    if (!book) {
      log(`skip ${chapter}: not part of the built book`);
      continue;
    }
    await page.locator(".file-item", { hasText: chapter }).first().click();
    await page.waitForSelector(".rich-editor-host .gp-sheet", { timeout: 60_000 });
    // A file switch remounts the editor, so re-assert the lock rather than
    // assuming it survived; the mode control is idempotent.
    const locked = async () => (await page.locator(".rich-editor-host .md-editor.md-readonly").count()) > 0;
    for (let attempt = 0; attempt < 3 && !(await locked()); attempt++) {
      await page.click('button[aria-label="Read"]').catch(() => {});
      await sleep(1500);
    }
    if (!(await locked())) throw new Error(`${chapter}: the editor never locked`);
    await sleep(2200);

    const editorPages = await page.evaluate(
      () => document.querySelectorAll(".rich-editor-host .gp-sheet").length,
    );
    const ok = editorPages === book.pages;
    rows.push({ chapter, editorPages, bookPages: book.pages, ok });
    if (ok) log(`ok   ${chapter}: ${editorPages} page(s)`);
    else {
      failures += 1;
      console.error(
        `[parity] FAIL ${chapter}: editor paginates it into ${editorPages} page(s), the book into ${book.pages}`,
      );
    }
  }
} finally {
  await app.close().catch(() => {});
  rmSync(bookDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
}

log(`${rows.filter((r) => r.ok).length}/${rows.length} chapter(s) agree`);
if (failures > 0) process.exit(1);
process.exit(0);
