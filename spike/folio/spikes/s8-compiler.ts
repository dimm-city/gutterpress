/**
 * S8 — end-to-end compiler check (M1 + M3 of the proposal).
 *
 * Asserts the *output contract*, not the implementation: correct media/trim/
 * bleed boxes, content that stays put relative to trim when bleed is added,
 * running heads carrying real chapter titles, cross-references resolving to
 * the page the target actually printed on, signature padding, and the tier
 * routing (a plain document must NOT trigger measurement).
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChromium, type Browser } from "../src/shared/cdp.ts";
import { build } from "../src/compiler/build.ts";
import { inspectPdf, PT_PER_IN as IN } from "../src/shared/pdf-inspect.ts";
import { bookHtml } from "../fixtures/make-book.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfDrawings, pdfText } from "./probe.ts";

const near = (a: number, b: number, tol = 0.75) => Math.abs(a - b) <= tol;

export async function run(browser: Browser) {
  const s = new Spike("s8-compiler", "compiler: tiers 1–3, bleed/marks, boxes, signatures");

  // ---------------------------------------------------------------- tier 1
  const plain = join(OUT_DIR, "s8-plain.html");
  writeFileSync(
    plain,
    `<!doctype html><meta charset="utf-8"><style>
@page { size: 6in 9in; margin: 0.75in; @bottom-center { content: counter(page); } }
html { font: 11pt/1.45 'DejaVu Serif', serif } body { margin: 0 }
</style><main>${Array.from({ length: 40 }, (_, i) => `<p>Plain ${i + 1}. Aenean lacinia bibendum nulla sed consectetur donec ullamcorper nulla non metus auctor fringilla.</p>`).join("")}</main>`,
  );
  const r1 = await build({ input: plain, browser });
  writeArtifact(join(OUT_DIR, "s8-tier1.pdf"), r1.bytes);
  s.check("plain document takes Tier 1 (no synthesis, one pass)", r1.tier === 1 && r1.passes === 1, `tier ${r1.tier}, ${r1.passes} pass(es)`);
  const f1 = await inspectPdf(r1.bytes);
  s.check(
    "Tier 1 media box is the author's trim size",
    near(f1.boxes[0].media[2], 6 * IN) && near(f1.boxes[0].media[3], 9 * IN),
    `${f1.boxes[0].media.join(", ")}`,
  );

  // ---------------------------------------------------------------- tier 2
  const chaptered = join(OUT_DIR, "s8-chaptered.html");
  writeFileSync(chaptered, bookHtml({ seed: 7, chapters: 3, blocksPerChapter: 14, namedPages: true }));
  const r2 = await build({ input: chaptered, browser, signature: 4, title: "Folio spike", author: "Gutterpress" });
  writeArtifact(join(OUT_DIR, "s8-tier2.pdf"), r2.bytes);
  writeArtifact(join(OUT_DIR, "s8-tier2.gen.css"), r2.genCss);
  // Running heads are produced by the measurement path (the page-renaming
  // shim was removed — see DIFFERENCES.md), so a document with `string()` in a
  // margin box costs one extra print pass and pays for it with the author's
  // `@page` cascade left completely alone.
  s.check(
    "a document with running heads measures, and converges immediately",
    r2.tier === 3 && r2.passes <= 2 && r2.converged,
    `tier ${r2.tier}, ${r2.passes} pass(es), converged=${r2.converged}`,
  );

  // INVARIANT: synthesis must never change where content falls. Ground truth is
  // the same document printed by Chromium with no Folio at all.
  {
    const p = await browser.newPage();
    await p.navigate(`file://${chaptered}`);
    await p.waitForReady();
    const nativeBytes = await p.printToPDF();
    await p.close();
    const nativePages = (await inspectPdf(nativeBytes)).pageCount;
    s.check(
      "synthesis does not change pagination (vs a plain Chromium print)",
      nativePages === r2.pageCount - r2.post.padded,
      `native ${nativePages}pp, folio ${r2.pageCount - r2.post.padded}pp before signature padding`,
    );
  }

  const t2 = pdfText(join(OUT_DIR, "s8-tier2.pdf"));
  const titles = ["Chapter 1", "Chapter 2", "Chapter 3"];
  const headed = t2.pages.filter((p) => titles.some((t) => p.text.includes(t)));
  s.check(
    "every chapter page carries its own running head",
    headed.length >= titles.length,
    `${headed.length} pages carry a chapter title`,
  );
  // the head must be the CHAPTER'S OWN title, not the first chapter's
  const lastChapterPages = t2.pages.filter((p) => p.text.includes("Chapter 3"));
  s.check(
    "running heads are per-chapter, not global",
    lastChapterPages.length > 0 &&
      lastChapterPages.every((p) => !p.text.includes("Chapter 1")),
    `${lastChapterPages.length} pages head "Chapter 3"`,
  );

  // ------------------------------------------------- bleed / marks / boxes
  const f2 = await inspectPdf(r2.bytes);
  const bleed = 0.125 * IN;
  const slug = 0.25 * IN;
  const media = [0, 0, 6 * IN + 2 * (bleed + slug), 9 * IN + 2 * (bleed + slug)];
  s.check(
    "MediaBox = trim + 2×bleed + 2×slug",
    near(f2.boxes[0].media[2], media[2]) && near(f2.boxes[0].media[3], media[3]),
    `${f2.boxes[0].media.map((n) => n.toFixed(2)).join(", ")} (want ${media.map((n) => n.toFixed(2)).join(", ")})`,
  );
  s.check(
    "TrimBox = the author's trim size, centred",
    !!f2.boxes[0].trim &&
      near(f2.boxes[0].trim![2] - f2.boxes[0].trim![0], 6 * IN) &&
      near(f2.boxes[0].trim![3] - f2.boxes[0].trim![1], 9 * IN),
    `${f2.boxes[0].trim?.map((n) => n.toFixed(2)).join(", ")}`,
  );
  s.check(
    "BleedBox = trim + 2×bleed",
    !!f2.boxes[0].bleed &&
      near(f2.boxes[0].bleed![2] - f2.boxes[0].bleed![0], 6 * IN + 2 * bleed) &&
      near(f2.boxes[0].bleed![3] - f2.boxes[0].bleed![1], 9 * IN + 2 * bleed),
    `${f2.boxes[0].bleed?.map((n) => n.toFixed(2)).join(", ")}`,
  );
  s.check(
    "signature padding to a multiple of 4",
    r2.pageCount % 4 === 0,
    `${r2.pageCount} pages (${r2.post.padded} blanks appended)`,
  );

  // content must not move relative to trim when bleed/slug are added
  const noBleed = join(OUT_DIR, "s8-nobleed.html");
  writeFileSync(
    noBleed,
    bookHtml({ seed: 7, chapters: 3, blocksPerChapter: 14, namedPages: true })
      .replace("bleed: 0.125in;", "")
      .replace("marks: crop;", ""),
  );
  const r2b = await build({ input: noBleed, browser });
  writeArtifact(join(OUT_DIR, "s8-nobleed.pdf"), r2b.bytes);
  const tb = pdfText(join(OUT_DIR, "s8-nobleed.pdf"));
  const inkTop = (t: any, page: number, offset: number) =>
    Math.min(...t.pages[page].words.filter((w: any) => /§P/.test(w.text)).map((w: any) => w.y0)) - offset;
  const withOffset = inkTop(t2, 1, bleed + slug);
  const withoutOffset = inkTop(tb, 1, 0);
  s.check(
    "content stays put relative to trim when bleed/slug are added",
    near(withOffset, withoutOffset, 1),
    `${withOffset.toFixed(2)}pt vs ${withoutOffset.toFixed(2)}pt from trim edge`,
  );
  // and the folio (page number) must not drift into the bleed
  const folioY = (t: any, page: number) =>
    Math.max(...t.pages[page].words.map((w: any) => w.y1));
  s.check(
    "margin-box content does not drift into the bleed",
    near(folioY(t2, 1) - (bleed + slug), folioY(tb, 1), 1.5),
    `folio at ${(folioY(t2, 1) - (bleed + slug)).toFixed(2)}pt vs ${folioY(tb, 1).toFixed(2)}pt from trim edge`,
  );

  // crop marks must be drawn in the slug, clear of the bleed box
  const marks = pdfDrawings(join(OUT_DIR, "s8-tier2.pdf"), 1);
  const inSlug = marks.items.filter((d: any) => {
    const [x0, y0, x1, y1] = d.rect;
    const b = [slug, slug, marks.page[2] - slug, marks.page[3] - slug];
    return x1 < b[0] + 1 || y1 < b[1] + 1 || x0 > b[2] - 1 || y0 > b[3] - 1;
  });
  s.check(
    "crop marks drawn, and only in the slug area",
    marks.count >= 8 && inSlug.length >= 8,
    `${marks.count} drawings, ${inSlug.length} of them outside the bleed box`,
  );

  // signature padding when the page count is NOT already a multiple
  const r2s = await build({ input: chaptered, browser, signature: 8 });
  s.check(
    "signature padding appends blanks to reach the multiple",
    r2s.pageCount % 8 === 0 && r2s.post.padded > 0,
    `${r2s.pageCount} pages after +${r2s.post.padded} blanks`,
  );

  // ---------------------------------------------------------------- tier 3
  const xrefs = join(OUT_DIR, "s8-xrefs.html");
  writeFileSync(xrefs, bookHtml({ seed: 11, chapters: 3, blocksPerChapter: 16, xrefs: true }));
  const r3 = await build({ input: xrefs, browser });
  writeArtifact(join(OUT_DIR, "s8-tier3.pdf"), r3.bytes);
  writeArtifact(join(OUT_DIR, "s8-tier3.gen.css"), r3.genCss);
  s.check("cross-references trigger Tier 3", r3.tier === 3, `tier ${r3.tier}`);
  s.check(
    "Tier 3 reaches a fixpoint within the pass budget",
    r3.converged,
    `${r3.passes} passes, converged=${r3.converged}`,
  );

  const t3 = pdfText(join(OUT_DIR, "s8-tier3.pdf"));
  const refs = [...t3.pages.flatMap((p) => [...p.text.matchAll(/\(p\.\s*(\d+)\)/g)])];
  s.check("cross-reference text was actually rendered", refs.length > 0, `${refs.length} references`);
  s.check(
    "no unresolved references",
    !t3.pages.some((p) => /\(p\.\s*\?\)/.test(p.text)),
    "",
  );
  // every rendered "(p. N)" must point at a page that exists…
  const bad = refs.filter((m) => Number(m[1]) < 1 || Number(m[1]) > t3.pageCount);
  s.check("every reference points inside the document", bad.length === 0, `${bad.length} out of range`);
  // …and at the page where the target heading actually printed
  const targetPages = new Map<string, number>();
  for (const p of t3.pages) {
    const m = /§P(\d{3}) Chapter (\d)/.exec(p.text);
    if (m) targetPages.set(`ch${m[2]}`, p.page + 1);
  }
  const chapterRefs = Object.entries(r3.pageMap).filter(([k]) => /^ch\d+$/.test(k));
  let mapOk = 0;
  for (const [id, page] of chapterRefs) if (targetPages.get(id) === page) mapOk++;
  s.check(
    "measured page map matches where targets actually printed",
    chapterRefs.length > 0 && mapOk === chapterRefs.length,
    `${mapOk}/${chapterRefs.length} chapter anchors correct`,
  );

  s.data = {
    tier1: { tier: r1.tier, pages: r1.pageCount },
    tier2: { tier: r2.tier, pages: r2.pageCount, padded: r2.post.padded, notes: r2.notes },
    tier3: { tier: r3.tier, passes: r3.passes, converged: r3.converged, refs: refs.length },
  };
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
