import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** One page's heaviest spot: the C, M, Y and K (percent) of its pixel with the most ink. */
export interface InkCoveragePage {
  page: number;
  c: number;
  m: number;
  y: number;
  k: number;
  /** total area coverage at that spot, C+M+Y+K in percent (0–400) */
  tac: number;
}

/**
 * The heaviest spot of one CMYK raster page, from a PAM file (`pamcmyk32`:
 * a text header ending `ENDHDR`, then 4 bytes per pixel). Total area
 * coverage is a per-pixel figure: a page with a 400% patch on a tenth of its
 * area averages 40%, and it is the 400% that a press cannot hold.
 */
export function maxInkOfPam(pam: Uint8Array): Omit<InkCoveragePage, "page"> {
  const head = Buffer.from(pam.subarray(0, Math.min(pam.length, 512))).toString("latin1");
  const end = head.indexOf("ENDHDR\n");
  const field = (name: string) => Number(new RegExp(`^${name} (\\d+)$`, "m").exec(head)?.[1]);
  if (!head.startsWith("P7\n") || end < 0 || field("DEPTH") !== 4) {
    throw new Error("Ghostscript did not write a 4-channel CMYK raster");
  }
  const max = field("MAXVAL");
  const from = end + "ENDHDR\n".length;
  const to = Math.min(pam.length, from + field("WIDTH") * field("HEIGHT") * 4);
  let best = from;
  let bestSum = -1;
  for (let i = from; i + 3 < to; i += 4) {
    const sum = pam[i]! + pam[i + 1]! + pam[i + 2]! + pam[i + 3]!;
    if (sum > bestSum) {
      bestSum = sum;
      best = i;
    }
  }
  const pct = (v: number) => (v / max) * 100;
  return {
    c: pct(pam[best] ?? 0),
    m: pct(pam[best + 1] ?? 0),
    y: pct(pam[best + 2] ?? 0),
    k: pct(pam[best + 3] ?? 0),
    tac: pct(Math.max(0, bestSum)),
  };
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

/** Raster resolution for the measurement: enough to see any patch a press would notice. */
const TAC_DPI = 72;

/**
 * Each page's total area coverage: Ghostscript rasterises the PDF to CMYK
 * (`pamcmyk32`, {@link TAC_DPI} DPI) and each page's heaviest pixel is read
 * ({@link maxInkOfPam}). A CMYK PDF's colours are rendered as they are; an
 * RGB PDF goes through Ghostscript's default profiles, which is not what a
 * PDF/X build prints, so measure the PDF/X file. Returns `{ ok: false, error }`
 * if gs could not be run or wrote no page — callers must surface the failure,
 * not treat it as "0 pages measured".
 */
export async function getPerPageInkCoverage(
  pdfPath: string
): Promise<InkCoverageResult> {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-tac-"));
  try {
    const ghostscript = await resolveGhostscript();
    if (!ghostscript) {
      throw new Error(
        "Ghostscript executable not found. Install Ghostscript or set GHOSTSCRIPT_PATH."
      );
    }
    const { stderr } = await execCapture(ghostscript, [
      "-q",
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-sDEVICE=pamcmyk32",
      `-r${TAC_DPI}`,
      `-sOutputFile=${join(dir, "page-%d.pam")}`,
      pdfPath,
    ]);
    const pages: InkCoveragePage[] = [];
    for (let page = 1; existsSync(join(dir, `page-${page}.pam`)); page++) {
      pages.push({ page, ...maxInkOfPam(await readFile(join(dir, `page-${page}.pam`))) });
    }
    if (pages.length === 0) {
      // A PDF has at least one page, so no raster means gs did not measure
      // it: a device or drawing error it reported on stderr with exit 0. Same
      // rule as a non-zero exit: never an empty success.
      const reason = stderr.trim().split(/\r?\n/)[0];
      throw new Error(
        `Ghostscript rendered no pages to measure${reason ? `: ${reason}` : ""}`
      );
    }
    return { ok: true, pages };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
