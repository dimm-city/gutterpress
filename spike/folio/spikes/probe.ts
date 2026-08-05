/** Bun-side wrapper around spikes/pdfprobe.py (verification only). */
import { spawnSync } from "node:child_process";
import { join } from "node:path";

const SCRIPT = join(import.meta.dir, "pdfprobe.py");

function run(args: string[]): any {
  const r = spawnSync("python3", [SCRIPT, ...args], {
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
  });
  if (r.status !== 0) throw new Error(`pdfprobe ${args[0]} failed: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

export interface PdfWord {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  text: string;
}
export interface PdfPageText {
  page: number;
  text: string;
  words: PdfWord[];
}

export function pdfText(path: string): { pageCount: number; pages: PdfPageText[] } {
  return run(["text", path]);
}

export function pdfInfo(path: string): any {
  return run(["info", path]);
}

export function pdfRender(path: string, outdir: string, dpi = 96): any {
  return run(["render", path, outdir, String(dpi)]);
}

export function pdfDrawings(path: string, page = 0): any {
  return run(["drawings", path, String(page)]);
}

/** First page (1-based) whose text contains `needle`, or 0. */
export function pageOf(t: { pages: PdfPageText[] }, needle: string): number {
  const p = t.pages.find((p) => p.text.includes(needle));
  return p ? p.page + 1 : 0;
}
