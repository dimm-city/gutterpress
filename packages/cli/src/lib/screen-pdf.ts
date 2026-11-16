/**
 * A smaller PDF to read on screen.
 *
 * Chromium stores every picture that did not come from a JPEG losslessly
 * (Flate) at its full source resolution, so a book with full-page art runs to
 * hundreds of MB. This pass keeps each such picture at {@link SCREEN_PPI} of
 * the largest size it is drawn at, and stores a colour one as a JPEG. Only the
 * picture streams change: text, fonts, links, bookmarks and tags stay exactly
 * as Chromium wrote them (Ghostscript's `pdfwrite` drops the tags, measured).
 *
 * Left as they are: JPEGs (already small), pictures this pass cannot see drawn
 * (it cannot know their size), and any it does not decode (predictors, 16-bit,
 * CMYK, indexed, colour-key masks, `/Decode` arrays).
 */
import { encode as encodeJpeg } from "jpeg-js";
import { unzlibSync, zlibSync } from "fflate";
import {
  decodePDFRawStream,
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFRef,
  type PDFContext,
} from "pdf-lib";

import { tokenize } from "./black-text-gray.ts";

/** Pixels per inch kept: sharp on a high-density screen, a fraction of print's bytes. */
export const SCREEN_PPI = 200;
const JPEG_QUALITY = 85;

type Matrix = [number, number, number, number, number, number];
const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];
const mul = (a: Matrix, b: Matrix): Matrix => [
  a[0] * b[0] + a[1] * b[2],
  a[0] * b[1] + a[1] * b[3],
  a[2] * b[0] + a[3] * b[2],
  a[2] * b[1] + a[3] * b[3],
  a[4] * b[0] + a[5] * b[2] + b[4],
  a[4] * b[1] + a[5] * b[3] + b[5],
];

const num = (v: unknown) => Number(String(v));
const name = (k: string) => PDFName.of(k);
const matrixOf = (dict: PDFDict): Matrix => {
  const m = dict.lookupMaybe(name("Matrix"), PDFArray)?.asArray().map(num);
  return m?.length === 6 && !m.some(Number.isNaN) ? (m as Matrix) : IDENTITY;
};

/** The largest size, in pixels at {@link SCREEN_PPI}, each picture is drawn at. */
function drawnSizes(doc: PDFDocument): Map<PDFRef, { w: number; h: number }> {
  const ctx = doc.context;
  const sizes = new Map<PDFRef, { w: number; h: number }>();
  const text = (s: PDFRawStream) => Buffer.from(decodePDFRawStream(s).decode()).toString("latin1");

  const walk = (src: string, res: PDFDict | undefined, base: Matrix, depth: number) => {
    if (depth > 20) return;
    // A tiling pattern paints in the space of the stream that owns it.
    for (const [, ref] of res?.lookupMaybe(name("Pattern"), PDFDict)?.entries() ?? []) {
      const pat = ctx.lookup(ref);
      if (pat instanceof PDFRawStream && num(pat.dict.get(name("PatternType"))) === 1) {
        walk(text(pat), pat.dict.lookupMaybe(name("Resources"), PDFDict), mul(matrixOf(pat.dict), base), depth + 1);
      }
    }
    const xobjects = res?.lookupMaybe(name("XObject"), PDFDict);
    const saved: Matrix[] = [];
    let ctm = base;
    const operands: string[] = [];
    for (const tok of tokenize(src)) {
      if (!tok.op) {
        operands.push(tok.text);
        continue;
      }
      if (tok.text === "q") saved.push(ctm);
      else if (tok.text === "Q") ctm = saved.pop() ?? base;
      else if (tok.text === "cm" && operands.length >= 6) ctm = mul(operands.slice(-6).map(Number) as Matrix, ctm);
      else if (tok.text === "Do" && operands.length) {
        const ref = xobjects?.get(name(operands.at(-1)!.slice(1)));
        const obj = ref instanceof PDFRef ? ctx.lookup(ref) : undefined;
        if (ref instanceof PDFRef && obj instanceof PDFRawStream) {
          const subtype = obj.dict.get(name("Subtype"));
          if (subtype === name("Image")) {
            // An image fills the unit square: its drawn size is the CTM's axes.
            const w = (Math.hypot(ctm[0], ctm[1]) / 72) * SCREEN_PPI;
            const h = (Math.hypot(ctm[2], ctm[3]) / 72) * SCREEN_PPI;
            const seen = sizes.get(ref);
            sizes.set(ref, { w: Math.max(w, seen?.w ?? 0), h: Math.max(h, seen?.h ?? 0) });
          } else if (subtype === name("Form")) {
            walk(text(obj), obj.dict.lookupMaybe(name("Resources"), PDFDict) ?? res, mul(matrixOf(obj.dict), ctm), depth + 1);
          }
        }
      }
      operands.length = 0;
    }
  };

  for (const page of doc.getPages()) {
    const contents = page.node.Contents();
    const streams = contents instanceof PDFArray ? contents.asArray().map((r) => ctx.lookup(r)) : [contents];
    const src = streams.filter((s) => s instanceof PDFRawStream).map((s) => text(s as PDFRawStream));
    walk(src.join("\n"), page.node.Resources(), IDENTITY, 0);
  }
  return sizes;
}

/** Raw 8-bit samples and their channel count, or null for a picture this pass leaves alone. */
function samples(ctx: PDFContext, img: PDFRawStream): { px: Uint8Array; n: 1 | 3 } | null {
  const d = img.dict;
  if (d.get(name("Filter")) !== name("FlateDecode") || num(d.get(name("BitsPerComponent"))) !== 8) return null;
  if (d.has(name("DecodeParms")) || d.has(name("Decode")) || d.has(name("Mask")) || d.has(name("ImageMask"))) return null;
  const cs = ctx.lookup(d.get(name("ColorSpace")));
  const n =
    cs === name("DeviceGray") ? 1
    : cs === name("DeviceRGB") ? 3
    : cs instanceof PDFArray && cs.get(0) === name("ICCBased") ? num((ctx.lookup(cs.get(1)) as PDFRawStream).dict.get(name("N")))
    : 0;
  if (n !== 1 && n !== 3) return null;
  const px = unzlibSync(img.contents);
  return px.length === num(d.get(name("Width"))) * num(d.get(name("Height"))) * n ? { px, n } : null;
}

/** Area-average downscale of `n`-channel pixels from w x h to W x H. */
function shrink(px: Uint8Array, w: number, h: number, n: number, W: number, H: number): Uint8Array {
  const out = new Uint8Array(W * H * n);
  const xs = Array.from({ length: W + 1 }, (_, X) => Math.floor((X * w) / W));
  const sum = new Float64Array(W * n);
  for (let Y = 0; Y < H; Y++) {
    const y0 = Math.floor((Y * h) / H);
    const y1 = Math.max(y0 + 1, Math.floor(((Y + 1) * h) / H));
    sum.fill(0);
    for (let y = y0; y < y1; y++) {
      for (let X = 0; X < W; X++) {
        const x1 = Math.max(xs[X]! + 1, xs[X + 1]!);
        for (let x = xs[X]!; x < x1; x++) {
          const i = (y * w + x) * n;
          for (let k = 0; k < n; k++) sum[X * n + k]! += px[i + k]!;
        }
      }
    }
    for (let X = 0; X < W; X++) {
      const count = (y1 - y0) * Math.max(1, xs[X + 1]! - xs[X]!);
      for (let k = 0; k < n; k++) out[(Y * W + X) * n + k] = Math.round(sum[X * n + k]! / count);
    }
  }
  return out;
}

/** Replace a picture's samples, keeping every other entry of its dictionary. */
function replace(ctx: PDFContext, ref: PDFRef, old: PDFRawStream, data: Uint8Array, set: Record<string, unknown>) {
  const entries: Record<string, unknown> = {};
  for (const [k, v] of old.dict.entries()) if (k !== name("Length")) entries[k.decodeText()] = v;
  ctx.assign(ref, ctx.stream(data, { ...entries, ...set } as never));
}

/** The book's PDF made small enough to download, for reading on screen. */
export async function shrinkForScreen(pdf: Uint8Array): Promise<Uint8Array> {
  const doc = await PDFDocument.load(pdf, { updateMetadata: false });
  const ctx = doc.context;
  for (const [ref, need] of drawnSizes(doc)) {
    const img = ctx.lookup(ref) as PDFRawStream;
    const got = samples(ctx, img);
    if (!got) continue;
    const w = num(img.dict.get(name("Width")));
    const h = num(img.dict.get(name("Height")));
    const f = Math.min(1, Math.max(need.w / w, need.h / h));
    const W = Math.max(1, Math.round(w * f));
    const H = Math.max(1, Math.round(h * f));
    const px = W < w ? shrink(got.px, w, h, got.n, W, H) : got.px;
    if (got.n === 1) {
      // jpeg-js writes three channels only; a grey picture stays lossless.
      if (W < w) replace(ctx, ref, img, zlibSync(px), { Width: W, Height: H });
    } else {
      const rgba = new Uint8Array(W * H * 4);
      for (let i = 0; i < W * H; i++) {
        rgba[i * 4] = px[i * 3]!;
        rgba[i * 4 + 1] = px[i * 3 + 1]!;
        rgba[i * 4 + 2] = px[i * 3 + 2]!;
        rgba[i * 4 + 3] = 255;
      }
      const jpeg = encodeJpeg({ data: rgba, width: W, height: H }, JPEG_QUALITY).data;
      replace(ctx, ref, img, jpeg, { Width: W, Height: H, Filter: "DCTDecode" });
    }
    // The soft mask (transparency) follows the picture's new size.
    const maskRef = img.dict.get(name("SMask"));
    const mask = maskRef instanceof PDFRef ? ctx.lookup(maskRef) : undefined;
    if (W < w && maskRef instanceof PDFRef && mask instanceof PDFRawStream) {
      const m = samples(ctx, mask);
      const mw = num(mask.dict.get(name("Width")));
      const mh = num(mask.dict.get(name("Height")));
      if (m?.n === 1 && (mw !== W || mh !== H)) {
        replace(ctx, maskRef, mask, zlibSync(shrink(m.px, mw, mh, 1, W, H)), { Width: W, Height: H });
      }
    }
  }
  return doc.save({ useObjectStreams: false });
}
