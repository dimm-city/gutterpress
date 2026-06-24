import { DTRPG_PRESET } from "./presets";
import type { ResolvedConfig } from "../schema/manifest.types";

export type ValidationProfile = "dtrpg";

export const DTRPG_STRICT_PDF_CHECKS = [
  "pdf.structure.qpdf",
  "pdf.print.pdfx-markers",
  "pdf.print.pdfx-metadata",
  "pdf.print.embedded-fonts",
] as const;

function cloneConfig(config: ResolvedConfig): ResolvedConfig {
  return {
    ...config,
    authors: [...config.authors],
    styles: [...config.styles],
    plugins: config.plugins.map((plugin) => ({
      ...plugin,
      options: { ...plugin.options },
    })),
    source: {
      ...config.source,
      assets: [...config.source.assets],
      files: config.source.files ? [...config.source.files] : null,
    },
    output: { ...config.output },
    pdfx: { ...config.pdfx },
    page: { ...config.page },
    ink: { ...config.ink },
    lint: { ...config.lint },
    validate: {
      ...config.validate,
      checks: { ...config.validate.checks },
      source: {
        ...config.validate.source,
        allowedCallouts: [...config.validate.source.allowedCallouts],
      },
      assets: {
        ...config.validate.assets,
        allowedColorSpaces: [...config.validate.assets.allowedColorSpaces],
        approvedFontFiles: [...config.validate.assets.approvedFontFiles],
      },
      pdf: { ...config.validate.pdf },
      heuristics: {
        ...config.validate.heuristics,
        textDensityRange: { ...config.validate.heuristics.textDensityRange },
      },
    },
  };
}

function enforceStrictPdfChecks(config: ResolvedConfig): void {
  for (const checkId of DTRPG_STRICT_PDF_CHECKS) {
    config.validate.checks[checkId] = {
      enabled: true,
      severity: "error",
    };
  }
}

export function applyDtrpgPdfDefaults(config: ResolvedConfig): ResolvedConfig {
  const next = cloneConfig(config);
  for (const checkId of DTRPG_STRICT_PDF_CHECKS) {
    if (next.validate.checks[checkId] === undefined) {
      next.validate.checks[checkId] = {
        enabled: true,
        severity: "error",
      };
    }
  }
  return next;
}

export function applyValidationProfile(
  config: ResolvedConfig,
  profile: ValidationProfile
): ResolvedConfig {
  const next = cloneConfig(config);

  if (profile === "dtrpg") {
    next.pdfx.flavor = DTRPG_PRESET.pdfx.flavor;
    next.ink.maxTac = DTRPG_PRESET.ink.maxTac;
    next.ink.tacTolerance = DTRPG_PRESET.ink.tacTolerance;
    next.validate.pdf.forbidTransparency = DTRPG_PRESET.validate.pdf.forbidTransparency;
    next.validate.pdf.minImageResolution = DTRPG_PRESET.validate.pdf.minImageResolution;
    next.validate.assets.allowedColorSpaces = [
      ...DTRPG_PRESET.validate.assets.allowedColorSpaces,
    ];
    enforceStrictPdfChecks(next);
  }

  return next;
}
