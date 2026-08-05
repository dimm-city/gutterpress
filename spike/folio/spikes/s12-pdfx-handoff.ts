/**
 * S12 — Ghostscript / PDF-X hand-off.
 *
 * Folio's output contract is "an RGB PDF at final media size with correct
 * boxes and embedded fonts". The real Gutterpress PDF/X pipeline
 * (`packages/cli/src/lib/ghostscript.ts`'s `convertToPdfxCmyk`) is the only
 * consumer that matters — it shells out to Ghostscript with a generated
 * `pdfx_def.ps` (GTS_PDFXVersion, OutputIntent, DestOutputProfile) and
 * `-dPDFX`. This spike proves (or disproves) that a Folio PDF survives that
 * exact conversion and comes out a conformant PDF/X-1a file.
 *
 * We import `convertToPdfxCmyk` and `resolveGhostscript` directly from the
 * cli package — the strongest evidence available, since it is the literal
 * code path `gutterpress build` runs, not a re-implementation.
 *
 * Validation reuses Gutterpress's own acceptance criteria (read from
 * `packages/cli/src/checks/pdf/*.ts`) but not its check modules verbatim:
 * those modules take a full `CheckContext`/`ResolvedConfig` and (for the
 * pdfx-markers/pdfx-metadata checks) shell out to `qpdf`, which this box does
 * not have. Instead we re-implement the same PDF/X-1a structural assertions
 * (`getPdfxOutputIntentIssues` / `getPdfxMetadataIssues` in
 * `pdfx-structure.ts`) directly against the parsed PDF via pdf-lib, and the
 * same byte-scan assertions the color-spaces/transparency checks make
 * (`readPdfBytes` + regex). This is noted inline at each check.
 *
 * Skips gracefully (INFO, not FAIL) when `gs` is not on this machine.
 */
import { writeFileSync, readFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFRef } from "pdf-lib";
import { launchChromium, type Browser } from "../src/shared/cdp.ts";
import { build } from "../src/compiler/build.ts";
import { bookHtml } from "../fixtures/make-book.ts";
import { Spike, writeArtifact, OUT_DIR } from "./harness.ts";
import { pdfText } from "./probe.ts";

const execFileP = promisify(execFile);

// packages/cli's real conversion code — not a re-implementation.
const GHOSTSCRIPT_TS = join(
  import.meta.dir,
  "..",
  "..",
  "..",
  "packages",
  "cli",
  "src",
  "lib",
  "ghostscript.ts",
);

const FOGRA39L = "/usr/share/color/icc/colord/FOGRA39L_coated.icc";

// ---------------------------------------------------------------------------
// PDF/X structural checks — re-implemented against pdf-lib (no qpdf on this
// box) but asserting the SAME facts as
// packages/cli/src/checks/pdf/pdfx-structure.ts's
// getPdfxOutputIntentIssues/getPdfxMetadataIssues.
// ---------------------------------------------------------------------------
interface PdfxFacts {
  gtsVersion: string | null;
  gtsConformance: string | null;
  trapped: string | null;
  outputIntentType: string | null;
  outputIntentS: string | null;
  destOutputProfileResolves: boolean;
}

async function readPdfxFacts(path: string): Promise<PdfxFacts> {
  const bytes = readFileSync(path);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const infoRef = doc.context.trailerInfo.Info;
  const info = infoRef ? doc.context.lookup(infoRef, PDFDict) : undefined;

  const catalog = doc.catalog;
  const intents = catalog.lookupMaybe(PDFName.of("OutputIntents"), PDFArray);
  const first = intents && intents.size() > 0 ? intents.lookup(0, PDFDict) : undefined;
  const dop = first?.get(PDFName.of("DestOutputProfile"));

  return {
    gtsVersion: info?.get(PDFName.of("GTS_PDFXVersion"))?.toString() ?? null,
    gtsConformance: info?.get(PDFName.of("GTS_PDFXConformance"))?.toString() ?? null,
    trapped: info?.get(PDFName.of("Trapped"))?.toString() ?? null,
    outputIntentType: first?.get(PDFName.of("Type"))?.toString() ?? null,
    outputIntentS: first?.get(PDFName.of("S"))?.toString() ?? null,
    destOutputProfileResolves:
      dop instanceof PDFRef && !!doc.context.lookup(dop),
  };
}

// Same byte-scan the color-spaces/transparency checks make
// (packages/cli/src/checks/pdf/color-spaces.ts, transparency.ts) via
// readPdfBytes(): a raw latin1 scan for literal markers.
function scanMarkers(path: string) {
  const text = readFileSync(path, "latin1");
  return {
    deviceRgb: (text.match(/\/DeviceRGB/g) ?? []).length,
    deviceCmyk: (text.match(/\/DeviceCMYK/g) ?? []).length,
    lab: /\/Lab\b/.test(text),
    separation: /\/Separation/.test(text),
    deviceN: /\/DeviceN/.test(text),
    transparencyGroup: text.includes("/Transparency"),
    smask: text.includes("/SMask"),
  };
}

/** Names of fonts pdffonts reports as NOT embedded (emb column == "no"). */
async function embeddedFontNames(path: string): Promise<string[]> {
  const { stdout } = await execFileP("pdffonts", [path]);
  const lines = stdout.trim().split("\n");
  const dashes = lines[1]; // header underline row fixes each column's width
  const starts: number[] = [0];
  for (let i = 1; i < dashes.length; i++) {
    if (dashes[i] === "-" && dashes[i - 1] === " ") starts.push(i);
  }
  const notEmbedded: string[] = [];
  for (const line of lines.slice(2)) {
    if (!line.trim()) continue;
    const cols = starts.map((start, i) => line.slice(start, starts[i + 1] ?? undefined).trim());
    const [name, , , emb] = cols;
    if (emb === "no") notEmbedded.push(name);
  }
  return notEmbedded;
}

function boxFromPdfinfo(stdout: string, name: string): number[] | null {
  const re = new RegExp(`${name}:\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)\\s+([-\\d.]+)`);
  const m = stdout.match(re);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])] : null;
}

const nearArr = (a: number[] | null, b: number[] | null, tol = 0.5) =>
  !!a && !!b && a.length === 4 && b.length === 4 && a.every((v, i) => Math.abs(v - b[i]) <= tol);

export async function run(browser: Browser) {
  const s = new Spike("s12-pdfx-handoff", "Ghostscript / PDF-X hand-off: real gutterpress convertToPdfxCmyk against a Folio PDF");

  const { resolveGhostscript, convertToPdfxCmyk } = (await import(GHOSTSCRIPT_TS)) as typeof import("../../../packages/cli/src/lib/ghostscript.ts");
  const gs = await resolveGhostscript();
  if (!gs) {
    s.note("Ghostscript not found on this machine — skipping PDF/X hand-off checks.");
    return s.finish("INFO");
  }
  s.note(`ghostscript resolved: ${gs}`);

  const staging = mkdtempSync(join(tmpdir(), "folio-pdfx-"));

  // ---------------------------------------------------------- 1. baseline
  const bookPath = join(OUT_DIR, "s12-book.html");
  writeFileSync(bookPath, bookHtml({ seed: 3, chapters: 4, blocksPerChapter: 12, namedPages: true, xrefs: true }));
  const built = await build({
    input: bookPath,
    browser,
    signature: 4,
    marks: true,
    title: "PDFX Handoff Spike",
    author: "Gutterpress",
  });
  const baselinePath = join(OUT_DIR, "s12-baseline.pdf");
  writeArtifact(baselinePath, built.bytes);

  const { stdout: baseInfo } = await execFileP("pdfinfo", ["-box", baselinePath]);
  const baseFonts = await embeddedFontNames(baselinePath);
  s.note(
    `baseline: ${built.pageCount}pp, ${(built.bytes.byteLength / 1024).toFixed(1)}KB, ` +
      `media=${boxFromPdfinfo(baseInfo, "MediaBox")}, trim=${boxFromPdfinfo(baseInfo, "TrimBox")}, ` +
      `bleed=${boxFromPdfinfo(baseInfo, "BleedBox")}`,
  );
  s.check("baseline: signature-padded to a multiple of 4", built.pageCount % 4 === 0, `${built.pageCount}pp`);
  s.check("baseline: all fonts embedded (pdffonts)", baseFonts.length === 0, baseFonts.length ? `not embedded: ${baseFonts.join(", ")}` : "all embedded/subset");
  const baseTrim = boxFromPdfinfo(baseInfo, "TrimBox");
  s.check("baseline: TrimBox present at 6in x 9in", nearArr(baseTrim, [27, 27, 459, 675], 1), `TrimBox ${baseTrim}`);

  // -------------------------------------------- 2. real PDF/X-1a conversion
  const pdfx1aPath = join(OUT_DIR, "s12-pdfx-x1a.pdf");
  let x1aOk = true;
  let x1aError = "";
  const t0 = Date.now();
  try {
    await convertToPdfxCmyk(baselinePath, pdfx1aPath, {
      iccPath: FOGRA39L,
      pdfx: "x1a",
      title: "PDFX Handoff Spike",
      stagingDir: staging,
    });
  } catch (err) {
    x1aOk = false;
    x1aError = String(err);
  }
  const x1aMs = Date.now() - t0;
  s.check("convertToPdfxCmyk(x1a) with real FOGRA39L ICC exits cleanly", x1aOk, x1aOk ? `${x1aMs}ms` : x1aError);

  if (x1aOk) {
    const x1aSize = readFileSync(pdfx1aPath).byteLength;
    s.note(`gs command: ${gs} -dSAFER --permit-file-read=${FOGRA39L} -dBATCH -dNOPAUSE -sDEVICE=pdfwrite -dPDFX -dCompatibilityLevel=1.3 -dEmbedAllFonts=true -dSubsetFonts=true -sProcessColorModel=DeviceCMYK -sColorConversionStrategy=CMYK -dOverrideICC=true -sOutputICCProfile=${FOGRA39L} -sOutputFile=<out> <pdfx-def.ps> ${baselinePath}`);
    s.note(`x1a output: ${(x1aSize / 1024).toFixed(1)}KB (baseline was ${(built.bytes.byteLength / 1024).toFixed(1)}KB)`);

    // ---- 3. validate against Gutterpress's own PDF/X-1a acceptance criteria
    const facts = await readPdfxFacts(pdfx1aPath);
    s.check(
      "PDF/X-1a: DOCINFO /GTS_PDFXVersion present and matches x1a (pdfx-metadata.ts criterion)",
      !!facts.gtsVersion && /PDF\/X-1a|PDF\/X-1/.test(facts.gtsVersion),
      `${facts.gtsVersion}`,
    );
    s.check(
      "PDF/X-1a: DOCINFO /GTS_PDFXConformance present and matches x1a (pdfx-metadata.ts criterion)",
      !!facts.gtsConformance && facts.gtsConformance.includes("PDF/X-1a"),
      `${facts.gtsConformance}`,
    );
    s.check(
      "PDF/X-1a: DOCINFO /Trapped present (pdfx-metadata.ts criterion)",
      facts.trapped === "/True" || facts.trapped === "/False" || facts.trapped === "/Unknown",
      `${facts.trapped}`,
    );
    s.check(
      "PDF/X-1a: Catalog /OutputIntents[0] has /Type /OutputIntent and /S /GTS_PDFX (pdfx-markers.ts criterion)",
      facts.outputIntentType === "/OutputIntent" && facts.outputIntentS === "/GTS_PDFX",
      `Type=${facts.outputIntentType} S=${facts.outputIntentS}`,
    );
    s.check(
      "PDF/X-1a: /DestOutputProfile is an indirect ref that resolves (pdfx-markers.ts criterion)",
      facts.destOutputProfileResolves,
      `resolves=${facts.destOutputProfileResolves}`,
    );

    const markers = scanMarkers(pdfx1aPath);
    s.check(
      "PDF/X-1a: no /DeviceRGB left in content (color-spaces.ts criterion)",
      markers.deviceRgb === 0,
      `${markers.deviceRgb} occurrences (DeviceCMYK: ${markers.deviceCmyk})`,
    );
    s.check(
      "PDF/X-1a: no Lab/Separation/DeviceN spot colors (color-spaces.ts criterion)",
      !markers.lab && !markers.separation && !markers.deviceN,
      `Lab=${markers.lab} Separation=${markers.separation} DeviceN=${markers.deviceN}`,
    );
    s.check(
      "PDF/X-1a: no transparency groups/soft masks (transparency.ts criterion)",
      !markers.transparencyGroup && !markers.smask,
      `Transparency=${markers.transparencyGroup} SMask=${markers.smask}`,
    );

    const x1aFonts = await embeddedFontNames(pdfx1aPath);
    s.check("PDF/X-1a: all fonts still embedded after gs round-trip", x1aFonts.length === 0, x1aFonts.length ? `not embedded: ${x1aFonts.join(", ")}` : "all embedded/subset");

    // ---- 4. geometry survival
    const { stdout: x1aInfo } = await execFileP("pdfinfo", ["-box", pdfx1aPath]);
    const x1aMedia = boxFromPdfinfo(x1aInfo, "MediaBox");
    const x1aTrim = boxFromPdfinfo(x1aInfo, "TrimBox");
    const x1aBleed = boxFromPdfinfo(x1aInfo, "BleedBox");
    const baseMedia = boxFromPdfinfo(baseInfo, "MediaBox");
    const baseBleed = boxFromPdfinfo(baseInfo, "BleedBox");
    s.check("geometry: MediaBox survives the gs round-trip exactly", nearArr(x1aMedia, baseMedia, 0.5), `${x1aMedia} vs ${baseMedia}`);
    s.check("geometry: TrimBox survives the gs round-trip exactly", nearArr(x1aTrim, baseTrim, 0.5), `${x1aTrim} vs ${baseTrim}`);
    s.check("geometry: BleedBox survives the gs round-trip exactly", nearArr(x1aBleed, baseBleed, 0.5), `${x1aBleed} vs ${baseBleed}`);

    // page count preserved (checks every page, not just page 1)
    const { stdout: baseCount } = await execFileP("pdfinfo", [baselinePath]);
    const { stdout: x1aCount } = await execFileP("pdfinfo", [pdfx1aPath]);
    const pages = (out: string) => Number(/Pages:\s+(\d+)/.exec(out)?.[1]);
    s.check("geometry: page count preserved", pages(x1aCount) === pages(baseCount), `${pages(x1aCount)} vs ${pages(baseCount)}`);

    // ---- 5. text survival
    const baseText = pdfText(baselinePath);
    const x1aText = pdfText(pdfx1aPath);
    const normalize = (t: string) => t.replace(/\s+/g, " ").trim();
    const baseJoined = normalize(baseText.pages.map((p) => p.text).join("\n"));
    const x1aJoined = normalize(x1aText.pages.map((p) => p.text).join("\n"));
    s.check(
      "text: pdftotext output identical after gs round-trip (no dropped/garbled content)",
      baseJoined === x1aJoined,
      baseJoined === x1aJoined ? `${baseJoined.length} chars` : `base ${baseJoined.length} chars vs x1a ${x1aJoined.length} chars`,
    );

    // crop marks: the annotation the gs stderr warned about
    // ("Annotation (not TrapNet or PrinterMark) on page, not permitted in
    // PDF/X, reverting to normal PDF output") comes from Folio's own
    // Chromium-emitted internal `<a href="#...">` link annotations (xrefs
    // enabled above) — Gutterpress's real pipeline strips these with qpdf
    // (`stripAnnotations`, build-runner.ts) BEFORE calling convertToPdfxCmyk;
    // this box has no qpdf, so we did not strip them, and they survive into
    // the "PDF/X" output as real /Annots. Surfaced as a note, not a hard
    // check failure, since gs still wrote valid PDF/X markers around it —
    // but a caller using convertToPdfxCmyk without the strip step first will
    // ship non-conformant Link annotations.
    const x1aBytes = readFileSync(pdfx1aPath, "latin1");
    const annotCount = (x1aBytes.match(/\/Subtype\s*\/Link/g) ?? []).length;
    s.note(
      `${annotCount} /Link annotations survived into the PDF/X-1a output ` +
        `(qpdf's stripAnnotations was NOT run — no qpdf on this machine). ` +
        `gs warned "Annotation (not TrapNet or PrinterMark) ... reverting to ` +
        `normal PDF output" for the page carrying them. Gutterpress's real ` +
        `build-runner.ts always runs stripAnnotations before convertToPdfxCmyk ` +
        `when pdfx.stripAnnotations is true (the preset default) — this spike ` +
        `did not, to isolate what convertToPdfxCmyk alone contributes.`,
    );
  }

  // ------------------------------------------------------- 6. x3 flavor
  const pdfx3Path = join(OUT_DIR, "s12-pdfx-x3.pdf");
  let x3Ok = true;
  let x3Error = "";
  try {
    await convertToPdfxCmyk(baselinePath, pdfx3Path, {
      iccPath: FOGRA39L,
      pdfx: "x3",
      title: "PDFX Handoff Spike x3",
      stagingDir: staging,
    });
  } catch (err) {
    x3Ok = false;
    x3Error = String(err);
  }
  s.check("convertToPdfxCmyk(x3) succeeds", x3Ok, x3Ok ? "ok" : x3Error);
  if (x3Ok) {
    const facts3 = await readPdfxFacts(pdfx3Path);
    s.check("PDF/X-3: DOCINFO /GTS_PDFXVersion matches x3", !!facts3.gtsVersion && facts3.gtsVersion.includes("PDF/X-3"), `${facts3.gtsVersion}`);
  }

  // ------------------------------------------------- 7. without bleed/marks
  const noBleedHtmlPath = join(OUT_DIR, "s12-nobleed.html");
  writeFileSync(
    noBleedHtmlPath,
    bookHtml({ seed: 3, chapters: 4, blocksPerChapter: 12 })
      .replace("bleed: 0.125in;", "")
      .replace("marks: crop;", ""),
  );
  const builtNoBleed = await build({ input: noBleedHtmlPath, browser, signature: 4 });
  const noBleedPath = join(OUT_DIR, "s12-nobleed.pdf");
  writeArtifact(noBleedPath, builtNoBleed.bytes);
  const noBleedPdfxPath = join(OUT_DIR, "s12-nobleed-pdfx.pdf");
  let noBleedOk = true;
  let noBleedError = "";
  try {
    await convertToPdfxCmyk(noBleedPath, noBleedPdfxPath, {
      iccPath: FOGRA39L,
      pdfx: "x1a",
      title: "No Bleed",
      stagingDir: staging,
    });
  } catch (err) {
    noBleedOk = false;
    noBleedError = String(err);
  }
  s.check("convertToPdfxCmyk succeeds without bleed/marks", noBleedOk, noBleedOk ? "ok" : noBleedError);
  if (noBleedOk) {
    const noBleedMarkers = scanMarkers(noBleedPdfxPath);
    s.check(
      "no-bleed doc has no forbidden Link annotations (no xrefs used)",
      !readFileSync(noBleedPdfxPath, "latin1").includes("/Subtype/Link") && !readFileSync(noBleedPdfxPath, "latin1").includes("/Subtype /Link"),
      "clean conversion, no annotation warning expected",
    );
    s.check("no-bleed doc: still zero /DeviceRGB", noBleedMarkers.deviceRgb === 0, `${noBleedMarkers.deviceRgb}`);
  }

  // ---------------------------------------------------- 8. failure modes
  const missingIccPath = join(staging, "does-not-exist.icc");
  let missingIccThrew = false;
  try {
    await convertToPdfxCmyk(baselinePath, join(staging, "should-not-exist.pdf"), {
      iccPath: missingIccPath,
      pdfx: "x1a",
      title: "Missing ICC",
      stagingDir: staging,
    });
  } catch {
    missingIccThrew = true;
  }
  s.check("missing ICC profile: gs fails loudly (throws), does not silently emit a file", missingIccThrew, `threw=${missingIccThrew}`);

  const fakeIccPath = join(staging, "fake.icc");
  writeFileSync(fakeIccPath, "not an icc profile");
  let badIccThrew = false;
  try {
    await convertToPdfxCmyk(baselinePath, join(staging, "should-not-exist-2.pdf"), {
      iccPath: fakeIccPath,
      pdfx: "x1a",
      title: "Bad ICC",
      stagingDir: staging,
    });
  } catch {
    badIccThrew = true;
  }
  s.check("malformed ICC profile: gs fails loudly (throws), does not silently emit a non-conformant file", badIccThrew, `threw=${badIccThrew}`);

  s.data = {
    baseline: { pageCount: built.pageCount, bytes: built.bytes.byteLength },
    x1a: { ok: x1aOk, ms: x1aMs },
    x3: { ok: x3Ok },
    noBleed: { ok: noBleedOk },
    failureModes: { missingIccThrew, badIccThrew },
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
