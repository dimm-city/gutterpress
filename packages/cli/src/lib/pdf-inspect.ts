/**
 * In-process PDF inspection via unpdf (a serverless-tuned PDF.js build).
 *
 * This is the pure-JS replacement for the Poppler suite (pdfinfo, pdffonts,
 * pdfimages, pdftotext) and the general qpdf inspection used by the post-build
 * validation checks. It has ZERO system dependency and — unlike raw pdfjs-dist,
 * whose `legacy` build eagerly evaluates canvas/DOMMatrix code — unpdf bundles
 * cleanly under `bun build --compile` (verified). See ADR 0002.
 *
 * NOT replaced here (still system tools, by design):
 *   - Ghostscript (gs): ink coverage + PDF/X CMYK conversion — no JS equivalent.
 *   - qpdf: PDF/X OutputIntent/DOCINFO structure checks (pdfx-*) — needs raw
 *     catalog/object access pdfjs has no public API for, and qpdf is already
 *     mandatory whenever PDF/X is produced.
 *
 * Fidelity notes (accepted in ADR 0002):
 *   - Structural integrity (`isLoadable`) is a "does it parse" gate, not a deep
 *     `qpdf --check` of xref/stream-length integrity.
 *   - Image DPI requires decoding the image to read its pixel dimensions and is
 *     therefore best-effort; bleed-box reads fall back to a raw-byte scan because
 *     pdfjs exposes no TrimBox/BleedBox accessor.
 *
 * Loaded documents are cached per path (invalidated on size/mtime change) so a
 * single validation run parses a large PDF once across all checks.
 */

import { stat, readFile } from "node:fs/promises";
import { getDocumentProxy } from "unpdf";
import * as pdfjs from "unpdf/pdfjs";
import type { PDFDocumentProxy, PDFPageProxy } from "unpdf/pdfjs";

function getOps(mod: object): Record<string, number> {
  if ("OPS" in mod && mod.OPS && typeof mod.OPS === "object") {
    return mod.OPS as Record<string, number>;
  }
  throw new Error("unpdf/pdfjs missing OPS export");
}

const OPS = getOps(pdfjs);

// ---------------------------------------------------------------------------
// Document cache (path -> parsed document, keyed by size+mtime)
// ---------------------------------------------------------------------------

interface CacheEntry {
  mtimeMs: number;
  size: number;
  doc: Promise<PDFDocumentProxy>;
}
const docCache = new Map<string, CacheEntry>();

/**
 * Cap on distinct cached documents (audit B3). One validation run touches a
 * single PDF across ~13 checks (one entry), so this only bounds accumulation
 * ACROSS runs in a long-lived host (the Electron desktop validating many
 * projects over a session). Without it, `docCache` grew one never-freed parsed
 * document per distinct path ever validated. LRU eviction destroys the evicted
 * document so its decoded pages/fonts/images are released, not just unreferenced.
 * (Exported so tests derive their eviction fixtures from the real cap.)
 */
export const DOC_CACHE_MAX = 8;

function destroyEntry(entry: CacheEntry): void {
  entry.doc.then((d) => d.destroy()).catch(() => {});
}

/**
 * Grace period before an LRU-evicted document is destroyed (review finding):
 * a caller that obtained the proxy from `loadPdf` may still be mid-check when
 * the entry gets evicted by unrelated loads — destroying immediately would
 * make its in-flight page reads throw "Transport destroyed". Individual
 * checks complete in seconds; a minute of grace lets them drain while still
 * bounding memory. (Same-path stale replacement keeps immediate destroy —
 * that behavior predates the LRU and the superseded doc's file has changed.)
 */
const EVICT_DESTROY_GRACE_MS = 60_000;

/**
 * Evicted entries still inside their destroy grace. Tracked so `clearPdfCache`
 * can cancel the timers and destroy them immediately — otherwise validating
 * many distinct PDFs in quick succession retains up to a minute's worth of
 * fully-parsed documents BEYOND the DOC_CACHE_MAX cap.
 */
const gracePending = new Map<ReturnType<typeof setTimeout>, CacheEntry>();

function destroyEntryAfterGrace(entry: CacheEntry): void {
  const t = setTimeout(() => {
    gracePending.delete(t);
    destroyEntry(entry);
  }, EVICT_DESTROY_GRACE_MS);
  // Never keep the process alive just to reclaim cache memory.
  t.unref?.();
  gracePending.set(t, entry);
}

/** Evict least-recently-used entries until the cache is within its cap. */
function evictLru(): void {
  while (docCache.size > DOC_CACHE_MAX) {
    // Map iteration order is insertion order; the first key is the LRU one
    // because `loadPdf` re-inserts on every hit (see below).
    const oldestKey = docCache.keys().next().value as string | undefined;
    if (oldestKey === undefined) break;
    const evicted = docCache.get(oldestKey);
    docCache.delete(oldestKey);
    if (evicted) destroyEntryAfterGrace(evicted);
  }
}

/**
 * Load (and cache) a PDF as a PDF.js document proxy. Returns null if the file
 * is missing or cannot be parsed at all. Concurrent callers for the same path
 * share one parse.
 */
export async function loadPdf(path: string): Promise<PDFDocumentProxy | null> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return null;
  }

  const hit = docCache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) {
    // Touch: re-insert so this path becomes most-recently-used for the LRU.
    docCache.delete(path);
    docCache.set(path, hit);
    try {
      return await hit.doc;
    } catch {
      return null;
    }
  }
  // Stale entry → free the old document before replacing it.
  if (hit) destroyEntry(hit);

  const docPromise = readFile(path).then((buf) =>
    getDocumentProxy(new Uint8Array(buf))
  );
  docCache.delete(path);
  docCache.set(path, { mtimeMs: st.mtimeMs, size: st.size, doc: docPromise });
  evictLru();

  try {
    return await docPromise;
  } catch {
    // Identity guard (review finding): only drop OUR entry — a concurrent
    // caller may have re-inserted a newer one for this path after an eviction,
    // and an unguarded delete would silently discard their live document.
    if (docCache.get(path)?.doc === docPromise) docCache.delete(path);
    return null;
  }
}

/**
 * Count of active retain scopes (see `retainPdfCache`). While non-zero, the
 * end-of-run reclaim is deferred — some run is still (potentially) mid-read.
 */
let activeRetains = 0;

/**
 * Retain the document cache for the duration of a run. The check runner is a
 * public lib export served by a long-lived host (the desktop), where two runs
 * CAN overlap — e.g. a Problems-panel lint run and a publish preflight. An
 * unconditional `clearPdfCache()` at either run's end would destroy documents
 * the other run is actively reading (getPage/getOperatorList then throw
 * "Transport destroyed") and would void the eviction grace protecting its
 * evicted-but-held documents. So each run holds a scope instead: the returned
 * release function decrements the count and performs the clear only when the
 * LAST active scope releases. Release is idempotent — extra calls are no-ops.
 */
export function retainPdfCache(): () => void {
  activeRetains++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    activeRetains--;
    if (activeRetains === 0) clearPdfCache();
  };
}

/**
 * Destroy and drop every cached document, including evicted ones still inside
 * their destroy grace (their timers are cancelled). This is the FORCEFUL,
 * unconditional reclaim — it ignores active retain scopes, so hosts should
 * prefer `retainPdfCache()` (which clears when the last overlapping run
 * releases); the check runner uses that scope. Exposed for tests and for
 * hosts that know no run is in flight.
 */
export function clearPdfCache(): void {
  for (const [t, entry] of gracePending) {
    clearTimeout(t);
    destroyEntry(entry);
  }
  gracePending.clear();
  for (const entry of docCache.values()) destroyEntry(entry);
  docCache.clear();
}

/** Test-only introspection: evicted documents still awaiting grace destruction. */
export function pendingGraceDestroyCount(): number {
  return gracePending.size;
}

// ---------------------------------------------------------------------------
// Page geometry
// ---------------------------------------------------------------------------

/** Page dimensions in PostScript points (1/72") for the given 1-based page. */
export function getPageSize(
  page: PDFPageProxy
): { w: number; h: number } {
  const vp = page.getViewport({ scale: 1 });
  return { w: vp.width, h: vp.height };
}

// ---------------------------------------------------------------------------
// Navigation structures (replaces qpdf --list-all-objects regex scans)
// ---------------------------------------------------------------------------

/** Number of top-level outline (bookmark) entries; 0 if none. */
export async function getOutlineCount(doc: PDFDocumentProxy): Promise<number> {
  try {
    const outline = await doc.getOutline();
    return outline ? outline.length : 0;
  } catch {
    return 0;
  }
}

/** Page label array, or null when the PDF declares no explicit labels. */
export async function getPageLabels(
  doc: PDFDocumentProxy
): Promise<string[] | null> {
  try {
    return await doc.getPageLabels();
  } catch {
    return null;
  }
}

/**
 * Count link annotations across the whole document. `stopAtFirst` short-circuits
 * for the boolean "are there any links?" question (TOC-links check).
 */
export async function countLinkAnnotations(
  doc: PDFDocumentProxy,
  stopAtFirst = false
): Promise<number> {
  let count = 0;
  for (let i = 1; i <= doc.numPages; i++) {
    try {
      const page = await doc.getPage(i);
      const annots = await page.getAnnotations();
      for (const a of annots) {
        if ((a as { subtype?: string }).subtype === "Link") {
          count++;
          if (stopAtFirst) return count;
        }
      }
    } catch {
      // skip unreadable page
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Text (replaces pdftotext) — single pass, memoized per document
// ---------------------------------------------------------------------------

/** One non-whitespace text run's exact string plus its extents, in PDF points. */
export interface TextRun {
  /** Verbatim run string (never normalized/rounded) — pdf.js item `str`. */
  s: string;
  /** Baseline origin x — item `transform[4]`. */
  x: number;
  /** Baseline origin y — item `transform[5]`. */
  y: number;
  /** Advance width, "in device space" per pdf.js (points, at the unscaled
   *  viewport this module always reads at — see getPageSize). */
  w: number;
  /** Glyph height, same space as `w`. */
  h: number;
}

export interface TextPass {
  /** Non-whitespace-stripped text per page (index 0 = page 1). */
  textByPage: string[];
  /** Every text run's baseline origin, for layout-variance analysis. */
  positions: Array<{ x: number; y: number }>;
  /**
   * Every non-whitespace text run's exact string + extents, per page (index
   * 0 = page 1) — same filter as `positions` above (whitespace-only items
   * excluded), plus the run's width/height. Added for the render-parity gate
   * (render-parity.ts's `extractReport`); `textByPage`/`positions` are
   * untouched and still hold their original values.
   */
  runsByPage: TextRun[][];
}
const textCache = new WeakMap<PDFDocumentProxy, Promise<TextPass>>();

export function getTextPass(doc: PDFDocumentProxy): Promise<TextPass> {
  let p = textCache.get(doc);
  if (!p) {
    p = (async () => {
      const textByPage: string[] = [];
      const positions: Array<{ x: number; y: number }> = [];
      const runsByPage: TextRun[][] = [];
      for (let i = 1; i <= doc.numPages; i++) {
        try {
          const page = await doc.getPage(i);
          const tc = await page.getTextContent();
          let pageText = "";
          const runs: TextRun[] = [];
          for (const item of tc.items) {
            const it = item as {
              str?: string;
              transform?: number[];
              width?: number;
              height?: number;
            };
            if (typeof it.str !== "string") continue;
            pageText += it.str;
            if (it.transform && it.str.trim().length > 0) {
              const x = it.transform[4]!;
              const y = it.transform[5]!;
              positions.push({ x, y });
              runs.push({ s: it.str, x, y, w: it.width ?? 0, h: it.height ?? 0 });
            }
          }
          textByPage.push(pageText);
          runsByPage.push(runs);
        } catch {
          textByPage.push("");
          runsByPage.push([]);
        }
      }
      return { textByPage, positions, runsByPage };
    })();
    textCache.set(doc, p);
  }
  return p;
}

// ---------------------------------------------------------------------------
// Operator-list pass: images + fonts (replaces pdfimages + pdffonts)
// One pass per document, memoized.
// ---------------------------------------------------------------------------

export interface ImageRef {
  /** XObject resource name (or "(inline)" for inline images). */
  name: string;
  /** Rendered width/height on the page, in points (from the CTM). */
  placedW: number;
  placedH: number;
  /**
   * Placed origin, in points — the CTM's translation components (`ctm[4]`,
   * `ctm[5]`). Added for the render-parity gate (render-parity.ts); `name`/
   * `placedW`/`placedH`/`page` are untouched.
   */
  x: number;
  y: number;
  /** 1-based page number. */
  page: number;
}

export interface FontRef {
  name: string;
  embedded: boolean;
}

export interface OpPass {
  imagesByPage: Map<number, ImageRef[]>;
  fonts: FontRef[];
}
const opCache = new WeakMap<PDFDocumentProxy, Promise<OpPass>>();

function multiply(m1: number[], m2: number[]): number[] {
  return [
    m1[0]! * m2[0]! + m1[2]! * m2[1]!,
    m1[1]! * m2[0]! + m1[3]! * m2[1]!,
    m1[0]! * m2[2]! + m1[2]! * m2[3]!,
    m1[1]! * m2[2]! + m1[3]! * m2[3]!,
    m1[0]! * m2[4]! + m1[2]! * m2[5]! + m1[4]!,
    m1[1]! * m2[4]! + m1[3]! * m2[5]! + m1[5]!,
  ];
}

/**
 * Decide whether a PDF.js font object is embedded. Chromium (Gutterpress's only
 * PDF source) subsets and embeds every font, so the common case is "true".
 * We only report NOT-embedded on a positive signal (`missingFile` /
 * `isStandardFont`) to avoid false alarms on good output — a deliberate
 * sensitivity trade-off vs `pdffonts` (see ADR 0002).
 */
function fontIsEmbedded(f: {
  missingFile?: boolean;
  isStandardFont?: boolean;
  isType3Font?: boolean;
}): boolean {
  if (f.isType3Font) return true; // Type3 glyphs are inline content, always present
  if (f.missingFile === true) return false;
  if (f.isStandardFont === true) return false;
  return true;
}

export function getOpPass(doc: PDFDocumentProxy): Promise<OpPass> {
  let p = opCache.get(doc);
  if (!p) {
    p = (async () => {
      const imagesByPage = new Map<number, ImageRef[]>();
      const fonts: FontRef[] = [];
      const seenFonts = new Set<string>();

      for (let i = 1; i <= doc.numPages; i++) {
        let page: PDFPageProxy;
        try {
          page = await doc.getPage(i);
        } catch {
          continue;
        }
        let ops;
        try {
          ops = await page.getOperatorList();
        } catch {
          continue;
        }

        let ctm = [1, 0, 0, 1, 0, 0];
        const stack: number[][] = [];
        const pageImages: ImageRef[] = [];

        for (let j = 0; j < ops.fnArray.length; j++) {
          const fn = ops.fnArray[j];
          const args = ops.argsArray[j] as unknown[];
          if (fn === OPS.save) {
            stack.push(ctm.slice());
          } else if (fn === OPS.restore) {
            ctm = stack.pop() ?? ctm;
          } else if (fn === OPS.transform) {
            ctm = multiply(ctm, args as number[]);
          } else if (
            fn === OPS.paintImageXObject ||
            fn === OPS.paintImageXObjectRepeat ||
            fn === OPS.paintInlineImageXObject
          ) {
            const name =
              typeof args[0] === "string" ? (args[0] as string) : "(inline)";
            pageImages.push({
              name,
              placedW: Math.hypot(ctm[0]!, ctm[1]!),
              placedH: Math.hypot(ctm[2]!, ctm[3]!),
              x: ctm[4]!,
              y: ctm[5]!,
              page: i,
            });
          } else if (fn === OPS.setFont) {
            const ref = args[0];
            if (typeof ref === "string" && !seenFonts.has(ref)) {
              seenFonts.add(ref);
              try {
                if (page.commonObjs.has(ref)) {
                  const f = page.commonObjs.get(ref) as {
                    name?: string;
                    missingFile?: boolean;
                    isStandardFont?: boolean;
                    isType3Font?: boolean;
                  };
                  fonts.push({
                    name: f?.name ?? ref,
                    embedded: fontIsEmbedded(f ?? {}),
                  });
                }
              } catch {
                // font object not ready — skip
              }
            }
          }
        }
        if (pageImages.length > 0) imagesByPage.set(i, pageImages);
      }
      return { imagesByPage, fonts };
    })();
    opCache.set(doc, p);
  }
  return p;
}

/**
 * Await an image XObject's pixel dimensions (requires PDF.js to decode it).
 * Bounded by a timeout so a slow/broken image can't hang validation.
 */
function getImagePixelSize(
  page: PDFPageProxy,
  name: string,
  timeoutMs = 2000
): Promise<{ width: number; height: number } | null> {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v: { width: number; height: number } | null) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    const t = setTimeout(() => finish(null), timeoutMs);
    try {
      page.objs.get(name, (obj: { width?: number; height?: number } | null) => {
        clearTimeout(t);
        finish(
          obj && obj.width && obj.height
            ? { width: obj.width, height: obj.height }
            : null
        );
      });
    } catch {
      clearTimeout(t);
      finish(null);
    }
  });
}

/**
 * Per-image effective DPI = pixel dimension ÷ placed size in inches. Decodes
 * each image (best-effort). Used only by the opt-in image-resolution check.
 */
export async function getImageResolutions(
  doc: PDFDocumentProxy
): Promise<Array<{ page: number; xDpi: number; yDpi: number }>> {
  const { imagesByPage } = await getOpPass(doc);
  const out: Array<{ page: number; xDpi: number; yDpi: number }> = [];
  for (const [pageNum, imgs] of imagesByPage) {
    let page: PDFPageProxy;
    try {
      page = await doc.getPage(pageNum);
    } catch {
      continue;
    }
    for (const img of imgs) {
      if (img.name === "(inline)") continue;
      const px = await getImagePixelSize(page, img.name);
      if (!px) continue;
      const placedWin = img.placedW / 72;
      const placedHin = img.placedH / 72;
      if (placedWin <= 0 || placedHin <= 0) continue;
      out.push({
        page: pageNum,
        xDpi: px.width / placedWin,
        yDpi: px.height / placedHin,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Structural integrity gate (degraded replacement for qpdf --check)
// ---------------------------------------------------------------------------

/**
 * "Does it parse" gate: load every page. Returns true if the whole document is
 * traversable. This is NOT a deep xref/stream-length integrity check — it only
 * catches PDFs that are actually broken/unparseable (ADR 0002).
 */
export async function isLoadable(doc: PDFDocumentProxy): Promise<boolean> {
  try {
    for (let i = 1; i <= doc.numPages; i++) {
      await doc.getPage(i);
    }
    return true;
  } catch {
    return false;
  }
}
