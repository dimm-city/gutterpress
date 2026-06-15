/**
 * Unit tests for the Media panel's pure helpers (#47) — formatting, default
 * alt text, markdown snippets, and the plain-language print-readiness notes.
 */
import { test, expect, describe } from "bun:test";
import {
  buildPrintWarnings,
  defaultAltText,
  describeColorSpace,
  dpiAtFullWidth,
  formatBytes,
  imageMarkdown,
  MEDIA_IMAGE_EXT_RE,
} from "../../src/lib/media";
import type { MediaImageDetails } from "../../src/lib/platform/contract";

function details(partial: Partial<MediaImageDetails["info"] & object> = {}, fileSize = 1000): MediaImageDetails {
  return {
    fileSize,
    info: {
      width: 2400,
      height: 1600,
      xDpi: 300,
      yDpi: 300,
      hasAlpha: false,
      colorSpace: "srgb",
      ...partial,
    },
  };
}

describe("formatBytes", () => {
  test("bytes / KB / MB", () => {
    expect(formatBytes(312)).toBe("312 B");
    expect(formatBytes(2048)).toBe("2.0 KB");
    expect(formatBytes(150 * 1024)).toBe("150 KB");
    expect(formatBytes(3.5 * 1024 * 1024)).toBe("3.5 MB");
  });
  test("invalid input degrades to a dash", () => {
    expect(formatBytes(-1)).toBe("—");
    expect(formatBytes(Number.NaN)).toBe("—");
  });
});

describe("extension filter", () => {
  test("accepts the supported formats, rejects others", () => {
    for (const ok of ["a.png", "b.JPG", "c.jpeg", "d.webp", "e.gif", "f.svg", "g.tif", "h.tiff"]) {
      expect(MEDIA_IMAGE_EXT_RE.test(ok)).toBe(true);
    }
    for (const no of ["a.pdf", "b.md", "c.pngx", "d.css"]) {
      expect(MEDIA_IMAGE_EXT_RE.test(no)).toBe(false);
    }
  });
});

describe("dpiAtFullWidth", () => {
  test("2100px-wide image is exactly 300 DPI at 7in", () => {
    expect(dpiAtFullWidth(2100)).toBe(300);
  });
  test("1050px-wide image is 150 DPI at 7in", () => {
    expect(dpiAtFullWidth(1050)).toBe(150);
  });
});

describe("buildPrintWarnings", () => {
  test("high-resolution image gets the 'sharp' note", () => {
    const w = buildPrintWarnings(details({ width: 2400 }), "png");
    expect(w[0]!.level).toBe("ok");
    expect(w[0]!.text).toContain("Sharp in print");
  });

  test("low-resolution image gets the plain-language blur warning", () => {
    // 1050px wide → ~150 DPI at full width
    const w = buildPrintWarnings(details({ width: 1050 }), "jpg");
    expect(w[0]!.level).toBe("warn");
    expect(w[0]!.text).toContain("may look blurry in print");
    expect(w[0]!.text).toContain("150 DPI");
    expect(w[0]!.text).toContain("300");
  });

  test("mid-resolution image gets the softer warning", () => {
    // 1400px → 200 DPI
    const w = buildPrintWarnings(details({ width: 1400 }), "png");
    expect(w[0]!.level).toBe("warn");
    expect(w[0]!.text).toContain("slightly soft");
  });

  test("sRGB gets an informational note, CMYK an ok note", () => {
    const srgb = buildPrintWarnings(details({ colorSpace: "srgb" }), "jpg");
    expect(srgb.some((x) => x.level === "info" && x.text.includes("sRGB"))).toBe(true);
    const cmyk = buildPrintWarnings(details({ colorSpace: "cmyk" }), "jpg");
    expect(cmyk.some((x) => x.level === "ok" && x.text.includes("CMYK"))).toBe(true);
  });

  test("alpha gets a transparency note", () => {
    const w = buildPrintWarnings(details({ hasAlpha: true }), "png");
    expect(w.some((x) => x.text.includes("transparency"))).toBe(true);
  });

  test("svg is always crisp regardless of details", () => {
    const w = buildPrintWarnings(null, "svg");
    expect(w).toHaveLength(1);
    expect(w[0]!.level).toBe("ok");
    expect(w[0]!.text).toContain("Vector");
  });

  test("unparsed format degrades to the 'details unavailable' note", () => {
    const w = buildPrintWarnings({ fileSize: 5000, info: null }, "webp");
    expect(w).toHaveLength(1);
    expect(w[0]!.level).toBe("info");
    expect(w[0]!.text).toContain("aren't available");
  });

  test("null details (stat failed) degrades gracefully", () => {
    const w = buildPrintWarnings(null, "png");
    expect(w).toHaveLength(1);
    expect(w[0]!.level).toBe("info");
  });
});

describe("insert helpers", () => {
  test("defaultAltText strips the extension", () => {
    expect(defaultAltText("cover-art.png")).toBe("cover-art");
    expect(defaultAltText("no-ext")).toBe("no-ext");
  });
  test("imageMarkdown builds the snippet", () => {
    expect(imageMarkdown("assets/cover.png", "cover")).toBe("![cover](assets/cover.png)");
  });
});
