/**
 * Dependency-free raster image header reader — the in-process replacement for
 * ImageMagick `identify` used by the asset checks (Phase 3 of ADR 0002).
 *
 * Why not `sharp`? sharp is the most capable option but is a native addon whose
 * platform binaries are resolved through `node_modules` at runtime — exactly the
 * pattern that breaks `bun build --compile` (ADR 0001 §1/§3). A small header
 * parser for the formats print authors actually use (PNG, JPEG, TIFF) keeps a
 * single code path that bundles into the standalone binary AND runs in the
 * Electron desktop, with zero system/native dependency.
 *
 * Scope: width/height, x/y DPI, alpha presence, and a coarse color-space token
 * ("srgb" | "gray" | "cmyk"). This matches what the three asset checks consume.
 * Tokens are lowercased to line up with the lowercased `identify %[colorspace]`
 * values the existing config compares against.
 *
 * DPI parity note: like `identify`, an image with no density metadata is treated
 * as 72 DPI (ImageMagick's default) so the opt-in min-DPI check behaves as before.
 */

import { stat, readFile } from "node:fs/promises";
import { ASSET_SCAN_IGNORE_GLOBS } from "../checks/asset/extensions";

export type ColorSpace = "srgb" | "gray" | "cmyk" | "";

export interface ImageInfo {
  width: number;
  height: number;
  /** Effective DPI; defaults to 72 when the file carries no density metadata. */
  xDpi: number;
  yDpi: number;
  hasAlpha: boolean;
  colorSpace: ColorSpace;
}

const DEFAULT_DPI = 72;

// --- small mtime-keyed cache so repeated checks don't re-read the same file ---
interface CacheEntry {
  mtimeMs: number;
  size: number;
  info: ImageInfo | null;
}
const cache = new Map<string, CacheEntry>();

/** Inspect a PNG/JPEG/TIFF file; returns null for unreadable/unknown formats. */
export async function inspectImage(path: string): Promise<ImageInfo | null> {
  let st;
  try {
    st = await stat(path);
  } catch {
    return null;
  }
  const hit = cache.get(path);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.info;

  let info: ImageInfo | null = null;
  try {
    const buf = await readFile(path);
    info = parseImage(buf);
  } catch {
    info = null;
  }
  cache.set(path, { mtimeMs: st.mtimeMs, size: st.size, info });
  return info;
}

function parseImage(b: Buffer): ImageInfo | null {
  if (
    b.length > 8 &&
    b[0] === 0x89 &&
    b[1] === 0x50 &&
    b[2] === 0x4e &&
    b[3] === 0x47
  ) {
    return parsePng(b);
  }
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return parseJpeg(b);
  }
  if (
    b.length > 8 &&
    ((b[0] === 0x49 && b[1] === 0x49 && b[2] === 0x2a) ||
      (b[0] === 0x4d && b[1] === 0x4d && b[2] === 0x00 && b[3] === 0x2a))
  ) {
    return parseTiff(b);
  }
  return null;
}

// ---------------------------------------------------------------------------
// PNG
// ---------------------------------------------------------------------------

function parsePng(b: Buffer): ImageInfo | null {
  let width = 0;
  let height = 0;
  let colorType = -1;
  let hasTrns = false;
  let dpiX = 0;
  let dpiY = 0;

  let off = 8; // skip 8-byte signature
  while (off + 8 <= b.length) {
    const len = b.readUInt32BE(off);
    const type = b.toString("latin1", off + 4, off + 8);
    const dataOff = off + 8;
    if (type === "IHDR" && dataOff + 10 <= b.length) {
      width = b.readUInt32BE(dataOff);
      height = b.readUInt32BE(dataOff + 4);
      colorType = b[dataOff + 9]!;
    } else if (type === "pHYs" && dataOff + 9 <= b.length) {
      const ppuX = b.readUInt32BE(dataOff);
      const ppuY = b.readUInt32BE(dataOff + 4);
      const unit = b[dataOff + 8]!;
      if (unit === 1) {
        // pixels per metre → DPI
        dpiX = Math.round(ppuX * 0.0254);
        dpiY = Math.round(ppuY * 0.0254);
      }
    } else if (type === "tRNS") {
      hasTrns = true;
    } else if (type === "IDAT" || type === "IEND") {
      break; // headers we care about precede image data
    }
    off = dataOff + len + 4; // data + 4-byte CRC
  }

  if (colorType < 0) return null;
  // colorType: 0 gray, 2 rgb, 3 palette, 4 gray+alpha, 6 rgba
  const hasAlpha = colorType === 4 || colorType === 6 || hasTrns;
  const colorSpace: ColorSpace = colorType === 0 || colorType === 4 ? "gray" : "srgb";
  return {
    width,
    height,
    xDpi: dpiX || DEFAULT_DPI,
    yDpi: dpiY || DEFAULT_DPI,
    hasAlpha,
    colorSpace,
  };
}

// ---------------------------------------------------------------------------
// JPEG
// ---------------------------------------------------------------------------

function parseJpeg(b: Buffer): ImageInfo | null {
  let width = 0;
  let height = 0;
  let components = 0;
  let dpiX = 0;
  let dpiY = 0;

  let off = 2; // skip SOI
  while (off + 4 <= b.length) {
    if (b[off] !== 0xff) {
      off++;
      continue;
    }
    const marker = b[off + 1]!;
    // Standalone markers without a length payload.
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      off += 2;
      continue;
    }
    const segLen = b.readUInt16BE(off + 2);
    const segStart = off + 4;

    if (marker === 0xe0 && b.toString("latin1", segStart, segStart + 4) === "JFIF") {
      // APP0/JFIF: units@7, Xdensity@8, Ydensity@10 (relative to segStart-2 base)
      const units = b[segStart + 7]!;
      const xd = b.readUInt16BE(segStart + 8);
      const yd = b.readUInt16BE(segStart + 10);
      if (units === 1) {
        dpiX = xd;
        dpiY = yd;
      } else if (units === 2) {
        dpiX = Math.round(xd * 2.54);
        dpiY = Math.round(yd * 2.54);
      }
    } else if (
      // SOF0–SOF15 except DHT(C4), reserved(C8), DAC(CC)
      marker >= 0xc0 &&
      marker <= 0xcf &&
      marker !== 0xc4 &&
      marker !== 0xc8 &&
      marker !== 0xcc
    ) {
      height = b.readUInt16BE(segStart + 1);
      width = b.readUInt16BE(segStart + 3);
      components = b[segStart + 5]!;
      break; // SOF carries everything we need
    }
    off = segStart + segLen - 2;
  }

  if (components === 0) return null;
  // 1 → grayscale, 3 → YCbCr (sRGB), 4 → CMYK/YCCK
  const colorSpace: ColorSpace =
    components === 1 ? "gray" : components === 4 ? "cmyk" : "srgb";
  return {
    width,
    height,
    xDpi: dpiX || DEFAULT_DPI,
    yDpi: dpiY || DEFAULT_DPI,
    hasAlpha: false, // baseline JPEG has no alpha channel
    colorSpace,
  };
}

// ---------------------------------------------------------------------------
// TIFF
// ---------------------------------------------------------------------------

function parseTiff(b: Buffer): ImageInfo | null {
  const le = b[0] === 0x49; // "II" little-endian, "MM" big-endian
  const u16 = (o: number) => (le ? b.readUInt16LE(o) : b.readUInt16BE(o));
  const u32 = (o: number) => (le ? b.readUInt32LE(o) : b.readUInt32BE(o));

  const ifdOff = u32(4);
  if (ifdOff + 2 > b.length) return null;
  const count = u16(ifdOff);

  let width = 0;
  let height = 0;
  let photometric = -1;
  let extraSamples = 0;
  let resUnit = 2; // default inch
  let xResOff = 0;
  let yResOff = 0;

  for (let i = 0; i < count; i++) {
    const e = ifdOff + 2 + i * 12;
    if (e + 12 > b.length) break;
    const tag = u16(e);
    const valOff = e + 8;
    switch (tag) {
      case 256: // ImageWidth
        width = u16(valOff); // SHORT or LONG; SHORT common
        if (width === 0) width = u32(valOff);
        break;
      case 257: // ImageLength
        height = u16(valOff);
        if (height === 0) height = u32(valOff);
        break;
      case 262: // PhotometricInterpretation
        photometric = u16(valOff);
        break;
      case 282: // XResolution (RATIONAL → offset)
        xResOff = u32(valOff);
        break;
      case 283: // YResolution
        yResOff = u32(valOff);
        break;
      case 296: // ResolutionUnit (1 none, 2 inch, 3 cm)
        resUnit = u16(valOff);
        break;
      case 338: // ExtraSamples → alpha present
        extraSamples = u32(e + 4); // the count field
        break;
    }
  }

  const rational = (o: number): number => {
    if (o <= 0 || o + 8 > b.length) return 0;
    const num = u32(o);
    const den = u32(o + 4);
    return den ? num / den : 0;
  };
  let xDpi = rational(xResOff);
  let yDpi = rational(yResOff);
  if (resUnit === 3) {
    xDpi = Math.round(xDpi * 2.54);
    yDpi = Math.round(yDpi * 2.54);
  } else if (resUnit === 1) {
    xDpi = 0; // no absolute unit
    yDpi = 0;
  }

  // photometric: 0/1 gray, 2 rgb, 5 cmyk, 6 ycbcr(→srgb)
  const colorSpace: ColorSpace =
    photometric === 5
      ? "cmyk"
      : photometric === 0 || photometric === 1
        ? "gray"
        : photometric < 0
          ? ""
          : "srgb";

  return {
    width,
    height,
    xDpi: xDpi || DEFAULT_DPI,
    yDpi: yDpi || DEFAULT_DPI,
    hasAlpha: extraSamples > 0,
    colorSpace,
  };
}

// ---------------------------------------------------------------------------
// Shared file collector for the asset checks.
// ---------------------------------------------------------------------------

export async function collectImageFiles(
  dirs: string[],
  exts: readonly string[],
  ignore: readonly string[] = ASSET_SCAN_IGNORE_GLOBS
): Promise<string[]> {
  const { glob } = await import("glob");
  // A single-element brace list (`**/*.{png}`) is not expanded by glob and
  // matches NOTHING — a silent-zero-results trap for any caller narrowing to
  // one extension. Emit a plain pattern in that case.
  const pattern =
    exts.length === 1 ? `**/*.${exts[0]}` : `**/*.{${exts.join(",")}}`;
  const files: string[] = [];
  for (const dir of dirs) {
    const matches = await glob(pattern, {
      cwd: dir,
      absolute: true,
      ignore: [...ignore],
    });
    files.push(...matches);
  }
  return files;
}
