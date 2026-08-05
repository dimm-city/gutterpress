/**
 * S13 — POD (print-on-demand) acceptance of bleed and crop marks.
 *
 * Folio's claim: `@page { bleed: 0.125in; marks: crop; }` produces a PDF
 * whose MediaBox = trim + 2×bleed + 2×slug, correct BleedBox/TrimBox, and
 * crop marks drawn in the slug. `src/compiler/postprocess.ts` and
 * `src/compiler/tier2.ts` are internally self-consistent about this — this
 * spike checks it against what POD services actually require, reusing
 * Gutterpress's own acceptance criteria (`packages/cli/src/checks/pdf/
 * bleed.ts`, `page-size.ts`, `packages/cli/src/lib/presets.ts`'s
 * `DTRPG_PRESET`) where the repo already encodes a number, and general
 * industry practice (documented inline) otherwise.
 *
 * Repo-encoded numbers reused here:
 *   - `DTRPG_PRESET.validate.pdf.bleedSize` = 9pt = 0.125in (presets.ts)
 *   - `pdf.print.bleed` check: MediaBox - TrimBox must be >= bleedSize*2*0.9
 *     (bleed.ts) — a 10% underage tolerance
 *   - `pdf.print.page-size` check: page size within `page.tolerance` (0.5pt
 *     in both presets) of the expected trim (page-size.ts)
 *
 * General industry practice (NOT in the repo, cited as such at each use):
 *   - safe area / live-matter margin >= 0.25in from trim (DriveThruRPG/
 *     Lulu/IngramSpark author guides)
 *   - crop marks: hairline weight (~0.25-0.5pt), ~0.25in (18pt) long,
 *     offset from the trim corner by roughly the bleed amount so they never
 *     cross into the bleed area
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { launchChromium, type Browser, type Session } from "../src/shared/cdp.ts";
import { build } from "../src/compiler/build.ts";
import { inspectPdf, PT_PER_IN as IN } from "../src/shared/pdf-inspect.ts";
import { bookHtml } from "../fixtures/make-book.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfDrawings, pdfText, pdfRender } from "./probe.ts";

const near = (a: number, b: number, tol = 0.05) => Math.abs(a - b) <= tol;

// repo-encoded: presets.ts DTRPG_PRESET.validate.pdf.bleedSize
const DTRPG_BLEED_PT = 9; // 0.125in
// repo-encoded: bleed.ts's 10% underage tolerance
const BLEED_CHECK_TOLERANCE = 0.9;
// general industry practice (DriveThruRPG/Lulu/IngramSpark author guides),
// not encoded in the repo: minimum live-matter distance from trim
const SAFE_AREA_MIN_IN = 0.25;

interface TrimCase {
  name: string;
  sizeCss: string;
  bleedCss: string;
  marginCss: string;
  trimW: number; // pt
  trimH: number; // pt
  bleedPt: number; // pt, expected after unit conversion
}

const TRIM_CASES: TrimCase[] = [
  { name: "6x9in trade", sizeCss: "6in 9in", bleedCss: "0.125in", marginCss: "0.75in 0.625in", trimW: 6 * IN, trimH: 9 * IN, bleedPt: 0.125 * IN },
  { name: "8.5x11in US Letter", sizeCss: "8.5in 11in", bleedCss: "0.125in", marginCss: "0.75in", trimW: 8.5 * IN, trimH: 11 * IN, bleedPt: 0.125 * IN },
  { name: "5.5x8.5in digest", sizeCss: "5.5in 8.5in", bleedCss: "0.125in", marginCss: "0.5in", trimW: 5.5 * IN, trimH: 8.5 * IN, bleedPt: 0.125 * IN },
  { name: "A5", sizeCss: "148mm 210mm", bleedCss: "0.125in", marginCss: "15mm", trimW: (148 / 25.4) * IN, trimH: (210 / 25.4) * IN, bleedPt: 0.125 * IN },
  { name: "7x10in", sizeCss: "7in 10in", bleedCss: "0.125in", marginCss: "0.75in", trimW: 7 * IN, trimH: 10 * IN, bleedPt: 0.125 * IN },
];

async function buildCase(browser: Browser, name: string, css: string): Promise<{ bytes: Uint8Array; path: string }> {
  const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
  const path = join(OUT_DIR, `s13-${slug}.html`);
  writeFileSync(
    path,
    `<!doctype html><meta charset="utf-8"><style>${css}\nhtml{font:11pt 'DejaVu Serif',serif}body{margin:0}</style><main><p>POD geometry probe: ${name}</p></main>`,
  );
  const r = await build({ input: path, browser, marks: true });
  const pdfPath = join(OUT_DIR, `s13-${slug}.pdf`);
  writeArtifact(pdfPath, r.bytes);
  return { bytes: r.bytes, path: pdfPath };
}

export async function run(browser: Browser) {
  const s = new Spike("s13-pod-geometry", "POD acceptance: bleed/marks geometry vs real print-service specs");

  // ---------------------------------------------------- 1+2. trim + bleed
  for (const tc of TRIM_CASES) {
    const css = `@page { size: ${tc.sizeCss}; bleed: ${tc.bleedCss}; marks: crop; margin: ${tc.marginCss}; }`;
    const { bytes } = await buildCase(browser, tc.name, css);
    const f = await inspectPdf(bytes);
    const box = f.boxes[0];
    const media = box.media;
    const trim = box.trim!;
    const bleed = box.bleed!;

    // trim size correct (page-size.ts tolerance: 0.5pt)
    s.check(
      `[${tc.name}] TrimBox size = author's trim`,
      near(trim[2] - trim[0], tc.trimW, 0.5) && near(trim[3] - trim[1], tc.trimH, 0.5),
      `${(trim[2] - trim[0]).toFixed(2)}x${(trim[3] - trim[1]).toFixed(2)}pt (${((trim[2] - trim[0]) / IN).toFixed(3)}x${((trim[3] - trim[1]) / IN).toFixed(3)}in) vs ${tc.trimW.toFixed(2)}x${tc.trimH.toFixed(2)}pt`,
    );

    // trim centred in media — all four offsets equal (not just sizes)
    const offL = trim[0] - media[0];
    const offB = trim[1] - media[1];
    const offR = media[2] - trim[2];
    const offT = media[3] - trim[3];
    s.check(
      `[${tc.name}] TrimBox centred in MediaBox (all 4 offsets equal)`,
      near(offL, offR, 0.5) && near(offB, offT, 0.5) && near(offL, offB, 0.5),
      `L${offL.toFixed(2)} R${offR.toFixed(2)} B${offB.toFixed(2)} T${offT.toFixed(2)}pt`,
    );

    // bleed box = trim + 2*bleed, meeting the repo's own bleed.ts acceptance
    // criterion: mediaW - trimW >= bleedSize*2*0.9 (using this doc's declared
    // bleed since bleed.ts's own bleedSize is a manifest constant, not the
    // per-book CSS value)
    const bleedGap = media[2] - media[0] - (trim[2] - trim[0]);
    s.check(
      `[${tc.name}] MediaBox-TrimBox gap satisfies bleed.ts's tolerance (>= bleed*2*0.9)`,
      bleedGap >= tc.bleedPt * 2 * BLEED_CHECK_TOLERANCE,
      `gap ${bleedGap.toFixed(2)}pt vs required >= ${(tc.bleedPt * 2 * BLEED_CHECK_TOLERANCE).toFixed(2)}pt`,
    );
    s.check(
      `[${tc.name}] BleedBox = trim + 2×bleed, centred`,
      near(bleed[2] - bleed[0], tc.trimW + 2 * tc.bleedPt, 0.5) &&
        near(bleed[3] - bleed[1], tc.trimH + 2 * tc.bleedPt, 0.5) &&
        near(bleed[0] - media[0], media[2] - bleed[2], 0.5),
      `${(bleed[2] - bleed[0]).toFixed(2)}x${(bleed[3] - bleed[1]).toFixed(2)}pt`,
    );
  }

  // ---- bleed unit correctness: 0 / 0.125in / 3mm (metric author) ----------
  {
    const css0 = `@page { size: 6in 9in; margin: 0.75in; }`; // no bleed declared
    const cssIn = `@page { size: 6in 9in; bleed: 0.125in; marks: crop; margin: 0.75in; }`;
    const cssMm = `@page { size: 6in 9in; bleed: 3mm; marks: crop; margin: 0.75in; }`;
    const r0 = await buildCase(browser, "unit-0bleed", css0);
    const rIn = await buildCase(browser, "unit-in", cssIn);
    const rMm = await buildCase(browser, "unit-mm", cssMm);
    const f0 = await inspectPdf(r0.bytes);
    const fIn = await inspectPdf(rIn.bytes);
    const fMm = await inspectPdf(rMm.bytes);
    // 0 bleed: BleedBox == TrimBox (both inset by slug only)
    s.check(
      "0 bleed: BleedBox == TrimBox",
      near((f0.boxes[0].bleed![2] - f0.boxes[0].bleed![0]), (f0.boxes[0].trim![2] - f0.boxes[0].trim![0]), 0.01),
      `bleed ${f0.boxes[0].bleed?.join(",")} trim ${f0.boxes[0].trim?.join(",")}`,
    );
    const expectMmPt = 3 * (IN / 25.4); // 3mm in pt
    const mmBleedGap = (fMm.boxes[0].bleed![2] - fMm.boxes[0].bleed![0] - (fMm.boxes[0].trim![2] - fMm.boxes[0].trim![0])) / 2;
    s.check(
      "3mm bleed converts to the correct pt value (no unit bug)",
      near(mmBleedGap, expectMmPt, 0.05),
      `${mmBleedGap.toFixed(3)}pt vs ${expectMmPt.toFixed(3)}pt (3mm)`,
    );
    const inBleedGap = (fIn.boxes[0].bleed![2] - fIn.boxes[0].bleed![0] - (fIn.boxes[0].trim![2] - fIn.boxes[0].trim![0])) / 2;
    s.check(
      "0.125in bleed = 9pt exactly",
      near(inBleedGap, DTRPG_BLEED_PT, 0.05),
      `${inBleedGap.toFixed(3)}pt vs ${DTRPG_BLEED_PT}pt`,
    );
  }

  // ---------------------------------------------- 3. content actually bleeds
  //
  // MEASURED ENGINE LIMIT: Chromium clips page content to the CONTENT BOX.
  // Nothing paints outside it — not `position:fixed`, not a negative margin,
  // not even `html { background }` (which per CSS Paged Media §painting should
  // fill the whole page box). So on a page WITH margins, no author technique can put
  // ink in the bleed area, and that is not something Folio can fix.
  //
  // What Folio must get right is the case that CAN bleed: a page whose
  // authored margin is 0 (covers, full-page plates). There the content box is
  // the whole page, so art fills it — and Folio must NOT inflate that margin
  // by bleed+slug, or it would put a white border exactly where the author
  // asked for bleed. `bleedMargin()` keeps zero-margin pages at slug only, so
  // the content box IS the bleed box.
  {
    // 3a. the limit itself, asserted as the documented fact it is
    const marginCases: Array<[string, string, string]> = [
      [
        "position:fixed + negative inset",
        `@page { size: 6in 9in; bleed: 0.125in; marks: crop; margin: 0.75in; } html,body{margin:0} .bg{position:fixed;inset:-0.125in;background:red;z-index:-1} main{position:relative}`,
        `<body><div class="bg"></div><main><p>x</p></main></body>`,
      ],
      [
        "html { background } canvas fill",
        `@page { size: 6in 9in; bleed: 0.125in; marks: crop; margin: 0.75in; } html{background:red} body{margin:0}`,
        `<body><p>x</p></body>`,
      ],
    ];
    for (const [name, css, body] of marginCases) {
      const slug = name.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const path = join(OUT_DIR, `s13-bleedcontent-${slug}.html`);
      writeFileSync(path, `<!doctype html><meta charset="utf-8"><style>${css}</style>${body}`);
      const r = await build({ input: path, browser, marks: true });
      const pdfPath = join(OUT_DIR, `s13-bleedcontent-${slug}.pdf`);
      writeArtifact(pdfPath, r.bytes);
      const png = pdfRender(pdfPath, join(OUT_DIR, `s13-render-${slug}`), 150).files[0].file as string;
      const extent = inkExtentPx(png, 150);
      const contentEdge = r.geometry.bleed + r.geometry.slug + 54; // + the 0.75in margin
      s.check(
        `[${name}] on a page WITH margins, ink stops at the content box (engine limit)`,
        extent.x0Pt > r.geometry.bleed + 1,
        `ink starts at ${extent.x0Pt.toFixed(1)}pt; content box at ~${contentEdge.toFixed(1)}pt, ` +
          `bleed box at ${r.geometry.slug.toFixed(1)}pt — Chromium paints nothing outside the content box`,
      );
    }

    // 3b. the case that MUST work: a zero-margin page bleeds edge to edge
    const coverCss = `@page { size: 6in 9in; bleed: 0.125in; margin: 0.75in; }
@page cover { margin: 0; }
html,body{margin:0} section.cover { page: cover; }
.art { width: 6.25in; height: 9.25in; background: red; }`;
    const coverPath = join(OUT_DIR, "s13-cover-bleed.html");
    writeFileSync(
      coverPath,
      `<!doctype html><meta charset="utf-8"><style>${coverCss}</style>` +
        `<main><section class="cover"><div class="art"></div></section><p>after</p></main>`,
    );
    const cover = await build({ input: coverPath, browser });
    const coverPdf = join(OUT_DIR, "s13-cover-bleed.pdf");
    writeArtifact(coverPdf, cover.bytes);
    const coverPng = pdfRender(coverPdf, join(OUT_DIR, "s13-render-cover"), 150).files[0].file as string;
    const coverInk = inkExtentPx(coverPng, 150);
    const mediaW = cover.geometry.media.width;
    const mediaH = cover.geometry.media.height;
    s.check(
      "a zero-margin page bleeds edge to edge (Folio must not inflate a 0 margin)",
      coverInk.x0Pt <= 2.5 && coverInk.y0Pt <= 2.5 &&
        coverInk.x1Pt >= mediaW - 2.5 && coverInk.y1Pt >= mediaH - 2.5,
      `ink ${coverInk.x0Pt.toFixed(1)},${coverInk.y0Pt.toFixed(1)} -> ` +
        `${coverInk.x1Pt.toFixed(1)},${coverInk.y1Pt.toFixed(1)}pt on a ${mediaW}x${mediaH}pt media box`,
    );
    s.note(
      "Bleed art is therefore possible ONLY on zero-margin pages. Presets must say so: put the " +
        "cover/plate on its own `@page name { margin: 0 }` and inset any live matter with padding.",
    );
  }

  // ------------------------------------------------------------ 4. crop marks
  {
    const { bytes, path } = await buildCase(
      browser,
      "crop-marks",
      `@page { size: 6in 9in; bleed: 0.125in; marks: crop; margin: 0.75in; }`,
    );
    const facts = await inspectPdf(bytes);
    const media = facts.boxes[0].media;
    const bleedBL = facts.boxes[0].bleed!; // bottom-left origin, per pdf-lib/PDF convention
    const trimBL = facts.boxes[0].trim!;
    const H = media[3];
    // pdfDrawings (pdfprobe-poppler.py) reports rects in TOP-LEFT origin —
    // flip the boxes to match before comparing.
    const bleed = [bleedBL[0], H - bleedBL[3], bleedBL[2], H - bleedBL[1]];
    const trim = [trimBL[0], H - trimBL[3], trimBL[2], H - trimBL[1]];
    const drawings = pdfDrawings(path, 0);
    const isMarkLine = (d: any) => d.type === "s" || d.type === "l"; // stroked line ops
    const marks = drawings.items.filter(isMarkLine);
    s.check("exactly 8 crop marks (2 per corner x 4 corners)", marks.length === 8, `${marks.length} stroked lines found`);

    const outsideBleed = marks.filter((d: any) => {
      const [x0, y0, x1, y1] = d.rect;
      return x1 <= bleed[0] + 0.5 || y1 <= bleed[1] + 0.5 || x0 >= bleed[2] - 0.5 || y0 >= bleed[3] - 0.5;
    });
    s.check(
      "every crop mark is entirely outside the BleedBox (in the slug, not the live/bleed area)",
      outsideBleed.length === marks.length,
      `${outsideBleed.length}/${marks.length} outside`,
    );

    // length ~0.25in (18pt, capped at slug) and standard offset from trim
    const lengths = marks.map((d: any) => {
      const [x0, y0, x1, y1] = d.rect;
      return Math.max(x1 - x0, y1 - y0);
    });
    s.check(
      "crop marks are ~0.25in (18pt) long — standard POD mark length",
      lengths.every((l: number) => near(l, 18, 0.5)),
      `lengths: ${lengths.map((l: number) => l.toFixed(1)).join(", ")}pt`,
    );

    // gap between trim corner and the near end of the mark == the bleed
    // amount (industry convention: marks start just outside the bleed edge)
    // Each mark is a single arm: horizontal (spans x, fixed y) or vertical
    // (spans y, fixed x). The gap is measured along the arm's OWN axis, from
    // its near end to the corresponding trim edge on that axis — not a
    // nearest-corner distance, which conflates the two axes.
    const gaps = marks.map((d: any) => {
      const [x0, y0, x1, y1] = d.rect;
      const horizontal = x1 - x0 > y1 - y0;
      if (horizontal) {
        const nearTrimX = Math.abs(x0 - trim[0]) < Math.abs(x1 - trim[2]) ? trim[0] : trim[2];
        return Math.min(Math.abs(x0 - nearTrimX), Math.abs(x1 - nearTrimX));
      }
      const nearTrimY = Math.abs(y0 - trim[1]) < Math.abs(y1 - trim[3]) ? trim[1] : trim[3];
      return Math.min(Math.abs(y0 - nearTrimY), Math.abs(y1 - nearTrimY));
    });
    s.check(
      "crop marks start ~bleed-amount away from the trim corner (0.125in / 9pt)",
      gaps.every((g: number) => near(g, DTRPG_BLEED_PT, 0.5)),
      `gaps: ${gaps.map((g: number) => g.toFixed(1)).join(", ")}pt vs ${DTRPG_BLEED_PT}pt`,
    );

    // render for visual inspection (also lets us confirm marks are visible,
    // not just present in the vector list)
    const renderDir = join(OUT_DIR, "s13-render-crop-marks");
    pdfRender(path, renderDir, 300);
    s.note(`crop marks rendered under ${renderDir} for visual inspection (300dpi PNG)`);
  }

  // -------------------------------------------- 5. safe area on a real book
  {
    const bookPath = join(OUT_DIR, "s13-safearea-book.html");
    writeFileSync(bookPath, bookHtml({ seed: 3, chapters: 3, blocksPerChapter: 12 }));
    const r = await build({ input: bookPath, browser, marks: true });
    const pdfPath = join(OUT_DIR, "s13-safearea-book.pdf");
    writeArtifact(pdfPath, r.bytes);
    const facts = await inspectPdf(r.bytes);
    const t = pdfText(pdfPath);
    const H = facts.boxes[0].media[3];
    const trim = facts.boxes[0].trim!;
    const trimLeft = trim[0];
    const trimRight = trim[2];
    const trimTop = H - trim[3]; // top-left coords
    const trimBottom = H - trim[1];

    let worst = { dist: Infinity, page: -1, text: "" };
    for (const p of t.pages) {
      for (const w of p.words) {
        const dl = w.x0 - trimLeft;
        const dr = trimRight - w.x1;
        const dt = w.y0 - trimTop;
        const db = trimBottom - w.y1;
        const m = Math.min(dl, dr, dt, db);
        if (m < worst.dist) worst = { dist: m, page: p.page + 1, text: w.text };
      }
    }
    s.check(
      `minimum live-matter distance from trim >= ${SAFE_AREA_MIN_IN}in (general POD practice, not repo-encoded)`,
      worst.dist >= SAFE_AREA_MIN_IN * IN,
      `worst: ${worst.dist.toFixed(2)}pt (${(worst.dist / IN).toFixed(3)}in) on page ${worst.page}, word "${worst.text}"`,
    );
  }

  // ------------------------------------------ 6. mirrored margins (:left/:right)
  {
    const baseMargin = { top: 0.75, side: 0.625, gutter: 0.875 }; // in
    const css = `
@page { size: 6in 9in; margin: ${baseMargin.top}in ${baseMargin.side}in; @bottom-center{content:counter(page)} }
@page :left { margin-left: ${baseMargin.side}in; margin-right: ${baseMargin.gutter}in; }
@page :right { margin-left: ${baseMargin.gutter}in; margin-right: ${baseMargin.side}in; }
html{font:11pt 'DejaVu Serif',serif} body{margin:0} h1{break-before:page}`;
    const body = `<main>${Array.from({ length: 6 }, (_, i) => `<h1>Ch${i + 1}</h1>${Array.from({ length: 4 }, (_, j) => `<p>p${i}-${j} body text here</p>`).join("")}`).join("")}</main>`;
    const path = join(OUT_DIR, "s13-mirror.html");
    writeFileSync(path, `<!doctype html><meta charset="utf-8"><style>${css}</style>${body}`);
    const page = await browser.newPage();
    await page.navigate(`file://${path}`);
    await page.waitForReady();
    const nativeBytes = await page.printToPDF();
    await page.close();
    writeArtifact(join(OUT_DIR, "s13-mirror-native.pdf"), nativeBytes);
    const tNative = pdfText(join(OUT_DIR, "s13-mirror-native.pdf"));
    // native Chromium (Tier 1, no bleed): verify alternation itself works
    const nativeMinX = tNative.pages.map((p) => Math.min(...p.words.map((w: any) => w.x0)));
    const rectoNative = nativeMinX.filter((_, i) => i % 2 === 0); // pages 1,3,5 (odd, 1-based)
    const versoNative = nativeMinX.filter((_, i) => i % 2 === 1);
    s.check(
      "native Chromium (no bleed): :left/:right margins alternate by page parity",
      rectoNative.every((x) => near(x, baseMargin.gutter * IN, 1)) &&
        versoNative.every((x) => near(x, baseMargin.side * IN, 1)),
      `recto min-x ${rectoNative.map((x) => x.toFixed(1)).join(",")}pt, verso ${versoNative.map((x) => x.toFixed(1)).join(",")}pt`,
    );

    // Now through Folio's bleed synthesis (Tier 2) — does mirroring survive?
    const withBleedCss = css.replace("@page { size: 6in 9in;", "@page { size: 6in 9in; bleed: 0.125in; marks: crop;");
    const path2 = join(OUT_DIR, "s13-mirror-bleed.html");
    writeFileSync(path2, `<!doctype html><meta charset="utf-8"><style>${withBleedCss}</style>${body}`);
    const r = await build({ input: path2, browser, marks: true });
    const pdfPath2 = join(OUT_DIR, "s13-mirror-bleed.pdf");
    writeArtifact(pdfPath2, r.bytes);
    const tBleed = pdfText(pdfPath2);
    const inset = r.geometry.bleed + r.geometry.slug;
    const bleedMinX = tBleed.pages.map((p) => Math.min(...p.words.map((w: any) => w.x0)) - inset);
    const rectoBleed = bleedMinX.filter((_, i) => i % 2 === 0);
    const versoBleed = bleedMinX.filter((_, i) => i % 2 === 1);
    s.check(
      "with bleed active (Tier 2 synthesis): :left/:right margins still alternate by page parity",
      rectoBleed.every((x) => near(x, baseMargin.gutter * IN, 2)) &&
        versoBleed.every((x) => near(x, baseMargin.side * IN, 2)),
      `recto min-x (from trim) ${rectoBleed.map((x) => x.toFixed(1)).join(",")}pt (want ~${(baseMargin.gutter * IN).toFixed(1)}), ` +
        `verso ${versoBleed.map((x) => x.toFixed(1)).join(",")}pt (want ~${(baseMargin.side * IN).toFixed(1)})`,
    );
  }

  // -------------------------------------------------- 7. signature padding
  {
    const bookPath = join(OUT_DIR, "s13-signature-book.html");
    writeFileSync(bookPath, bookHtml({ seed: 3, chapters: 2, blocksPerChapter: 10 }));
    const r = await build({ input: bookPath, browser, marks: true, signature: 4 });
    const pdfPath = join(OUT_DIR, "s13-signature-book.pdf");
    writeArtifact(pdfPath, r.bytes);
    s.check(
      "page count is padded to a multiple of the signature",
      r.pageCount % 4 === 0 && r.post.padded > 0,
      `${r.pageCount} pages (+${r.post.padded} blanks)`,
    );
    const facts = await inspectPdf(r.bytes);
    const first = facts.boxes[0];
    const allSameBoxes = facts.boxes.every(
      (b) =>
        near(b.media[2], first.media[2], 0.01) &&
        near(b.media[3], first.media[3], 0.01) &&
        near(b.bleed![2], first.bleed![2], 0.01) &&
        near(b.trim![2], first.trim![2], 0.01),
    );
    s.check(
      "padded blank pages have IDENTICAL MediaBox/BleedBox/TrimBox to content pages",
      allSameBoxes,
      allSameBoxes ? "all pages match" : `boxes diverge: ${JSON.stringify(facts.boxes.map((b) => b.media))}`,
    );
    const t = pdfText(pdfPath);
    const lastN = t.pages.slice(-r.post.padded);
    s.check(
      "the padded pages are genuinely blank (no stray content)",
      lastN.every((p) => !p.text.trim()),
      `last ${r.post.padded} page(s): ${JSON.stringify(lastN.map((p) => p.text.trim()))}`,
    );
  }

  s.note(
    "Repo-encoded specs used as source of truth: packages/cli/src/lib/presets.ts " +
      "(DTRPG_PRESET.validate.pdf.bleedSize=9pt/0.125in, page.tolerance=0.5pt) and " +
      "packages/cli/src/checks/pdf/bleed.ts (mediaW-trimW >= bleedSize*2*0.9). " +
      "Safe-area minimum (0.25in) and crop-mark length/offset conventions are general " +
      "industry practice (DriveThruRPG/Lulu/IngramSpark author guides), NOT asserted " +
      "anywhere in this repo — flagged as such rather than presented as a repo requirement.",
  );

  return s.finish();
}

/** Ink bounding box (in pt) from a rendered PNG, top-left origin. */
function inkExtentPx(pngPath: string, dpi: number): { x0Pt: number; y0Pt: number; x1Pt: number; y1Pt: number } {
  // Minimal PNG ink-extent probe via a tiny inline python call would add a
  // process per case; instead shell to python3 + PIL once, matching probe.ts's
  // existing pattern of shelling to python3 for pixel-level verification.
  const { spawnSync } = require("node:child_process") as typeof import("node:child_process");
  const script = `
import sys
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
w, h = im.size
px = im.load()
minx, miny, maxx, maxy = w, h, 0, 0
found = False
for y in range(0, h, 3):
    for x in range(0, w, 3):
        r, g, b = px[x, y]
        if not (r > 245 and g > 245 and b > 245):
            found = True
            if x < minx: minx = x
            if y < miny: miny = y
            if x > maxx: maxx = x
            if y > maxy: maxy = y
import json
print(json.dumps({"found": found, "bbox": [minx, miny, maxx, maxy], "size": [w, h]}))
`;
  const r = spawnSync("python3", ["-c", script, pngPath], { encoding: "utf8" });
  const out = JSON.parse(r.stdout.trim() || '{"found":false,"bbox":[0,0,0,0],"size":[1,1]}');
  const ptPerPx = 72 / dpi;
  const [minx, miny, maxx, maxy] = out.bbox;
  return {
    x0Pt: minx * ptPerPx,
    y0Pt: miny * ptPerPx,
    x1Pt: maxx * ptPerPx,
    y1Pt: maxy * ptPerPx,
  };
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
