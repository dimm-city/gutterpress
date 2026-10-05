import { describe, expect, test } from "bun:test";
import { inflateSync } from "node:zlib";
import { comparePixels, encodePng, parsePpm, type RgbImage } from "./render-parity-raster.ts";
import { compareReports, type Report } from "./render-parity.ts";

function img(w: number, h: number, rgb: [number, number, number]): RgbImage {
  const data = new Uint8Array(w * h * 3);
  for (let i = 0; i < data.length; i += 3) data.set(rgb, i);
  return { w, h, data };
}

describe("render-parity raster (#295)", () => {
  test("parsePpm reads pdftoppm's P6 header, comments included", () => {
    const header = new TextEncoder().encode("P6\n# made by pdftoppm\n2 1\n255\n");
    const buf = new Uint8Array([...header, 1, 2, 3, 4, 5, 6]);
    const out = parsePpm(buf);
    expect([out.w, out.h, [...out.data]]).toEqual([2, 1, [1, 2, 3, 4, 5, 6]]);
  });

  test("parsePpm refuses anything but an 8-bit binary PPM", () => {
    expect(() => parsePpm(new TextEncoder().encode("P3\n1 1\n255\n0 0 0"))).toThrow();
  });

  test("a hue change past 1% of a channel is a differing pixel, painted red", () => {
    const base = img(2, 2, [27, 79, 138]);
    const cand = img(2, 2, [27, 79, 138]);
    cand.data.set([192, 21, 138], 0);
    const { differing, marked } = comparePixels(base, cand, 0.01);
    expect(differing).toBe(1);
    expect([...marked!.data.subarray(0, 6)]).toEqual([255, 0, 0, 27, 79, 138]);
  });

  test("anti-aliasing noise within the tolerance is not a difference", () => {
    const { differing } = comparePixels(img(3, 3, [100, 100, 100]), img(3, 3, [102, 98, 101]), 0.01);
    expect(differing).toBe(0);
  });

  test("pages of different sizes differ everywhere and get no diff image", () => {
    const { differing, marked } = comparePixels(img(2, 2, [0, 0, 0]), img(3, 2, [0, 0, 0]), 0.01);
    expect([differing, marked]).toEqual([6, null]);
  });

  test("encodePng writes a PNG whose pixels round-trip", () => {
    const src = img(2, 2, [10, 20, 30]);
    const png = encodePng(src);
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const view = new DataView(png.buffer, png.byteOffset);
    expect([view.getUint32(16), view.getUint32(20)]).toEqual([2, 2]);
    const idatLen = view.getUint32(33);
    const raw = inflateSync(png.subarray(41, 41 + idatLen));
    expect([...raw]).toEqual([0, 10, 20, 30, 10, 20, 30, 0, 10, 20, 30, 10, 20, 30]);
  });

  test("raster diffs go through the same waivers as every other kind", () => {
    const report: Report = { version: 1, pageCount: 1, pages: [{ w: 612, h: 792, text: [], images: [] }] } as Report;
    const extraDiffs = [{ page: 1, kind: "raster" as const, before: "612x792", after: "40 px differ (0.01%)" }];
    const waived = compareReports(report, report, {
      extraDiffs,
      waivers: [{ page: 1, kind: "raster", reason: "accent colour changed on purpose" }],
    });
    expect([waived.diffs.length, waived.waived.length]).toEqual([0, 1]);
    expect(compareReports(report, report, { extraDiffs }).diffs).toHaveLength(1);
  });
});
