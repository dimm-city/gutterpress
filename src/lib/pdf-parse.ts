import { execCapture } from "./exec";

/**
 * Parse page size from `pdfinfo -box` output.
 */
export function parsePdfInfoBox(
  pdfinfo: string
): { w: number; h: number } | null {
  const lines = pdfinfo.split(/\r?\n/);
  const sizeLine = lines.find((l) => l.startsWith("Page size:"));
  if (!sizeLine) return null;
  const m = sizeLine.match(/Page size:\s*([0-9.]+)\s*x\s*([0-9.]+)\s*pts/i);
  if (!m) return null;
  return { w: Number(m[1]), h: Number(m[2]) };
}

/**
 * Parse font embedding info from `pdffonts` output.
 */
export function parsePdfFonts(
  pdffontsOut: string
): Array<{ name: string; embedded: boolean }> {
  const lines = pdffontsOut.split(/\r?\n/).filter(Boolean);
  const headerIdx = lines.findIndex((l) => l.toLowerCase().startsWith("name"));
  if (headerIdx < 0) return [];
  const header = lines[headerIdx];
  const embPos = header.indexOf(" emb");
  if (embPos < 0) return [];
  const rows = lines
    .slice(headerIdx + 2)
    .filter((l) => l.trim().length > 0);
  return rows.map((r) => {
    const embValue = r.substring(embPos + 1, embPos + 4).trim();
    return {
      name: r.split(/\s+/)[0],
      embedded: embValue === "yes",
    };
  });
}

/**
 * Parse ink coverage from `gs -sDEVICE=inkcov` output.
 */
export function parseInkCov(out: string) {
  const lines = out.split(/\r?\n/).filter((l) => l.includes("CMYK"));
  const pages: Array<{
    c: number;
    m: number;
    y: number;
    k: number;
    sum: number;
  }> = [];
  for (const line of lines) {
    const nums = line.trim().split(/\s+/).slice(0, 4).map(Number);
    if (nums.length === 4 && nums.every((n) => Number.isFinite(n))) {
      const sum = nums[0] + nums[1] + nums[2] + nums[3];
      pages.push({ c: nums[0], m: nums[1], y: nums[2], k: nums[3], sum });
    }
  }
  return pages;
}

/**
 * Get per-page ink coverage using Ghostscript's inkcov device.
 * Returns an array of per-page CMYK coverage values (in percentages).
 */
export async function getPerPageInkCoverage(
  pdfPath: string
): Promise<Array<{ page: number; c: number; m: number; y: number; k: number; tac: number }>> {
  try {
    const { stdout } = await execCapture("gs", [
      "-q",
      "-dBATCH",
      "-dNOPAUSE",
      "-sDEVICE=inkcov",
      pdfPath,
    ]);
    const pages = parseInkCov(stdout);
    return pages.map((p, i) => ({
      page: i + 1,
      c: p.c * 100,
      m: p.m * 100,
      y: p.y * 100,
      k: p.k * 100,
      tac: p.sum * 100,
    }));
  } catch {
    return [];
  }
}

/**
 * Parse full-page images from `pdfimages -list` output.
 */
export function parsePdfImages(
  out: string,
  pageSizePts: { w: number; h: number }
): number[] {
  const lines = out
    .split(/\r?\n/)
    .filter((l) => /^\s*\d+\s+\d+/.test(l));
  const candidatePages: number[] = [];

  const pageWidthIn = pageSizePts.w / 72;
  const pageHeightIn = pageSizePts.h / 72;

  for (const line of lines) {
    const cols = line.trim().split(/\s+/);
    const pageNum = parseInt(cols[0], 10);
    const width = parseInt(cols[3], 10);
    const height = parseInt(cols[4], 10);
    const xppi = parseInt(cols[12], 10);
    const yppi = parseInt(cols[13], 10);

    if (isNaN(width) || isNaN(height) || isNaN(xppi) || isNaN(yppi)) continue;
    if (xppi <= 0 || yppi <= 0) continue;

    const imgWidthIn = width / xppi;
    const imgHeightIn = height / yppi;

    const widthMatch =
      Math.abs(imgWidthIn - pageWidthIn) / pageWidthIn < 0.03;
    const heightMatch =
      Math.abs(imgHeightIn - pageHeightIn) / pageHeightIn < 0.03;

    if (widthMatch && heightMatch) {
      if (!candidatePages.includes(pageNum)) {
        candidatePages.push(pageNum);
      }
    }
  }

  return candidatePages;
}

/**
 * Filter candidate pages to find truly rasterized ones (vs intentional artwork).
 */
export async function filterRasterized(
  candidates: number[],
  pdfPath: string,
  pdfimagesOut: string
): Promise<number[]> {
  const imageLines = pdfimagesOut
    .split(/\r?\n/)
    .filter((l) => /^\s*\d+\s+\d+/.test(l));
  const imagesPerPage = new Map<number, number>();
  for (const line of imageLines) {
    const pageNum = parseInt(line.trim().split(/\s+/)[0], 10);
    if (!isNaN(pageNum)) {
      imagesPerPage.set(pageNum, (imagesPerPage.get(pageNum) || 0) + 1);
    }
  }

  const rasterized: number[] = [];
  for (const page of candidates) {
    const imageCount = imagesPerPage.get(page) || 0;
    if (imageCount !== 1) continue;

    try {
      const { stdout } = await execCapture("pdftotext", [
        "-f",
        String(page),
        "-l",
        String(page),
        pdfPath,
        "-",
      ]);
      const text = stdout.replace(/\s+/g, "").trim();
      if (text.length > 20 && text.length < 200) {
        rasterized.push(page);
      }
    } catch {
      rasterized.push(page);
    }
  }
  return rasterized;
}
