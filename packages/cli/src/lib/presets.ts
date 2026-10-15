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
export interface VendorPreset extends Omit<ResolvedConfig, "title" | "authors" | "preset" | "targets" | "page"> {
  /** This preset's id: what the manifest's `preset:` names and a resolved config reports. */
  id: PresetId;
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

/**
 * DriveThruRPG print-on-demand interior. Where each value comes from:
 *
 *  SPEC = DriveThru Partners, "Quick Specifications for Print Books"
 *         (help.drivethrupartners.com/hc/en-us/articles/12780800178583)
 *  GUIDE = third-party DriveThruRPG layout guides (consistent with SPEC's
 *         bleed rule; not stated by DriveThru itself)
 *  CONVENTION = Gutterpress's own choice or a value DERIVED from a spec
 *         requirement (e.g. PDF/X-1a forbids transparency) — NOT a DriveThru
 *         requirement in its own right.
 */
export const DTRPG_PRESET: VendorPreset = {
  id: "dtrpg",
  // The article the SPEC numbers below come from: hosts credit it where they
  // draw them (the preview overlay's source line).
  spec: {
    label: "DriveThruRPG — Quick Specifications for Print Books",
    url: "https://help.drivethrupartners.com/hc/en-us/articles/12780800178583-Quick-Specifications-for-Print-Books",
  },
  // Books designed for DriveThruRPG validate against it by default.
  defaultTargets: ["dtrpg"],
  // No default `styles:` — `resolveActiveStyles`
  // (style-resolver.ts) is the SINGLE source of default-stylesheet truth: the
  // manifest `styles:` list, else `styles/book.css`, else the first
  // discovered `.css`, else `[]`. A preset default here would defeat that
  // documented fallback chain and make every styles:-less project silently
  // link a phantom stylesheet, whether or not it existed on disk.
  extensions: [],
  // No `assets` list and no `output` block: assets are discovered from the
  // book's own references (lib/asset-inline.ts) and the output location is a
  // convention (lib/output-paths.ts), so neither is configuration any more.
  source: {
    files: null,
  },
  // `lastPage` is listed (undefined) only so the manifest merge, which copies
  // the preset's keys, carries an author's value; no preset sets it.
  // SPEC: the page count must be one less than a signature multiple, or the
  // file must end on a fully blank page; US Letter (and 6.69 x 9.61in and up)
  // prints in 4-page signatures (#332). `reserveLastPage` takes the blank-page
  // route.
  print: { signature: 4, reserveLastPage: true, lastPage: undefined },
  pdfx: {
    // SPEC: PDF/X-1a:2001 or PDF/X-3:2002 (x1a is the default of the two).
    flavor: "x1a",
    // SPEC: the CGATS21_CRPC1.icc profile.
    icc: "profiles/CGATS21_CRPC1.icc",
    // CONVENTION: interactive annotations have no place in a PDF/X print file.
    stripAnnotations: true,
    // CONVENTION (#331): near-black text on the black plate alone, so small
    // type is not registered across four plates. Not a DriveThru rule.
    blackText: "k-only",
    rasterDpi: undefined,
  },
  page: {
    // GUIDE: 8.625 x 11.25in is the interior FILE size for an 8.5 x 11in book:
    // the trim plus 0.125in bleed on the three outside edges (SPEC: a .125in
    // bleed on the top, bottom and outer edges, none on the binding edge).
    // Other trim sizes set `page.width`/`height`/`bleed` in the manifest.
    width: 621,
    height: 810,
    tolerance: 0.5, // CONVENTION: slack for rounding in the PDF boxes
    // SPEC: 0.125in = 9pt, ALREADY INSIDE width/height above on the top,
    // bottom and outer edges only. Declared so the preview's margin & bleed
    // overlay and `pdf.print.safe-margins` can find the trim; the PDF is
    // unchanged (CSS `bleed` is symmetric and would grow the page and add
    // binding-edge bleed, which the SPEC rules out).
    bleed: 9,
    // SPEC: 0.5in = 36pt, DriveThru's TEXT rule: text stays at least 0.5in
    // inside the trim on every edge. The preview overlay and
    // `pdf.print.safe-margins` judge text against it; the PDF is unchanged.
    safe: 36,
    // SPEC: 0.25in = 18pt, DriveThru's ART rule: art that does not bleed stays
    // at least 0.25in from the three outside edges (the binding edge takes the
    // text rule's 0.5in above). Overlay only; the PDF is unchanged.
    artSafe: 18,
  },
  ink: {
    // SPEC: total ink coverage must not exceed 240%.
    maxTac: 240,
    tacTolerance: 0.5, // CONVENTION: measurement noise
  },
  lint: {
    enabled: true,
    configPath: null,
    rules: {},
  },
  validate: {
    enabled: true,
    checks: {
      // SPEC: PDF/X conformance (markers + metadata) and "all fonts embedded".
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
      // SPEC: text at least 0.5in inside the trim on every edge (`page.safe`).
      "pdf.print.safe-margins": {
        enabled: true,
        severity: "error",
      },
    },
    source: {
      markdownlint: null,
      htmlhint: null,
      stylelint: null,
      cssOwnership: null,
    },
    assets: {
      maxImageSize: 10_000_000,
      minImageDpi: 300,
      // SPEC: CMYK for colour interiors (Grayscale for black-and-white).
      allowedColorSpaces: ["CMYK", "Grayscale"],
      // DERIVED: PDF/X-1a forbids transparency, which an alpha channel needs.
      allowAlpha: false,
      approvedFontFiles: [],
      requireFontLicense: false,
    },
    pdf: {
      requireBookmarks: false,
      requireTocLinks: false,
      // CONVENTION: 300 dpi is the common print minimum; DriveThru's quick
      // spec does not state one.
      minImageResolution: 300,
      // DERIVED: PDF/X-1a forbids transparency; DriveThru asks for X-1a/X-3.
      forbidTransparency: true,
      // Stays false on purpose: `pdf.print.bleed` compares MediaBox with
      // TrimBox and expects the bleed OUTSIDE the trim on every side. Here the
      // bleed is inside the sheet on three edges and TrimBox == MediaBox, so
      // the check would warn on every correct DriveThruRPG file.
      requireBleed: false,
      // SPEC: 0.125in (the size `page.bleed` above is declared at).
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
 * specific print vendor. Standard 6x9in trade-book trim size,
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
  id: "book",
  // A neutral trade book has no default publish target; add `targets:` when
  // a destination's requirements should be validated.
  defaultTargets: [],
  // No default `styles:` — see the matching comment on DTRPG_PRESET.
  extensions: [],
  // No `assets` list and no `output` block: assets are discovered from the
  // book's own references (lib/asset-inline.ts) and the output location is a
  // convention (lib/output-paths.ts), so neither is configuration any more.
  source: {
    files: null,
  },
  print: { signature: 1, reserveLastPage: false, lastPage: undefined },
  pdfx: {
    flavor: "x1a",
    icc: "profiles/CGATS21_CRPC1.icc",
    stripAnnotations: true,
    blackText: "icc",
    rasterDpi: undefined,
  },
  page: {
    width: 432,
    height: 648,
    tolerance: 0.5,
    // No bleed inside the sheet; listed so a manifest `page.bleed` merges in.
    bleed: undefined,
    // CONVENTION: 0.25in safe area inside the trim (preview overlay and
    // `pdf.print.safe-margins`).
    safe: 18,
    // The art rule is the same as `safe`; listed so a manifest `page.artSafe` merges in.
    artSafe: undefined,
  },
  ink: {
    maxTac: 400,
    tacTolerance: 0.5,
  },
  lint: {
    enabled: true,
    configPath: null,
    rules: {},
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
      // CONVENTION: text stays `page.safe` inside the trim. A warning: no
      // printer's rule stands behind this preset's number.
      "pdf.print.safe-margins": {
        enabled: true,
        severity: "warning",
      },
      "pdf.print.pdfx-markers": false,
      "pdf.print.pdfx-metadata": false,
    },
    source: {
      markdownlint: null,
      htmlhint: null,
      stylelint: null,
      cssOwnership: null,
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
  id: "custom",
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
 * every live-preview regen). One shared, explicitly-keyed registry rather
 * than per-file module-level `let warned = false` booleans, so it:
 *   - lets tests reset dedup state between cases (`resetWarnOnce()`) instead
 *     of having no way to touch a private per-file boolean; and
 *   - lets a caller swap in its own sink instead of `console.warn` (the
 *     optional 3rd arg).
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
 * Resolve a manifest/CLI `preset` value to the {@link VendorPreset} it names.
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
