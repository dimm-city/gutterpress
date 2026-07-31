import type { ResolvedConfig } from "../schema/manifest.types";
import { DTRPG_PRESET, type VendorPreset } from "./presets";
import { UsageError } from "./cli-args";

/**
 * Publish targets — WHERE THE BOOK IS PUBLISHED (ADR 0008).
 *
 * A target is a named validation-policy overlay: the requirements a
 * destination (DriveThruRPG, itch.io, …) places on the built PDF. Targets
 * never change how the book renders — they change what the validator
 * demands of the output — so one source can be validated against several
 * destinations (`targets: [dtrpg, itch]` in the manifest).
 *
 * A target's overlay is DATA merged between the preset and the manifest,
 * giving one precedence chain everywhere: cli > manifest > target > preset.
 * The author's explicit manifest values therefore always win — the same
 * sovereignty rule presets follow. The only hard enforcement a target adds
 * is {@link PublishTarget.requiredChecks}: a required check that gets
 * skipped because its tools are missing becomes a synthetic error, so
 * "validated for dtrpg" can never silently mean "the dtrpg checks didn't
 * run".
 *
 * Grown from the old `validate --profile dtrpg` (validation-profile.ts,
 * deleted): the profile was this exact idea hardcoded for one destination.
 */

/** The deep-partial preset shape a target may overlay. */
export type TargetOverlay = {
  pdfx?: Partial<ResolvedConfig["pdfx"]>;
  ink?: Partial<ResolvedConfig["ink"]>;
  validate?: {
    checks?: ResolvedConfig["validate"]["checks"];
    assets?: Partial<ResolvedConfig["validate"]["assets"]>;
    pdf?: Partial<ResolvedConfig["validate"]["pdf"]>;
  };
};

export interface PublishTarget {
  id: string;
  /** Display name for reports and pickers. */
  label: string;
  /** Policy defaults merged between the preset and the manifest. */
  overlay: TargetOverlay;
  /**
   * Check ids that must actually RUN for this target: when tool
   * availability forces one to be skipped, validation reports a synthetic
   * error instead of a false green. (An author who explicitly disables one
   * of these in the manifest owns that choice — this guards silent
   * environment gaps, not deliberate configuration.)
   */
  requiredChecks: readonly string[];
  /**
   * External system tools this destination's full pipeline depends on —
   * building the compliant output AND running the required checks. Creation
   * flows use this to warn, at target-selection time, that a compliant file
   * can't be produced or verified until these are installed. Must cover at
   * least the union of {@link requiredChecks}' own `requiredTools`
   * (enforced by targets.test.ts); may add build-time tools the checks
   * alone don't reveal (e.g. Ghostscript for the PDF/X conversion).
   */
  requiredTools: readonly string[];
}

/**
 * DriveThruRPG print-on-demand. The policy VALUES intentionally point at
 * {@link DTRPG_PRESET}: the dtrpg preset's base policy IS this destination's
 * requirement set (the preset exists so a book designed for DTRPG is
 * print-ready with zero further configuration), so there is exactly one
 * place the numbers live.
 */
const DTRPG_TARGET: PublishTarget = {
  id: "dtrpg",
  label: "DriveThruRPG",
  overlay: {
    pdfx: { flavor: DTRPG_PRESET.pdfx.flavor },
    ink: {
      maxTac: DTRPG_PRESET.ink.maxTac,
      tacTolerance: DTRPG_PRESET.ink.tacTolerance,
    },
    validate: {
      checks: {
        "pdf.structure.qpdf": { enabled: true, severity: "error" },
        "pdf.print.pdfx-markers": { enabled: true, severity: "error" },
        "pdf.print.pdfx-metadata": { enabled: true, severity: "error" },
        "pdf.print.embedded-fonts": { enabled: true, severity: "error" },
      },
      assets: {
        allowedColorSpaces: [...DTRPG_PRESET.validate.assets.allowedColorSpaces],
      },
      pdf: {
        forbidTransparency: DTRPG_PRESET.validate.pdf.forbidTransparency,
        minImageResolution: DTRPG_PRESET.validate.pdf.minImageResolution,
      },
    },
  },
  requiredChecks: [
    "pdf.structure.qpdf",
    "pdf.print.pdfx-markers",
    "pdf.print.pdfx-metadata",
    "pdf.print.embedded-fonts",
  ],
  // qpdf: PDF/X marker/metadata verification (and annotation stripping at
  // build time); gs: the PDF/X CMYK conversion itself plus ink-coverage.
  // Without these a print-compliant file can't be built or verified.
  requiredTools: ["qpdf", "gs"],
};

/**
 * itch.io — a DIGITAL release. Print-only constraints (PDF/X, press ink
 * limits, bleed, CMYK-only art) do not apply; a well-formed PDF with
 * embedded fonts does.
 */
const ITCH_TARGET: PublishTarget = {
  id: "itch",
  label: "itch.io",
  overlay: {
    validate: {
      checks: {
        "pdf.structure.qpdf": { enabled: true, severity: "error" },
        "pdf.print.embedded-fonts": { enabled: true, severity: "error" },
        "pdf.print.pdfx-markers": false,
        "pdf.print.pdfx-metadata": false,
        "pdf.print.ink-coverage": false,
        "asset.image.tac-raster": false,
      },
      assets: {
        allowedColorSpaces: ["RGB", "CMYK", "Grayscale"],
        allowAlpha: true,
      },
      pdf: {
        forbidTransparency: false,
        requireBleed: false,
      },
    },
  },
  requiredChecks: ["pdf.structure.qpdf", "pdf.print.embedded-fonts"],
  // Both required checks run in-process (the qpdf id is historical — the
  // structure gate is a pure-JS parse now), so a digital release needs no
  // external tools at all.
  requiredTools: [],
};

export const TARGETS: Record<string, PublishTarget> = {
  dtrpg: DTRPG_TARGET,
  itch: ITCH_TARGET,
};

/** The registered target ids, in the order pickers should offer them. */
export const TARGET_IDS = Object.keys(TARGETS);

/** Look up a target id; unknown ids are a usage error naming the registry. */
export function publishTargetFor(id: string): PublishTarget {
  const target = TARGETS[id];
  if (!target) {
    throw new UsageError(
      `Unknown publish target "${id}". Known targets: ${TARGET_IDS.join(", ")}.`
    );
  }
  return target;
}

/**
 * Resolve the effective target-id list for a run: the requested list when
 * given (manifest `targets:` or `--target`), else the preset's defaults.
 * Validates every id and dedupes while preserving order.
 */
export function resolveTargets(
  requested: readonly string[] | undefined,
  fallback: readonly string[]
): string[] {
  const ids = requested ?? fallback;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    publishTargetFor(id);
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Merge a target's overlay onto a preset, producing the effective preset a
 * target-scoped `resolveConfig` run merges the manifest over. This is what
 * puts the overlay BELOW the manifest in the precedence chain.
 */
export function overlayPreset(preset: VendorPreset, target: PublishTarget): VendorPreset {
  const o = target.overlay;
  return {
    ...preset,
    pdfx: { ...preset.pdfx, ...o.pdfx },
    ink: { ...preset.ink, ...o.ink },
    validate: {
      ...preset.validate,
      checks: { ...preset.validate.checks, ...o.validate?.checks },
      assets: { ...preset.validate.assets, ...o.validate?.assets },
      pdf: { ...preset.validate.pdf, ...o.validate?.pdf },
    },
  };
}

/**
 * The strict-PDF fill-ins applied to EVERY post-build PDF validation
 * regardless of preset/target: any of these left `undefined` by the config
 * becomes an error-severity check, without overwriting an author's explicit
 * choice (including an explicit disable). Moved verbatim from
 * validation-profile.ts (ARCH #21).
 */
export const DEFAULT_STRICT_PDF_CHECKS = [
  "pdf.structure.qpdf",
  "pdf.print.pdfx-markers",
  "pdf.print.pdfx-metadata",
  "pdf.print.embedded-fonts",
] as const;

export function applyDefaultPdfStrictChecks(config: ResolvedConfig): ResolvedConfig {
  const next = structuredClone(config);
  for (const checkId of DEFAULT_STRICT_PDF_CHECKS) {
    if (next.validate.checks[checkId] === undefined) {
      next.validate.checks[checkId] = { enabled: true, severity: "error" };
    }
  }
  return next;
}
