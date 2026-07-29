import { DTRPG_PRESET } from "./presets";
import type { ResolvedConfig } from "../schema/manifest.types";

export type ValidationProfile = "dtrpg";

export const DTRPG_STRICT_PDF_CHECKS = [
  "pdf.structure.qpdf",
  "pdf.print.pdfx-markers",
  "pdf.print.pdfx-metadata",
  "pdf.print.embedded-fonts",
] as const;

/**
 * Force (or fill in) the DTRPG-style strict PDF checks on `config` in place.
 * ARCH finding #21: this used to be two near-duplicate functions differing
 * only in an undefined-check — collapsed into one with an explicit flag.
 *
 * @param overwrite - `true`: unconditionally set every check to
 *   `{enabled: true, severity: "error"}`, clobbering any existing value — the
 *   "profile lock" behavior `applyValidationProfile("dtrpg")` needs.
 *   `false` (default): only fill in checks the config left `undefined` — an
 *   author who explicitly configured (or disabled) a check keeps that choice.
 */
function enforceStrictPdfChecks(config: ResolvedConfig, overwrite = false): void {
  for (const checkId of DTRPG_STRICT_PDF_CHECKS) {
    if (overwrite || config.validate.checks[checkId] === undefined) {
      config.validate.checks[checkId] = {
        enabled: true,
        severity: "error",
      };
    }
  }
}

/**
 * Fill in the strict PDF checks (structure/PDF-X markers/metadata/embedded
 * fonts) for any of them the config left unset, without overwriting an
 * author's explicit choice. ARCH finding #21: replaces the old
 * `applyDtrpgPdfDefaults` name, which implied a dtrpg-only opt-in even though
 * `executeValidation` applies it to every PDF validation regardless of
 * profile/preset — see validation-exec.ts.
 */
export function applyDefaultPdfStrictChecks(config: ResolvedConfig): ResolvedConfig {
  const next = structuredClone(config);
  enforceStrictPdfChecks(next, false);
  return next;
}

export function applyValidationProfile(
  config: ResolvedConfig,
  profile: ValidationProfile
): ResolvedConfig {
  const next = structuredClone(config);

  if (profile === "dtrpg") {
    next.pdfx.flavor = DTRPG_PRESET.pdfx.flavor;
    next.ink.maxTac = DTRPG_PRESET.ink.maxTac;
    next.ink.tacTolerance = DTRPG_PRESET.ink.tacTolerance;
    next.validate.pdf.forbidTransparency = DTRPG_PRESET.validate.pdf.forbidTransparency;
    next.validate.pdf.minImageResolution = DTRPG_PRESET.validate.pdf.minImageResolution;
    next.validate.assets.allowedColorSpaces = [
      ...DTRPG_PRESET.validate.assets.allowedColorSpaces,
    ];
    enforceStrictPdfChecks(next, true);
  }

  return next;
}
