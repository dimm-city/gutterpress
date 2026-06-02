/**
 * Tests for the dependency-free image header reader (Phase 3 of ADR 0002,
 * replacing ImageMagick `identify`). Fixtures are constructed as byte buffers
 * in-test so the suite needs no ImageMagick and no committed binaries. Parser
 * output was cross-checked against real `identify` during development.
 */

import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectImage } from "./image-inspect";

// --- byte-buffer builders -------------------------------------------------

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  // CRC is not validated by the reader, so zeros are fine.
  return Buffer.concat([len, Buffer.from(type, "latin1"), data, Buffer.alloc(4)]);
}

function makePng(
  colorType: number,
  opts: { ppm?: number; unit?: number; trns?: boolean } = {}
): Buffer {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(10, 0); // width
  ihdr.writeUInt32BE(8, 4); // height
  ihdr[8] = 8; // bit depth
  ihdr[9] = colorType;
  const parts = [sig, pngChunk("IHDR", ihdr)];
  if (opts.ppm) {
    const phys = Buffer.alloc(9);
    phys.writeUInt32BE(opts.ppm, 0);
    phys.writeUInt32BE(opts.ppm, 4);
    phys[8] = opts.unit ?? 1;
    parts.push(pngChunk("pHYs", phys));
  }
  if (opts.trns) parts.push(pngChunk("tRNS", Buffer.alloc(2)));
  parts.push(pngChunk("IEND", Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function makeJpeg(
  components: number,
  opts: { units?: number; density?: number } = {}
): Buffer {
  const parts: Buffer[] = [Buffer.from([0xff, 0xd8])]; // SOI
  if (opts.units !== undefined) {
    const seg = Buffer.alloc(16);
    seg.write("JFIF\0", 0, "latin1");
    seg[5] = 1; // version major
    seg[6] = 2; // version minor
    seg[7] = opts.units;
    seg.writeUInt16BE(opts.density ?? 72, 8);
    seg.writeUInt16BE(opts.density ?? 72, 10);
    const len = Buffer.alloc(2);
    len.writeUInt16BE(seg.length + 2);
    parts.push(Buffer.from([0xff, 0xe0]), len, seg);
  }
  const sof = Buffer.alloc(6);
  sof[0] = 8; // precision
  sof.writeUInt16BE(8, 1); // height
  sof.writeUInt16BE(10, 3); // width
  sof[5] = components;
  const sofLen = Buffer.alloc(2);
  sofLen.writeUInt16BE(sof.length + 2);
  parts.push(Buffer.from([0xff, 0xc0]), sofLen, sof, Buffer.from([0xff, 0xd9]));
  return Buffer.concat(parts);
}

/** Minimal little-endian TIFF with 6 IFD entries + one RATIONAL (XResolution). */
function makeTiff(opts: {
  photometric: number;
  extraSamples?: boolean;
  xres?: number;
  resUnit?: number;
}): Buffer {
  const entries: Array<[number, number, number, number]> = [
    [256, 3, 1, 10], // ImageWidth
    [257, 3, 1, 8], // ImageLength
    [262, 3, 1, opts.photometric], // PhotometricInterpretation
    [282, 5, 1, 0], // XResolution (offset filled below)
    [296, 3, 1, opts.resUnit ?? 2], // ResolutionUnit (inch)
    [338, 3, 1, opts.extraSamples ? 1 : 0], // ExtraSamples
  ];
  const headerSize = 8;
  const ifdSize = 2 + entries.length * 12 + 4;
  const ratOffset = headerSize + ifdSize;
  entries[3]![3] = ratOffset; // XResolution value = offset to rational

  const buf = Buffer.alloc(ratOffset + 8);
  buf.write("II", 0, "latin1");
  buf.writeUInt16LE(42, 2);
  buf.writeUInt32LE(headerSize, 4);
  buf.writeUInt16LE(entries.length, headerSize);
  entries.forEach((e, i) => {
    const o = headerSize + 2 + i * 12;
    buf.writeUInt16LE(e[0], o);
    buf.writeUInt16LE(e[1], o + 2);
    buf.writeUInt32LE(e[2], o + 4);
    if (e[1] === 3) buf.writeUInt16LE(e[3], o + 8);
    else buf.writeUInt32LE(e[3], o + 8);
  });
  buf.writeUInt32LE(opts.xres ?? 72, ratOffset); // numerator
  buf.writeUInt32LE(1, ratOffset + 4); // denominator
  return buf;
}

// --- harness --------------------------------------------------------------

async function inspect(name: string, bytes: Buffer) {
  const dir = await mkdtemp(join(tmpdir(), "print-md-img-"));
  try {
    const p = join(dir, name);
    await writeFile(p, bytes);
    return await inspectImage(p);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

describe("image-inspect", () => {
  test("PNG truecolor → srgb, no alpha, default 72 DPI", async () => {
    const info = await inspect("a.png", makePng(2));
    expect(info).toMatchObject({
      width: 10,
      height: 8,
      colorSpace: "srgb",
      hasAlpha: false,
      xDpi: 72,
      yDpi: 72,
    });
  });

  test("PNG RGBA → alpha true", async () => {
    expect((await inspect("a.png", makePng(6)))?.hasAlpha).toBe(true);
  });

  test("PNG grayscale → gray", async () => {
    expect((await inspect("a.png", makePng(0)))?.colorSpace).toBe("gray");
  });

  test("PNG palette with tRNS → alpha true", async () => {
    expect((await inspect("a.png", makePng(3, { trns: true })))?.hasAlpha).toBe(true);
  });

  test("PNG pHYs 11811 ppm → 300 DPI", async () => {
    const info = await inspect("a.png", makePng(2, { ppm: 11811, unit: 1 }));
    expect(info?.xDpi).toBe(300);
    expect(info?.yDpi).toBe(300);
  });

  test("JPEG 3 components → srgb", async () => {
    expect((await inspect("a.jpg", makeJpeg(3, { units: 1, density: 96 })))).toMatchObject({
      colorSpace: "srgb",
      hasAlpha: false,
      xDpi: 96,
    });
  });

  test("JPEG 1 component → gray", async () => {
    expect((await inspect("a.jpg", makeJpeg(1, { units: 1 })))?.colorSpace).toBe("gray");
  });

  test("JPEG 4 components → cmyk", async () => {
    expect((await inspect("a.jpg", makeJpeg(4, { units: 1 })))?.colorSpace).toBe("cmyk");
  });

  test("JPEG density units=2 (per cm) → DPI converted", async () => {
    // 100 px/cm × 2.54 ≈ 254 DPI
    expect((await inspect("a.jpg", makeJpeg(3, { units: 2, density: 100 })))?.xDpi).toBe(254);
  });

  test("TIFF CMYK photometric=5 → cmyk", async () => {
    expect((await inspect("a.tif", makeTiff({ photometric: 5 })))?.colorSpace).toBe("cmyk");
  });

  test("TIFF grayscale with ExtraSamples + 300 XResolution → gray, alpha, 300 DPI", async () => {
    const info = await inspect(
      "a.tif",
      makeTiff({ photometric: 1, extraSamples: true, xres: 300 })
    );
    expect(info).toMatchObject({ colorSpace: "gray", hasAlpha: true, xDpi: 300 });
  });

  test("unknown format → null", async () => {
    expect(await inspect("a.bin", Buffer.from("not an image"))).toBeNull();
  });
});
