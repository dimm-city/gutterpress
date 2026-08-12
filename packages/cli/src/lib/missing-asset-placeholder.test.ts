import { test, expect, describe } from "bun:test";
import { placeholderPng } from "./missing-asset-placeholder";

/**
 * The placeholder stands in for an image the book references but does not
 * have, so that one stale path cannot make a whole book unbuildable. It is
 * hand-encoded, which means nothing but a test proves it is a real PNG —
 * an invalid one would trade a build failure for a broken-image box, which
 * is strictly worse than what it replaced.
 */
describe("missing-asset placeholder", () => {
  const png = placeholderPng();

  test("carries the PNG signature", () => {
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  });

  test("declares the requested dimensions in IHDR", () => {
    const custom = placeholderPng(64, 32);
    const view = new DataView(custom.buffer, custom.byteOffset);
    // 8-byte signature + 4 length + 4 type, then width/height
    expect(view.getUint32(16)).toBe(64);
    expect(view.getUint32(20)).toBe(32);
    expect(custom[24]).toBe(8); // bit depth
    expect(custom[25]).toBe(2); // truecolor
  });

  test("chunks are ordered IHDR, IDAT, IEND", () => {
    const s = Buffer.from(png).toString("latin1");
    expect(s.indexOf("IHDR")).toBeGreaterThan(-1);
    expect(s.indexOf("IDAT")).toBeGreaterThan(s.indexOf("IHDR"));
    expect(s.indexOf("IEND")).toBeGreaterThan(s.indexOf("IDAT"));
  });

  test("is a checkerboard, not a flat fill — the point is to be unmissable", () => {
    // Two different cells must differ; a uniform image would read as art.
    const a = placeholderPng(64, 64, 32);
    const b = placeholderPng(64, 64, 64); // one cell covers the whole image
    expect(a).not.toEqual(b);
  });

  test("every chunk's CRC validates", () => {
    // Walk the chunk list and recompute each CRC exactly as a decoder would.
    const crcTable = Array.from({ length: 256 }, (_, n) => {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      return c >>> 0;
    });
    const crc = (buf: Uint8Array) => {
      let c = ~0;
      for (const byte of buf) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
      return ~c >>> 0;
    };

    const view = new DataView(png.buffer, png.byteOffset);
    let off = 8;
    let seen = 0;
    while (off < png.length) {
      const len = view.getUint32(off);
      const declared = view.getUint32(off + 8 + len);
      expect(crc(png.subarray(off + 4, off + 8 + len))).toBe(declared);
      off += 12 + len;
      seen++;
    }
    expect(seen).toBe(3);
    expect(off).toBe(png.length);
  });
});
