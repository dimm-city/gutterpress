import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { execCapture } from "../lib/exec";
import {
  parsePdfInfoBox,
  parsePdfFonts,
  parseCmykFromPdf,
  parsePdfImages,
  filterRasterized,
} from "../lib/pdf-parse";
import { log } from "../lib/logger";

export default defineCommand({
  meta: {
    name: "validate",
    description: "Validate a PDF for print compliance",
  },
  args: {
    pdf: {
      type: "string",
      description: "Path to the PDF file to validate",
      required: true,
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
  },
  async run({ args }) {
    const manifest = await loadManifest(args.manifest);
    const config = resolveConfig({}, manifest);

    const pdf = args.pdf!;
    if (!existsSync(pdf)) {
      log.error(`File not found: ${pdf}`);
      process.exit(2);
    }

    const errors: string[] = [];
    const warnings: string[] = [];

    // qpdf structure check
    try {
      await execCapture("qpdf", ["--check", pdf]);
    } catch {
      warnings.push("qpdf reported structural issues in the PDF.");
    }

    // Page size
    const info = await execCapture("pdfinfo", ["-box", pdf]);
    const size = parsePdfInfoBox(info.stdout);
    if (!size) {
      errors.push("Could not parse PDF page size.");
    } else if (
      Math.abs(size.w - config.page.width) >= config.page.tolerance ||
      Math.abs(size.h - config.page.height) >= config.page.tolerance
    ) {
      errors.push(
        `Page size mismatch: expected ~${config.page.width}x${config.page.height} pts, got ${size.w}x${size.h} pts.`
      );
    }

    // PDF/X markers
    const pdfxCheck = await execCapture("grep", [
      "-ao",
      "GTS_PDFX\\|PDF/X-",
      pdf,
    ]).catch(() => ({ stdout: "", stderr: "" }));
    if (
      !pdfxCheck.stdout.includes("GTS_PDFX") &&
      !pdfxCheck.stdout.includes("PDF/X-")
    ) {
      errors.push("PDF/X markers not found (GTS_PDFXVersion / OutputIntent).");
    }

    // Color spaces
    const colorCheck = await execCapture("grep", [
      "-ao",
      "/DeviceRGB\\|/Lab\\b\\|/Separation\\|/DeviceN",
      pdf,
    ]).catch(() => ({ stdout: "", stderr: "" }));
    if (colorCheck.stdout.includes("/DeviceRGB")) {
      errors.push("DeviceRGB found (interior must be CMYK or grayscale only).");
    }
    if (colorCheck.stdout.includes("/Lab")) {
      errors.push("Lab color space found (not allowed).");
    }
    if (colorCheck.stdout.includes("/Separation")) {
      errors.push("Spot color (Separation) found (not allowed).");
    }
    if (colorCheck.stdout.includes("/DeviceN")) {
      errors.push("Spot color (DeviceN) found (not allowed).");
    }

    // Embedded fonts
    const fonts = await execCapture("pdffonts", [pdf]);
    const rows = parsePdfFonts(fonts.stdout);
    if (rows.length === 0) {
      warnings.push("No fonts detected (unexpected).");
    } else if (!rows.every((r) => r.embedded)) {
      errors.push(
        "Not all fonts are embedded. Check @font-face and Chromium output."
      );
    }

    // TAC check
    const cmykData = await parseCmykFromPdf(pdf);
    const maxTac = cmykData.maxTac;
    const tacWarning = maxTac > config.ink.maxTac + config.ink.tacTolerance;
    if (tacWarning) {
      warnings.push(
        `Total ink coverage too high (max ${maxTac.toFixed(1)}%, recommended <=${config.ink.maxTac}%)`
      );
      warnings.push(
        "Some pages may have issues with commercial print. Consider lightening dark backgrounds."
      );
      if (cmykData.colors.length > 0) {
        const offending = cmykData.colors
          .slice(0, 3)
          .filter((c) => c.tac > config.ink.maxTac);
        for (const color of offending) {
          warnings.push(
            `  C:${color.c.toFixed(1)}% M:${color.m.toFixed(1)}% Y:${color.y.toFixed(1)}% K:${color.k.toFixed(1)}% = ${color.tac.toFixed(1)}% TAC`
          );
        }
      }
    }

    // Rasterized page detection
    const rasterizedPages: number[] = [];
    if (size) {
      const images = await execCapture("pdfimages", ["-list", pdf]);
      const candidates = parsePdfImages(images.stdout, size);
      rasterizedPages.push(
        ...(await filterRasterized(candidates, pdf, images.stdout))
      );
      if (rasterizedPages.length > 0) {
        warnings.push(
          `Possible rasterized pages detected: ${rasterizedPages.join(", ")}`
        );
        warnings.push(
          "This may indicate CSS filters, blend modes, or transparency that forced flattening."
        );
        warnings.push(
          "Text on these pages may not be selectable and quality may be reduced."
        );
      }
    }

    // --- Report ---
    for (const w of warnings) {
      log.warn(w);
    }
    for (const e of errors) {
      log.error(e);
    }

    const hasErrors = errors.length > 0;
    const hasWarnings = warnings.length > 0;

    if (hasErrors) {
      log.error(`VALIDATION FAILED (${errors.length} error${errors.length > 1 ? "s" : ""})`);
    } else if (hasWarnings) {
      log.warn("VALIDATION PASSED (with warnings)");
    } else {
      log.success("VALIDATION PASSED");
    }

    log.info(`Max TAC: ${maxTac.toFixed(1)}%${tacWarning ? " (high!)" : ""}`);
    log.info(`Fonts embedded: ${rows.length}`);
    log.info(
      `Rasterized pages: ${rasterizedPages.length > 0 ? rasterizedPages.join(", ") : "none"}`
    );

    if (hasErrors) {
      process.exit(1);
    }
  },
});
