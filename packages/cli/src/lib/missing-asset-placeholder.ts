import { deflateSync } from "node:zlib";

/**
 * A visible stand-in for an image the book references but does not have.
 *
 * WHY THIS EXISTS: a missing image used to abort the whole build
 * (`Could not copy asset … ENOENT`). For a non-technical author that is the
 * worst possible failure mode — one stale image path in a 273-page book and
 * nothing renders at all, with a filesystem error as the only explanation.
 * Worse, it makes the book unbuildable by anyone who does not already have
 * the missing file, which is exactly the state the dc-op-manual field guide
 * was in: two chapters referenced art that exists nowhere in the repo, so
 * every tool and every reviewer had to hand-patch placeholders in to build
 * it at all.
 *
 * The fix is NOT to substitute something invisible. A silently-blank image
 * is how a missing illustration ships to print. This paints an unmistakable
 * magenta/black checkerboard: the build completes, the author is warned by
 * path, and the hole is impossible to miss when flipping through the PDF.
 *
 * FORMAT: a hand-encoded PNG, because the alternative — embedding a fixture
 * file — cannot adapt its dimensions, and a wrongly-shaped placeholder
 * distorts the surrounding layout while the author is trying to judge it.
 * PNG is the only format written, whatever extension the reference used;
 * Chromium resolves a local image's type from its extension, so a
 * placeholder standing in for `.jpg` may itself fail to decode. That is
 * acceptable and deliberate: the build still succeeds, and the author still
 * gets the warning naming the file. It is not a silent fallback either way.
 */

function crc32(buf: Uint8Array): number {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]!;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(data.length + 12);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(data.length + 8, crc32(out.subarray(4, data.length + 8)));
  return out;
}

/**
 * Encode a checkerboard PNG of `width`×`height` at `cell` pixels per square.
 * Truecolor (8-bit RGB, no alpha) with filter byte 0 per scanline — the
 * simplest encoding that every decoder handles, and small enough that the
 * deflate cost is irrelevant next to a book build.
 */
export function placeholderPng(width = 640, height = 480, cell = 32): Uint8Array {
  const A = [0xd9, 0x46, 0xef]; // magenta — reads as "wrong", never as art
  const B = [0x1a, 0x1a, 0x1a];

  const raw = new Uint8Array(height * (1 + width * 3));
  let p = 0;
  for (let y = 0; y < height; y++) {
    raw[p++] = 0; // filter: none
    for (let x = 0; x < width; x++) {
      const c = (((x / cell) | 0) + ((y / cell) | 0)) % 2 === 0 ? A : B;
      raw[p++] = c[0]!;
      raw[p++] = c[1]!;
      raw[p++] = c[2]!;
    }
  }

  const ihdr = new Uint8Array(13);
  const hv = new DataView(ihdr.buffer);
  hv.setUint32(0, width);
  hv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // color type: truecolor
  // 10..12: compression, filter, interlace — all 0

  const parts = [
    new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", new Uint8Array(deflateSync(raw))),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((n, x) => n + x.length, 0);
  const png = new Uint8Array(total);
  let o = 0;
  for (const part of parts) {
    png.set(part, o);
    o += part.length;
  }
  return png;
}
