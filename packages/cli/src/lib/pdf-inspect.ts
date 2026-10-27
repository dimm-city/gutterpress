/**
 * In-process PDF inspection via unpdf (a serverless-tuned PDF.js build).
 *
 * This is the pure-JS replacement for the Poppler suite (pdfinfo, pdffonts,
 * pdfimages, pdftotext) and the general qpdf inspection used by the post-build
 * validation checks. It has ZERO system dependency and — unlike raw pdfjs-dist,
 * whose `legacy` build eagerly evaluates canvas/DOMMatrix code — unpdf bundles
 * cleanly under `bun build --compile` (verified).
 *
 * NOT replaced here (still system tools, by design):
 *   - Ghostscript (gs): ink coverage + PDF/X CMYK conversion — no JS equivalent.
 *   - qpdf: PDF/X OutputIntent/DOCINFO structure checks (pdfx-*) — needs raw
 *     catalog/object access pdfjs has no public API for, and qpdf is already
 *     mandatory whenever PDF/X is produced.
 *
 * Fidelity notes (accepted):
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
 * Cap on distinct cached documents. One validation run touches a
 * single PDF across ~13 checks (one entry), so this only bounds accumulation
 * ACROSS runs in a long-lived host (the Electron desktop validating many
 * projects over a session). Without it, `docCache` grows one never-freed parsed
 * document per distinct path ever validated. LRU eviction destroys the evicted
 * document so its decoded pages/fonts/images are released, not just unreferenced.
 * (Exported so tests derive their eviction fixtures from the real cap.)
 */
export const DOC_CACHE_MAX = 8;

function destroyEntry(entry: CacheEntry): void {
  entry.doc.then((d) => d.destroy()).catch(() => {});
}

/**
 * Grace period before an LRU-evicted document is destroyed:
 * a caller that obtained the proxy from `loadPdf` may still be mid-check when
 * the entry gets evicted by unrelated loads — destroying immediately would
 * make its in-flight page reads throw "Transport destroyed". Individual
 * checks complete in seconds; a minute of grace lets them drain while still
 * bounding memory. (Same-path stale replacement destroys immediately — the
 * superseded doc's file has changed.)
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
    // Identity guard: only drop OUR entry — a concurrent
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
  /**
   * The drawn rect in points, y up from the sheet's bottom: the unit square
   * under the CTM as its axis-aligned bounds, so it holds for an image drawn
   * flipped or rotated where `x`/`y`/`placedW`/`placedH` do not. The
   * `pdf.print.safe-margins` check judges it against the art rule.
   */
  bounds: { x: number; y: number; w: number; h: number };
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

const opSet = (names: string[]) =>
  new Set<number>(names.map((name) => OPS[name]).filter((op): op is number => op !== undefined));

/**
 * The operators that draw an image. Each paints the unit square under the
 * CTM, so the CTM at that point is the image's placement. `getOperatorList`
 * builds its list unoptimised, so every image is one of these where it is
 * drawn; `paintJpegXObject` is gone from pdf.js but listed should a build
 * still carry it (an unknown name is dropped).
 */
const IMAGE_OPS = opSet([
  "paintImageXObject",
  "paintImageXObjectRepeat",
  "paintInlineImageXObject",
  "paintImageMaskXObject",
  "paintJpegXObject",
]);

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
 * sensitivity trade-off vs `pdffonts`.
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
          const fn = ops.fnArray[j]!;
          const args = ops.argsArray[j] as unknown[];
          if (fn === OPS.save) {
            stack.push(ctm.slice());
          } else if (fn === OPS.restore) {
            ctm = stack.pop() ?? ctm;
          } else if (fn === OPS.transform) {
            ctm = multiply(ctm, args as number[]);
          } else if (fn === OPS.paintFormXObjectBegin) {
            // a form is drawn under its own /Matrix, inside a save/restore of its own
            stack.push(ctm.slice());
            const matrix = args[0];
            if (Array.isArray(matrix)) ctm = multiply(ctm, matrix as number[]);
          } else if (fn === OPS.paintFormXObjectEnd) {
            ctm = stack.pop() ?? ctm;
          } else if (IMAGE_OPS.has(fn)) {
            const name =
              typeof args[0] === "string" ? (args[0] as string) : "(inline)";
            // the image fills the unit square: its bounds are its four corners under the CTM
            const [a, b, c, d, e, f] = ctm as [number, number, number, number, number, number];
            const xs = [e, a + e, c + e, a + c + e];
            const ys = [f, b + f, d + f, b + d + f];
            const x0 = Math.min(...xs);
            const y0 = Math.min(...ys);
            pageImages.push({
              name,
              placedW: Math.hypot(a, b),
              placedH: Math.hypot(c, d),
              x: e,
              y: f,
              bounds: { x: x0, y: y0, w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 },
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

const FILL_COLOR_OPS = opSet(["setFillGray", "setFillRGBColor", "setFillCMYKColor", "setFillColor"]);
const STROKE_COLOR_OPS = opSet(["setStrokeGray", "setStrokeRGBColor", "setStrokeCMYKColor", "setStrokeColor"]);

const SHOW_TEXT_OPS = opSet(["showText", "showSpacedText", "nextLineShowText", "nextLineSetSpacingShowText"]);

/**
 * Why a page is not split from its artwork: its text cannot be (the first
 * three), or it shows no text at all, so there is none to keep (`no-text`).
 */
export type UnsplittableReason = "text-transparency" | "type3-font" | "text-pattern-or-clip" | "no-text";

/**
 * For each 1-based page that `pdfx.transparency: preserve-text` must not split,
 * the first reason found; pages absent from the map can be split. `pages`
 * limits the scan to those pages (the build passes the transparent ones only,
 * so the rest of the book is never decoded).
 *
 * A page's text cannot be split when text SHOWS while transparency is in effect: constant alpha
 * (`ca`/`CA` < 1), a non-Normal blend mode, an active soft mask, or any
 * enclosing transparency group that is composited translucent, blended or
 * masked, or is a knockout group. (Chromium draws `opacity` and
 * `mix-blend-mode` content as a group form XObject under such a state, and
 * resets the state INSIDE the group, so the state at the point the group
 * begins is what counts.) Such text cannot be lifted out of its page and drawn
 * opaque on top of a flattened picture without changing how it looks, so
 * `pdfx.transparency: preserve-text` leaves those pages alone.
 *
 * Also flagged: any page that sets a Type 3 font. Chromium (Skia) emits Type 3
 * for glyphs it can only draw as paths, e.g. the synthetic bold of a
 * single-weight webfont. Their glyph procedures are vector paths, which the
 * text pass's `-dFILTERVECTOR` strips, so the text would print nothing.
 *
 * Also flagged: text painted with a pattern (`scn`/`SCN` to a tiling pattern
 * or shading), as Chromium emits for SVG `<text fill="url(#…)">` and gradient
 * text fills, and text used as a clip (render modes 4-7, `background-clip:
 * text`). The artwork pass removes the glyphs and the text pass's
 * `-dFILTERIMAGE`/`-dFILTERVECTOR` removes their paint, so they would vanish.
 *
 * A plain isolated group composited at alpha 1 / Normal / no mask is NOT
 * counted: painting it is the same as painting its content inline, and
 * Chromium wraps the content of EVERY page in one as soon as any element of
 * the document uses a blend mode (measured on Chromium 141), which would
 * otherwise rule out every page of such a book. The page's OWN `/Group` is
 * likewise ignored.
 *
 * Walks PDF.js's operator list, which has already inlined form XObjects
 * between `paintFormXObjectBegin/End` and reports their `/Group` as
 * `beginGroup/endGroup`. Graphics state is tracked per save/restore (a form
 * XObject is an implicit save/restore).
 */
export async function unsplittableTextReasons(
  pdfBytes: Uint8Array,
  pages?: number[]
): Promise<Map<number, UnsplittableReason>> {
  const GSTATE_BIT: Record<string, number> = { ca: 1, CA: 2, BM: 4, SMask: 8 };
  const COMPOSITING = 15; // the GSTATE_BIT flags: what makes a group count
  const FILL_PATTERN = 16;
  const STROKE_PATTERN = 32;
  const CLIP_TEXT = 64; // text render modes 4-7 add the glyphs to the clip
  const doc = await getDocumentProxy(new Uint8Array(pdfBytes));
  const reasons = new Map<number, UnsplittableReason>();
  try {
    const scan = pages ?? Array.from({ length: doc.numPages }, (_, i) => i + 1);
    for (const i of scan) {
      const page = await doc.getPage(i);
      const ops = await page.getOperatorList();
      let state = 0; // GSTATE_BIT flags currently in effect
      const groups: boolean[] = []; // open groups: composited translucent, blended, masked or knockout?
      const stack: number[] = [];
      let showsText = false;
      for (let j = 0; j < ops.fnArray.length; j++) {
        const fn = ops.fnArray[j]!;
        if (fn === OPS.save || fn === OPS.paintFormXObjectBegin) stack.push(state);
        else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) state = stack.pop() ?? 0;
        else if (fn === OPS.beginGroup) {
          const group = (ops.argsArray[j] as [{ smask?: unknown; knockout?: boolean }])[0];
          groups.push((state & COMPOSITING) !== 0 || !!(group.smask || group.knockout));
        } else if (fn === OPS.endGroup) groups.pop();
        else if (fn === OPS.setFont) {
          const ref = (ops.argsArray[j] as [unknown])[0];
          const font = typeof ref === "string" && page.commonObjs.has(ref) ? page.commonObjs.get(ref) : undefined;
          if ((font as { isType3Font?: boolean } | undefined)?.isType3Font) {
            reasons.set(i, "type3-font");
            break;
          }
        } else if (fn === OPS.setFillColorN || fn === OPS.setStrokeColorN) {
          // PDF.js reports a pattern paint as ["TilingPattern" | "Shading", …];
          // a plain colour comes through setFill/StrokeRGBColor etc. instead.
          const bit = fn === OPS.setFillColorN ? FILL_PATTERN : STROKE_PATTERN;
          const kind = (ops.argsArray[j] as unknown[])[0];
          state = kind === "TilingPattern" || kind === "Shading" ? state | bit : state & ~bit;
        } else if (FILL_COLOR_OPS.has(fn)) state &= ~FILL_PATTERN;
        else if (STROKE_COLOR_OPS.has(fn)) state &= ~STROKE_PATTERN;
        else if (fn === OPS.setTextRenderingMode) {
          state = (ops.argsArray[j] as [number])[0] >= 4 ? state | CLIP_TEXT : state & ~CLIP_TEXT;
        } else if (fn === OPS.setGState) {
          for (const [key, value] of (ops.argsArray[j] as [[string, unknown][]])[0]) {
            const bit = GSTATE_BIT[key];
            if (!bit) continue;
            const on =
              key === "BM" ? value !== "source-over" : key === "SMask" ? !!value : (value as number) < 1;
            state = on ? state | bit : state & ~bit;
          }
        } else if (SHOW_TEXT_OPS.has(fn)) {
          showsText = true;
          if (state || groups.includes(true)) {
            const paint = state & (FILL_PATTERN | STROKE_PATTERN | CLIP_TEXT);
            reasons.set(i, paint ? "text-pattern-or-clip" : "text-transparency");
            break;
          }
        }
      }
      if (!showsText && !reasons.has(i)) reasons.set(i, "no-text");
    }
  } finally {
    await doc.destroy();
  }
  return reasons;
}

const FILL_PAINT_OPS = opSet(["fill", "eoFill", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"]);
const STROKE_PAINT_OPS = opSet(["stroke", "closeStroke", "fillStroke", "eoFillStroke", "closeFillStroke", "closeEOFillStroke"]);

/** A box in device points: x0, y0, x1, y1. */
type Box = [number, number, number, number];

/** Thinner than this in either direction, once clipped, a paint is a sliver. A CSS pixel is 0.75pt. */
const SLIVER_PT = 0.25;

/**
 * Of `pages` (1-based), those on which a shading pattern paints a visible
 * area: a path filled with a `/Pattern` fill colour, or a `sh`, whose box is
 * at least {@link SLIVER_PT} wide and tall once the clip in force is applied.
 * Text shown in a shading pattern, a stroke with one, and a `sh` under an
 * unbounded clip are not sized here and count as visible.
 *
 * The one thing this excludes (#438): a box that starts exactly on a page
 * break and whose ink overflow (a `box-shadow` blur, an `outline`) reaches
 * above its top edge. Chromium paints it into the PREVIOUS page as well — the
 * whole background, clipped to that page's content box — so a repeating or
 * conic gradient on such a box also sits, as a sliver, in the resources and
 * content of the page before it. Its clipped area is empty in exact
 * arithmetic (under 0.01pt when the page's content height is not a whole
 * pixel); a RIP under the any-part-of-pixel rule renders one device row of it.
 * Measured on the ghostscript.flatten fixture with its 1in margins: page 3's
 * content fills page 4's 636x56px gradient box at y = 738pt, the clip's own
 * bottom edge, and a 300dpi raster of page 3 has exactly one non-white row.
 *
 * Walks PDF.js's operator list as {@link unsplittableTextReasons} does, with
 * the CTM and the clip's bounding box tracked per save/restore (a form
 * XObject is an implicit save/restore under its `/Matrix`, inside its
 * `/BBox`). PDF.js reports `W`/`W*` as a `clip`/`eoClip` op ahead of the
 * path it applies to, and every path as `constructPath` with its painting
 * operator and its bounding box.
 */
export async function pagesWithVisibleShadingPaints(
  pdfBytes: Uint8Array,
  pages: number[]
): Promise<number[]> {
  const box = (b: ArrayLike<number>, m: number[]): Box => {
    const xs: number[] = [];
    const ys: number[] = [];
    const corners: Array<[number, number]> = [[b[0]!, b[1]!], [b[2]!, b[1]!], [b[2]!, b[3]!], [b[0]!, b[3]!]];
    for (const [x, y] of corners) {
      xs.push(m[0]! * x + m[2]! * y + m[4]!);
      ys.push(m[1]! * x + m[3]! * y + m[5]!);
    }
    return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  };
  const intersect = (a: Box | null, b: Box): Box =>
    a ? [Math.max(a[0], b[0]), Math.max(a[1], b[1]), Math.min(a[2], b[2]), Math.min(a[3], b[3])] : b;
  const visible = (b: Box | null) => !b || (b[2] - b[0] >= SLIVER_PT && b[3] - b[1] >= SLIVER_PT);

  const doc = await getDocumentProxy(new Uint8Array(pdfBytes));
  const out: number[] = [];
  try {
    for (const i of pages) {
      const ops = await (await doc.getPage(i)).getOperatorList();
      let ctm = [1, 0, 0, 1, 0, 0];
      let clip: Box | null = null; // null: unbounded
      let fillShading = false;
      let strokeShading = false;
      let pendingClip = false;
      const stack: Array<[number[], Box | null, boolean, boolean]> = [];
      let found = false;
      for (let j = 0; j < ops.fnArray.length && !found; j++) {
        const fn = ops.fnArray[j]!;
        const args = ops.argsArray[j] as unknown[];
        if (fn === OPS.save) stack.push([ctm, clip, fillShading, strokeShading]);
        else if (fn === OPS.restore || fn === OPS.paintFormXObjectEnd) {
          const saved = stack.pop();
          if (saved) [ctm, clip, fillShading, strokeShading] = saved;
        } else if (fn === OPS.transform) ctm = multiply(ctm, args as number[]);
        else if (fn === OPS.paintFormXObjectBegin) {
          stack.push([ctm, clip, fillShading, strokeShading]);
          if (Array.isArray(args[0])) ctm = multiply(ctm, args[0] as number[]);
          if (Array.isArray(args[1])) clip = intersect(clip, box(args[1] as number[], ctm));
        } else if (fn === OPS.setFillColorN) fillShading = args[0] === "Shading";
        else if (fn === OPS.setStrokeColorN) strokeShading = args[0] === "Shading";
        else if (FILL_COLOR_OPS.has(fn)) fillShading = false;
        else if (STROKE_COLOR_OPS.has(fn)) strokeShading = false;
        else if (fn === OPS.clip || fn === OPS.eoClip) pendingClip = true;
        else if (fn === OPS.constructPath) {
          const paintOp = args[0] as number;
          const bounds = args[2] ? box(args[2] as ArrayLike<number>, ctm) : null;
          if (fillShading && FILL_PAINT_OPS.has(paintOp) && bounds) found = visible(intersect(clip, bounds));
          if (strokeShading && STROKE_PAINT_OPS.has(paintOp)) found = true;
          if (pendingClip) {
            clip = bounds ? intersect(clip, bounds) : [0, 0, 0, 0];
            pendingClip = false;
          }
        } else if (fn === OPS.shadingFill) found = visible(clip);
        else if (SHOW_TEXT_OPS.has(fn) && fillShading) found = true;
      }
      if (found) out.push(i);
    }
  } finally {
    await doc.destroy();
  }
  return out;
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

// Operators that put ink (or a pixel) on the page. Clips, paths that end in
// `n`, state changes and colour setters do not.
const PAINT_OPS = new Set<number>(
  [
    "stroke", "closeStroke", "fill", "eoFill", "fillStroke", "eoFillStroke",
    "closeFillStroke", "closeEOFillStroke", "shadingFill",
    "paintImageXObject", "paintInlineImageXObject", "paintImageXObjectRepeat",
    "paintImageMaskXObject", "paintImageMaskXObjectGroup", "paintImageMaskXObjectRepeat",
    "paintSolidColorImageMask", "showText", "showSpacedText", "nextLineShowText",
    "nextLineSetSpacingShowText",
  ]
    .map((name) => OPS[name])
    .filter((op): op is number => op !== undefined)
);

/**
 * Does page `pageNum` (1-based) paint anything at all? False for a page with
 * no content and for one whose operators only set state or clip. A path op
 * carries its painting operator as its first argument (`constructPath`).
 */
export async function pageHasMarks(doc: PDFDocumentProxy, pageNum: number): Promise<boolean> {
  const ops = await (await doc.getPage(pageNum)).getOperatorList();
  return ops.fnArray.some((fn, i) =>
    fn === OPS.constructPath
      ? PAINT_OPS.has((ops.argsArray[i] as unknown[])[0] as number)
      : PAINT_OPS.has(fn)
  );
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
 * catches PDFs that are actually broken/unparseable.
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
