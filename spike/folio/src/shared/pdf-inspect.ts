/**
 * Read-side PDF utilities (pdf-lib, pure JS).
 *
 * Two jobs:
 *  1. Verification: page count, page boxes, embedded fonts — the evidence the
 *     spikes assert on.
 *  2. Tier 3 measurement channel (§8): harvest Chromium's own link annotations
 *     and document outline to learn "which page is element X on", with no text
 *     heuristics.
 */
import { PDFDocument, PDFName, PDFDict, PDFArray, PDFNumber, PDFRef } from "pdf-lib";

export const PT_PER_IN = 72;

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

  // ---- link annotations: source annot -> destination page ----------------
  const linkTargets: Record<string, number> = {};
  for (const page of pages) {
    const annots = page.node.lookup(PDFName.of("Annots"));
    if (!(annots instanceof PDFArray)) continue;
    for (let i = 0; i < annots.size(); i++) {
      const a = annots.lookup(i, PDFDict);
      if (!a) continue;
      const subtype = a.get(PDFName.of("Subtype"));
      if (subtype?.toString() !== "/Link") continue;
      let dest = a.get(PDFName.of("Dest"));
      if (dest) dest = a.lookupMaybe?.(PDFName.of("Dest"), PDFArray) ?? dest;
      if (!dest) {
        const action = a.lookupMaybe?.(PDFName.of("A"), PDFDict);
        if (action) dest = action.lookupMaybe?.(PDFName.of("D"), PDFArray) ?? action.get(PDFName.of("D"));
      }
      const target = resolvePageIndex(dest instanceof PDFRef ? doc.context.lookup(dest) : dest);
      if (target === undefined) continue;
      const rect = a.lookupMaybe?.(PDFName.of("Rect"), PDFArray);
      const key = rect
        ? rect
            .asArray()
            .map((n) => Math.round((n as PDFNumber).asNumber() * 100) / 100)
            .join(",")
        : `annot-${Object.keys(linkTargets).length}`;
      linkTargets[key] = target;
    }
  }

  // ---- named destinations (/Names /Dests name tree) ----------------------
  const namedDests: Record<string, number> = {};
  const catalog = doc.catalog;
  const walkNameTree = (node: PDFDict | undefined) => {
    if (!node) return;
    const names = node.lookupMaybe(PDFName.of("Names"), PDFArray);
    if (names) {
      for (let i = 0; i + 1 < names.size(); i += 2) {
        const name = names.lookup(i);
        const val = names.lookup(i + 1);
        const idx = resolvePageIndex(val);
        if (idx !== undefined) {
          namedDests[String(name).replace(/^\((.*)\)$/, "$1")] = idx;
        }
      }
    }
    const kids = node.lookupMaybe(PDFName.of("Kids"), PDFArray);
    if (kids) {
      for (let i = 0; i < kids.size(); i++) walkNameTree(kids.lookup(i, PDFDict));
    }
  };
  const namesDict = catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  walkNameTree(namesDict?.lookupMaybe(PDFName.of("Dests"), PDFDict));
  // legacy /Dests dictionary
  const legacyDests = catalog.lookupMaybe(PDFName.of("Dests"), PDFDict);
  if (legacyDests) {
    for (const [k, v] of legacyDests.entries()) {
      const idx = resolvePageIndex(doc.context.lookup(v));
      if (idx !== undefined) namedDests[k.asString().replace(/^\//, "")] = idx;
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

/** Extract per-page text as a rough sanity channel (not used for measurement). */
export function ptToIn(pt: number): number {
  return pt / PT_PER_IN;
}

export function boxesEqual(a: number[] | undefined, b: number[], tol = 0.05): boolean {
  if (!a || a.length !== b.length) return false;
  return a.every((v, i) => Math.abs(v - b[i]) <= tol);
}
