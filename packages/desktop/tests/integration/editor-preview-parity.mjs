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

const startedWholeRun = Date.now();
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
  // Open a file before waiting for a page: with none open the editor pane
  // correctly shows "Select a file from the list to start editing", and a
  // gate that waits for a sheet there waits forever. Whether a project
  // auto-selects its first chapter is not this gate's subject.
  // The first `.file-item` may be a FOLDER (the field guide lists
  // `art-unplaced/` and `images/` before its chapters), and clicking one
  // opens no document at all — the gate then waits out its whole timeout on
  // an editor that was never given a file.
  await page.locator(".file-item").filter({ hasText: /\.md/i }).first().click();
  try {
    await page.waitForSelector(".rich-editor-host .gp-sheet", { timeout: 180_000 });
  } catch (e) {
    // A gate that only reports "no sheet appeared" sends the next hour to
    // guessing why. Say what the editor pane actually contains.
    const state = await page
      .evaluate(() => {
        const host = document.querySelector(".rich-editor-host");
        const loading = [...document.querySelectorAll(".editor-loading")].map((el) => el.textContent?.trim());
        return {
          host: !!host,
          document: !!document.querySelector(".rich-editor-host .md-document"),
          blocks: document.querySelectorAll(".rich-editor-host .md-block").length,
          layouts: document.querySelector(".rich-editor-host .md-document")?.dataset.gpLayout ?? null,
          loading,
          // Is the book's own CSS in the document at all? Without it the
          // editor cannot paginate (there is no @page geometry to read), and
          // "no page appeared" looks identical to a layout that failed.
          bookCss: Math.max(0, ...[...document.querySelectorAll("style")].map((el) => el.textContent?.length ?? 0)),
          docFont: getComputedStyle(document.querySelector(".rich-editor-host .md-document") ?? document.body).fontFamily.slice(0, 40),
          sheets: document.querySelectorAll(".rich-editor-host .gp-sheet").length,
          stage: !!document.querySelector(".rich-editor-host .gp-stage"),
          activeFile: document.querySelector(".file-item.active")?.textContent?.trim() ?? null,
          mode: [...document.querySelectorAll("button[aria-pressed='true']")].map((b) => b.getAttribute("aria-label")),
        };
      })
      .catch(() => null);
    console.error(`[parity] editor never paginated — pane state: ${JSON.stringify(state)}`);
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

  // Read mode: the locked editor is the one that must match the page.
  await page.click('button[aria-label="Read"]');
  await page.waitForSelector(".rich-editor-host .md-editor.md-readonly", { timeout: 30_000 });
  await settled();

  /**
   * Wait for the editor to STOP re-paginating, rather than sleeping past it.
   *
   * The paged surface publishes every layout on the document element
   * (`data-gp-layout`, `$lib/editor/paged-surface`), and it lays out more
   * than once per document by design: once on render, again when the fonts
   * arrive, again when the art loads. This waits for that counter to hold
   * still, which is both faster than a fixed sleep and actually correct —
   * the old fixed waits were minutes across a real book and still only a
   * guess about the slowest of them.
   */
  async function settled(quietMs = 400, timeoutMs = 60_000) {
    const deadline = Date.now() + timeoutMs;
    let last = -1;
    let stableSince = 0;
    while (Date.now() < deadline) {
      const now = await page
        .evaluate(() => Number(document.querySelector(".rich-editor-host .md-document")?.dataset.gpLayout ?? -1))
        .catch(() => -1);
      if (now !== last) {
        last = now;
        stableSince = Date.now();
      } else if (now >= 0 && Date.now() - stableSince >= quietMs) {
        return now;
      }
      await sleep(100);
    }
    return last;
  }

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

  /**
   * The book's own page counts are read ONCE, so they have to be read after
   * the viewer has finished paginating — not after a fixed sleep. A book
   * whose art or fonts are still arriving paginates again afterwards, and
   * reading through that made the BOOK's own answer move between runs (a
   * role chapter reported 23 pages on one run and 24 on the next), which
   * turned real agreement into a coin flip.
   */
  await frame.evaluate(async () => {
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
  });
  for (let last = -1, stableSince = Date.now(), deadline = Date.now() + 60_000; Date.now() < deadline; ) {
    const now = await frame.evaluate(() => document.querySelectorAll(".gp-sheet").length).catch(() => -1);
    if (now !== last) {
      last = now;
      stableSince = Date.now();
    } else if (now > 0 && Date.now() - stableSince >= 600) {
      break;
    }
    await sleep(100);
  }

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
    const startedAt = Date.now();
    await page.locator(".file-item", { hasText: chapter }).first().click();
    await page.waitForSelector(".rich-editor-host .gp-sheet", { timeout: 60_000 });
    // A file switch remounts the editor, so re-assert the lock rather than
    // assuming it survived; the mode control is idempotent.
    const locked = async () => (await page.locator(".rich-editor-host .md-editor.md-readonly").count()) > 0;
    if (!(await locked())) {
      await page.click('button[aria-label="Read"]').catch(() => {});
      await page.waitForSelector(".rich-editor-host .md-editor.md-readonly", { timeout: 30_000 });
    }
    await settled();

    const editorPages = await page.evaluate(
      () => document.querySelectorAll(".rich-editor-host .gp-sheet").length,
    );
    const tookMs = Date.now() - startedAt;
    const ok = editorPages === book.pages;
    rows.push({ chapter, editorPages, bookPages: book.pages, ok });
    if (ok) log(`ok   ${chapter}: ${editorPages} page(s) [${tookMs}ms]`);
    else {
      failures += 1;
      console.error(
        `[parity] FAIL ${chapter}: editor paginates it into ${editorPages} page(s), the book into ${book.pages} [${tookMs}ms]`,
      );
    }
  }
} finally {
  await app.close().catch(() => {});
  if (!inPlace) rmSync(bookDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
}

log(`${rows.filter((r) => r.ok).length}/${rows.length} chapter(s) agree in ${Math.round((Date.now() - startedWholeRun) / 1000)}s`);
if (failures > 0) process.exit(1);
process.exit(0);
