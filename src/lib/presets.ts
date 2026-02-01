import type { ResolvedConfig } from "../schema/manifest.types";

export type VendorPreset = Omit<ResolvedConfig, "title" | "authors">;

export const DTRPG_PRESET: VendorPreset = {
  styles: ["css/print.css"],
  source: {
    files: null,
    assets: ["css", "fonts", "images"],
  },
  output: {
    dir: "dist",
    filename: "book.pdf",
    html: "book.html",
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
};

export const PRESETS: Record<string, VendorPreset> = {
  dtrpg: DTRPG_PRESET,
};
