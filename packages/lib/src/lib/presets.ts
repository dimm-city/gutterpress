import type { ResolvedConfig } from "../schema/manifest.types";

export type VendorPreset = Omit<ResolvedConfig, "title" | "authors">;

export const DTRPG_PRESET: VendorPreset = {
  styles: ["css/print.css"],
  plugins: [],
  source: {
    files: null,
    assets: ["css", "fonts", "images"],
  },
  output: {
    dir: "dist",
    filename: "book.pdf",
  },
  pdfx: {
    flavor: "x1a",
    icc: "profiles/CGATS21_CRPC1.icc",
    stripAnnotations: true,
  },
  page: {
    width: 621,
    height: 810,
    tolerance: 0.5,
  },
  ink: {
    maxTac: 240,
    tacTolerance: 0.5,
  },
  lint: {
    enabled: true,
    configPath: null,
  },
  validate: {
    enabled: true,
    checks: {
      "pdf.structure.qpdf": {
        enabled: true,
        severity: "error",
      },
      "pdf.print.pdfx-markers": {
        enabled: true,
        severity: "error",
      },
      "pdf.print.pdfx-metadata": {
        enabled: true,
        severity: "error",
      },
      "pdf.print.embedded-fonts": {
        enabled: true,
        severity: "error",
      },
    },
    source: {
      markdownlint: null,
      htmlhint: null,
      stylelint: null,
      // Deprecated: ::: container syntax was removed 2026-05-17. Field kept
      // so older manifests still parse, but unused. See docs/migrations/2026-05-removing-container-syntax.md
      allowedCallouts: [],
    },
    assets: {
      maxImageSize: 10_000_000,
      minImageDpi: 300,
      allowedColorSpaces: ["CMYK", "Grayscale"],
      allowAlpha: false,
      approvedFontFiles: [],
      requireFontLicense: false,
    },
    pdf: {
      requireBookmarks: false,
      requireTocLinks: false,
      minImageResolution: 300,
      forbidTransparency: true,
      requireBleed: false,
      bleedSize: 9,
    },
    heuristics: {
      maxDecorativeLayers: 5,
      textDensityRange: { min: 200, max: 5000 },
      maxParagraphsPerSection: 10,
    },
  },
};

export const PRESETS: Record<string, VendorPreset> = {
  dtrpg: DTRPG_PRESET,
};
