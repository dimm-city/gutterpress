import type { ResolvedConfig } from "../schema/manifest.types";
import { UsageError } from "./cli-args";

/**
 * A preset is HOW THE BOOK IS DESIGNED (ADR 0008): the base defaults for the
 * resolved config, chiefly page/trim geometry, plus the publish targets a
 * book of this kind validates against when the manifest lists none. Where
 * the book is PUBLISHED is a separate concern — see ./targets.ts.
 *
 * Every preset value is overridable from the manifest, leaf by leaf
 * (resolveConfig's mergeShape; precedence cli > manifest > target > preset).
 */
export interface VendorPreset extends Omit<ResolvedConfig, "title" | "authors" | "targets" | "page" | "engine"> {
  /**
   * Base page geometry in points, or `null` for `custom` — the one preset
   * with no built-in trim, which therefore REQUIRES the manifest to supply
   * `page.width` and `page.height` (resolveConfig enforces it).
   */
  page: ResolvedConfig["page"] | null;
  /** Publish-target ids validated by default when the manifest has no `targets:`. */
  defaultTargets: readonly string[];
}

/** The built-in preset ids, in the order pickers should offer them. */
export const PRESET_IDS = ["dtrpg", "book", "custom"] as const;
export type PresetId = (typeof PRESET_IDS)[number];

export const DTRPG_PRESET: VendorPreset = {
  // Books designed for DriveThruRPG validate against it by default.
  defaultTargets: ["dtrpg"],
  // No default `styles:` (ARCH finding #2) — `resolveActiveStyles`
  // (style-resolver.ts) is the SINGLE source of default-stylesheet truth: the
  // manifest `styles:` list, else `styles/book.css`, else the first
  // discovered `.css`, else `[]`. A preset default here defeated that
  // documented fallback chain and made every styles:-less project silently
  // link a phantom `css/print.css`, whether or not it existed on disk.
  plugins: [],
  // No `assets` list and no `output` block: assets are discovered from the
  // book's own references (lib/asset-inline.ts) and the output location is a
  // convention (lib/output-paths.ts), so neither is configuration any more.
  source: {
    files: null,
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

/**
 * A neutral, vendor-agnostic default for authors who aren't targeting a
 * specific print vendor (UX finding M48). Standard 6x9in trade-book trim size,
 * no vendor total-area-coverage (TAC) cap, and no PDF/X forcing:
 *
 * - `page`: 6in x 9in (432 x 648pt) — the common generic trade paperback trim.
 *   Authors targeting a different size still set `page.width`/`page.height`
 *   directly; this is a starting point, not a lock-in.
 * - `ink.maxTac: 400` — 400% is the physical ceiling for 4-color process ink
 *   (100% each of C+M+Y+K), so `pdf.print.ink-coverage` effectively never
 *   fires unless the author opts into a real vendor limit.
 * - `validate.checks`: keeps the generic, vendor-agnostic PDF health checks
 *   (`pdf.structure.qpdf` parses/traverses, `pdf.print.embedded-fonts` are
 *   embedded) but does NOT force `pdf.print.pdfx-markers` /
 *   `pdf.print.pdfx-metadata` — those assert PDF/X OutputIntent/DOCINFO
 *   structure, which only applies to a PDF/X build (`--format pdfx`).
 * - `validate.pdf.forbidTransparency: false` and `assets.allowAlpha: true` —
 *   PDF/X forbids both; a plain PDF/HTML book has no such restriction.
 * - `validate.assets.allowedColorSpaces` includes RGB (not just CMYK/Grayscale)
 *   since a generic book isn't assumed to be prepping for CMYK print-only
 *   distribution.
 */
export const BOOK_PRESET: VendorPreset = {
  // A neutral trade book has no default publish target; add `targets:` when
  // a destination's requirements should be validated.
  defaultTargets: [],
  // No default `styles:` — see the matching comment on DTRPG_PRESET (ARCH #2).
  plugins: [],
  // No `assets` list and no `output` block: assets are discovered from the
  // book's own references (lib/asset-inline.ts) and the output location is a
  // convention (lib/output-paths.ts), so neither is configuration any more.
  source: {
    files: null,
  },
  pdfx: {
    flavor: "x1a",
    icc: "profiles/CGATS21_CRPC1.icc",
    stripAnnotations: true,
  },
  page: {
    width: 432,
    height: 648,
    tolerance: 0.5,
  },
  ink: {
    maxTac: 400,
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
      "pdf.print.embedded-fonts": {
        enabled: true,
        severity: "error",
      },
      "pdf.print.pdfx-markers": false,
      "pdf.print.pdfx-metadata": false,
    },
    source: {
      markdownlint: null,
      htmlhint: null,
      stylelint: null,
    },
    assets: {
      maxImageSize: 10_000_000,
      minImageDpi: 300,
      allowedColorSpaces: ["RGB", "CMYK", "Grayscale"],
      allowAlpha: true,
      approvedFontFiles: [],
      requireFontLicense: false,
    },
    pdf: {
      requireBookmarks: false,
      requireTocLinks: false,
      minImageResolution: 300,
      forbidTransparency: false,
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

/**
 * `custom` — the author supplies the trim. Policy defaults are the neutral
 * `book` ones (no vendor TAC cap, no PDF/X forcing); geometry is `null`, so
 * resolveConfig demands explicit `page.width`/`page.height` (points) and
 * errors, naming the missing fields, when they are absent.
 */
export const CUSTOM_PRESET: VendorPreset = {
  ...BOOK_PRESET,
  page: null,
  defaultTargets: [],
};

export const PRESETS: Record<PresetId, VendorPreset> = {
  dtrpg: DTRPG_PRESET,
  book: BOOK_PRESET,
  custom: CUSTOM_PRESET,
};

/**
 * Warn-once registry for one-line deprecation/defaulting notices that would
 * otherwise spam stderr on every `resolveConfig`/`resolvePreset` call (e.g.
 * every live-preview regen). ARCH finding #24: this replaces what used to be
 * separate anonymous module-level `let warned = false` booleans in this file
 * AND in manifest.ts — the §6-banned module-closure-state pattern — with one
 * shared, explicitly-keyed registry that:
 *   - lets tests reset dedup state between cases (`resetWarnOnce()`) instead
 *     of having no way to touch a private per-file boolean; and
 *   - lets a caller swap in its own sink instead of `console.warn` (the
 *     optional 3rd arg), the "pass a warn sink" half of the fix.
 */
const warnedIds = new Set<string>();

export function warnOnce(
  id: string,
  message: string,
  sink: (msg: string) => void = defaultWarnSink,
): void {
  if (warnedIds.has(id)) return;
  warnedIds.add(id);
  sink(message);
}

function defaultWarnSink(message: string): void {
  // eslint-disable-next-line no-console
  console.warn(message);
}

/** Test-only reset hook — clears all warn-once dedup state. */
export function resetWarnOnce(): void {
  warnedIds.clear();
}

/**
 * Resolve a manifest/CLI `preset` value to the {@link VendorPreset} it names
 * (UX finding M48).
 *
 * - Unset (`undefined`): defaults to `dtrpg`. That is the PRODUCT default,
 *   not a compatibility accident (ADR 0008): Gutterpress's primary audience
 *   is TTRPG authors producing print-on-demand content, and a preset-less
 *   manifest should come out print-ready for DriveThruRPG. Creation flows
 *   always write an explicit `preset:`, so this only applies to
 *   hand-written manifests — a one-line notice says which default applied.
 * - Unknown (typo'd) value: throws a {@link UsageError} naming the known
 *   presets, instead of silently falling back to `dtrpg` — the previous
 *   behavior turned a typo'd `preset: a4` into 621x810pt DriveThruRPG
 *   geometry with TAC 240 and PDF/X x1a with zero feedback.
 */
export function resolvePreset(presetName: string | undefined): VendorPreset {
  if (presetName === undefined) {
    warnOnce(
      "no-preset-set",
      "[gutterpress] No `preset` in manifest.yaml — using \"dtrpg\" " +
        "(DriveThruRPG print-ready defaults). Set `preset: dtrpg`, `book`, " +
        "or `custom` to choose explicitly."
    );
    return DTRPG_PRESET;
  }

  const preset = PRESETS[presetName as PresetId];
  if (!preset) {
    throw new UsageError(
      `Unknown preset "${presetName}". Known presets: ${Object.keys(PRESETS).join(", ")}.`
    );
  }
  return preset;
}
