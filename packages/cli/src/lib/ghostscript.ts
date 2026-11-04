import { existsSync } from "node:fs";
import { readFile, writeFile, unlink, rename, readdir } from "node:fs/promises";
import { join, basename, resolve } from "node:path";
import { enhancedPath, execCapture, run, spawnCapture } from "./exec";
import { log } from "../utils/logger";
import { findTool } from "./tool-probe";
import { pagesWithVisibleShadingPaints, type UnsplittableReason } from "./pdf-inspect";
import { iccProfileDescription, outputConditionFor, type OutputCondition } from "./icc-profile";

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
 * {@link flattenTransparentPages} (opt-in, `pdfx.transparency: preserve-text`)
 * can instead keep the text live on the pages this returns.
 *
 * This walks each page's parsed object graph rather than scanning raw bytes. A
 * byte scan is NOT sufficient and produced a false "all clear" in review: image
 * XObjects are streams, so their dicts do sit uncompressed at top level, but
 * `/ExtGState` and `/Group` dicts are plain objects that Chromium packs into
 * **object streams** (`/Type /ObjStm`, deflate-compressed), where no regex can
 * see them. Fonts, `/Parent` (which leads to every other page) and `/Annots`
 * are not followed: an annotation's appearance stream is not page content, and
 * PDF/X builds strip annotations before conversion.
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
 * 1-based numbers of the pages that paint a `/ShadingType 1` shading whose
 * function is `/FunctionType 4` (a PostScript calculator function).
 *
 * That is how Chromium (Skia) emits `repeating-linear-gradient()`,
 * `repeating-radial-gradient()`, `repeating-conic-gradient()` and
 * `conic-gradient()`. Ghostscript 10.x
 * reports "error in pattern" on it while converting to PDF/X and paints
 * nothing, so the gradient prints blank (#386). Plain `linear-gradient()` and
 * `radial-gradient()` are ShadingType 2/3 and convert fine. Detecting it lets
 * the build name the affected pages before the conversion drops them; the
 * pipeline does not rewrite the gradient. Delete this when Ghostscript paints
 * these shadings.
 *
 * Walks page resources (and form XObjects they draw) rather than every
 * object, so only shadings a page can actually paint are reported; of those
 * pages, only the ones that paint a shading with a visible area (#438: a box
 * that opens the NEXT page is also in this page's content as a sliver —
 * `pagesWithVisibleShadingPaints`, pdf-inspect.ts). Like
 * {@link transparentPages}, it never fails a build: an unparseable PDF
 * reports no pages.
 */
export async function findPostScriptShadingPages(pdfBytes: Uint8Array): Promise<number[]> {
  const { PDFDocument, PDFDict, PDFName, PDFNumber, PDFRawStream, PDFRef } = await import(
    "pdf-lib"
  );
  let doc;
  try {
    doc = await PDFDocument.load(pdfBytes, {
      updateMetadata: false,
      throwOnInvalidObject: false,
    });
  } catch {
    return [];
  }
  const ctx = doc.context;
  const asDict = (obj: unknown) => {
    const o = obj instanceof PDFRef ? ctx.lookup(obj) : obj;
    return o instanceof PDFRawStream ? o.dict : o instanceof PDFDict ? o : undefined;
  };
  const num = (obj: unknown) => {
    const o = obj instanceof PDFRef ? ctx.lookup(obj) : obj;
    return o instanceof PDFNumber ? o.asNumber() : undefined;
  };
  const isPostScriptShading = (shading: unknown) => {
    const dict = asDict(shading);
    if (!dict || num(dict.get(PDFName.of("ShadingType"))) !== 1) return false;
    return num(asDict(dict.get(PDFName.of("Function")))?.get(PDFName.of("FunctionType"))) === 4;
  };
  const subDicts = (resources: import("pdf-lib").PDFDict, key: string) => {
    const group = asDict(resources.get(PDFName.of(key)));
    return group ? group.entries().map(([, v]) => v) : [];
  };

  const seen = new Set<unknown>();
  const usesPostScriptShading = (resources: import("pdf-lib").PDFDict | undefined): boolean => {
    if (!resources || seen.has(resources)) return false;
    seen.add(resources);
    if (subDicts(resources, "Shading").some(isPostScriptShading)) return true;
    for (const pattern of subDicts(resources, "Pattern")) {
      const dict = asDict(pattern);
      if (dict && isPostScriptShading(dict.get(PDFName.of("Shading")))) return true;
    }
    return subDicts(resources, "XObject").some((x) =>
      usesPostScriptShading(asDict(asDict(x)?.get(PDFName.of("Resources"))))
    );
  };

  const pages: number[] = [];
  doc.getPages().forEach((page, i) => {
    seen.clear();
    if (usesPostScriptShading(asDict(page.node.Resources()))) pages.push(i + 1);
  });
  if (pages.length === 0) return pages;
  return pagesWithVisibleShadingPaints(pdfBytes, pages).catch(() => pages);
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

/** Why a transparent page is flattened whole under `preserve-text` instead of split. */
export type FallbackCause = Exclude<UnsplittableReason, "no-text"> | "listed" | "gradient";

/**
 * Sort each page that uses transparency (1-based, from {@link transparentPages})
 * for `pdfx.transparency: preserve-text`:
 * - `split`: its artwork is flattened and its text kept live
 *   ({@link flattenTransparentPages});
 * - `artOnly`: it shows no text, so there is nothing to keep and Ghostscript
 *   flattens it whole, which is as good;
 * - `kept`: it has text but is flattened whole anyway, with the cause the
 *   build reports. The author's `pdfx.flattenPages` list wins, then the
 *   text's own reason (`unsplittableTextReasons`), then a repeating or conic
 *   gradient (#386), whose PostScript-function shading the artwork pass
 *   distorts.
 * Every transparent page lands in exactly one group.
 */
export function planTransparentPages(
  transparent: number[],
  reasons: Map<number, UnsplittableReason>,
  flattenPages: number[],
  gradientPages: number[]
): { split: number[]; artOnly: number[]; kept: Map<number, FallbackCause> } {
  const split: number[] = [];
  const artOnly: number[] = [];
  const kept = new Map<number, FallbackCause>();
  for (const n of transparent) {
    const reason = reasons.get(n);
    if (reason === "no-text") artOnly.push(n);
    else if (flattenPages.includes(n)) kept.set(n, "listed");
    else if (reason) kept.set(n, reason);
    else if (gradientPages.includes(n)) kept.set(n, "gradient");
    else split.push(n);
  }
  return { split, artOnly, kept };
}

/**
 * Make the pages in `pages` (1-based; the `split` group of
 * {@link planTransparentPages}) free of transparency while keeping
 * their text live, so PDF/X (PDF 1.3) conversion has nothing left to flatten
 * into a single bitmap. Opt-in: `pdfx.transparency: preserve-text`.
 *
 * Per affected page, two Ghostscript passes split it in two and pdf-lib
 * stacks the halves back on the ORIGINAL page object:
 *
 *  1. ARTWORK — `pdfimage24 -dFILTERTEXT -r<dpi>` drops the glyphs and
 *     composites everything left (soft shadows, alpha images, opacity) into
 *     one opaque image (300 DPI unless `pdfx.rasterDpi` says otherwise),
 *     straight from the source;
 *  2. TEXT — `-dFILTERIMAGE -dFILTERVECTOR` keeps only the glyphs. It needs
 *     `-dNOTRANSPARENCY`: without it Chromium's transparency groups and
 *     `/ca`/`/SMask` ExtGStates survive in the text-only file and the next
 *     step flattens the page anyway. That is only faithful for text with no
 *     transparency of its own, which is why callers leave other pages out;
 *  3. the page's content is replaced by the artwork with the text drawn on
 *     top. Editing the original page keeps its boxes (Media/Crop/Trim/Bleed),
 *     annotations, the document's metadata, outlines and labels exactly as
 *     they were; only its `/Contents`, `/Resources` and `/Group` change.
 *
 * Pages not listed are never touched. Known limits, both consequences of
 * splitting a page into "picture" and "text": the page's vector chrome
 * (rules, backgrounds, shapes) becomes the picture, and text is always the
 * top layer, so text another element covers shows through.
 */
export async function flattenTransparentPages(
  pdfPath: string,
  pageNumbers: number[],
  stagingDir: string,
  /** artwork resolution (`pdfx.rasterDpi`) */
  dpi = 300
): Promise<void> {
  // The scratch files' pages are matched to these by index, in page order.
  const pages = [...new Set(pageNumbers)].sort((a, b) => a - b);
  if (pages.length === 0) return;
  const ghostscript = await resolveGhostscript();
  if (!ghostscript) {
    throw new Error(
      "Ghostscript executable not found. Install Ghostscript or set GHOSTSCRIPT_PATH to its command-line executable."
    );
  }
  const art = join(stagingDir, "flatten-art.pdf");
  const text = join(stagingDir, "flatten-text.pdf");
  const pageList = `-sPageList=${pages.join(",")}`;
  // Links and outlines point at pages this subset leaves out; they stay on the
  // original page objects and are not wanted in the scratch files (and
  // -dNO_PDFMARK_OUTLINES stops Ghostscript logging "pdfmark destination page N
  // points beyond the last page" for them).
  const gs = (...args: string[]) =>
    run(ghostscript, [
      "-q", "-dBATCH", "-dNOPAUSE", "-dSAFER",
      "-dPreserveAnnots=false", "-dNO_PDFMARK_OUTLINES",
      ...args,
    ]);

  try {
    await gs(pageList, "-sDEVICE=pdfimage24", "-dFILTERTEXT", `-r${dpi}`, `-sOutputFile=${art}`, pdfPath);
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
    const artDoc = await PDFDocument.load(await readFile(art));
    const textDoc = await PDFDocument.load(await readFile(text));
    if (artDoc.getPageCount() !== pages.length || textDoc.getPageCount() !== pages.length) {
      throw new Error(
        `Ghostscript returned ${artDoc.getPageCount()} artwork and ${textDoc.getPageCount()} text pages ` +
          `for ${pages.length} transparent pages.`
      );
    }
    const artPages = await doc.embedPages(artDoc.getPages());
    // A page whose text pass comes back empty has no /Contents, which pdf-lib
    // cannot embed. The build does not split pages that show no text, but text
    // pdf.js counts can still come back empty from Ghostscript (e.g. only
    // whitespace or invisible glyphs), so it is guarded here. One embedPages
    // call copies the text file's fonts once; embedding page by page would
    // copy them again for every page.
    const withText = textDoc.getPages().filter((p) => p.node.Contents());
    const embeddedText = await doc.embedPages(withText);
    const textPages = textDoc
      .getPages()
      .map((p) => embeddedText[withText.indexOf(p)]);

    pages.forEach((pageNumber, i) => {
      const page = doc.getPage(pageNumber - 1);
      const { x, y, width, height } = page.getMediaBox();
      page.node.set(PDFName.of("Contents"), doc.context.obj([]));
      page.node.set(PDFName.of("Resources"), doc.context.obj({}));
      page.node.delete(PDFName.of("Group"));
      // Scale to the original box: the raster's pixel grid rounds the
      // page size by a fraction of a point.
      page.drawPage(artPages[i]!, { x, y, width, height });
      const textPage = textPages[i];
      if (textPage) page.drawPage(textPage, { x, y, width, height });
    });
    await writeFile(pdfPath, await doc.save());
  } finally {
    await Promise.all([art, text].map((f) => unlink(f).catch(() => {})));
  }
}

type PdfxFlavor = "x1a" | "x3";

/** A PostScript string literal's body: backslash and parentheses escaped. */
function psString(text: string): string {
  return text.replace(/[\\()]/g, (c) => `\\${c}`);
}

/**
 * Generate the PostScript definition file for the PDF/X output intent.
 *
 * It carries no ink limit: the output profile is what bounds the ink
 * (CGATS21_CRPC1 holds it to about 240%). PostScript undercolour removal and
 * black generation act only in Ghostscript's non-ICC conversion path, so they
 * have no effect on this ICC-managed conversion.
 */
function makePdfxDefPs(params: {
  iccPath: string;
  pdfx: PdfxFlavor;
  title: string;
  output: OutputCondition;
}): string {
  const pdfxVersion = params.pdfx === "x3" ? "PDF/X-3:2002" : "PDF/X-1:2001";
  const pdfxConformance = params.pdfx === "x1a" ? "PDF/X-1a:2001" : null;
  const { identifier, condition, registered } = params.output;
  const normalizedIccPath = params.iccPath.replace(/\\/g, "/");
  const iccComponents = 4;
  const docInfoConformance = pdfxConformance
    ? `/GTS_PDFXConformance (${pdfxConformance})\n`
    : "";
  const registry = registered ? "  /RegistryName (http://www.color.org)\n" : "";

  return `
%!
% pdfx_def.ps generated by gutterpress

/ICCProfile (${normalizedIccPath}) def

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
  /OutputConditionIdentifier (${psString(identifier)})
  /OutputCondition (${psString(condition)})
  /Info (${psString(condition)})
${registry}  /DestOutputProfile {icc_PDFX}
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

/** true when `version` (as `gs --version` prints it, e.g. "10.02.1") is below major.minor; unparseable → false. */
export function ghostscriptOlderThan(version: string, major: number, minor: number): boolean {
  const m = /^(\d+)\.(\d+)/.exec(version.trim());
  if (!m) return false;
  const [maj, min] = [Number(m[1]), Number(m[2])];
  return maj < major || (maj === major && min < minor);
}

/**
 * Convert an RGB PDF to CMYK PDF/X using Ghostscript.
 *
 * The output profile (`iccPath`) is both the conversion target and the
 * OutputIntent's profile, so it sets the gamut and the ink limit; nothing
 * here caps ink on its own. Colour management is Ghostscript's default:
 * its default rendering intent and black-point setting, and every image is
 * read as sRGB (`-dOverrideICC` ignores a profile embedded in an image).
 */
export async function convertToPdfxCmyk(
  inputPdf: string,
  outPdf: string,
  config: {
    iccPath: string;
    pdfx: PdfxFlavor;
    title?: string;
    stagingDir: string;
    /**
     * Resolution of the picture Ghostscript makes of a page it flattens
     * (`pdfx.rasterDpi`). Unset keeps Ghostscript's own default (720 DPI).
     * pdfwrite uses it only for rendering it must do, such as transparency
     * flattening: vector content is unaffected.
     */
    rasterDpi?: number;
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
    // Lossless pictures. Converting to CMYK re-encodes every colour image,
    // and pdfwrite's default picks JPEG at a low quality: blotches and halos
    // in a flattened page, which a printer reproduces. Flate is also smaller
    // than a JPEG good enough for print.
    "-dAutoFilterColorImages=false",
    "-dColorImageFilter=/FlateEncode",
    "-dAutoFilterGrayImages=false",
    "-dGrayImageFilter=/FlateEncode",
    ...(config.rasterDpi ? [`-r${config.rasterDpi}`] : []),
    "-sProcessColorModel=DeviceCMYK",
    "-sColorConversionStrategy=CMYK",
    "-dOverrideICC=true",
    // No -sDefaultRGBProfile override: a hardcoded distro path (e.g. Linux's
    // /usr/share/color/icc/ghostscript/srgb.icc) breaks otherwise valid
    // macOS/Windows installs, so Ghostscript resolves its own built-in sRGB
    // profile instead. -sOutputICCProfile below is unrelated: it is the CMYK
    // profile pdfwrite separates into, always the caller-supplied iccPath,
    // which the definition file also embeds as the OutputIntent. Measured:
    // Ghostscript 10.03.0 and newer honour it for vector colour (Artifex bug
    // 707350); 10.02.1 and older ignore it (and -sDefaultCMYKProfile, and
    // -dRenderIntent) and separate through the default CMYK profile. The
    // version check below warns on those; the integration test pins CRPC1's
    // signature on CI's Ghostscript.
    `-sOutputICCProfile=${iccPath}`,
    `-sOutputFile=${outPdf}`,
    tmpDef,
    inputPdf,
  ];

  try {
    const description =
      iccProfileDescription(await readFile(iccPath).catch(() => new Uint8Array())) ??
      basename(iccPath);
    const output = outputConditionFor(description);
    log.info(`PDF/X output profile: ${description} (OutputConditionIdentifier ${output.identifier})`);
    if (!output.registered) {
      log.warn(
        `The PDF/X output profile "${description}" is not one Gutterpress knows (the shipped ` +
          "CGATS21_CRPC1.icc is), so the OutputIntent names the profile's own description, not a " +
          "registered printing condition. The profile alone sets this build's ink limit: `maxTac` " +
          "is what pdf.print.ink-coverage checks the result against, not something the conversion enforces."
      );
    }
    await writeFile(
      tmpDef,
      makePdfxDefPs({
        iccPath,
        pdfx: config.pdfx,
        title: config.title ?? basename(outPdf),
        output,
      }),
      "utf8"
    );
    const ghostscript = await resolveGhostscript();
    if (!ghostscript) {
      throw new Error(
        "Ghostscript executable not found. Install Ghostscript or set GHOSTSCRIPT_PATH to its command-line executable."
      );
    }
    const version = await execCapture(ghostscript, ["--version"])
      .then((r) => r.stdout.trim())
      .catch(() => "");
    if (ghostscriptOlderThan(version, 10, 3)) {
      log.warn(
        `Ghostscript ${version} is older than 10.03.0, so its pdfwrite ignores the output profile and separates ` +
          "every colour through Ghostscript's default CMYK profile (Artifex bug 707350): #000 prints at " +
          "C72 M68 Y67 K88 = 295%, over DriveThruRPG's 240%, while the file still names the profile as its " +
          "OutputIntent. Debian 12's 10.0.0 and Ubuntu 24.04's 10.02.1 are affected. Install 10.03 or newer: " +
          'Debian 13\'s or Ubuntu 25.10\'s package, Homebrew, winget, or the Docker image (docs/publishing.md, "PDF/X colour").'
      );
    }
    // `run` inherits stdio, which would leave the warnings block on a terminal
    // the desktop app never shows; capture it and log it through the logger.
    const { code, signal, stdout, stderr } = await spawnCapture(ghostscript, args, {
      env: { ...process.env, PATH: enhancedPath },
    });
    if (signal) {
      throw new Error(
        `Ghostscript ${version || "unknown version"} crashed (${signal}) while converting to PDF/X. ` +
          "This is a Ghostscript bug, not a problem with the PDF. Ghostscript " +
          "10.02.1 has been seen to crash in the PDF 1.3 transparency flattening " +
          "PDF/X requires, on a page with an alpha-channel image. Flattening that " +
          "image against its background avoided it there; a newer Ghostscript may " +
          "too. A plain PDF (--format pdf) does not run this step."
      );
    }
    if (code !== 0) {
      throw new Error(`${ghostscript} ${args.join(" ")} exited ${code}\n${stdout}${stderr}`);
    }
    const at = stderr.indexOf("The following warnings");
    if (at >= 0) {
      log.warn(`Ghostscript reported problems converting to PDF/X:\n${stderr.slice(at).trim()}`);
    }
  } finally {
    await unlink(tmpDef).catch(() => {});
  }
}
