import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, rename, readdir } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { run } from "./exec";
import { findTool } from "./tool-probe";

const WINDOWS_GHOSTSCRIPT_NAMES = ["gswin64c", "gswin32c", "gs"];
const POSIX_GHOSTSCRIPT_NAMES = ["gs"];

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const direct = env[name]?.trim();
  if (direct) return direct;
  const key = Object.keys(env).find((candidate) => candidate.toLowerCase() === name.toLowerCase());
  return key ? env[key]?.trim() || undefined : undefined;
}

async function findWindowsGhostscriptInstall(
  env: NodeJS.ProcessEnv
): Promise<string | undefined> {
  const roots = [
    envValue(env, "ProgramW6432"),
    envValue(env, "ProgramFiles"),
    "C:\\Program Files",
    envValue(env, "ProgramFiles(x86)"),
    "C:\\Program Files (x86)",
  ];
  const seen = new Set<string>();

  for (const root of roots) {
    if (!root || seen.has(root.toLowerCase())) continue;
    seen.add(root.toLowerCase());

    const installRoot = join(root, "gs");
    let versions;
    try {
      versions = (await readdir(installRoot, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory() && /^gs\d/i.test(entry.name))
        .sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true }));
    } catch {
      continue;
    }

    for (const version of versions) {
      for (const executable of ["gswin64c.exe", "gswin32c.exe"]) {
        const candidate = join(installRoot, version.name, "bin", executable);
        if (existsSync(candidate)) return candidate;
      }
    }
  }

  return undefined;
}

/**
 * Resolve the Ghostscript command on every supported platform.
 *
 * Resolution order is explicit override, platform-specific PATH names, then
 * conventional versioned Windows installer directories. The optional
 * arguments make the Windows branch testable on non-Windows CI; production
 * callers always use the current platform and environment.
 */
export async function resolveGhostscript(
  targetPlatform: NodeJS.Platform = process.platform,
  env: NodeJS.ProcessEnv = process.env
): Promise<string | undefined> {
  const override = envValue(env, "GHOSTSCRIPT_PATH");
  if (override && existsSync(override)) return override;

  const names = targetPlatform === "win32"
    ? WINDOWS_GHOSTSCRIPT_NAMES
    : POSIX_GHOSTSCRIPT_NAMES;
  for (const name of names) {
    const found = await findTool(name);
    if (found) return found;
  }

  return targetPlatform === "win32"
    ? findWindowsGhostscriptInstall(env)
    : undefined;
}

/**
 * The 1-based page numbers of `pdfBytes` that use live PDF transparency — the
 * PDF 1.4 imaging feature, in ALL the forms Chromium emits it, not just
 * alpha-channel images:
 *
 *  - a transparency **group** (`/Group << /S /Transparency >>`), which is what
 *    CSS `opacity`, `mix-blend-mode` and friends compile down to;
 *  - an **image soft mask** (`/SMask` on an image XObject, pointing at a real
 *    mask rather than the literal `/None` an opaque image also carries) — an
 *    RGBA source image;
 *  - a **graphics-state** soft mask, constant alpha (`/ca`, `/CA` below 1) or
 *    non-Normal blend mode (`/BM`) on an `/ExtGState` — soft `rgba()`
 *    shadows and fills.
 *
 * PDF/X-1a and PDF/X-3 (as this codebase generates them, `-dCompatibilityLevel=1.3`
 * in {@link convertToPdfxCmyk}) are both based on PDF 1.3, which predates the
 * PDF 1.4 transparency model entirely — live transparency has nothing a
 * PDF-1.3 file can represent it with. Ghostscript's only PDF/X-compliant
 * option is to flatten the page it appears ON down to a single raster image
 * (B.10, measured: text and fonts on that page are lost, identically on both
 * engines — a Ghostscript/PDF-1.3 property, not an engine bug).
 * {@link flattenTransparentPages} keeps the text live on exactly the pages
 * this returns; every other page is left alone.
 *
 * This walks each page's parsed object graph rather than scanning raw bytes. A
 * byte scan is NOT sufficient and produced a false "all clear" in review: image
 * XObjects are streams, so their dicts do sit uncompressed at top level, but
 * `/ExtGState` and `/Group` dicts are plain objects that Chromium packs into
 * **object streams** (`/Type /ObjStm`, deflate-compressed), where no regex can
 * see them. Fonts and `/Parent` (which leads to every other page) are not
 * followed.
 */
export async function transparentPages(pdfBytes: Uint8Array): Promise<number[]> {
  const { PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFArray, PDFRef } =
    await import("pdf-lib");
  let doc;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    // Never let a detection heuristic fail a build: if the PDF can't be
    // parsed here, Ghostscript is still about to be handed it and will
    // report anything genuinely wrong. Skip the advisory step instead.
    return [];
  }
  const ctx = doc.context;
  const SKIP = new Set(["Parent", "Font", "Annots"]);
  const isSet = (v: unknown) => v !== undefined && String(v) !== "/None";

  const dictHasTransparency = (dict: import("pdf-lib").PDFDict): boolean => {
    const smask = dict.get(PDFName.of("SMask"));
    const subtype = String(dict.get(PDFName.of("Subtype")) ?? "");
    const type = String(dict.get(PDFName.of("Type")) ?? "");
    if (subtype === "/Image" && isSet(smask)) return true;
    if (type === "/ExtGState" || dict.has(PDFName.of("ca")) || dict.has(PDFName.of("BM"))) {
      if (isSet(smask)) return true;
      for (const key of ["ca", "CA"]) {
        const alpha = ctx.lookup(dict.get(PDFName.of(key)));
        if (alpha instanceof PDFNumber && alpha.asNumber() < 1) return true;
      }
      const bm = ctx.lookup(dict.get(PDFName.of("BM")));
      const mode = bm instanceof PDFArray ? bm.get(0) : bm;
      if (mode && !["/Normal", "/Compatible"].includes(String(mode))) return true;
    }
    const group = ctx.lookup(dict.get(PDFName.of("Group")));
    return (
      group instanceof PDFDict && String(group.get(PDFName.of("S"))) === "/Transparency"
    );
  };

  const reaches = (root: unknown): boolean => {
    const seen = new Set<unknown>();
    const stack: unknown[] = [root];
    while (stack.length) {
      const node = stack.pop();
      const obj = node instanceof PDFRef ? ctx.lookup(node) : node;
      if (!obj || seen.has(obj)) continue;
      seen.add(obj);
      if (obj instanceof PDFArray) {
        stack.push(...obj.asArray());
        continue;
      }
      const dict =
        obj instanceof PDFRawStream ? obj.dict : obj instanceof PDFDict ? obj : undefined;
      if (!dict) continue;
      if (dictHasTransparency(dict)) return true;
      for (const [key, value] of dict.entries()) {
        if (!SKIP.has(key.asString().slice(1))) stack.push(value);
      }
    }
    return false;
  };

  const pages: number[] = [];
  doc.getPages().forEach((page, i) => {
    if (reaches(page.node)) pages.push(i + 1);
  });
  return pages;
}

/**
 * Strip all annotations from a PDF.
 *
 * Chromium embeds internal link annotations (from HTML `id` attributes)
 * that are not permitted in PDF/X output. Removing them before Ghostscript
 * prevents the "Annotation not TrapNet or PrinterMark" warning and keeps
 * the output in strict PDF/X compliance.
 *
 * Two passes, because neither alone removes every annotation (B.12,
 * measured: 20 `/Subtype /Link` objects survived qpdf's step alone, before
 * AND after):
 *  1. qpdf `--flatten-annotations=all` draws any annotation WITH an
 *     appearance stream (form fields, free text, …) into the page content
 *     before removing it, so visible annotation content is preserved rather
 *     than silently deleted.
 *  2. Link annotations have no appearance stream — that is what makes them
 *     invisible — so qpdf's flatten step has nothing to draw and leaves them
 *     in `/Annots` untouched. Delete whatever `/Annots` entries remain
 *     directly (pdf-lib, in-process, no second external tool).
 */
export async function stripAnnotations(
  pdfPath: string,
  stagingDir: string
): Promise<void> {
  const tmp = join(stagingDir, "annotations-stripped.pdf");
  try {
    await run("qpdf", [pdfPath, tmp, "--flatten-annotations=all"]);
    await rename(tmp, pdfPath);
  } finally {
    await unlink(tmp).catch(() => {});
  }

  const { PDFDocument, PDFName } = await import("pdf-lib");
  const bytes = await readFile(pdfPath);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const annots = PDFName.of("Annots");
  for (const page of doc.getPages()) page.node.delete(annots);
  const out = await doc.save();
  await writeFile(pdfPath, out);
}

/**
 * Make the pages in `pages` (1-based, from {@link transparentPages}) free of
 * transparency while keeping their text live, so PDF/X (PDF 1.3) conversion
 * has nothing left to flatten into a single bitmap.
 *
 * Per affected page, three Ghostscript passes split it in two and pdf-lib
 * stacks the halves back on the ORIGINAL page object:
 *
 *  1. ARTWORK — `-dFILTERTEXT` drops the glyphs, then `pdfimage24 -r300`
 *     composites everything left (soft shadows, alpha images, opacity) into
 *     one opaque 300 DPI image;
 *  2. TEXT — `-dFILTERIMAGE -dFILTERVECTOR` keeps only the glyphs. It needs
 *     `-dNOTRANSPARENCY`: without it Chromium's transparency groups and
 *     `/ca`/`/SMask` ExtGStates survive in the text-only file and the next
 *     step flattens the page anyway;
 *  3. the page's content is replaced by the artwork with the text drawn on
 *     top. Editing the original page keeps its boxes (Media/Crop/Trim/Bleed),
 *     annotations, the document's metadata, outlines and labels exactly as
 *     they were; only its `/Contents`, `/Resources` and `/Group` change.
 *
 * Pages not listed are never touched. Known limits, all consequences of
 * splitting a page into "picture" and "text": the page's vector chrome
 * (rules, backgrounds, shapes) becomes the 300 DPI picture; text is always the
 * top layer, so text another element covers shows through; and text that
 * carries its own transparency prints opaque.
 */
export async function flattenTransparentPages(
  pdfPath: string,
  pages: number[],
  stagingDir: string
): Promise<void> {
  if (pages.length === 0) return;
  const ghostscript = await resolveGhostscript();
  if (!ghostscript) {
    throw new Error(
      "Ghostscript executable not found. Install Ghostscript or set GHOSTSCRIPT_PATH to its command-line executable."
    );
  }
  const art = join(stagingDir, "flatten-art.pdf");
  const artFlat = join(stagingDir, "flatten-art-flat.pdf");
  const text = join(stagingDir, "flatten-text.pdf");
  const pageList = `-sPageList=${pages.join(",")}`;
  const gs = (...args: string[]) =>
    run(ghostscript, ["-q", "-dBATCH", "-dNOPAUSE", "-dSAFER", ...args]);

  try {
    await gs(pageList, "-sDEVICE=pdfwrite", "-dFILTERTEXT", `-sOutputFile=${art}`, pdfPath);
    await gs("-sDEVICE=pdfimage24", "-r300", `-sOutputFile=${artFlat}`, art);
    await gs(
      pageList,
      "-sDEVICE=pdfwrite",
      "-dNOTRANSPARENCY",
      "-dFILTERIMAGE",
      "-dFILTERVECTOR",
      "-dCompatibilityLevel=1.3",
      `-sOutputFile=${text}`,
      pdfPath
    );

    const { PDFDocument, PDFName } = await import("pdf-lib");
    const doc = await PDFDocument.load(await readFile(pdfPath), { updateMetadata: false });
    const artDoc = await PDFDocument.load(await readFile(artFlat));
    const textDoc = await PDFDocument.load(await readFile(text));
    if (artDoc.getPageCount() !== pages.length || textDoc.getPageCount() !== pages.length) {
      throw new Error(
        `Ghostscript returned ${artDoc.getPageCount()} artwork and ${textDoc.getPageCount()} text pages for ${pages.length} transparent pages.`
      );
    }
    const artPages = await doc.embedPages(artDoc.getPages());
    const textPages = await doc.embedPages(textDoc.getPages());

    pages.forEach((pageNumber, i) => {
      const page = doc.getPage(pageNumber - 1);
      const { x, y, width, height } = page.getMediaBox();
      page.node.set(PDFName.of("Contents"), doc.context.obj([]));
      page.node.set(PDFName.of("Resources"), doc.context.obj({}));
      page.node.delete(PDFName.of("Group"));
      // Scale to the original box: the 300 DPI raster's pixel grid rounds the
      // page size by a fraction of a point.
      page.drawPage(artPages[i]!, { x, y, width, height });
      page.drawPage(textPages[i]!, { x, y, width, height });
    });
    await writeFile(pdfPath, await doc.save());
  } finally {
    await Promise.all([art, artFlat, text].map((f) => unlink(f).catch(() => {})));
  }
}

type PdfxFlavor = "x1a" | "x3";

/**
 * Generate the PostScript definition file for PDF/X output intent + GCR.
 */
function makePdfxDefPs(params: {
  iccPath: string;
  pdfx: PdfxFlavor;
  title: string;
  maxTac?: number;
}): string {
  const pdfxVersion = params.pdfx === "x3" ? "PDF/X-3:2002" : "PDF/X-1:2001";
  const pdfxConformance = params.pdfx === "x1a" ? "PDF/X-1a:2001" : null;
  const outputCondition = "CGATS21_CRPC1";
  const outputConditionId = params.pdfx === "x1a" ? "CGATS TR001" : outputCondition;
  const maxTacNorm = ((params.maxTac ?? 240) / 100).toFixed(1);
  const normalizedIccPath = params.iccPath.replace(/\\/g, "/");
  const iccComponents = 4;
  const docInfoConformance = pdfxConformance
    ? `/GTS_PDFXConformance (${pdfxConformance})\n`
    : "";

  return `
%!
% pdfx_def.ps generated by gutterpress
% Based on the Ghostscript PDF/X approach with custom GCR for TAC limiting

/ICCProfile (${normalizedIccPath}) def

% Maximum TAC = ${maxTacNorm} (${params.maxTac ?? 240}%)
/MaxTAC ${maxTacNorm} def

% UCR (Undercolor Removal) - aggressive GCR to reduce CMY in dark areas
% Takes K value, returns amount to subtract from CMY
/UCR {
  % For dark colors, remove more CMY
  dup 0.2 gt {
    0.2 sub 1.5 mul  % Remove 150% of K above 0.2 from CMY
    1 min 0 max
  } {
    pop 0
  } ifelse
} bind def

% BG (Black Generation) - standard K generation
/BG {
  % Pass through K value
} bind def

% Set UCR and BG functions for color conversion
<< /UCRFunction { UCR } /BGFunction { BG } >> setpagedevice

[/Title (${params.title})
/Creator (gutterpress)
/GTS_PDFXVersion (${pdfxVersion})
/Trapped /False
${docInfoConformance}/DOCINFO pdfmark

[/_objdef {icc_PDFX} /type /stream /OBJ pdfmark
[{icc_PDFX} << /N ${iccComponents} >> /PUT pdfmark
[{icc_PDFX} ICCProfile (r) file /PUT pdfmark

[/_objdef {OutputIntent_PDFX} /type /dict /OBJ pdfmark

[{OutputIntent_PDFX} <<
  /Type /OutputIntent
  /S /GTS_PDFX
  /OutputConditionIdentifier (${outputConditionId})
  /OutputCondition (${outputCondition})
  /Info (${outputCondition})
  /RegistryName (http://www.color.org)
  /DestOutputProfile {icc_PDFX}
>> /PUT pdfmark

[{Catalog} << /OutputIntents [ {OutputIntent_PDFX} ] >> /PUT pdfmark
`;
}

/**
 * Stamp the Creator metadata field on an existing PDF.
 *
 * Uses pdf-lib (pure JS, MIT) rather than Ghostscript, so the plain-PDF build
 * path needs no system tool at all — gs is now required only for PDF/X CMYK
 * conversion. `updateMetadata: false` keeps pdf-lib from rewriting
 * the ModDate/Producer so the only change is the /Creator field.
 */
export async function stampCreator(pdfPath: string): Promise<void> {
  const { PDFDocument } = await import("pdf-lib");
  const bytes = await readFile(pdfPath);
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  doc.setCreator("gutterpress");
  const out = await doc.save();
  await writeFile(pdfPath, out);
}

/**
 * Convert an RGB PDF to CMYK PDF/X using Ghostscript.
 */
export async function convertToPdfxCmyk(
  inputPdf: string,
  outPdf: string,
  config: {
    iccPath: string;
    pdfx: PdfxFlavor;
    title?: string;
    maxTac?: number;
    stagingDir: string;
  }
): Promise<void> {
  const iccPath = resolve(config.iccPath);
  const tmpDef = join(config.stagingDir, "pdfx-def.ps");
  const args = [
    "-dSAFER",
    `--permit-file-read=${iccPath}`,
    "-dBATCH",
    "-dNOPAUSE",
    "-sDEVICE=pdfwrite",
    "-dPDFX",
    "-dCompatibilityLevel=1.3",
    "-dEmbedAllFonts=true",
    "-dSubsetFonts=true",
    "-dCompressFonts=true",
    "-dDetectDuplicateImages=true",
    "-dDownsampleColorImages=false",
    "-dDownsampleGrayImages=false",
    "-dDownsampleMonoImages=false",
    "-sProcessColorModel=DeviceCMYK",
    "-sColorConversionStrategy=CMYK",
    "-dOverrideICC=true",
    // No -sDefaultRGBProfile override: a hardcoded distro path (e.g. Linux's
    // /usr/share/color/icc/ghostscript/srgb.icc) breaks otherwise valid
    // macOS/Windows installs, so Ghostscript resolves its own built-in sRGB
    // profile instead. -sOutputICCProfile below is unrelated — it sets the
    // PDF/X output intent profile, always the caller-supplied iccPath.
    `-sOutputICCProfile=${iccPath}`,
    `-sOutputFile=${outPdf}`,
    tmpDef,
    inputPdf,
  ];

  try {
    await writeFile(
      tmpDef,
      makePdfxDefPs({
        iccPath,
        pdfx: config.pdfx,
        title: config.title ?? basename(outPdf),
        maxTac: config.maxTac,
      }),
      "utf8"
    );
    const ghostscript = await resolveGhostscript();
    if (!ghostscript) {
      throw new Error(
        "Ghostscript executable not found. Install Ghostscript or set GHOSTSCRIPT_PATH to its command-line executable."
      );
    }
    await run(ghostscript, args);
  } finally {
    await unlink(tmpDef).catch(() => {});
  }
}
