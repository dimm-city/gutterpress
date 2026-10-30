/**
 * Read-side PDF utilities (pdf-lib, pure JS).
 *
 * Three jobs:
 *  1. Verification: page count, page boxes, embedded fonts — the evidence the
 *     tests assert on.
 *  2. Tier 3 measurement channel (§8): harvest Chromium's own link annotations
 *     and document outline to learn "which page is element X on", with no text
 *     heuristics.
 *  3. The print scale: whether Chromium's shrink-to-fit scaled the page area
 *     ({@link printScale}).
 */
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFNumber,
  PDFRawStream,
  PDFRef,
  PDFString,
} from "pdf-lib";

export interface PageBoxes {
  media: number[];
  crop?: number[];
  bleed?: number[];
  trim?: number[];
}

export interface PdfFacts {
  pageCount: number;
  boxes: PageBoxes[];
  /** destination anchor name -> zero-based page index (from link annotations) */
  linkTargets: Record<string, number>;
  /** named destinations (/Dests name tree) -> zero-based page index */
  namedDests: Record<string, number>;
  /** outline title -> zero-based page index */
  outline: Array<{ title: string; page: number }>;
}

function boxOf(page: any, name: string): number[] | undefined {
  const arr = page.node.get(PDFName.of(name));
  if (!(arr instanceof PDFArray)) return undefined;
  return arr.asArray().map((n) => (n as PDFNumber).asNumber());
}

export async function inspectPdf(bytes: Uint8Array): Promise<PdfFacts> {
  const doc = await PDFDocument.load(bytes, { updateMetadata: false });
  const pages = doc.getPages();
  const pageRefIndex = new Map<string, number>();
  pages.forEach((p, i) => pageRefIndex.set(p.ref.toString(), i));

  const boxes: PageBoxes[] = pages.map((p) => ({
    media: boxOf(p, "MediaBox") ?? [],
    crop: boxOf(p, "CropBox"),
    bleed: boxOf(p, "BleedBox"),
    trim: boxOf(p, "TrimBox"),
  }));

  const resolvePageIndex = (dest: any): number | undefined => {
    let d = dest;
    if (d instanceof PDFDict) d = d.get(PDFName.of("D")) ?? d;
    if (!(d instanceof PDFArray)) return undefined;
    const first = d.get(0);
    if (first instanceof PDFRef) return pageRefIndex.get(first.toString());
    if (first instanceof PDFNumber) return first.asNumber();
    return undefined;
  };

  // ---- named destinations (/Names /Dests name tree) ----------------------
  // Resolved first: an annotation's /Dest may be a NAME into this tree rather
  // than an explicit array.
  const namedDests: Record<string, number> = {};
  const catalog = doc.catalog;
  const walkNameTree = (node: PDFDict | undefined) => {
    if (!node) return;
    const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (names) {
      for (let i = 0; i + 1 < names.size(); i += 2) {
        const key = names.lookup(i);
        const val = names.lookup(i + 1);
        const idx = resolvePageIndex(val);
        if (idx !== undefined)
          namedDests[String(key).replace(/^\((.*)\)$/, "$1")] = idx;
      }
    }
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) for (let i = 0; i < kids.size(); i++) walkNameTree(kids.lookup(i, PDFDict));
  };
  const namesDict = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  walkNameTree(namesDict?.lookupMaybe(PDFName.of("Dests"), PDFDict));
  const legacyDests = catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
  if (legacyDests) {
    for (const [k, v] of legacyDests.entries()) {
      const idx = resolvePageIndex(doc.context.lookup(v));
      if (idx !== undefined) namedDests[k.asString().replace(/^\//, "")] = idx;
    }
  }

  // ---- link annotations: source annot -> destination page ----------------
  const linkTargets: Record<string, number> = {};
  for (const page of pages) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i, PDFDict);
      if (!a) continue;
      if (a.get(PDFName.of("Subtype"))?.toString() !== "/Link") continue;

      let dest: any = a.get(PDFName.of("Dest"));
      if (!dest) {
        const action = a.lookup(PDFName.of("A"));
        if (action instanceof PDFDict) dest = action.get(PDFName.of("D"));
      }
      if (dest instanceof PDFRef) dest = doc.context.lookup(dest);

      let target: number | undefined;
      if (dest instanceof PDFName || dest instanceof PDFString || dest instanceof PDFHexString) {
        const key = String(dest).replace(/^[/(]|\)$/g, "");
        target = namedDests[key];
      } else {
        target = resolvePageIndex(dest);
      }
      if (target === undefined) continue;

      const rect = a.lookupMaybe(PDFName.of("Rect"), PDFArray);
      const key = rect
        ? rect
            .asArray()
            .map((n) => Math.round((n as PDFNumber).asNumber() * 100) / 100)
            .join(",")
        : `annot-${Object.keys(linkTargets).length}`;
      linkTargets[key] = target;
    }
  }

  // ---- document outline --------------------------------------------------
  const outline: Array<{ title: string; page: number }> = [];
  const outlines = catalog.lookupMaybe(PDFName.of("Outlines"), PDFDict);
  const walkOutline = (node: PDFDict | undefined) => {
    let cur = node?.lookupMaybe(PDFName.of("First"), PDFDict);
    while (cur) {
      const titleObj = cur.get(PDFName.of("Title"));
      const title = titleObj
        ? String(titleObj).replace(/^\((.*)\)$/, "$1").replace(/^﻿/, "")
        : "";
      let dest: any = cur.get(PDFName.of("Dest"));
      if (!dest) {
        const action = cur.lookupMaybe(PDFName.of("A"), PDFDict);
        dest = action?.get(PDFName.of("D"));
      }
      if (dest instanceof PDFRef) dest = doc.context.lookup(dest);
      const page = resolvePageIndex(dest);
      if (page !== undefined) outline.push({ title, page });
      walkOutline(cur.lookupMaybe(PDFName.of("First"), PDFDict) ? cur : undefined);
      cur = cur.lookupMaybe(PDFName.of("Next"), PDFDict);
    }
  };
  walkOutline(outlines);

  return { pageCount: pages.length, boxes, linkTargets, namedDests, outline };
}

/**
 * Chromium's page prologue: device units (300 per inch) to PDF points, with
 * the y axis flipped — `.24 0 0 -.24 0 792 cm` on a Letter sheet.
 */
const PROLOGUE = /^\s*(\d*\.?\d+) 0 0 -\d*\.?\d+ -?\d*\.?\d+ -?\d*\.?\d+ cm/;
/** A clip rectangle, in device units: `x y w h re W* n`. */
const CLIP = /(-?\d*\.?\d+) (-?\d*\.?\d+) (\d*\.?\d+) (\d*\.?\d+) re\s+W\*? n\b/g;
/** A uniform scale opening a group: `q s 0 0 s tx ty cm`. */
const UNIFORM = /\bq\s+(\d*\.?\d+) 0 0 \1 (-?\d*\.?\d+) -?\d*\.?\d+ cm/g;
/**
 * How far from 1 a read scale may be and still mean "not scaled". Chromium
 * writes the two matrices as float32 at eight significant digits (0.24 reads
 * `.23999999`), so an unscaled print reads 1 to within 1e-7. The smallest
 * shrink Chromium can apply is for 1/64 px of overflow (one LayoutUnit), a
 * scale of W / (W + 1/64) for a W px content box: further from 1 than 1e-6
 * for any content box narrower than 15,000 px (about 4 m).
 */
const UNSCALED_EPSILON = 1e-6;

/**
 * The scale Chromium printed the page area at: 1 when it laid the document
 * out at the page content box's own width, below 1 when print shrink-to-fit
 * scaled the whole document down because something reached past that box
 * (ENGINE.md §9). `null` when no page shows the transform — a reader that
 * cannot find it makes no claim. Pass Chromium's own print, before anything
 * redraws its pages.
 *
 * Read off the content streams rather than predicted from element widths.
 * Each page draws its page box (background, margin boxes) under an unscaled
 * `3.125 0 0 3.125 0 0 cm` — CSS px to 300-per-inch device units — then clips
 * to the page area, its largest clip, and draws the page area's content
 * under `s 0 0 s x y cm`, where x is the clip's own left edge and s is 3.125
 * times the shrink. An element with a CSS transform or its own clip draws
 * under other matrices, so one page can read wrong; Chromium applies one
 * factor to the whole document, so the first reading three pages agree on
 * (or the most common, in a shorter document) is the answer. The prologue
 * fixes the device resolution: the scale is s × prologue × 96/72.
 */
export function printScale(doc: PDFDocument): number | null {
  const readings = new Map<number, number>();
  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams =
      contents instanceof PDFArray
        ? contents.asArray().map((ref) => doc.context.lookup(ref))
        : [contents];
    let text = "";
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream)) continue;
      try {
        text += Buffer.from(decodePDFRawStream(stream).decode()).toString("latin1") + "\n";
      } catch {
        // an unsupported filter: this page cannot answer
      }
    }
    const prologue = PROLOGUE.exec(text);
    if (!prologue) continue;
    let area: { x: number; size: number; end: number } | undefined;
    for (const m of text.matchAll(CLIP)) {
      const size = Number(m[3]) * Number(m[4]);
      if (!area || size > area.size) area = { x: Number(m[1]), size, end: m.index! + m[0].length };
    }
    if (!area) continue;
    UNIFORM.lastIndex = area.end;
    for (let m; (m = UNIFORM.exec(text)); ) {
      if (Math.abs(Number(m[2]) - area.x) > 0.5) continue;
      const scale = (Number(m[1]) * Number(prologue[1]) * 96) / 72;
      readings.set(scale, (readings.get(scale) ?? 0) + 1);
      break;
    }
    if ([...readings.values()].some((n) => n >= 3)) break;
  }
  let best: number | null = null;
  for (const [scale, n] of readings) if (best === null || n > readings.get(best)!) best = scale;
  return best === null ? null : Math.abs(1 - best) < UNSCALED_EPSILON ? 1 : best;
}
