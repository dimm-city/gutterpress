#!/usr/bin/env node
/**
 * VIEWER REVISION DIFF — did the on-screen viewer change between two revisions?
 *
 * The preview/PDF parity gate answers "does the viewer agree with print RIGHT
 * NOW". It cannot answer "did this branch change what the viewer does", because
 * a change that moves the viewer and the PDF together keeps the gate green, and
 * a book whose viewer was already wrong keeps failing it the same way. Those are
 * different questions and they need different tools.
 *
 * This one paginates the SAME built book twice — once per engine bundle — and
 * reports every page whose content or height moved. It is the tool that settles
 * a "the viewer regressed" report with a page list instead of an impression.
 *
 * ## Running it
 *
 * Build the book on both revisions (`gutterpress build --format html`), then:
 *
 *   node scripts/viewer-revision-diff.mjs --a <dir> --b <dir> [--json out.json]
 *
 * `--a` / `--b` are build output directories (each holding `book.html` and
 * `engine/gutterpress-viewer.js`). Exits 1 when the two disagree, 0 when they
 * match, so it can gate a release.
 *
 * To attribute a difference to ONE commit, keep `--a` fixed and swap only the
 * bundle in `--b`, which is valid whenever `book.html` is byte-identical
 * between the revisions (check that first — if the markup differs, the
 * pipeline changed too and the bundle is not the whole story):
 *
 *   git show <rev>:packages/cli/src/assets/engine/gutterpress-viewer.js \
 *     > <b-dir>/engine/gutterpress-viewer.js
 *
 * ## Reading the result
 *
 * A difference is not automatically a regression. The viewer is an emulation of
 * print, so the question a difference raises is which side is closer to the
 * PDF — compare against `qpdf --show-npages` on a build of the same book, and
 * remember that print does NOT depend on this bundle (the compiler reads it for
 * a prediction pass; `Page.printToPDF` is what produces the pages).
 *
 * Chromium comes from `--chromium` or `CHROMIUM_PATH`, the same variable the
 * CLI itself documents when no browser is on PATH. Driven with puppeteer-core
 * — this package's own browser dependency, the one `browser-pool.ts` uses —
 * so the tool lives beside the engine it measures rather than in the desktop
 * package for the sake of a second driver.
 */
import puppeteer from "puppeteer-core";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

const argv = process.argv.slice(2);
const opt = (name, fallback = null) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? fallback : argv[i + 1];
};

const A = opt("a") ? resolve(opt("a")) : null;
const B = opt("b") ? resolve(opt("b")) : null;
if (!A) {
  console.error(
    "usage: node scripts/viewer-revision-diff.mjs --a <build dir> [--b <build dir>] [--json out.json]",
  );
  process.exit(2);
}
const JSON_OUT = opt("json");
const executablePath = opt("chromium", process.env.CHROMIUM_PATH);
if (!executablePath) {
  console.error("no Chromium: pass --chromium <path> or set CHROMIUM_PATH");
  process.exit(2);
}

const browser = await puppeteer.launch({
  headless: true,
  executablePath,
  args: ["--no-sandbox", "--disable-gpu", "--disable-dev-shm-usage"],
});

/**
 * Every page the viewer produced, with what is on it.
 *
 * Pagination is asynchronous and has no completion event, so the count is
 * sampled until it holds still — a fixed sleep either flakes on a slow machine
 * or wastes a minute on a fast one, and both were tried.
 */
async function paginate(dir) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto(`file://${dir}/book.html`, { waitUntil: "load", timeout: 180_000 });
  let last = -1;
  let stable = 0;
  for (let i = 0; i < 240 && stable < 5; i++) {
    const n = await page.evaluate(() => document.querySelectorAll(".gp-sheet").length);
    if (n === last && n > 0) stable++;
    else {
      stable = 0;
      last = n;
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  if (last <= 0) throw new Error(`${dir}: the viewer produced no pages`);
  const sheets = await page.evaluate(() =>
    [...document.querySelectorAll(".gp-sheet")].map((s, i) => ({
      i,
      text: (s.innerText || "").replace(/\s+/g, " ").trim().slice(0, 70),
      h: Math.round(s.getBoundingClientRect().height),
    })),
  );
  await page.close();
  return sheets;
}

try {
  const a = await paginate(A);
  if (!B) {
    console.log(`${a.length}`);
    process.exit(0);
  }
  const b = await paginate(B);
  const diffs = [];
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i];
    const y = b[i];
    if (!x || !y || x.text !== y.text || x.h !== y.h) {
      diffs.push({ page: i + 1, a: x ?? null, b: y ?? null });
    }
  }
  if (JSON_OUT) {
    writeFileSync(resolve(JSON_OUT), JSON.stringify({ aPages: a.length, bPages: b.length, diffs }, null, 1));
  }
  console.log(`a: ${a.length} pages   b: ${b.length} pages   differing: ${diffs.length}`);
  for (const d of diffs.slice(0, 20)) {
    console.log(`  p${d.page}`);
    console.log(`    a: ${JSON.stringify(d.a?.text ?? null)} h=${d.a?.h ?? "-"}`);
    console.log(`    b: ${JSON.stringify(d.b?.text ?? null)} h=${d.b?.h ?? "-"}`);
  }
  if (diffs.length > 20) console.log(`  … ${diffs.length - 20} more (use --json for all)`);
  process.exit(diffs.length === 0 ? 0 : 1);
} finally {
  await browser.close();
}
