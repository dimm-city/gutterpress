/**
 * Raster-image test fixtures for S14 (image-heavy books). New file, sibling
 * to fixtures/make-book.ts — that file is not touched (per the spike's brief).
 *
 * No ImageMagick, no canvas library on disk: PNGs are hand-encoded here with
 * a ~60-line deflate-backed PNG writer (Bun/Node's `node:zlib` does the
 * compression; the container format is ours), so pixel dimensions — and
 * therefore effective DPI — are exact and known ahead of time. JPEGs need a
 * real encoder, so those go through Chrome itself: draw the same pattern on
 * an offscreen `<canvas>` in a live page and read back `toDataURL('image/jpeg')`.
 *
 * Tokens follow fixtures/make-book.ts's convention (`§Pxxx`) so the same
 * token -> page parity technique from s1-break-parity.ts applies unchanged;
 * images carry no extractable text themselves, so each one gets a token in
 * its caption, which the print PDF can see and the DOM id can locate.
 */
import { deflateSync } from "node:zlib";
import type { Session } from "../../../packages/cli/src/engine/shared/cdp.ts";

// ---- tiny PNG encoder ------------------------------------------------------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function u32(n: number): Buffer {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0, 0);
  return b;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const typeBuf = Buffer.from(type, "ascii");
  const crc = crc32(Buffer.concat([typeBuf, data]));
  return Buffer.concat([u32(data.length), typeBuf, data, u32(crc)]);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  h = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return [
    Math.round((r + m) * 255),
    Math.round((g + m) * 255),
    Math.round((b + m) * 255),
  ];
}

export interface PngOptions {
  alpha?: boolean;
  seed?: number;
}

/** Minimal, deterministic PNG encoder (8-bit RGB or RGBA, no filtering, no palette). */
export function makePng(width: number, height: number, opts: PngOptions = {}): Buffer {
  const { alpha = false, seed = 1 } = opts;
  const channels = alpha ? 4 : 3;
  const stride = width * channels + 1;
  const raw = Buffer.alloc(stride * height);
  const hueBase = (seed * 53) % 360;
  for (let y = 0; y < height; y++) {
    const row = y * stride;
    raw[row] = 0; // filter type 0 (none)
    for (let x = 0; x < width; x++) {
      const checker = (Math.floor(x / 24) + Math.floor(y / 24)) % 2 === 0;
      const [r, g, b] = hslToRgb(
        hueBase + (x / width) * 50,
        0.55,
        checker ? 0.52 : 0.72,
      );
      const off = row + 1 + x * channels;
      raw[off] = r;
      raw[off + 1] = g;
      raw[off + 2] = b;
      if (alpha) raw[off + 3] = Math.round(255 * (y / height));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = alpha ? 6 : 2; // color type: 2 = truecolor, 6 = truecolor+alpha
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const idat = deflateSync(raw, { level: 9 });
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  return Buffer.concat([
    sig,
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function pngDataUri(width: number, height: number, opts: PngOptions = {}): string {
  return `data:image/png;base64,${makePng(width, height, opts).toString("base64")}`;
}

// ---- JPEG, via a live Chrome canvas (no JS JPEG encoder here) -------------

/** Draws the same checker/gradient pattern used by makePng() into an
 * offscreen canvas and reads it back as a JPEG data URI. Needs a live page. */
export async function jpegDataUri(
  session: Session,
  width: number,
  height: number,
  seed: number,
  quality = 0.85,
): Promise<string> {
  return session.evaluate<string>(`(() => {
    const c = document.createElement('canvas');
    c.width = ${width}; c.height = ${height};
    const ctx = c.getContext('2d');
    const hueBase = (${seed} * 53) % 360;
    for (let y = 0; y < ${height}; y += 1) {
      for (let x = 0; x < ${width}; x += 4) {
        const checker = (Math.floor(x / 24) + Math.floor(y / 24)) % 2 === 0;
        const l = checker ? 52 : 72;
        ctx.fillStyle = 'hsl(' + (hueBase + (x / ${width}) * 50) + ' 55% ' + l + '%)';
        ctx.fillRect(x, y, 4, 1);
      }
    }
    return c.toDataURL('image/jpeg', ${quality});
  })()`);
}

// ---- inline SVG (baseline format, same recipe as make-book.ts's helper) ---

export function svgDataUri(w: number, h: number, label: string, seed: number): string {
  const hue = (seed * 47) % 360;
  return (
    `data:image/svg+xml;utf8,` +
    encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">` +
        `<rect width="${w}" height="${h}" fill="hsl(${hue} 45% 75%)"/>` +
        `<text x="${w / 2}" y="${h / 2}" font-size="28" text-anchor="middle" fill="#222">${label}</text></svg>`,
    )
  );
}

// ---- page geometry shared with the test book (6in x 9in, §page below) -----

export const PAGE = {
  widthIn: 6,
  heightIn: 9,
  marginXIn: 0.625,
  marginYIn: 0.75,
  get contentWidthIn() {
    return this.widthIn - 2 * this.marginXIn; // 4.75in
  },
  get contentHeightIn() {
    return this.heightIn - 2 * this.marginYIn; // 7.5in
  },
};

export function imageBookCss(): string {
  return `
@page {
  size: ${PAGE.widthIn}in ${PAGE.heightIn}in;
  margin: ${PAGE.marginYIn}in ${PAGE.marginXIn}in ${PAGE.marginYIn}in ${PAGE.marginXIn}in;
  @bottom-center { content: counter(page); font-size: 9pt; }
}
@page :first { @bottom-center { content: ""; } }
html { font: 11pt/1.45 'DejaVu Serif', Georgia, serif; }
body { margin: 0; }
main { margin: 0; }
h1 { font-size: 20pt; line-height: 1.2; margin: 0 0 18pt; break-before: page; break-after: avoid; }
p { margin: 0 0 8pt; text-align: justify; }
figure { margin: 12pt 0; }
figure.avoid { break-inside: avoid; }
figcaption { font-size: 9pt; margin-top: 4pt; }
img { display: block; }
.thumb-wrap { display: flex; align-items: center; gap: 8pt; margin: 8pt 0; }
table { width: 100%; border-collapse: collapse; margin: 10pt 0; font-size: 10pt; }
th, td { border: 0.5pt solid #666; padding: 3pt 5pt; text-align: left; vertical-align: top; }
`;
}

const FILLER =
  `gutter press folio signature quire recto verso colophon imposition kerning ligature
   ascender descender baseline leading widow orphan galley codex vellum quarto octavo`
    .split(/\s+/);

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface ImageBookInputs {
  plate300: string; // 4.75in-wide plate, PNG source at 300dpi
  plate600: string; // same display width, PNG source at 600dpi (oversampled)
  thumb72: string; // 1.5in-wide thumbnail, PNG source at 72dpi (underres)
  tall: string; // deliberately taller than the page's content box
  avoidPlate: string; // near-full-page plate inside break-inside:avoid
  tableThumb: string; // small PNG for a table cell
  jpegPlate: string; // JPEG version of the 300dpi plate
  alphaBadge: string; // PNG with an alpha gradient
  svgPlate: string; // baseline inline SVG, for cross-format comparison
}

/** Builds the fixed image-stress book. Returns { html, tokens } where tokens
 * lists every §Pxxx id in document order for the harness to walk. */
export function imageBookHtml(inputs: ImageBookInputs, opts: { seed?: number } = {}) {
  const rand = rng(opts.seed ?? 41);
  const sentence = (n: number) =>
    Array.from({ length: n }, () => FILLER[Math.floor(rand() * FILLER.length)])
      .join(" ")
      .replace(/^./, (c) => c.toUpperCase()) + ".";

  let token = 0;
  const tok = () => `§P${String(++token).padStart(3, "0")}`;
  const ids: string[] = [];
  const id = (name: string) => {
    ids.push(name);
    return name;
  };

  const chapters: string[] = [];

  chapters.push(`
<section>
<h1 id="${id("ch1")}">${tok()} Chapter 1: Plates and thumbnails</h1>
<p id="${id("ch1-p1")}">${tok()} ${sentence(40)}</p>
<figure id="${id("plate300")}">
  <img src="${inputs.plate300}" style="width:${PAGE.contentWidthIn}in;height:auto;">
  <figcaption>${tok()} full-width plate, 300 DPI source</figcaption>
</figure>
<p id="${id("ch1-p2")}">${tok()} ${sentence(30)}</p>
<div class="thumb-wrap" id="${id("thumb72")}">
  <img src="${inputs.thumb72}" style="width:1.5in;height:auto;">
  <span>${tok()} inline thumbnail, 72 DPI source</span>
</div>
<p id="${id("ch1-p3")}">${tok()} ${sentence(50)}</p>
</section>`);

  chapters.push(`
<section>
<h1 id="${id("ch2")}">${tok()} Chapter 2: Oversized and oversampled</h1>
<p id="${id("ch2-p1")}">${tok()} ${sentence(35)}</p>
<figure id="${id("plate600")}">
  <img src="${inputs.plate600}" style="width:${PAGE.contentWidthIn}in;height:auto;">
  <figcaption>${tok()} full-width plate, 600 DPI source (oversampled 2x)</figcaption>
</figure>
<p id="${id("ch2-p2")}">${tok()} ${sentence(25)}</p>
<figure id="${id("tall")}">
  <img src="${inputs.tall}" style="width:3in;height:${PAGE.contentHeightIn + 1.5}in;">
  <figcaption>${tok()} image taller than the page's content box</figcaption>
</figure>
<p id="${id("ch2-p3")}">${tok()} ${sentence(30)}</p>
<figure class="avoid" id="${id("avoidPlate")}">
  <img src="${inputs.avoidPlate}" style="width:${PAGE.contentWidthIn}in;height:${PAGE.contentHeightIn - 0.6}in;">
  <figcaption>${tok()} near-full-page plate, break-inside:avoid</figcaption>
</figure>
<p id="${id("ch2-p4")}">${tok()} ${sentence(45)}</p>
</section>`);

  chapters.push(`
<section>
<h1 id="${id("ch3")}">${tok()} Chapter 3: Table images, formats, alpha</h1>
<p id="${id("ch3-p1")}">${tok()} ${sentence(30)}</p>
<table id="${id("tableImg")}">
  <thead><tr><th>${tok()} Item</th><th>Sample</th></tr></thead>
  <tbody>
    <tr><td>${sentence(3)}</td><td><img src="${inputs.tableThumb}" style="width:1in;height:1in;"></td></tr>
    <tr><td>${sentence(3)}</td><td><img src="${inputs.tableThumb}" style="width:1in;height:1in;"></td></tr>
  </tbody>
</table>
<p id="${id("ch3-p2")}">${tok()} ${sentence(25)}</p>
<figure id="${id("jpegPlate")}">
  <img src="${inputs.jpegPlate}" style="width:${PAGE.contentWidthIn}in;height:auto;">
  <figcaption>${tok()} JPEG plate, 300 DPI source, q=0.85</figcaption>
</figure>
<p id="${id("ch3-p3")}">${tok()} ${sentence(25)}</p>
<div class="thumb-wrap" id="${id("alphaBadge")}">
  <img src="${inputs.alphaBadge}" style="width:1in;height:1in;">
  <span>${tok()} PNG with alpha channel</span>
</div>
<p id="${id("ch3-p4")}">${tok()} ${sentence(25)}</p>
<figure id="${id("svgPlate")}">
  <img src="${inputs.svgPlate}" style="width:${PAGE.contentWidthIn}in;height:auto;">
  <figcaption>${tok()} inline SVG plate (baseline, non-raster)</figcaption>
</figure>
<p id="${id("ch3-p5")}">${tok()} ${sentence(30)}</p>
</section>`);

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Folio image-heavy spike book</title>
<style>${imageBookCss()}</style>
</head>
<body>
<main>
${chapters.join("\n")}
</main>
</body>
</html>`;

  return { html, ids };
}

/** Standard set of image inputs, generated once and reused. `session` is only
 * needed for the JPEG (Chrome canvas encoder); pass null to skip it (falls
 * back to a PNG for that slot, e.g. for pure-Bun scale scripts). */
export async function standardImages(session: Session | null): Promise<ImageBookInputs> {
  const w = PAGE.contentWidthIn;
  return {
    plate300: pngDataUri(Math.round(w * 300), Math.round(w * 300 * 0.6), { seed: 1 }),
    plate600: pngDataUri(Math.round(w * 600), Math.round(w * 600 * 0.6), { seed: 2 }),
    thumb72: pngDataUri(Math.round(1.5 * 72), Math.round(1.5 * 72 * 0.75), { seed: 3 }),
    tall: pngDataUri(Math.round(3 * 300), Math.round((PAGE.contentHeightIn + 1.5) * 300), { seed: 4 }),
    avoidPlate: pngDataUri(
      Math.round(w * 300),
      Math.round((PAGE.contentHeightIn - 0.6) * 300),
      { seed: 5 },
    ),
    tableThumb: pngDataUri(300, 300, { seed: 6 }),
    jpegPlate: session
      ? await jpegDataUri(session, Math.round(w * 300), Math.round(w * 300 * 0.6), 7)
      : pngDataUri(Math.round(w * 300), Math.round(w * 300 * 0.6), { seed: 7 }),
    alphaBadge: pngDataUri(300, 300, { seed: 8, alpha: true }),
    svgPlate: svgDataUri(950, 570, "SVG PLATE", 9),
  };
}
