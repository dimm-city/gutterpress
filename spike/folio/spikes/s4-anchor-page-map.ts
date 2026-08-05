/**
 * S4 (§11.4) — the Tier 3 measurement channel: can "which page is element X
 * on" be harvested from Chromium's OWN structural PDF metadata (link
 * annotations + document outline), with no text heuristics?
 *
 * Known to have regressed upstream in the past, hence the version pin + this
 * check in CI. Ground truth here is the PDF's text (an independent reader),
 * so a Chromium regression shows up as a failure rather than as silently
 * wrong cross-references.
 */
import { join } from "node:path";
import { launchChromium, type Browser } from "../src/shared/cdp.ts";
import { inspectPdf } from "../src/shared/pdf-inspect.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText } from "./probe.ts";

const TARGETS = 14;

function doc(): string {
  const blocks: string[] = [];
  for (let i = 1; i <= TARGETS; i++) {
    blocks.push(`<h2 id="t${i}">TARGET${i} Heading ${i}</h2>`);
    for (let j = 0; j < 4; j++)
      blocks.push(
        `<p>Body ${i}.${j} Aenean lacinia bibendum nulla sed consectetur donec ullamcorper nulla non metus auctor fringilla nullam quis risus eget urna.</p>`,
      );
  }
  const links = Array.from(
    { length: TARGETS },
    (_, i) => `<li><a href="#t${i + 1}">Link to target ${i + 1}</a></li>`,
  ).join("");
  return `<!doctype html><meta charset="utf-8"><style>
@page { size: 6in 9in; margin: 1in; @bottom-center { content: counter(page); } }
html { font: 11pt/1.4 'DejaVu Serif', serif; } body { margin: 0 }
h2 { margin: 14pt 0 6pt; font-size: 13pt; }
p { margin: 0 0 8pt; }
nav { break-before: page; }
</style>
<main>
${blocks.join("\n")}
<nav><h2 id="toc">Contents</h2><ul>${links}</ul></nav>
</main>`;
}

export async function run(browser: Browser) {
  const s = new Spike("s4-anchor-page-map", "anchor → page fidelity of Chromium's PDF metadata (§11.4)");
  const page = await browser.newPage();
  await page.setContent(doc());
  await page.waitForReady();
  const bytes = await page.printToPDF();
  const p = join(OUT_DIR, "s4-anchors.pdf");
  writeArtifact(p, bytes);

  const facts = await inspectPdf(bytes);
  const t = pdfText(p);

  // ground truth: where the target text actually printed
  const truth = new Map<number, number>();
  for (let i = 1; i <= TARGETS; i++) {
    const idx = t.pages.findIndex((pg) => pg.text.includes(`TARGET${i} `));
    truth.set(i, idx + 1);
  }

  s.check(
    "document outline records every heading with a page",
    facts.outline.length >= TARGETS,
    `${facts.outline.length} outline entries for ${TARGETS} targets`,
  );

  let outlineOk = 0;
  for (const entry of facts.outline) {
    const m = /TARGET(\d+)/.exec(entry.title);
    if (!m) continue;
    if (truth.get(Number(m[1])) === entry.page + 1) outlineOk++;
  }
  s.check(
    "outline page numbers match where the text actually printed",
    outlineOk === TARGETS,
    `${outlineOk}/${TARGETS} correct`,
  );

  // link annotations: every <a href="#..."> on the TOC page resolves to a page
  const annots = Object.entries(facts.linkTargets);
  s.check(
    "link annotations emitted for internal anchors",
    annots.length >= TARGETS,
    `${annots.length} link annotations`,
  );

  // Match annotation -> link text by rect: the TOC page's annots are ordered
  // top-to-bottom, exactly like the list items.
  const tocPage = t.pages.findIndex((pg) => pg.text.includes("Contents"));
  const tocWords = t.pages[tocPage].words.filter((w) => w.text === "target");
  const sorted = annots
    .map(([rect, target]) => ({ rect: rect.split(",").map(Number), target }))
    .sort((a, b) => b.rect[1] - a.rect[1]); // PDF y grows upward
  let annotOk = 0;
  for (let i = 0; i < Math.min(sorted.length, TARGETS); i++) {
    if (sorted[i].target + 1 === truth.get(i + 1)) annotOk++;
  }
  s.check(
    "link annotation destinations match the true target pages",
    annotOk === TARGETS,
    `${annotOk}/${TARGETS} correct (${tocWords.length} TOC entries on page ${tocPage + 1})`,
  );

  // Does Chromium emit a /Dests entry keyed by element id? And does it do so
  // for ids that nothing links to? This decides whether Tier 3 must inject
  // instrumentation links at all.
  const destKeys = Object.keys(facts.namedDests);
  let destOk = 0;
  for (let i = 1; i <= TARGETS; i++)
    if (facts.namedDests[`t${i}`] !== undefined && facts.namedDests[`t${i}`] + 1 === truth.get(i))
      destOk++;
  s.check(
    "/Dests name tree is keyed by element id and page-accurate",
    destOk === TARGETS,
    `${destOk}/${TARGETS} ids resolve to the right page (keys: ${destKeys.slice(0, 3).join(", ")}…)`,
  );

  const unlinked = doc().replace(
    /<nav>[\s\S]*<\/nav>/,
    '<nav><h2 id="toc">Contents</h2><p id="lonely">UNLINKED anchor with no link to it</p></nav>',
  );
  await page.setContent(unlinked);
  await page.waitForReady();
  const bytes2 = await page.printToPDF();
  writeArtifact(join(OUT_DIR, "s4-unlinked.pdf"), bytes2);
  const facts2 = await inspectPdf(bytes2);
  const emitsUnlinked = facts2.namedDests["lonely"] !== undefined;
  s.check(
    "unlinked ids are NOT in /Dests (so Tier 3 must instrument what it measures)",
    !emitsUnlinked,
    `ids in /Dests without an incoming link: ${emitsUnlinked ? "yes" : "no"} ` +
      `(${Object.keys(facts2.namedDests).length} entries)`,
  );
  s.note(
    "Tier 3 measurement channel is therefore: inject one zero-size <a href=\"#id\"> per " +
      "element whose page must be known, print once, read /Dests (keyed by id) — no rect " +
      "ordering, no text heuristics, no outline title matching.",
  );

  s.data = {
    truth: Object.fromEntries(truth),
    outline: facts.outline,
    namedDests: Object.keys(facts.namedDests).length,
    annotations: annots.length,
  };
  s.note(
    facts.namedDests && Object.keys(facts.namedDests).length
      ? `named destinations also present (${Object.keys(facts.namedDests).length})`
      : "no /Dests name tree — link annotations + outline are the only structural channels",
  );

  await page.close();
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
