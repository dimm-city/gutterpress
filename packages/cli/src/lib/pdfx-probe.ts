/**
 * Does the installed Ghostscript separate through the PDF/X output profile?
 *
 * Measured (2026-11-04): Ghostscript 10.02.1 (Ubuntu 24.04's package; Debian
 * 12 ships 10.0.0) ignores `-sOutputICCProfile`, `-sDefaultCMYKProfile` and
 * `-dRenderIntent` for pdfwrite's vector colour and separates RGB through its
 * built-in default_cmyk.icc: `#000` comes out C72 M68 Y67 K88 = 295%, over
 * DriveThruRPG's 240%, while the file still embeds CRPC1 as its OutputIntent.
 * Ghostscript 10.06.0 honours the profile: `#000` comes out about
 * C47 M42 Y40 K100 = 229% (gutterpress #331). DeviceGray and DeviceCMYK pass
 * through unchanged on both, so K-only text is safe either way.
 *
 * No version number is a reliable test across distributions, so a PDF/X build
 * converts a one-page `#000` swatch with the book's own arguments and reads the
 * separation back from the result. Only the shipped CRPC1 has a signature this
 * module knows; a build with another profile is not judged.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { PDFDocument, rgb } from "pdf-lib";
import { log } from "../utils/logger";
import { execCapture } from "./exec";
import { convertToPdfxCmyk, resolveGhostscript } from "./ghostscript";
import { iccProfileDescription, outputConditionFor } from "./icc-profile";
import { getPerPageInkCoverage, type InkCoveragePage } from "./pdf-parse";

/** `profile`: the output profile separated the swatch; `default`: Ghostscript's own CMYK profile did. */
export type Separation = "profile" | "default";

/**
 * CRPC1 puts RGB black on the K plate (K 100, C 45-52, TAC <= 245);
 * default_cmyk.icc gives K 88, C 72, TAC 295. The thresholds sit between.
 */
export function crpc1SeparatesBlack(ink: Pick<InkCoveragePage, "c" | "k" | "tac">): Separation {
  return ink.k >= 99 && ink.c <= 55 && ink.tac <= 245 ? "profile" : "default";
}

export interface SeparationProbe {
  /** false when nothing was judged: an unknown profile, or the swatch could not be measured */
  checked: boolean;
  separation?: Separation;
  /** the swatch's heaviest spot, percent per ink */
  black?: InkCoveragePage;
  version?: string;
}

const fmt = (ink: InkCoveragePage) =>
  `C${ink.c.toFixed(0)} M${ink.m.toFixed(0)} Y${ink.y.toFixed(0)} K${ink.k.toFixed(0)} = ${ink.tac.toFixed(0)}%`;

/**
 * Convert a `#000` swatch with the build's arguments and say which profile
 * separated it. Warns when the output profile was ignored; the build goes on,
 * because the file is still a valid PDF/X and `pdf.print.ink-coverage` reports
 * the ink it carries.
 */
export async function verifyPdfxSeparation(config: {
  iccPath: string;
  pdfx: "x1a" | "x3";
  stagingDir: string;
}): Promise<SeparationProbe> {
  const description = iccProfileDescription(
    await readFile(config.iccPath).catch(() => new Uint8Array())
  );
  if (!description || !outputConditionFor(description).registered) return { checked: false };

  const swatch = join(config.stagingDir, "separation-probe.pdf");
  const out = join(config.stagingDir, "separation-probe-pdfx.pdf");
  const doc = await PDFDocument.create();
  doc
    .addPage([72, 72])
    .drawRectangle({ x: 0, y: 0, width: 72, height: 72, color: rgb(0, 0, 0), borderWidth: 0 });
  await writeFile(swatch, await doc.save());
  await convertToPdfxCmyk(swatch, out, { ...config, title: "separation probe", quiet: true });

  const coverage = await getPerPageInkCoverage(out);
  if (!coverage.ok || coverage.pages.length === 0) {
    log.warn(
      `Could not measure how Ghostscript separates colour (${coverage.ok ? "no page measured" : coverage.error}), ` +
        "so whether it honoured the PDF/X output profile is unknown."
    );
    return { checked: false };
  }
  const black = coverage.pages[0]!;
  const separation = crpc1SeparatesBlack(black);
  const ghostscript = await resolveGhostscript();
  const version = ghostscript
    ? await execCapture(ghostscript, ["--version"])
        .then((r) => r.stdout.trim())
        .catch(() => "")
    : "";
  if (separation === "default") {
    log.warn(
      `Ghostscript ${version || "(unknown version)"} ignored the PDF/X output profile: #000 separated to ${fmt(black)}, ` +
        `Ghostscript's own default CMYK profile, where ${description} gives about C47 M42 Y40 K100 = 229%. ` +
        "Every colour in this file is separated the same way, so its ink runs up to 295%, over DriveThruRPG's 240%, " +
        "and the embedded OutputIntent does not describe it. Ghostscript 10.02.1 (Debian's and Ubuntu's package) " +
        'does this; 10.06.0 does not. Install Ghostscript 10.06 or newer (docs/publishing.md, "PDF/X colour") and build again.'
    );
  } else {
    log.info(`Ghostscript ${version} separates through ${description}: #000 -> ${fmt(black)}`);
  }
  return { checked: true, separation, black, version };
}
