#!/usr/bin/env node
/**
 * EDITOR ↔ PREVIEW parity report.
 *
 * The preview is the surface held page-for-page to the PDF (the CLI's
 * `scripts/native-parity-gate.ts`). The rich editor is a third view, and its
 * promise is that an author's text looks the way it will print. This tool
 * measures how well it keeps that promise on a REAL book: it opens one
 * chapter in both surfaces of the packaged app, walks every painted run of
 * text in each, and reports where they disagree.
 *
 * It exists because screenshots are a terrible bug report for this. A
 * screenshot shows one page at one size and hides everything below the fold;
 * a run-by-run diff names the divergence, the element it came from, and how
 * big it is. Everything it prints is measured, not inferred.
 *
 * ## Running it
 *
 *   npm run parity -- --book /path/to/book --file 03-components.md
 *
 * Options:
 *   --book  <dir>    project directory (the folder holding manifest.yaml)
 *   --file  <name>   chapter to open; defaults to the first .md file
 *   --out   <dir>    report + screenshots destination (default ./parity-report)
 *   --width <px>     window width, default 1500
 *   --keep-parent    stage the book's PARENT directory too, for a project
 *                    whose plugins or styles live in a sibling folder
 *
 * On a headless machine, run it under a virtual display:
 *   xvfb-run -a npm run parity -- --book …
 *
 * ## What it reports
 *
 * `report.json` plus a printed summary:
 *
 *   sequence     the two surfaces produced the same runs, in the same order
 *   pages        which run lands on which page of the chapter, ordinally
 *   gaps         the space between consecutive blocks (the reader's rhythm)
 *   style        font size / weight / colour / family / alignment per run
 *   plugins      what the editor could and could not load, with reasons
 *
 * Measurements are normalised before comparison — the preview paints at the
 * author's zoom and the editor at its own fit scale — so a difference in the
 * report is a difference the author would SEE, not a difference in zoom.
 */
import { _electron as electron } from "playwright-core";
import { cpSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// ── options ────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};
const flag = (name) => argv.includes(`--${name}`);

const BOOK = opt("book") ? resolve(opt("book")) : null;
if (!BOOK) {
  console.error("usage: npm run parity -- --book <project dir> [--file <chapter.md>]");
  process.exit(2);
}
const OUT = resolve(opt("out", "parity-report"));
const WIDTH = Number(opt("width", 1500));
const HEIGHT = Number(opt("height", 1000));
const DESKTOP = resolve(dirname(new URL(import.meta.url).pathname), "..");
const MAIN = join(DESKTOP, "out", "main", "main.js");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (m) => console.log(`[parity] ${m}`);

// ── stage a disposable copy so the run cannot touch the author's files ─────
const stage = mkdtempSync(join(tmpdir(), "gp-parity-"));
let book;
if (flag("keep-parent")) {
  cpSync(dirname(BOOK), stage, { recursive: true });
  book = join(stage, basename(BOOK));
} else {
  cpSync(BOOK, stage, { recursive: true });
  book = stage;
}
const FILE =
  opt("file") ??
  readdirSync(book)
    .filter((f) => f.endsWith(".md"))
    .sort()[0];
if (!FILE) {
  console.error(`no .md files in ${BOOK}`);
  process.exit(2);
}
mkdirSync(OUT, { recursive: true });

const home = mkdtempSync(join(tmpdir(), "gp-parity-home-"));
const userData = join(home, "userData");
mkdirSync(userData, { recursive: true });
writeFileSync(
  join(userData, "gutterpress-settings.json"),
  JSON.stringify({ editor: { mode: "rich" }, preview: { viewMode: "single" } }),
);
writeFileSync(
  join(userData, "gutterpress-prefs.json"),
  JSON.stringify({
    lastProjectDir: book,
    leftPanel: { open: false },
    showLandingAtStartup: false,
    viewMode: "single",
  }),
);

/**
 * Collect every painted text run, with where it landed.
 *
 * Injected into both frames as source, so the two sides are measured by the
 * same code. `pageOf` is the only part that differs: the preview paints its
 * pages as `.gp-sheet` backdrops while the editor's pages are multicol
 * columns, so each surface says where its own page starts.
 */
const COLLECT = `(pageOf) => {
  const out = [];
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = walk.nextNode())) {
    const t = (n.textContent || "").replace(/\\s+/g, " ").trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || el.closest("script,style")) continue;
    const r = document.createRange();
    r.selectNodeContents(n);
    const b = r.getBoundingClientRect();
    if (!b.width && !b.height) continue;
    const info = pageOf(el, b);
    if (!info) continue;
    const cs = getComputedStyle(el);
    const scale = info.scale || 1;
    out.push({
      text: t.slice(0, 60),
      pageTop: info.top,
      pageLeft: info.left,
      dy: Math.round((b.top - info.top) / scale),
      dx: Math.round((b.left - info.left) / scale),
      tag: el.tagName.toLowerCase(),
      size: cs.fontSize,
      weight: cs.fontWeight,
      color: cs.color,
      family: cs.fontFamily.split(",")[0].replace(/["']/g, ""),
      align: cs.textAlign,
      chain: (() => {
        const parts = [];
        let x = el;
        while (x && parts.length < 5) {
          parts.push(x.tagName.toLowerCase() + (x.className ? "." + String(x.className).trim().split(/\\s+/).join(".") : ""));
          x = x.parentElement;
        }
        return parts.join(" < ");
      })(),
    });
  }
  return out;
}`;

/** The Nth distinct page a run lands on, in reading order. */
function ordinal(runs) {
  const seen = new Map();
  for (const r of runs) {
    const key = `${Math.round(r.pageLeft / 4)}|${Math.round(r.pageTop / 4)}`;
    if (!seen.has(key)) seen.set(key, seen.size + 1);
    r.page = seen.get(key);
  }
}

const app = await electron.launch({
  args: [MAIN, `--user-data-dir=${userData}`, "--no-sandbox"],
  cwd: DESKTOP,
  env: { ...process.env, HOME: home, ELECTRON_DISABLE_GPU: "1" },
});

const report = {
  book: BOOK,
  file: FILE,
  window: { width: WIDTH, height: HEIGHT },
  when: null,
};

try {
  let page = null;
  for (let i = 0; i < 120 && !page; i++) {
    page = app.windows().find((w) => w.url().startsWith("app://"));
    if (!page) await sleep(500);
  }
  if (!page) throw new Error("the app window never appeared");
  await page.waitForLoadState("domcontentloaded");
  await page.setViewportSize({ width: WIDTH, height: HEIGHT });
  for (let i = 0; i < 120; i++) {
    if (await page.evaluate(() => !!document.querySelector('button[aria-label="Toggle markdown editor"]'))) break;
    await sleep(1000);
  }
  await sleep(4000);

  report.chromium = await page.evaluate(() => navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0] ?? "?");

  // What does the host think this project's plugins are? A plugin the editor
  // cannot load is the single largest source of "it looks nothing like the
  // preview", so it is reported first and by name.
  report.plugins = await page.evaluate(async (dir) => {
    const r = await fetch("/api/project/editor-plugins", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ projectDir: dir }),
    });
    return { status: r.status, body: await r.json().catch(() => null) };
  }, book);

  // ── open the chapter in the rich editor ─────────────────────────────────
  await page.evaluate(() => document.querySelector('button[aria-label="Toggle markdown editor"]').click());
  await sleep(3000);
  await page.evaluate(() => {
    const b = [...document.querySelectorAll("button")].find((x) => /decide later/i.test(x.textContent || ""));
    b?.click();
  });
  await sleep(2500);
  await page.evaluate((name) => {
    const el = [...document.querySelectorAll(".file-item .file-name")].find(
      (x) => x.textContent.trim() === name,
    );
    (el?.closest(".file-item") ?? el)?.click();
  }, FILE);
  await sleep(5000);

  report.editorNotes = await page.evaluate(() =>
    [...document.querySelectorAll(".editor-mode-note")].map((n) => n.textContent.replace(/\s+/g, " ").trim()),
  );

  const handle = await page.$("iframe.rich-editor");
  const frame = handle ? await handle.contentFrame() : null;
  if (!frame) throw new Error("the rich editor never mounted (is this file rich-editable?)");

  const editorScale = await frame.evaluate(() => {
    const box = document.querySelector(".gp-editor-scale");
    const m = box ? /matrix\(([\d.]+)/.exec(getComputedStyle(box).transform) : null;
    return m ? Number(m[1]) : 1;
  });
  const chapterId = await frame.evaluate(
    () => document.querySelector(".gp-editor-page-flow .chapter[id]")?.id ?? null,
  );
  report.editorScale = editorScale;
  report.chapterId = chapterId;

  const editor = await frame.evaluate(`(${COLLECT})((el, box) => {
    const flow = document.querySelector(".gp-editor-page-flow");
    if (!flow) return null;
    const cs = getComputedStyle(flow);
    const h = parseFloat(cs.columnHeight || cs.height);
    const rowGap = parseFloat(cs.rowGap) || 0;
    const colW = parseFloat(cs.columnWidth);
    const colGap = parseFloat(cs.columnGap) || 0;
    const r = flow.getBoundingClientRect();
    const row = Math.floor((box.top - r.top) / (h + rowGap));
    const col = Math.max(0, Math.round((box.left - r.left) / (colW + colGap)));
    return { top: r.top + row * (h + rowGap), left: r.left + col * (colW + colGap), scale: ${editorScale} };
  })`);
  await page.screenshot({ path: join(OUT, "editor.png") });

  // ── the same chapter in the preview ─────────────────────────────────────
  let previewFrame = null;
  let sheets = 0;
  for (let attempt = 0; attempt < 20 && sheets === 0; attempt++) {
    for (const f of page.frames()) {
      const n = await f.evaluate(() => document.querySelectorAll(".gp-sheet").length).catch(() => 0);
      if (n > sheets) {
        sheets = n;
        previewFrame = f;
      }
    }
    if (!sheets) await sleep(1500);
  }
  if (!previewFrame) throw new Error("the preview never paginated (did the build fail?)");
  report.previewSheets = sheets;

  const previewZoom = await previewFrame.evaluate(() => {
    const stage = document.querySelector(".gp-stage") ?? document.body;
    const z = parseFloat(getComputedStyle(stage).zoom);
    return Number.isFinite(z) && z > 0 ? z : 1;
  });
  report.previewZoom = previewZoom;

  const preview = await previewFrame.evaluate(`(() => {
    const CHAPTER = ${JSON.stringify(chapterId)};
    const sheets = [...document.querySelectorAll(".gp-sheet")].map((s) => {
      const r = s.getBoundingClientRect();
      const cs = getComputedStyle(s);
      return { r, top: r.top + parseFloat(cs.paddingTop || "0"), left: r.left + parseFloat(cs.paddingLeft || "0") };
    });
    return (${COLLECT})((el, box) => {
      // Only the chapter the editor is showing: the preview holds the book.
      if (CHAPTER && el.closest(".chapter")?.id !== CHAPTER) return null;
      const cy = box.top + box.height / 2, cx = box.left + box.width / 2;
      const hit = sheets.find((s) => cy >= s.r.top && cy <= s.r.bottom && cx >= s.r.left && cx <= s.r.right)
        ?? sheets.find((s) => cy >= s.r.top && cy <= s.r.bottom);
      return hit ? { top: hit.top, left: hit.left, scale: ${previewZoom} } : null;
    });
  })()`);
  if (!chapterId) {
    log("NOTE: this chapter has no id, so the preview side could not be scoped to it.");
    log("      Give the chapter an id (@chapter … #ch-name) for a precise comparison.");
  }

  ordinal(preview);
  ordinal(editor);

  // ── diff ────────────────────────────────────────────────────────────────
  const pText = preview.map((r) => r.text);
  const eText = editor.map((r) => r.text);
  const sameSequence = pText.length === eText.length && pText.every((t, i) => t === eText[i]);
  const pairs = sameSequence
    ? preview.map((p, i) => [p, editor[i]])
    : editor.map((e) => [preview.find((p) => p.text === e.text), e]).filter(([p]) => p);

  const missing = pText.filter((t) => !eText.includes(t));
  const extra = eText.filter((t) => !pText.includes(t));

  const pageDiffs = [];
  const styleDiffs = [];
  for (const [p, e] of pairs) {
    if (p.page !== e.page) pageDiffs.push({ text: e.text, preview: p.page, editor: e.page });
    // `tag` is deliberately not compared: the editing surface legitimately
    // wraps list-item text in a paragraph. What matters is what is SEEN.
    for (const k of ["size", "weight", "color", "family", "align"]) {
      if (p[k] !== e[k]) {
        styleDiffs.push({ text: e.text, property: k, preview: p[k], editor: e[k], previewChain: p.chain, editorChain: e.chain });
      }
    }
  }

  // Per-block GAPS — the reader's rhythm. Compared only within a page, since
  // a page boundary is not a gap.
  const gapDiffs = [];
  for (let i = 1; i < pairs.length; i++) {
    const [pa, ea] = pairs[i - 1];
    const [pb, eb] = pairs[i];
    if (pa.page !== pb.page || ea.page !== eb.page) continue;
    const pg = pb.dy - pa.dy;
    const eg = eb.dy - ea.dy;
    if (Math.abs(pg - eg) > 2) gapDiffs.push({ after: pa.text, before: pb.text, preview: pg, editor: eg, delta: eg - pg });
  }

  const pageCount = { editor: new Set(editor.map((r) => r.page)).size, preview: new Set(preview.map((r) => r.page)).size };

  Object.assign(report, {
    when: new Date().toISOString(),
    runs: { preview: preview.length, editor: editor.length },
    sameSequence,
    pageCount,
    counts: {
      missing: missing.length,
      extra: extra.length,
      pageDiffs: pageDiffs.length,
      styleDiffs: styleDiffs.length,
      gapDiffs: gapDiffs.length,
    },
    missing,
    extra,
    pageDiffs,
    styleDiffs,
    gapDiffs,
  });

  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));

  log(`book        ${BOOK}`);
  log(`chapter     ${FILE}${chapterId ? ` (#${chapterId})` : " (no id — preview not scoped)"}`);
  log(`plugins     ${JSON.stringify(report.plugins?.body ?? report.plugins)}`);
  if (report.editorNotes.length) log(`editor says ${JSON.stringify(report.editorNotes)}`);
  log(`runs        preview ${preview.length} / editor ${editor.length}  (same sequence: ${sameSequence})`);
  log(`pages       preview ${pageCount.preview} / editor ${pageCount.editor}`);
  log(`missing     ${missing.length}   ${JSON.stringify(missing.slice(0, 4))}`);
  log(`extra       ${extra.length}   ${JSON.stringify(extra.slice(0, 4))}`);
  log(`page diffs  ${pageDiffs.length}`);
  log(`style diffs ${styleDiffs.length}  ${JSON.stringify(styleDiffs.slice(0, 3))}`);
  log(`gap diffs   ${gapDiffs.length}  ${JSON.stringify(gapDiffs.slice(0, 3))}`);
  log(`report      ${join(OUT, "report.json")}  (+ editor.png)`);
} catch (e) {
  report.error = e instanceof Error ? `${e.message}\n${e.stack}` : String(e);
  writeFileSync(join(OUT, "report.json"), JSON.stringify(report, null, 2));
  log(`FAILED: ${report.error.split("\n")[0]}`);
  log(`report  ${join(OUT, "report.json")}`);
  process.exitCode = 1;
} finally {
  await app.close().catch(() => {});
}
