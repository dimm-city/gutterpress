#!/usr/bin/env node
/**
 * Editor↔preview parity gate.
 *
 * The paged editor (`src/lib/editor/paged-surface.ts`) and the preview
 * iframe paginate the same chapter with the same engine and the same CSS —
 * so they must put the same content on the same page. This gate is what
 * proves it, and it is the reason the preview pane stays: it is the
 * reference the editor is measured against.
 *
 * Method (the same shape as `packages/cli/scripts/native-parity-gate.ts`,
 * which compares the viewer against print): PAGE-OF-ELEMENT mapping. For
 * one chapter it reads, from each side, every rendered text block and the
 * page its top-left corner lands on, converts both to CHAPTER-RELATIVE page
 * numbers (the preview paginates the whole book; the editor paginates one
 * chapter), matches blocks by their normalized text, and reports every
 * block whose relative page differs.
 *
 * It compares the LOCKED editor (Read mode). Unlocked, the editor shows
 * marker chips that occupy vertical space the printed page does not, so it
 * legitimately paginates differently; locked, it drops them and must agree
 * with the page. It compares page ASSIGNMENT, not pixels — book-wide
 * counters (`counter(chapter)`) restart in a single-chapter editor
 * document, and that is expected. Where a block's text lands is the thing
 * that must agree, and the thing an author would notice.
 *
 * Usage:
 *   node tests/integration/editor-preview-parity.mjs [book-dir]
 * Exit 0 when every compared block agrees, 1 otherwise.
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

/**
 * Runs INSIDE the page. Given a root and that side's sheets, returns one
 * `{ text, page }` per rendered text block, page being the 0-based index of
 * the sheet the block's top-left corner sits on.
 */
const COLLECT = `(root, sheetSelector) => {
  const sheets = [...document.querySelectorAll(sheetSelector)].map((s) => {
    const r = s.getBoundingClientRect();
    return { top: r.top, left: r.left, bottom: r.bottom, right: r.right };
  });
  const pageOf = (rect) => {
    let best = -1;
    let bestDistance = Infinity;
    const x = rect.left + 1;
    const y = rect.top + 1;
    for (let i = 0; i < sheets.length; i++) {
      const s = sheets[i];
      if (x >= s.left && x <= s.right && y >= s.top && y <= s.bottom) return i;
      // A block sitting in the gap between sheets (a forced break's slack)
      // belongs to the nearest one rather than to nothing.
      const dy = y < s.top ? s.top - y : y > s.bottom ? y - s.bottom : 0;
      const dx = x < s.left ? s.left - x : x > s.right ? x - s.right : 0;
      const d = dx + dy;
      if (d < bestDistance) { bestDistance = d; best = i; }
    }
    return best;
  };
  // Typographic normalization: the preview runs markdown-it's typographer
  // (curly quotes, en/em dashes, ellipses) and the editor renders the
  // author's literal characters. That difference is real and reported
  // separately — it must not be allowed to mask a PAGINATION difference,
  // which is what this gate measures.
  const norm = (s) =>
    s
      // The editor keeps a heading's own hash marker in the DOM (hidden
      // while the block is inactive); the preview never had one.
      .replace(/^\\s*#{1,6}\\s+/, "")
      // ...and markdown-it-attrs trailers are consumed into attributes there.
      .replace(/\\{[#.][^}]*\\}\\s*$/, "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\u2014/g, "--")
      .replace(/\u2013/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/\\s+/g, " ")
      .trim();
  const out = [];
  for (const el of root.querySelectorAll("p, h1, h2, h3, h4, h5, h6, li, pre, blockquote, td, th")) {
    // Nested blocks (a <p> inside an <li>) would double-count; keep the outermost.
    if (el.parentElement && el.parentElement.closest("li, blockquote, td, th")) continue;
    if (el.closest(".gp-block-chip, .gp-marginbox, .gp-layer")) continue;
    // textContent, not innerText: the editor keeps a soft line break as a
    // rendered-but-empty node, so innerText joins the two lines with no
    // space, while the preview's markdown has a real space there. Structural
    // text is what makes the same paragraph the same string on both sides.
    const text = norm(el.textContent ?? "");
    if (!text) continue;
    out.push({ text, page: pageOf(el.getBoundingClientRect()) });
  }
  return out;
}`;

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
  await page.waitForSelector(".rich-editor-host .md-block", { timeout: 60_000 });
  // Compare the LOCKED editor. Unlocked, the editor shows marker chips that
  // take vertical space the printed page does not, so it legitimately
  // paginates differently; locked, it drops them and must agree with the
  // page exactly. That is the invariant worth gating on.
  await page.click('button[aria-label="Read"]');
  await sleep(3000);

  // The preview is a shell iframe that hosts the book in a nested iframe, so
  // pick the frame that actually paginated rather than one matching a URL.
  let frame;
  for (let attempt = 0; attempt < 60 && !frame; attempt++) {
    for (const f of page.frames()) {
      if (f === page.mainFrame()) continue;
      const sheets = await f.evaluate(() => document.querySelectorAll(".gp-sheet").length).catch(() => 0);
      if (sheets > 0) { frame = f; break; }
    }
    if (!frame) await sleep(1000);
  }
  if (!frame) throw new Error("no paginated preview frame appeared — nothing to compare against");
  log(`preview frame: ${frame.url()}`);

  const chapters = await page.locator(".file-item").evaluateAll((els) =>
    els.map((e) => e.textContent.trim()).filter((t) => /\.md$/i.test(t)),
  );
  log(`chapters: ${chapters.join(", ")}`);

  for (const chapter of chapters) {
    await page.locator(".file-item", { hasText: chapter }).first().click();
    await page.waitForSelector(".rich-editor-host .gp-sheet", { timeout: 60_000 });
    // Both sides must be in single-page view: Read mode puts the preview in
    // two-up spread, which is a VIEW mode, not pagination. Driven through the
    // viewer's own API rather than by faking anything.
    await frame.evaluate(() => window.Gutterpress?.setSpread?.(false));
    await page.waitForSelector(".rich-editor-host .md-editor.md-readonly", { timeout: 30_000 });
    await sleep(2500);

    const editorBlocks = await page.evaluate(
      ([collect, sel]) =>
        new Function(`return ${collect}`)()(document.querySelector(sel), `${sel} .gp-sheet`),
      [COLLECT, ".rich-editor-host .md-document"],
    );
    // A chapter is exploded into one shell per page context, so every
    // `[data-chapter-src]` element for this file is part of it.
    const previewBlocks = await frame.evaluate(
      ([collect, src]) => {
        const fn = new Function(`return ${collect}`)();
        // A chapter is exploded into one shell per page context, and a shell
        // can sit inside another shell (the recursion clones the wrapper it
        // splits). Counting a nested shell too would count its blocks twice.
        const all = [...document.querySelectorAll(`[data-chapter-src="${src}"]`)];
        const roots = all.filter((el) => !all.some((other) => other !== el && other.contains(el)));
        return roots.length ? roots.flatMap((root) => fn(root, ".gp-sheet")) : fn(document.body, ".gp-sheet");
      },
      [COLLECT, chapter],
    );

    if (editorBlocks.length === 0 || previewBlocks.length === 0) {
      const roots = await frame.evaluate(() =>
        [...document.querySelectorAll("[data-chapter-src]")].map((e) => e.getAttribute("data-chapter-src")),
      );
      console.error(
        `[parity] FAIL ${chapter}: nothing to compare (editor ${editorBlocks.length} blocks, preview ${previewBlocks.length});` +
          ` preview chapter roots: ${JSON.stringify(roots)}`,
      );
      failures += 1;
      continue;
    }

    // Chapter-relative pages: the preview paginates the whole book.
    const rebase = (blocks) => {
      const base = Math.min(...blocks.map((b) => b.page));
      return blocks.map((b) => ({ ...b, page: b.page - base }));
    };
    const editor = rebase(editorBlocks);
    const preview = rebase(previewBlocks);

    const previewByText = new Map();
    for (const b of preview) {
      if (!previewByText.has(b.text)) previewByText.set(b.text, []);
      previewByText.get(b.text).push(b.page);
    }

    let compared = 0;
    const mismatches = [];
    for (const b of editor) {
      const pages = previewByText.get(b.text);
      if (!pages || pages.length === 0) continue; // present on one side only (chrome, chips)
      const expected = pages.shift();
      compared += 1;
      if (expected !== b.page) mismatches.push({ text: b.text.slice(0, 60), editor: b.page, preview: expected });
    }

    const geometry = async (target, sel) =>
      target.evaluate((s) => {
        const strip = document.querySelector(s);
        if (!strip) return null;
        const cs = getComputedStyle(strip);
        const read = (n) => cs.getPropertyValue(n).trim();
        return {
          page: `${read("--gp-page-w")}x${read("--gp-page-h")}`,
          content: `${read("--gp-content-w")}x${read("--gp-content-h")}`,
          fontSize: getComputedStyle(strip.querySelector("p") ?? strip).fontSize,
          paragraph: (() => {
            const p = strip.querySelector("p");
            if (!p) return null;
            const c = getComputedStyle(p);
            // No width here: each pane applies its own fit zoom, so a
            // rect width says nothing about layout.
            return `m${c.marginTop}/${c.marginBottom} lh${c.lineHeight}`;
          })(),
          layers: [...document.querySelectorAll("style")].filter((e) => /@layer/.test(e.textContent ?? "")).length,
        };
      }, sel);
    const editorGeometry = await geometry(page, ".rich-editor-host .gp-strip");
    // Scope the preview's geometry to THIS chapter's strip: a book has many
    // strips and the first one belongs to chapter 1.
    const previewGeometry = await frame.evaluate((src) => {
      const root = document.querySelector(`[data-chapter-src="${src}"]`);
      const strip = root?.closest(".gp-strip") ?? root?.querySelector(".gp-strip");
      if (!strip) return null;
      const cs = getComputedStyle(strip);
      const read = (n) => cs.getPropertyValue(n).trim();
      const p = root?.querySelector("p");
      return {
        page: `${read("--gp-page-w")}x${read("--gp-page-h")}`,
        content: `${read("--gp-content-w")}x${read("--gp-content-h")}`,
        fontSize: getComputedStyle(p ?? strip).fontSize,
        paragraph: p
          ? `m${getComputedStyle(p).marginTop}/${getComputedStyle(p).marginBottom} lh${getComputedStyle(p).lineHeight}`
          : null,
        layers: [...document.querySelectorAll("style")].filter((e) => /@layer/.test(e.textContent ?? "")).length,
      };
    }, chapter);
    if (process.env.GP_PARITY_DEBUG) {
      const dump = async (target, stripSel, breakSel) =>
        target.evaluate(([ss, bs]) => {
          const strip = document.querySelector(ss);
          return {
            strips: document.querySelectorAll(ss).length,
            scrollWidth: strip?.scrollWidth,
            clientWidth: strip?.clientWidth,
            pages: strip ? getComputedStyle(strip).getPropertyValue("--gp-pages").trim() : null,
            breaks: document.querySelectorAll(bs).length,
            columns: document.querySelectorAll(".gp-columns-2, .gp-columns-3").length,
            readonly: !!document.querySelector(".md-editor.md-readonly"),
            visibleChips: [...document.querySelectorAll(".gp-block-chip")].filter(
              (e) => e.getBoundingClientRect().height > 0,
            ).length,
            sheetTops: [...document.querySelectorAll(ss.replace(".gp-strip", ".gp-sheet"))]
              .slice(0, 6)
              .map((e) => Math.round(e.getBoundingClientRect().top)),
          };
        }, [stripSel, breakSel]);
      console.error(
        `[parity] debug ${chapter}: editor ${JSON.stringify(await dump(page, ".rich-editor-host .gp-strip", ".gp-block-chip--column-break, .gp-block-chip--page-break"))}` +
          ` | preview ${JSON.stringify(await dump(frame, ".gp-strip", ".gp-column-break, .gp-page-break"))}`,
      );
    }
    log(`geom ${chapter}: editor ${JSON.stringify(editorGeometry)} | preview ${JSON.stringify(previewGeometry)}`);
    const comparable = (g) => (g ? { page: g.page, content: g.content, fontSize: g.fontSize, paragraph: g.paragraph } : null);
    if (
      previewGeometry?.paragraph &&
      JSON.stringify(comparable(editorGeometry)) !== JSON.stringify(comparable(previewGeometry))
    ) {
      failures += 1;
      console.error(
        `[parity] FAIL ${chapter}: page geometry differs — editor ${JSON.stringify(comparable(editorGeometry))} vs preview ${JSON.stringify(comparable(previewGeometry))}`,
      );
    }

    const editorPages = Math.max(...editor.map((b) => b.page)) + 1;
    const previewPages = Math.max(...preview.map((b) => b.page)) + 1;
    if (mismatches.length === 0 && compared > 0) {
      log(
        `ok   ${chapter}: ${compared}/${editor.length} block(s) agree, ` +
          `${editorPages} page(s) (preview: ${previewPages})`,
      );
    } else {
      failures += 1;
      console.error(
        `[parity] FAIL ${chapter}: ${mismatches.length}/${compared} compared block(s) on a different page ` +
          `(editor has ${editor.length}, preview ${preview.length}) ` +
          `(editor ${editorPages} page(s), preview ${previewPages})`,
      );
      for (const m of mismatches.slice(0, 10)) {
        console.error(`  - editor p${m.editor} vs preview p${m.preview}: "${m.text}"`);
      }
      if (compared === 0) {
        console.error("  - no block text matched on both sides; first texts from each:");
        const e0 = editor[0]?.text ?? "";
        const p0 = preview[0]?.text ?? "";
        console.error(`      editor [0] (${e0.length}): ${JSON.stringify(e0)}`);
        console.error(`      preview[0] (${p0.length}): ${JSON.stringify(p0)}`);
        for (let i = 0; i < Math.max(e0.length, p0.length); i++) {
          if (e0[i] !== p0[i]) {
            console.error(`      first difference at ${i}: editor ${JSON.stringify(e0.slice(i, i + 24))} vs preview ${JSON.stringify(p0.slice(i, i + 24))}`);
            break;
          }
        }
      }
    }
  }
} finally {
  await app.close().catch(() => {});
  rmSync(bookDir, { recursive: true, force: true });
  rmSync(fakeHome, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`[parity] ${failures} chapter(s) diverge`);
  process.exit(1);
}
log("editor and preview agree on every compared block");
process.exit(0);
