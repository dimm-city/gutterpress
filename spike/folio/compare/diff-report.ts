/**
 * Exhaustive output diff between two PDFs of the same book.
 *
 * The head-to-head harness (compare/run.ts) answers "how do the two pipelines
 * behave"; this answers "what is actually different in the artifact", page by
 * page and word by word, so defects can't hide behind an aggregate score.
 *
 *   bun compare/diff-report.ts <a.pdf> <b.pdf> [labelA] [labelB]
 */
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { inspectPdf } from "../src/shared/pdf-inspect.ts";
import { readFileSync } from "node:fs";
import { pdfText, type PdfPageText } from "../spikes/probe.ts";

const [aPath, bPath, labelA = "A", labelB = "B"] = process.argv.slice(2);
if (!aPath || !bPath) throw new Error("usage: diff-report.ts <a.pdf> <b.pdf> [labelA] [labelB]");

const OUT = join(import.meta.dir, "out");

/** Ink bounding box per page, via the PyMuPDF probe (verification only). */
function inkBoxes(path: string): Array<{ page: number; box: number[] | null }> {
  const r = spawnSync("python3", [join(import.meta.dir, "ink-boxes.py"), path], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`ink-boxes failed: ${r.stderr}`);
  return JSON.parse(r.stdout).pages;
}

const norm = (s: string) =>
  s
    .replace(/ /g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, " ")
    .trim();

const words = (p: PdfPageText) => p.words.map((w) => norm(w.text)).filter(Boolean);

/** Multiset difference: what does `x` have that `y` doesn't. */
function missing(x: string[], y: string[]): string[] {
  const counts = new Map<string, number>();
  for (const w of y) counts.set(w, (counts.get(w) ?? 0) + 1);
  const out: string[] = [];
  for (const w of x) {
    const n = counts.get(w) ?? 0;
    if (n > 0) counts.set(w, n - 1);
    else out.push(w);
  }
  return out;
}

const a = pdfText(aPath);
const b = pdfText(bPath);
const aFacts = await inspectPdf(readFileSync(aPath));
const bFacts = await inspectPdf(readFileSync(bPath));
const aInk = inkBoxes(aPath);
const bInk = inkBoxes(bPath);

// ---- 1. document-level content: is anything MISSING, not just moved? -------
const aAll = a.pages.flatMap(words);
const bAll = b.pages.flatMap(words);
const onlyInA = missing(aAll, bAll);
const onlyInB = missing(bAll, aAll);

// ---- 1b. align pages by CONTENT ---------------------------------------------
// Once one page is inserted or dropped, comparing page N to page N is noise:
// every later page looks different. Align first (Needleman-Wunsch over word
// overlap), then compare what is actually the same page of the book.
function jaccard(x: Set<string>, y: Set<string>): number {
  if (!x.size || !y.size) return 0;
  let inter = 0;
  for (const w of x) if (y.has(w)) inter++;
  return inter / (x.size + y.size - inter);
}
const aSets = a.pages.map((p) => new Set(words(p)));
const bSets = b.pages.map((p) => new Set(words(p)));
const GAP = -0.35;
const dp: number[][] = Array.from({ length: a.pages.length + 1 }, () =>
  new Array(b.pages.length + 1).fill(0),
);
for (let i = 1; i <= a.pages.length; i++) dp[i][0] = dp[i - 1][0] + GAP;
for (let j = 1; j <= b.pages.length; j++) dp[0][j] = dp[0][j - 1] + GAP;
for (let i = 1; i <= a.pages.length; i++) {
  for (let j = 1; j <= b.pages.length; j++) {
    dp[i][j] = Math.max(
      dp[i - 1][j - 1] + jaccard(aSets[i - 1], bSets[j - 1]),
      dp[i - 1][j] + GAP,
      dp[i][j - 1] + GAP,
    );
  }
}
const alignment: Array<{ a: number | null; b: number | null; score: number }> = [];
{
  let i = a.pages.length;
  let j = b.pages.length;
  while (i > 0 || j > 0) {
    const diag = i > 0 && j > 0 ? dp[i - 1][j - 1] + jaccard(aSets[i - 1], bSets[j - 1]) : -Infinity;
    const up = i > 0 ? dp[i - 1][j] + GAP : -Infinity;
    const left = j > 0 ? dp[i][j - 1] + GAP : -Infinity;
    if (diag >= up && diag >= left && i > 0 && j > 0) {
      alignment.unshift({ a: i, b: j, score: jaccard(aSets[i - 1], bSets[j - 1]) });
      i--;
      j--;
    } else if (up >= left && i > 0) {
      alignment.unshift({ a: i, b: null, score: 0 });
      i--;
    } else {
      alignment.unshift({ a: null, b: j, score: 0 });
      j--;
    }
  }
}
const unmatchedA = alignment.filter((x) => x.b === null).map((x) => x.a);
const unmatchedB = alignment.filter((x) => x.a === null).map((x) => x.b);
const matched = alignment.filter((x) => x.a !== null && x.b !== null);
const weakMatches = matched.filter((x) => x.score < 0.7);

// ---- 2. page geometry ------------------------------------------------------
const geometry = matched.map((m) => ({
  page: m.a!,
  pageB: m.b!,
  a: aFacts.boxes[m.a! - 1]?.media,
  b: bFacts.boxes[m.b! - 1]?.media,
  aInk: aInk[m.a! - 1]?.box,
  bInk: bInk[m.b! - 1]?.box,
}));
const inkWidth = (box: number[] | null | undefined) => (box ? box[2] - box[0] : 0);
const widthDiffs = geometry
  .filter((g) => g.aInk && g.bInk && Math.abs(inkWidth(g.aInk) - inkWidth(g.bInk)) > 3)
  .map((g) => ({
    page: g.page,
    pageB: g.pageB,
    aWidth: Math.round(inkWidth(g.aInk!)),
    bWidth: Math.round(inkWidth(g.bInk!)),
    aBox: g.aInk!.map(Math.round),
    bBox: g.bInk!.map(Math.round),
  }));

// ---- 3. running heads and folios ------------------------------------------
/** Text drawn outside the content box = margin-box content. */
function chrome(t: { pages: PdfPageText[] }, top: number, bottom: number) {
  return t.pages.map((p) => {
    const head = p.words.filter((w) => w.y1 <= top + 1).map((w) => w.text);
    const foot = p.words.filter((w) => w.y0 >= bottom - 1).map((w) => w.text);
    return { head: norm(head.join(" ")), foot: norm(foot.join(" ")) };
  });
}
const CONTENT_TOP = Number(process.env.FOLIO_CONTENT_TOP ?? 63);
const CONTENT_BOTTOM = Number(process.env.FOLIO_CONTENT_BOTTOM ?? 720);
const aChrome = chrome(a, CONTENT_TOP, CONTENT_BOTTOM);
const bChrome = chrome(b, CONTENT_TOP, CONTENT_BOTTOM);

// ---- 4. per-page content alignment ----------------------------------------
const pageDiffs: any[] = [];
for (const m of matched) {
  const i = m.a! - 1;
  const j = m.b! - 1;
  const aw = words(a.pages[i]);
  const bw = words(b.pages[j]);
  if (aw.join(" ") === bw.join(" ")) continue;
  pageDiffs.push({
    page: m.a,
    pageB: m.b,
    score: Number(m.score.toFixed(2)),
    onlyInA: missing(aw, bw).slice(0, 12),
    onlyInB: missing(bw, aw).slice(0, 12),
    aFirst: aw.slice(0, 8).join(" "),
    bFirst: bw.slice(0, 8).join(" "),
    headA: aChrome[i].head,
    headB: bChrome[j].head,
    footA: aChrome[i].foot,
    footB: bChrome[j].foot,
  });
}

// first page where the two documents stop containing the same content
const firstDivergence = pageDiffs.length ? pageDiffs[0].page : null;

// ---- 5. structure ----------------------------------------------------------
const structure = {
  pages: { [labelA]: a.pageCount, [labelB]: b.pageCount },
  outline: { [labelA]: aFacts.outline.length, [labelB]: bFacts.outline.length },
  namedDests: {
    [labelA]: Object.keys(aFacts.namedDests).length,
    [labelB]: Object.keys(bFacts.namedDests).length,
  },
  links: {
    [labelA]: Object.keys(aFacts.linkTargets).length,
    [labelB]: Object.keys(bFacts.linkTargets).length,
  },
};

// ---- 6. margin-box chrome differences --------------------------------------
const chromeDiffs = [];
for (const m of matched) {
  const x = aChrome[m.a! - 1];
  const y = bChrome[m.b! - 1];
  // folios legitimately differ once a page has been inserted/dropped upstream
  if (x.head !== y.head) chromeDiffs.push({ page: m.a, pageB: m.b, a: x, b: y });
}

const report = {
  alignment: {
    matched: matched.length,
    unmatchedA,
    unmatchedB,
    weakMatches: weakMatches.map((m) => ({ a: m.a, b: m.b, score: Number(m.score.toFixed(2)) })),
  },
  a: { path: aPath, label: labelA, pages: a.pageCount },
  b: { path: bPath, label: labelB, pages: b.pageCount },
  structure,
  contentLoss: {
    onlyInA: onlyInA.slice(0, 80),
    onlyInACount: onlyInA.length,
    onlyInB: onlyInB.slice(0, 80),
    onlyInBCount: onlyInB.length,
    totalWordsA: aAll.length,
    totalWordsB: bAll.length,
  },
  inkWidthDiffs: widthDiffs,
  firstDivergence,
  pageDiffs: pageDiffs.slice(0, 40),
  pageDiffCount: pageDiffs.length,
  chromeDiffs: chromeDiffs.slice(0, 40),
  chromeDiffCount: chromeDiffs.length,
};

writeFileSync(join(OUT, "diff-report.json"), JSON.stringify(report, null, 2));

console.log(`\n== structure`);
console.table(structure);
console.log(`\n== content (word multiset over the whole document)`);
console.log(
  `   ${labelA}: ${aAll.length} words, ${onlyInA.length} not present anywhere in ${labelB}`,
);
console.log(
  `   ${labelB}: ${bAll.length} words, ${onlyInB.length} not present anywhere in ${labelA}`,
);
if (onlyInA.length) console.log(`   only in ${labelA}: ${onlyInA.slice(0, 30).join(" ")}`);
if (onlyInB.length) console.log(`   only in ${labelB}: ${onlyInB.slice(0, 30).join(" ")}`);

console.log(`\n== page alignment (by content, not by index)`);
console.log(
  `   ${matched.length} pages matched; only in ${labelA}: ${JSON.stringify(unmatchedA)}; ` +
    `only in ${labelB}: ${JSON.stringify(unmatchedB)}; weak matches (<0.7): ` +
    JSON.stringify(weakMatches.map((m) => `${m.a}~${m.b}@${m.score.toFixed(2)}`)),
);

console.log(`\n== page geometry on ALIGNED pages (ink width differs by >3pt)`);
if (!widthDiffs.length) console.log(`   none`);
for (const d of widthDiffs.slice(0, 12))
  console.log(
    `   ${labelA} p${d.page} / ${labelB} p${d.pageB}: ${d.aWidth}pt ${JSON.stringify(d.aBox)} vs ${d.bWidth}pt ${JSON.stringify(d.bBox)}`,
  );
if (widthDiffs.length > 12) console.log(`   … ${widthDiffs.length - 12} more`);

console.log(`\n== margin-box chrome (running head / folio) differs on ${chromeDiffs.length} pages`);
for (const d of chromeDiffs.slice(0, 10))
  console.log(
    `   ${labelA} p${d.page} / ${labelB} p${d.pageB}: head ${JSON.stringify(d.a.head)} vs ${JSON.stringify(d.b.head)}`,
  );

console.log(
  `\n== content on aligned pages: ${pageDiffs.length} pairs differ, first at ${labelA} p${firstDivergence}`,
);
for (const d of pageDiffs.slice(0, 10))
  console.log(
    `   p${d.page}~p${d.pageB} (${d.score}): only in ${labelA}: ${JSON.stringify(d.onlyInA.slice(0, 6))} | only in ${labelB}: ${JSON.stringify(d.onlyInB.slice(0, 6))}`,
  );
console.log(`\nwrote ${join(OUT, "diff-report.json")}`);
