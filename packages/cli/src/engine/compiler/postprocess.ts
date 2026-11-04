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
import { printScale } from "../shared/pdf-inspect.ts";
import { signaturePadding, type LastPageMode } from "../shared/synthesis.ts";
import type { PageTrim } from "./tier2.ts";

export interface PostprocessOptions {
  geometry: PageTrim;
  /**
   * The manifest's `page.bleed` (pt, from the book's print area): a bleed the
   * sheet already contains on the top, bottom and OUTER edge, none at the
   * binding (shared/print-area.ts). The TrimBox is then the sheet pulled in on
   * those three edges, mirrored by page parity (page 1 is a recto, outer edge
   * right). A CSS `@page { bleed }` or slug, which grew the sheet on every
   * side, adds to it: the trim is the sheet less both.
   */
  printBleed?: number;
  /** append blank pages until pageCount % signature === 0 */
  signature?: number;
  /**
   * `blank`: guarantee the last page is a blank page added here (if signature
   * padding would add nothing, append one full signature of blank pages — one
   * page when signature <= 1). `short-by-one`: stop one page short of a
   * multiple of the signature, for the printer to add the last page.
   */
  lastPage?: LastPageMode;
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
  /** page 1's boxes (a verso's three-edge TrimBox is mirrored) */
  boxes: { media: number[]; bleed: number[]; trim: number[] };
  /** The scale Chromium printed at, read before anything here draws:
   * `printScale` in shared/pdf-inspect.ts (1 = not shrunk). */
  scale: number | null;
}

export async function postprocess(
  input: Uint8Array,
  opts: PostprocessOptions,
): Promise<PostprocessResult> {
  // updateMetadata:false — pdf-lib otherwise stamps ITSELF as Producer at load
  // time, clobbering Chromium's. Gutterpress's postprocess edits boxes; it is not the
  // document's producer.
  const doc = await PDFDocument.load(input, { updateMetadata: false });
  const scale = printScale(doc);
  const g = opts.geometry;
  // A CSS `@page { bleed }` or slug grew the sheet around the page on every
  // side; the manifest's `page.bleed` is inside the page, on the top, bottom
  // and outer edge. The trim is the sheet less both.
  const inset = g.bleed + g.slug;
  const b = opts.printBleed && opts.printBleed > 0 ? opts.printBleed : 0;
  const hasBleed = inset > 0 || b > 0;

  const media = [0, 0, g.media.width, g.media.height];
  const bleedBox = [
    g.slug,
    g.slug,
    g.media.width - g.slug,
    g.media.height - g.slug,
  ];
  const trimFor = (recto: boolean) => [
    inset + (recto ? 0 : b),
    inset + b,
    g.media.width - inset - (recto ? b : 0),
    g.media.height - inset - b,
  ];
  const trimBox = trimFor(true);

  // ---- signature padding -------------------------------------------------
  const padded = signaturePadding(doc.getPageCount(), opts.signature, opts.lastPage);
  for (let i = 0; i < padded; i++) doc.addPage([g.media.width, g.media.height]);

  const wantMarks = opts.marks || g.marks.includes("crop") || g.marks.includes("cross");

  for (const [index, page] of doc.getPages().entries()) {
    const node = page.node;
    const set = (name: string, box: number[]) =>
      node.set(
        PDFName.of(name),
        doc.context.obj(box.map((v) => PDFNumber.of(round(v)))),
      );
    // A padded blank page is created at media size already; a printed page may
    // be at media size too (Tier 2 grew `size`). Either way the boxes are
    // authoritative: identical for every page, except that a `printBleed`
    // TrimBox follows the page's side.
    set("MediaBox", media);
    set("CropBox", media);
    const trim = trimFor(index % 2 === 0);
    if (hasBleed) {
      set("BleedBox", bleedBox);
      set("TrimBox", trim);
    } else {
      set("TrimBox", media);
    }
    if (wantMarks && g.slug > 0) drawCropMarks(page, g, trim);
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
    scale,
  };
}

/** Crop marks sit in the slug: on the trim's lines, from the bleed box's edge outward. */
function drawCropMarks(page: any, g: PageTrim, trim: number[]) {
  const len = Math.min(g.slug, 18);
  const [tx0, ty0, tx1, ty1] = trim as [number, number, number, number];
  // the bleed box: the sheet less the slug
  const [bx0, by0, bx1, by1] = [g.slug, g.slug, g.media.width - g.slug, g.media.height - g.slug];
  const color = rgb(0, 0, 0);
  const thickness = 0.25;
  const line = (x: number, y: number, dx: number, dy: number) =>
    page.drawLine({
      start: { x, y },
      end: { x: x + dx, y: y + dy },
      thickness,
      color,
    });

  for (const x of [tx0, tx1]) {
    for (const y of [ty0, ty1]) {
      const sx = x === tx0 ? -1 : 1;
      const sy = y === ty0 ? -1 : 1;
      // horizontal arm, outward from the bleed on this side
      line(x === tx0 ? bx0 : bx1, y, sx * len, 0);
      // vertical arm
      line(x, y === ty0 ? by0 : by1, 0, sy * len);
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1000) / 1000;
}
