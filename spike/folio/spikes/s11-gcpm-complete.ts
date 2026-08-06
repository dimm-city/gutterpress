/**
 * S11 — GCPM completeness + measurement neutrality.
 *
 * Locks in the batch of fixes from the open-items investigation:
 *  1. leader() fills with measured glue — dots reach the number, nothing wraps.
 *  2. target-text() resolves in print.
 *  3. string(name, which) position keywords honoured by the compiler
 *     (`first-except` = the classic no-head-on-the-opener idiom).
 *  4. Instrumentation is invisible to hostile author CSS (`[id]` counters,
 *     ::before, a[href]::after) — measurement never mutates author-visible
 *     attributes, so no de-instrument pass and no final reprint exist.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { build } from "../../../packages/cli/src/engine/compiler/build.ts";
import { launchChromium, type Browser } from "../../../packages/cli/src/engine/shared/cdp.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText } from "./probe.ts";

const TITLES = [
  "Intro",
  "A Much Longer Chapter Title That Extends Quite Far Across the Line Indeed",
  "Creature Codex",
  "Colophon and Acknowledgements for the Second Printing",
];

export async function run(browser: Browser) {
  const s = new Spike("s11-gcpm-complete", "leaders, target-text, string(which), neutral measurement");

  // ---- one document exercising everything --------------------------------
  const doc = `<!doctype html><meta charset="utf-8"><style>
@page { size: 6in 9in; margin: 1in;
  @top-left  { content: string(t, first-except); font-size: 8pt; }
  @top-right { content: string(t, last); font-size: 8pt; }
  @bottom-center { content: counter(page); } }
html { font: 11pt/1.5 'DejaVu Serif', serif } body { margin: 0 }
ul.toc { list-style: none; margin: 0 0 12pt; padding: 0; }
li.toc { margin: 0 0 4pt; }
li.toc a { text-decoration: none; color: inherit; }
li.toc a::after { content: leader(".") " " target-counter(attr(href url), page); }
a.see::after { content: " [" target-text(attr(href url)) "]"; }
h1 { break-before: page; string-set: t content(); font-size: 14pt; }
/* hostile author CSS: any attribute folio touches becomes visible ink */
h1[id] { counter-increment: hostile; }
h1::before { content: counter(hostile) "· "; }
</style><main>
<ul class="toc">${TITLES.map((t, i) => `<li class="toc"><a href="#t${i + 1}">${t}</a></li>`).join("")}</ul>
<p>First see <a class="see" href="#t3">this</a>.</p>
${TITLES.map(
    (t, i) =>
      `<h1 id="t${i + 1}">${t}</h1>` +
      Array.from({ length: 14 }, (_, j) => `<p>Body ${i}.${j} Aenean lacinia bibendum nulla sed consectetur donec ullamcorper nulla non metus auctor fringilla.</p>`).join(""),
  ).join("")}
</main>`;
  const path = join(OUT_DIR, "s11-book.html");
  writeFileSync(path, doc);

  // baseline: the same document printed by plain Chromium, no folio at all —
  // the neutrality yardstick for anything measurement might have perturbed
  const basePage = await browser.newPage();
  await basePage.navigate(`file://${path}`);
  await basePage.waitForReady();
  writeArtifact(join(OUT_DIR, "s11-base.pdf"), await basePage.printToPDF());
  await basePage.close();
  const baseline = pdfText(join(OUT_DIR, "s11-base.pdf"));
  const hostileCounters = (t: { pages: Array<{ text: string }> }) =>
    t.pages.flatMap((p) => [...p.text.matchAll(/(\d+)·/g)]).map((m) => m[1]).join(",");

  const r = await build({ input: path, browser });
  writeArtifact(join(OUT_DIR, "s11.pdf"), r.bytes);
  const t = pdfText(join(OUT_DIR, "s11.pdf"));
  s.data.pages = t.pageCount;
  s.check("build converges", r.converged, `${r.passes} passes, ${t.pageCount} pages`);

  // ---- 1. leaders ---------------------------------------------------------
  const CONTENT_RIGHT = 360; // 6in page, 1in margins -> content right at 5in
  const tocPage = t.pages[0];
  let leaderOk = 0;
  const details: string[] = [];
  for (let i = 0; i < TITLES.length; i++) {
    // expected number = the page the chapter actually printed on
    const target = t.pages.findIndex(
      (p) =>
        p.text.replace(/\s+/g, " ").includes(TITLES[i]) &&
        p.text.includes(`Body ${i}.0`),
    ) + 1;
    const nums = tocPage.words.filter(
      (w) => new RegExp(`(^|\\.)${target}$`).test(w.text) && w.x1 > 250,
    );
    const best = nums.sort((a, b) => b.x1 - a.x1)[0];
    const slack = best ? CONTENT_RIGHT - best.x1 : NaN;
    const hasDots = tocPage.text.includes("....");
    if (best && slack > -0.5 && slack < 15 && hasDots) leaderOk++;
    details.push(`#${i + 1}->p${target}:${best ? slack.toFixed(1) + "pt" : "missing"}`);
  }
  s.check(
    "leader(): dots fill to the page number at the content edge",
    leaderOk === TITLES.length,
    `${leaderOk}/${TITLES.length} lines, slack ${details.join(" ")}`,
  );
  s.check(
    "leader(): no TOC line wraps from overfill",
    (() => {
      // every TOC li occupies its own y-band; count distinct bands with dots
      const dotWords = tocPage.words.filter((w) => /\.{4,}/.test(w.text));
      const bands = new Set(dotWords.map((w) => Math.round(w.y0 / 4)));
      return bands.size === dotWords.length && dotWords.length >= TITLES.length - 1;
    })(),
    "",
  );

  // ---- 2. target-text -----------------------------------------------------
  s.check(
    "target-text() renders the target's text",
    t.pages[0].text.includes("[Creature Codex]"),
    JSON.stringify(t.pages[0].text.match(/\[[^\]]*\]/)?.[0] ?? "missing"),
  );

  // ---- 3. string(name, which) --------------------------------------------
  // first-except: EMPTY on chapter openers, title elsewhere.
  const openerPages = TITLES.map((title) => t.pages.findIndex((p) => p.text.includes("· " + title.split(" ")[0])));
  const headAt = (pg: number, left: boolean) =>
    t.pages[pg]?.words.filter((w) => w.y1 < 72 && (left ? w.x0 < 200 : w.x0 >= 200)).map((w) => w.text).join(" ") ?? "";
  const openerIdx = t.pages.findIndex((p) => p.text.includes("Creature Codex") && p.text.includes("Body 2.0"));
  const bodyIdx = openerIdx + 1;
  s.check(
    "string(t, first-except) is empty on the opener, set on body pages",
    openerIdx > 0 && headAt(openerIdx, true) === "" && headAt(bodyIdx, true).includes("Creature"),
    `opener p${openerIdx + 1} left-head="${headAt(openerIdx, true)}", body p${bodyIdx + 1} left-head="${headAt(bodyIdx, true)}"`,
  );
  s.check(
    "string(t, last) shows the opener's own title on the opener page",
    headAt(openerIdx, false).includes("Creature"),
    `opener right-head="${headAt(openerIdx, false)}"`,
  );
  void openerPages;

  // ---- 4. measurement neutrality -----------------------------------------
  // The h1s carry AUTHOR ids, so `h1[id]` fires on the baseline too — the
  // requirement is that folio's measurement changes NOTHING relative to a
  // plain Chromium print of the same file.
  s.check(
    "hostile [id]/::before CSS renders identically to a folio-free print",
    hostileCounters(t) === hostileCounters(baseline),
    `folio: ${hostileCounters(t)} vs baseline: ${hostileCounters(baseline)}`,
  );
  s.check(
    "measurement did not change the page count vs the folio-free print",
    t.pageCount === baseline.pageCount,
    `folio ${t.pageCount}pp, baseline ${baseline.pageCount}pp`,
  );

  await Promise.resolve();
  return s.finish();
}

if (import.meta.main) {
  const b = await launchChromium();
  try {
    const r = await run(b);
    process.exitCode = r.verdict === "FAIL" ? 1 : 0;
  } finally {
    await b.close();
  }
}
