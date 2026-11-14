import type { ResolvedConfig } from "../schema/manifest.types";
import { DTRPG_PRESET, type VendorPreset } from "./presets";
import { UsageError } from "./cli-args";

/**
 * Publish targets — WHERE THE BOOK IS PUBLISHED (ADR 0008, ADR 0012).
 *
 * A target is a place the book goes: DriveThruRPG print, itch.io, a Drive
 * folder, a folder on this computer. This registry says what each one IS:
 * the FILE it receives (fixed, or a pick the person makes) and the RULES that
 * file is held to (a validation-policy overlay; none for a target that
 * leaves the file to the book's own rules). How a file is delivered is the
 * target's publish provider (`publish/providers/`), which takes its label and
 * file from here. Targets never change how the book is laid out — only which
 * file is made and what the validator demands of it — so one source can go
 * to several places (`publish: { drivethrurpg-print:, itch: }` in the
 * manifest).
 *
 * A target's overlay is DATA merged between the preset and the manifest,
 * giving one precedence chain everywhere: cli > manifest > target > preset.
 * The author's explicit manifest values therefore always win — the same
 * sovereignty rule presets follow. The only hard enforcement a target adds
 * is {@link PublishTarget.requiredChecks}: a required check that gets
 * skipped because its tools are missing becomes a synthetic error, so
 * "validated for dtrpg" can never silently mean "the dtrpg checks didn't
 * run".
 */

/** The deep-partial preset shape a target may overlay. */
export type TargetOverlay = {
  pdfx?: Partial<ResolvedConfig["pdfx"]>;
  ink?: Partial<ResolvedConfig["ink"]>;
  checks?: ResolvedConfig["checks"];
  validate?: {
    assets?: Partial<ResolvedConfig["validate"]["assets"]>;
    pdf?: Partial<ResolvedConfig["validate"]["pdf"]>;
  };
};

/** A file a book can be made into: a PDF, a print-ready PDF/X, or the website. */
export type TargetFileFormat = "pdf" | "pdfx" | "html";

export interface PublishTarget {
  id: string;
  /** Display name for reports and pickers. */
  label: string;
  /**
   * The file this target receives. Fixed when {@link formats} is absent
   * (DriveThruRPG print is PDF/X); otherwise the pick made when none is saved.
   */
  format: TargetFileFormat;
  /**
   * Present when the target does not define its file: the formats the person
   * picks from. The pick is saved as `publish.<id>.format` and reused.
   */
  formats?: readonly TargetFileFormat[];
  /**
   * Policy defaults merged between the preset and the manifest. Empty for a
   * target with no rules of its own: its file is checked against the book's.
   */
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
const DTRPG_PRINT_TARGET: PublishTarget = {
  id: "drivethrurpg-print",
  label: "DriveThruRPG (print)",
  // The whole point of the target: print-on-demand takes PDF/X, nothing else.
  format: "pdfx",
  overlay: {
    pdfx: { flavor: DTRPG_PRESET.pdfx.flavor },
    ink: {
      maxTac: DTRPG_PRESET.ink.maxTac,
      tacTolerance: DTRPG_PRESET.ink.tacTolerance,
    },
    checks: {
      "pdf.structure.qpdf": "error",
      "pdf.print.pdfx-markers": "error",
      "pdf.print.pdfx-metadata": "error",
      "pdf.print.embedded-fonts": "error",
      "pdf.print.safe-margins": "error",
      // DERIVED: PDF/X-1a forbids transparency; on even for a `book` preset.
      "pdf.print.transparency": "on",
      // SPEC: 0.125in of bleed on the top, bottom and outside edge; the `book`
      // preset turns the check off.
      "pdf.print.bleed": "on",
    },
    validate: {
      pdf: {
        minImageResolution: DTRPG_PRESET.validate.pdf.minImageResolution,
      },
    },
  },
  requiredChecks: [
    "pdf.structure.qpdf",
    "pdf.print.pdfx-markers",
    "pdf.print.pdfx-metadata",
    "pdf.print.embedded-fonts",
    "pdf.print.safe-margins",
  ],
  // qpdf: PDF/X marker/metadata verification (and annotation stripping at
  // build time); gs: the PDF/X CMYK conversion itself plus ink-coverage.
  // Without these a print-compliant file can't be built or verified.
  requiredTools: ["qpdf", "gs"],
};

/**
 * A DIGITAL release. Print-only constraints (PDF/X, press ink limits, bleed,
 * CMYK-only art) do not apply; a well-formed PDF with embedded fonts does.
 * Shared by every target that sells or hosts a PDF to read on screen.
 */
const DIGITAL_RULES: Pick<PublishTarget, "format" | "overlay" | "requiredChecks" | "requiredTools"> = {
  format: "pdf",
  overlay: {
    checks: {
      "pdf.structure.qpdf": "error",
      "pdf.print.embedded-fonts": "error",
      "pdf.print.pdfx-markers": "off",
      "pdf.print.pdfx-metadata": "off",
      "pdf.print.ink-coverage": "off",
      "pdf.print.safe-margins": "off",
      "pdf.print.transparency": "off",
      "pdf.print.bleed": "off",
      "asset.image.alpha-channel": "off",
    },
    validate: {
      assets: {
        // 0 = no limit: a screen PDF has no print file-size cap.
        maxImageSize: 0,
      },
      pdf: {
        // 0 = no floor: 300 DPI is a print bar, not a screen one.
        minImageResolution: 0,
      },
    },
  },
  requiredChecks: ["pdf.structure.qpdf", "pdf.print.embedded-fonts"],
  // Both required checks run in-process (the qpdf id is historical — the
  // structure gate is a pure-JS parse now), so a digital release needs no
  // external tools at all.
  requiredTools: [],
};

/** A target that defines neither a file nor rules: the person picks the file,
 *  and it is checked against the book's own rules. */
const openTarget = (
  id: string,
  label: string,
  formats: readonly TargetFileFormat[],
): PublishTarget => ({ id, label, format: formats[0]!, formats, overlay: {}, requiredChecks: [], requiredTools: [] });

/** Every place a book can go, in the order pickers offer them. */
export const TARGETS: Record<string, PublishTarget> = {
  local: openTarget("local", "A folder on this computer", ["pdf", "pdfx", "html"]),
  itch: { id: "itch", label: "itch.io", ...DIGITAL_RULES },
  "drivethrurpg-print": DTRPG_PRINT_TARGET,
  "drivethrurpg-digital": { id: "drivethrurpg-digital", label: "DriveThruRPG (digital)", ...DIGITAL_RULES },
  kdp: openTarget("kdp", "Amazon KDP", ["pdf", "pdfx"]),
  // The one target that takes only the website: nothing to pick.
  "azure-swa": {
    id: "azure-swa",
    label: "Azure Static Web Apps",
    format: "html",
    overlay: {},
    requiredChecks: [],
    requiredTools: [],
  },
  shopify: openTarget("shopify", "Shopify", ["pdf", "pdfx"]),
  gdrive: openTarget("gdrive", "Google Drive", ["pdf", "pdfx", "html"]),
};

/**
 * Names older books and scripts use. DriveThruRPG had two: `dtrpg` in
 * `targets:` (what to check against) and `drivethrurpg` in `publish:` (where
 * to send). Both meant print.
 */
const TARGET_ALIASES: Record<string, string> = {
  dtrpg: "drivethrurpg-print",
  drivethrurpg: "drivethrurpg-print",
};

/** The registry's name for a target id, old name or new. Unknown ids come back unchanged. */
export function canonicalTargetId(id: string): string {
  return TARGET_ALIASES[id] ?? id;
}

/** True when the target holds its file to rules of its own (vs the book's). */
export function hasOwnRules(target: PublishTarget): boolean {
  return target.requiredChecks.length > 0 || Object.keys(target.overlay).length > 0;
}

/**
 * The file a target receives, given the pick saved for it (`publish.<id>.format`).
 * A target that defines its file ignores the pick; one that offers a choice
 * takes it when it is on offer, else its first format.
 */
export function targetFormat(target: PublishTarget, saved: unknown): TargetFileFormat {
  return target.formats?.includes(saved as TargetFileFormat) ? (saved as TargetFileFormat) : target.format;
}

/** The registered target ids, in the order pickers should offer them. */
export const TARGET_IDS = Object.keys(TARGETS);

/** Look up a target id (old name or new); unknown ids are a usage error naming the registry. */
export function publishTargetFor(id: string): PublishTarget {
  const target = TARGETS[canonicalTargetId(id)];
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
  for (const given of ids) {
    const id = publishTargetFor(given).id;
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

/**
 * Of a book's targets, the ones that hold their file to rules of their own,
 * in order. The rest (a Drive folder, a local folder, an extension's target)
 * add none: their file is checked against the book's own rules.
 */
export function ruleTargets(ids: readonly string[]): string[] {
  return ids.filter((id) => {
    const target = TARGETS[canonicalTargetId(id)];
    return target !== undefined && hasOwnRules(target);
  });
}

/** The parts of a manifest that say where the book goes. */
interface PublishPlanSource {
  targets?: unknown;
  publish?: unknown;
}

const publishSections = (manifest: PublishPlanSource): Array<[string, unknown]> =>
  manifest.publish && typeof manifest.publish === "object" && !Array.isArray(manifest.publish)
    ? Object.entries(manifest.publish as Record<string, unknown>)
    : [];

const sectionEnabled = (section: unknown): unknown =>
  section && typeof section === "object" ? (section as { enabled?: unknown }).enabled : undefined;

/**
 * True for a manifest written before ADR 0012: one with a top-level
 * `targets:` list (what to check against) or a `publish.<id>.enabled` tick
 * (where to send). Such a book keeps its old meaning until its targets are
 * changed in the app.
 */
export function isOldPublishForm(manifest: PublishPlanSource): boolean {
  return (
    manifest.targets !== undefined ||
    publishSections(manifest).some(([, section]) => sectionEnabled(section) !== undefined)
  );
}

/**
 * The targets a book names (ADR 0012), under their registry names.
 *
 * `publish:` is the list: a target is on because it is there. No `publish:`
 * key means the preset's targets; an empty one means none. A name the
 * registry does not know is an extension's target and is kept as written.
 *
 * An older book ({@link isOldPublishForm}) is read with its old meaning: its
 * `targets:` list (else the preset's), plus the sections ticked `enabled`.
 */
export function bookTargets(manifest: PublishPlanSource, presetDefaults: readonly string[]): string[] {
  const sections = publishSections(manifest);
  let ids: string[];
  if (isOldPublishForm(manifest)) {
    const listed = Array.isArray(manifest.targets) ? (manifest.targets as string[]) : undefined;
    ids = [
      ...resolveTargets(listed, presetDefaults),
      ...sections.filter(([, section]) => sectionEnabled(section) === true).map(([id]) => id),
    ];
  } else if (manifest.publish !== undefined) {
    ids = sections.map(([id]) => id);
  } else {
    ids = [...presetDefaults];
  }
  return [...new Set(ids.map(canonicalTargetId))];
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
    checks: { ...preset.checks, ...o.checks },
    validate: {
      ...preset.validate,
      assets: { ...preset.validate.assets, ...o.validate?.assets },
      pdf: { ...preset.validate.pdf, ...o.validate?.pdf },
    },
  };
}

/**
 * The strict-PDF fill-ins applied to EVERY post-build PDF validation
 * regardless of preset/target: any of these the config leaves unset reports
 * at error severity, without overwriting an author's explicit level
 * (including `off`).
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
    if (next.checks[checkId] === undefined) next.checks[checkId] = "error";
  }
  return next;
}
