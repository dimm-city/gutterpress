/**
 * Raster mode for the render-parity gate (#295). The text/image report is
 * colour-blind: a rule that turns a divider from blue to magenta, or a
 * `@page` background that stops painting, moves no text run. This compares
 * the pages as pixels.
 *
 * Both PDFs are rasterized with poppler's `pdftoppm` (72 dpi, one process per
 * CPU) — a dev-tool dependency of `scripts/render-parity.ts compare --raster`
 * only; nothing here is reachable from the published CLI. Two PDFs printed by
 * the same Chromium in the same job rasterize identically, so any pixel that
 * moves past the per-channel tolerance is a real change. Each differing page
 * becomes one `raster` diff (waivable per page, like every other kind) and
 * gets a `diff-NNN.png` with the changed pixels painted red.
 */
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { availableParallelism, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { deflateSync } from "node:zlib";
import type { Diff } from "./render-parity.ts";

const run = promisify(execFile);

export interface RgbImage {
  w: number;
  h: number;
  /** Packed RGB, 3 bytes per pixel. */
  data: Uint8Array;
}

/** Parse a binary PPM (P6, maxval 255) — what `pdftoppm` writes by default. */
export function parsePpm(buf: Uint8Array): RgbImage {
  let pos = 0;
  const token = (): string => {
    for (;;) {
      while (pos < buf.length && /\s/.test(String.fromCharCode(buf[pos]!))) pos++;
      if (buf[pos] !== 0x23) break; // '#' comment line
      while (pos < buf.length && buf[pos] !== 0x0a) pos++;
    }
    const start = pos;
    while (pos < buf.length && !/\s/.test(String.fromCharCode(buf[pos]!))) pos++;
    return String.fromCharCode(...buf.subarray(start, pos));
  };
  const magic = token();
  const w = Number(token());
  const h = Number(token());
  const max = Number(token());
  if (magic !== "P6" || max !== 255 || !(w > 0) || !(h > 0)) {
    throw new Error(`Not an 8-bit binary PPM (${magic} ${w}x${h} max ${max})`);
  }
  pos++; // the single whitespace byte after maxval
  const data = buf.subarray(pos, pos + w * h * 3);
  if (data.length !== w * h * 3) throw new Error("Truncated PPM");
  return { w, h, data };
}

/**
 * Count pixels where any channel differs by more than `tolerance` (a fraction
 * of 255; 0.01 = 1%), and return a copy of `cand` with those pixels painted
 * red. Images of different sizes differ everywhere and get no diff image.
 */
export function comparePixels(
  base: RgbImage,
  cand: RgbImage,
  tolerance: number,
): { differing: number; marked: RgbImage | null } {
  if (base.w !== cand.w || base.h !== cand.h) {
    return { differing: Math.max(base.w * base.h, cand.w * cand.h), marked: null };
  }
  const limit = tolerance * 255;
  const out = new Uint8Array(cand.data);
  let differing = 0;
  for (let i = 0; i < out.length; i += 3) {
    if (
      Math.abs(base.data[i]! - cand.data[i]!) > limit ||
      Math.abs(base.data[i + 1]! - cand.data[i + 1]!) > limit ||
      Math.abs(base.data[i + 2]! - cand.data[i + 2]!) > limit
    ) {
      differing++;
      out[i] = 255;
      out[i + 1] = 0;
      out[i + 2] = 0;
    }
  }
  return { differing, marked: { w: cand.w, h: cand.h, data: out } };
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, body.length);
  out.set(Buffer.from(type, "ascii"), 4);
  out.set(body, 8);
  view.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}

/** Encode an RGB image as a PNG (8-bit truecolour, no filtering). */
export function encodePng(img: RgbImage): Uint8Array {
  const header = new Uint8Array(13);
  const hv = new DataView(header.buffer);
  hv.setUint32(0, img.w);
  hv.setUint32(4, img.h);
  header.set([8, 2, 0, 0, 0], 8); // bit depth 8, colour type RGB
  const stride = img.w * 3;
  const raw = new Uint8Array((stride + 1) * img.h);
  for (let y = 0; y < img.h; y++) {
    raw.set(img.data.subarray(y * stride, (y + 1) * stride), y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", new Uint8Array(0)),
  ]);
}

/** Rasterize pages 1..pageCount of `pdf` into `dir`; returns the files by page. */
async function rasterize(pdf: string, pageCount: number, dir: string, dpi: number): Promise<Map<number, string>> {
  const procs = Math.max(1, Math.min(availableParallelism(), pageCount));
  const per = Math.ceil(pageCount / procs);
  const jobs: Promise<unknown>[] = [];
  for (let first = 1; first <= pageCount; first += per) {
    const last = Math.min(pageCount, first + per - 1);
    jobs.push(run("pdftoppm", ["-r", String(dpi), "-f", String(first), "-l", String(last), pdf, join(dir, "p")]));
  }
  try {
    await Promise.all(jobs);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error("--raster needs poppler's pdftoppm on PATH (apt install poppler-utils / brew install poppler).");
    }
    throw err;
  }
  const pages = new Map<number, string>();
  for (const name of await readdir(dir)) {
    const m = /-(\d+)\.ppm$/.exec(name);
    if (m) pages.set(Number(m[1]), join(dir, name));
  }
  return pages;
}

/**
 * Raster-compare the first `pageCount` pages of two PDFs. Returns one `raster`
 * diff per differing page and writes `diff-NNN.png` for each into `outDir`.
 */
export async function rasterDiffs(
  basePdf: string,
  candPdf: string,
  pageCount: number,
  outDir: string,
  options: { dpi?: number; tolerance?: number } = {},
): Promise<Diff[]> {
  const dpi = options.dpi ?? 72;
  const tolerance = options.tolerance ?? 0.01;
  const work = await mkdtemp(join(tmpdir(), "render-parity-raster-"));
  try {
    await mkdir(join(work, "base"));
    await mkdir(join(work, "cand"));
    await mkdir(outDir, { recursive: true });
    const [basePages, candPages] = await Promise.all([
      rasterize(basePdf, pageCount, join(work, "base"), dpi),
      rasterize(candPdf, pageCount, join(work, "cand"), dpi),
    ]);
    const diffs: Diff[] = [];
    for (let page = 1; page <= pageCount; page++) {
      const b = basePages.get(page);
      const c = candPages.get(page);
      if (!b || !c) throw new Error(`pdftoppm produced no image for page ${page}`);
      const base = parsePpm(await readFile(b));
      const cand = parsePpm(await readFile(c));
      const { differing, marked } = comparePixels(base, cand, tolerance);
      if (differing === 0) continue;
      const total = cand.w * cand.h;
      diffs.push({
        page,
        kind: "raster",
        before: `${base.w}x${base.h}`,
        after: marked
          ? `${differing} px differ (${((differing / total) * 100).toFixed(2)}%)`
          : `${cand.w}x${cand.h}`,
      });
      if (marked) {
        await writeFile(join(outDir, `diff-${String(page).padStart(3, "0")}.png`), encodePng(marked));
      }
    }
    return diffs;
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}
