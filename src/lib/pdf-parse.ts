import { existsSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
 * Extract CMYK color values directly from PDF content streams (async).
 */
export async function parseCmykFromPdf(
  pdfPath: string
): Promise<{
  maxTac: number;
  colors: Array<{ c: number; m: number; y: number; k: number; tac: number }>;
}> {
  try {
    const tmpDir = await mkdtemp(join(tmpdir(), "validate-tac-"));
    const qdfPath = join(tmpDir, "decompressed.pdf");

    try {
      try {
        await execCapture("qpdf", [
          "--qdf",
          "--no-original-object-ids",
          pdfPath,
          qdfPath,
        ]);
      } catch {
        if (!existsSync(qdfPath)) throw new Error("qpdf failed and produced no output");
      }

      const { stdout: output } = await execCapture("strings", [qdfPath]);

      const cmykPattern =
        /^([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+([0-9.]+)\s+[kK]$/gm;
      const colors: Array<{
        c: number;
        m: number;
        y: number;
        k: number;
        tac: number;
      }> = [];
      const seen = new Set<string>();

      let match;
      while ((match = cmykPattern.exec(output)) !== null) {
        const c = parseFloat(match[1]);
        const m = parseFloat(match[2]);
        const y = parseFloat(match[3]);
        const k = parseFloat(match[4]);

        if ([c, m, y, k].some((v) => isNaN(v) || v < 0 || v > 1)) continue;

        const tac = (c + m + y + k) * 100;
        const key = `${c.toFixed(3)},${m.toFixed(3)},${y.toFixed(3)},${k.toFixed(3)}`;

        if (!seen.has(key)) {
          seen.add(key);
          colors.push({
            c: c * 100,
            m: m * 100,
            y: y * 100,
            k: k * 100,
            tac,
          });
        }
      }

      colors.sort((a, b) => b.tac - a.tac);
      const maxTac = colors.length > 0 ? colors[0].tac : 0;
      return { maxTac, colors };
    } finally {
      await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    }
  } catch {
    return { maxTac: 0, colors: [] };
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
