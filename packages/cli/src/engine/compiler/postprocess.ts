/**
 * Postprocess (§8) — pure JS, pdf-lib, Bun/Node-native.
 *
 * Sets the PDF box metadata from geometry the compiler already knows, draws
 * crop/registration marks in the slug, pads to a signature multiple, and
 * embeds document metadata. Output contract: an RGB PDF at final media size
 * with correct boxes and embedded fonts — the hand-off point to the existing
 * pdfx pipeline (Ghostscript PDF/X-1a, ICC, ink coverage).
 */
import { PDFDocument, PDFName, PDFNumber, rgb } from "pdf-lib";
import type { PageTrim } from "./tier2.ts";

export interface PostprocessOptions {
  geometry: PageTrim;
  /** append blank pages until pageCount % signature === 0 */
  signature?: number;
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string[];
  /** draw crop marks even if CSS didn't ask */
  marks?: boolean;
}

export interface PostprocessResult {
  bytes: Uint8Array;
  pageCount: number;
  padded: number;
  boxes: { media: number[]; bleed: number[]; trim: number[] };
}

export async function postprocess(
  input: Uint8Array,
  opts: PostprocessOptions,
): Promise<PostprocessResult> {
  // updateMetadata:false — pdf-lib otherwise stamps ITSELF as Producer at load
  // time, clobbering Chromium's. Folio's postprocess edits boxes; it is not the
  // document's producer.
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  const g = opts.geometry;
  const inset = g.bleed + g.slug;

  const media = [0, 0, g.media.width, g.media.height];
  const bleedBox = [
    g.slug,
    g.slug,
    g.media.width - g.slug,
    g.media.height - g.slug,
  ];
  const trimBox = [
    inset,
    inset,
    g.media.width - inset,
    g.media.height - inset,
  ];

  // ---- signature padding -------------------------------------------------
  let padded = 0;
  if (opts.signature && opts.signature > 1) {
    const remainder = doc.getPageCount() % opts.signature;
    if (remainder !== 0) {
      padded = opts.signature - remainder;
      for (let i = 0; i < padded; i++) doc.addPage([g.media.width, g.media.height]);
    }
  }

  const wantMarks = opts.marks || g.marks.includes("crop") || g.marks.includes("cross");

  for (const page of doc.getPages()) {
    const node = page.node;
    const set = (name: string, box: number[]) =>
      node.set(
        PDFName.of(name),
        doc.context.obj(box.map((v) => PDFNumber.of(round(v)))),
      );
    // A padded blank page is created at media size already; a printed page may
    // be at media size too (Tier 2 grew `size`). Either way the boxes are
    // authoritative and identical for every page.
    set("MediaBox", media);
    set("CropBox", media);
    if (g.bleed > 0 || g.slug > 0) {
      set("BleedBox", bleedBox);
      set("TrimBox", trimBox);
    } else {
      set("TrimBox", media);
    }
    if (wantMarks && g.slug > 0) drawCropMarks(page, g);
  }

  // Preserve-unless-provided: only fields the caller passed are written;
  // Producer/Creator stay whatever the renderer put there.
  if (opts.title) doc.setTitle(opts.title);
  if (opts.author) doc.setAuthor(opts.author);
  if (opts.subject) doc.setSubject(opts.subject);
  if (opts.keywords?.length) doc.setKeywords(opts.keywords);

  // Object streams: measured 41% smaller and 2.5x faster to save on a 61-page
  // book (979 KB/225 ms -> 579 KB/89 ms), byte-identical structure to both
  // pdf-lib and PyMuPDF readers.
  const bytes = await doc.save({ useObjectStreams: true });
  return {
    bytes,
    pageCount: doc.getPageCount(),
    padded,
    boxes: { media, bleed: bleedBox, trim: trimBox },
  };
}

/** Crop marks sit in the slug, offset from the trim corners by the bleed. */
function drawCropMarks(page: any, g: PageTrim) {
  const inset = g.bleed + g.slug;
  const len = Math.min(g.slug, 18);
  const gap = g.bleed;
  const w = g.media.width;
  const h = g.media.height;
  const color = rgb(0, 0, 0);
  const thickness = 0.25;
  const line = (x: number, y: number, dx: number, dy: number) =>
    page.drawLine({
      start: { x, y },
      end: { x: x + dx, y: y + dy },
      thickness,
      color,
    });

  const xs = [inset, w - inset];
  const ys = [inset, h - inset];
  for (const x of xs) {
    for (const y of ys) {
      const sx = x === inset ? -1 : 1;
      const sy = y === inset ? -1 : 1;
      // horizontal arm, offset outward past the bleed
      line(x + sx * gap, y, sx * len, 0);
      // vertical arm
      line(x, y + sy * gap, 0, sy * len);
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
