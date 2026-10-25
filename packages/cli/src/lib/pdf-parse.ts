import { readFile } from "node:fs/promises";
import { execCapture } from "./exec";
import { resolveGhostscript } from "./ghostscript";

/**
 * Read a PDF as a latin1 string for literal ASCII-marker scanning.
 *
 * latin1 maps every byte 0x00–0xFF to exactly one char (lossless for binary
 * data) — never use utf8 here, which mangles non-text bytes. This is the
 * in-process replacement for the previous `grep -ao <marker> file.pdf` usage
 * and is a behavioral equivalent, including grep's one limitation: markers that
 * live inside FlateDecode-compressed streams are not visible to a raw byte
 * scan. grep had the identical blind spot, so callers see no behavior change.
 *
 * Used by the transparency, color-spaces, and bleed checks. All other PDF
 * inspection now goes through the structured PDF.js reader in pdf-inspect.ts.
 */
export async function readPdfBytes(pdfPath: string): Promise<string> {
  return readFile(pdfPath, "latin1");
}

/**
 * Parse ink coverage from `gs -sDEVICE=inkcov` output.
 *
 * Ghostscript has no pure-JS equivalent (it stays a system tool),
 * so the inkcov path remains shell-based here.
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
      const [c, m, y, k] = nums as [number, number, number, number];
      pages.push({ c, m, y, k, sum: c + m + y + k });
    }
  }
  return pages;
}

interface InkCoveragePage {
  page: number;
  c: number;
  m: number;
  y: number;
  k: number;
  tac: number;
}

/**
 * Discriminated result for {@link getPerPageInkCoverage}. Ghostscript failing
 * (crash, corrupt PDF, missing binary, a Windows PATH mismatch) must be
 * distinguishable from a legitimately measured, empty-pages result:
 * collapsing both to the same `[]` would let the ink-coverage check silently
 * PASS a book it never actually measured.
 */
export type InkCoverageResult =
  | { ok: true; pages: InkCoveragePage[] }
  | { ok: false; error: string };

/**
 * Get per-page ink coverage using Ghostscript's inkcov device.
 * Returns `{ ok: true, pages }` with per-page CMYK coverage (in percentages)
 * on success, or `{ ok: false, error }` if gs could not be run/parsed —
 * callers must surface the failure, not treat it as "0 pages measured".
 */
export async function getPerPageInkCoverage(
  pdfPath: string
): Promise<InkCoverageResult> {
  try {
    const ghostscript = await resolveGhostscript();
    if (!ghostscript) {
      throw new Error(
        "Ghostscript executable not found. Install Ghostscript or set GHOSTSCRIPT_PATH."
      );
    }
    const { stdout, stderr } = await execCapture(ghostscript, [
      "-q",
      "-dBATCH",
      "-dNOPAUSE",
      "-sDEVICE=inkcov",
      // Ghostscript 10 refuses to run the inkcov device without an output
      // target ("Device 'inkcov' requires an output file but no file was
      // specified"), exits 0 and prints nothing on stdout. Without this flag
      // that parsed as "no pages" and the check passed books it never
      // measured (#419).
      "-sOutputFile=-",
      pdfPath,
    ]);
    const pages = parseInkCov(stdout);
    if (pages.length === 0) {
      // A PDF has at least one page, so no CMYK line means gs did not measure
      // it: a device or drawing error it reported on stderr with exit 0. Same
      // rule as a non-zero exit: never an empty success.
      const reason = stderr.trim().split(/\r?\n/)[0];
      throw new Error(
        `Ghostscript inkcov produced no per-page data${reason ? `: ${reason}` : ""}`
      );
    }
    return {
      ok: true,
      pages: pages.map((p, i) => ({
        page: i + 1,
        c: p.c * 100,
        m: p.m * 100,
        y: p.y * 100,
        k: p.k * 100,
        tac: p.sum * 100,
      })),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
