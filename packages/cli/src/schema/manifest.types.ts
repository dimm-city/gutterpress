import type { LastPageMode } from "../engine/shared/synthesis";

type CheckSeverity = "error" | "warning" | "info";

/**
 * What a manifest's `checks:` entry may say about one check or lint rule:
 * `off`, or the severity its findings are reported at (`info`, `warn`,
 * `error`). `true` / `on` switch on a check its preset leaves off, at the
 * check's own severity; `false` is `off`. `warning` is accepted for `warn`.
 */
export type CheckLevelInput = "off" | "on" | "info" | "warn" | "warning" | "error" | boolean;

/**
 * A `checks:` entry that also sets options: the numbers or the list a check
 * measures against, which the preset and the publish target otherwise set
 * (`lib/check-options.ts` lists which check takes which). `level` is optional;
 * left out, the check keeps the level the preset and target give it.
 *
 *   checks:
 *     pdf.print.ink-coverage: { maxTac: 300 }
 *     pdf.print.image-resolution: { level: error, minImageResolution: 200 }
 */
export interface CheckEntry {
  level?: CheckLevelInput;
  /** `pdf.print.ink-coverage`: the total ink limit in percent (and what a PDF/X build holds the ink to). */
  maxTac?: number;
  /** `pdf.print.ink-coverage`: how far over `maxTac` a page may measure before it is reported. */
  tacTolerance?: number;
  /** `pdf.print.page-size`: how far (pt) the built PDF's page may differ from the manifest's size. */
  tolerance?: number;
  /** `pdf.print.image-resolution`: the lowest DPI a placed image may print at; 0 = no floor. */
  minImageResolution?: number;
  /** `pdf.print.bleed`: the bleed (pt) each side must have. */
  bleedSize?: number;
  /** `asset.image.file-size`: the largest image file in bytes; 0 = no limit. */
  maxImageSize?: number;
  /** `asset.font.approved-files`: the font files a book may ship (glob patterns, relative to the book); empty = any. */
  approvedFontFiles?: string[];
  /** `heuristic.decoration.layer-count`: the most decorative layers on one page. */
  maxDecorativeLayers?: number;
  /** `heuristic.whitespace.text-density`: the characters a page should carry. */
  textDensityRange?: { min?: number; max?: number };
  /** `heuristic.chunking.section-density`: the most paragraphs in one section. */
  maxParagraphsPerSection?: number;
}

/**
 * A check's resolved level: `off`, `on` (runs at its own severity) or the
 * severity every finding is reported at.
 */
export type CheckLevel = "off" | "on" | CheckSeverity;

/**
 * The object form of an `extensions:` entry (#265) — only for an entry that
 * has to say more than its specifier. The common case is the bare string;
 * `use` carries the same specifier in both forms.
 */
export interface ExtensionConfig {
  /**
   * The specifier: a bundled feature name, a `./`/`../`/`/` path (relative
   * to the manifest), or an npm package name, optionally pinned as
   * `name@version`. See `lib/extension-specifier.ts` for the three rules.
   */
  use: string;
  /** Named module export to use when the package has no default plugin export. */
  export?: string;
  /** Options passed straight through to the markdown-it plugin. */
  options?: Record<string, unknown>;
  /**
   * Per-project enable flag (#30). Absent or `true` = active; `false` = the
   * entry stays in the manifest (reversible toggle) but is skipped by
   * `resolveConfig` so it is not loaded at build/preview time.
   */
  enabled?: boolean;
}

/**
 * Non-secret, per-provider publish settings (#35), keyed by provider id —
 * the same spelling as `gutterpress publish --provider <id>`. Secrets (API
 * keys, tokens) NEVER live in the manifest — they belong to the host's
 * credential store (CLI: 0600 file under the user config dir; desktop:
 * Electron safeStorage).
 */
/**
 * The name (label) of the SAVED credential this book uses for a provider, when
 * the user keeps more than one (e.g. two itch.io accounts). It is NOT a secret
 * — just a reference into the host credential store's named entries; empty/
 * absent uses the default (bare-host) credential. The desktop app keeps this
 * choice (and an output folder outside the book) in the person's own private
 * settings, which win over the manifest's; a value written here still applies
 * to a book that has none (older books, the CLI) and overrides any front-end
 * default. Everything else in a section is the team's, shared.
 */
interface PublishSettings {
  itch?: {
    /** Whether the desktop's Publish view ticks this destination for the book (the team's choice, shared). */
    enabled?: boolean;
    /** itch.io project as `user/game` (the butler push target). */
    target?: string;
    /** butler channel name (default: "pdf"). */
    channel?: string;
    /** Saved-credential label to use (see PublishSettings doc). */
    credential?: string;
  };
  drivethrurpg?: {
    /** Whether the desktop's Publish view ticks this destination for the book (the team's choice, shared). */
    enabled?: boolean;
    /** Existing product page URL, when updating a published title. */
    productUrl?: string;
  };
  kdp?: { enabled?: boolean };
  "azure-swa"?: {
    /** Whether the desktop's Publish view ticks this destination for the book (the team's choice, shared). */
    enabled?: boolean;
    /** Deploy environment (default: "production"). */
    env?: string;
    /** Saved-credential label to use (see PublishSettings doc). */
    credential?: string;
  };
  shopify?: {
    /** Whether the desktop's Publish view ticks this destination for the book (the team's choice, shared). */
    enabled?: boolean;
    /** The store domain, e.g. `my-store.myshopify.com`. */
    shop?: string;
    /** Existing product GID/id to update instead of creating a new one. */
    productId?: string;
    /** Admin GraphQL API version (default: "2026-04"). */
    apiVersion?: string;
    /** Saved-credential label to use (see PublishSettings doc). */
    credential?: string;
  };
  gdrive?: {
    /** Whether the desktop's Publish view ticks this destination for the book (the team's choice, shared). */
    enabled?: boolean;
    /** Display name of the target Drive folder; created at My Drive root if
     * missing. Default when unset: "Gutterpress". */
    folder?: string;
    /** Stable Drive folder id (picker-set in the desktop app, or hand-recorded
     * from the CLI's post-publish tip). Takes precedence over `folder` when
     * present and the folder still exists. */
    folderId?: string;
    /** Saved-credential label to use (see PublishSettings doc). */
    credential?: string;
    /**
     * Which build output to publish (#221 phase 3, D8) — gdrive is the one
     * provider that supports more than one. "pdf" (default when unset): the
     * finished PDF. "html": the website export, zipped into one
     * `<title>-website.zip` before upload (Drive is file delivery, not web
     * hosting). An unrecognized value is ignored, not an error — see
     * `run-publish.ts`'s `resolvePublishFormat`.
     */
    format?: "pdf" | "html";
  };
}

/**
 * Page margins in points: the space between the trim and the text on each
 * edge. `inside` is the binding edge (the left of a right-hand page, the
 * right of a left-hand one), `outside` the other. All four together.
 */
export interface PageMargin {
  top: number;
  bottom: number;
  inside: number;
  outside: number;
}

export interface GutterpressManifest {
  title?: string;
  authors?: string[];
  /**
   * The book's language as a BCP 47 tag (`en`, `de-CH`, `pt-BR`); default
   * `en`. It is the `lang` of the built HTML, which is what hyphenation
   * follows, and the typographer sets quotation marks by it.
   */
  language?: string;
  publish?: PublishSettings;
  /** How the book is designed (ADR 0008). The registry in lib/presets.ts is authoritative. */
  preset?: "dtrpg" | "book" | "custom";
  /**
   * Where the book is published (ADR 0008): publish-target ids whose
   * validation policies this book is checked against. Absent = the preset's
   * defaults (`dtrpg` -> ["dtrpg"]; `book`/`custom` -> []). The registry in
   * lib/targets.ts is authoritative.
   */
  targets?: string[];
  styles?: string[];
  /**
   * Extensions, in load order (#265): markdown-it plugins, looks, component
   * libraries — from npm, a folder, or the bundled set. A later entry loads
   * later, sees earlier entries' markdown output, and its CSS wins ties; the
   * project's own `styles` always load after every extension.
   */
  extensions?: (string | ExtensionConfig)[];
  /**
   * The book's markdown files, in reading order, relative to the manifest.
   * Absent or null: every top-level `.md` file in natural order.
   */
  chapters?: string[] | null;
  /**
   * Per-check and per-rule levels, keyed by a check id
   * (`pdf.print.image-resolution`) or a lint rule id
   * (`printsafe/no-risky-print-effects`), and the options a check takes
   * ({@link CheckEntry}). A key that names nothing is ignored.
   */
  checks?: Record<string, CheckLevelInput | CheckEntry>;
  pdfx?: {
    flavor?: "x1a" | "x3";
    icc?: string;
    stripAnnotations?: boolean;
    /** `k-only` prints near-black text on the black plate alone (#331). */
    blackText?: "icc" | "k-only";
    /**
     * A page that uses transparency, which PDF/X cannot hold (#385).
     * `flatten-page` (default): Ghostscript rasterizes the whole page, text
     * included. `preserve-text`: flatten the artwork only and keep the text
     * live on top; a page whose text cannot be split (translucent or blended,
     * Type 3, pattern-filled or a clip) or that has a repeating or conic
     * gradient falls back to the whole-page flattening.
     */
    transparency?: "flatten-page" | "preserve-text";
    /**
     * `preserve-text` only: pages (1-based, as the build reports them) left to
     * Ghostscript's whole-page flattening, e.g. a page whose look depends on a
     * cover or tint painted over its text.
     */
    flattenPages?: number[];
    /**
     * Resolution (DPI) of every picture made from a transparent page: the
     * whole page Ghostscript flattens, and the `preserve-text` artwork.
     * Unset: Ghostscript's default (720) and 300 for `preserve-text` artwork.
     */
    rasterDpi?: number;
  };
  /**
   * Native-engine print-production options with no other manifest home
   * (`engine/compiler/postprocess.ts` already implements them; this is the
   * missing manifest surface for reaching them — B.12).
   */
  print?: {
    /** Pad the PDF with blank pages until pageCount is a multiple of this. */
    signature?: number;
    /**
     * Guarantee the interior's final page is a blank page appended by the
     * build (no content, no folio). Print-on-demand services such as
     * DriveThruRPG reserve the last page for printer info.
     */
    reserveLastPage?: boolean;
    /**
     * What the interior's last page is for a printer that reserves it:
     * `blank` (an empty page the build adds — what `reserveLastPage: true`
     * means) or `short-by-one` (one page short of a multiple of `signature`,
     * the printer supplies the last page). When set it wins over
     * `reserveLastPage`.
     */
    lastPage?: LastPageMode;
  };
  page?: {
    width?: number;
    height?: number;
    /**
     * A bleed (pt) the page `width` x `height` ALREADY CONTAINS, on the top,
     * bottom and OUTER edges only (the binding edge has none) — how
     * DriveThruRPG's interior file is cut (8.625 x 11.25in for an 8.5 x 11in
     * book). By itself it changes nothing in the PDF: it tells the preview's
     * safe area & bleed overlay, `pdf.print.safe-margins` and pinned art
     * (`.gp-pin` on an edge sits on the art-safe line) where the trim is.
     */
    bleed?: number;
    /**
     * The TEXT rule (pt): glyphs stay at least this far inside the trim on
     * EVERY edge, the binding edge too unless the book sets a `gutter` —
     * DriveThruRPG's "keep text 0.5in inside the trim" (`dtrpg` sets 36). The
     * preview's overlay outlines it and flags text outside it, and
     * `pdf.print.safe-margins` fails a built PDF whose text is closer. An
     * image pinned to an edge where `artSafe` is not set sits on it; nothing
     * in a book's CSS moves it.
     */
    safe?: number;
    /**
     * The ART rule (pt): art that does not bleed — images, backgrounds,
     * borders, rules — stays at least this far inside the trim on the top,
     * bottom and OUTER edge; at the binding edge it uses `gutter`. DriveThruRPG's
     * "keep non-bleeding art 0.25in from the outside edges" (`dtrpg` sets 18).
     * The preview's overlay outlines it and flags art outside it, and
     * `pdf.print.safe-margins` fails a built PDF with an image closer, or one
     * that stops in the bleed band. An image pinned to the top, bottom or outer
     * edge (`.gp-pin`) sits on this line unless it carries `.gp-flush`. Absent =
     * the same as `safe`.
     */
    artSafe?: number;
    /**
     * The binding allowance (pt): how far content stays from the spine — the
     * binding edge, the left of a right-hand page and the right of a left-hand
     * one — measured from the trim. It stands in for `safe` at the binding
     * edge, for text and for art alike, so a book that keeps its text further
     * from the spine than the printer's minimum says so here, not in its CSS
     * (for example 54 for 0.75in where DriveThruRPG asks for 0.5in).
     * An image pinned to the binding edge sits on it. The other edges keep
     * `safe` and `artSafe`. Absent = the same as `safe`; `dtrpg` sets 36
     * (DriveThruRPG's 0.5in at the binding, the same as its `safe`), `book`
     * and `custom` none.
     */
    gutter?: number;
    /**
     * Page margins (pt), the space between the trim and the text on each
     * edge — `inside` is the binding edge, `outside` the other. Setup >
     * Details in the app writes it. When set, the book prints with these
     * margins and any `@page` margin in a stylesheet is overridden, except
     * where a named page sets its own (`@page full { margin: 0 }`); left
     * out, the stylesheets' `@page` margins apply (a look's design), else
     * 1in. All four edges are required together.
     */
    margin?: PageMargin;
  };
}

export interface ResolvedExtensionConfig {
  /** The specifier exactly as written (pin included) — for messages and manifest edits. */
  use: string;
  /** The path specifier, for a path entry; the loader resolves it against the manifest directory. */
  path?: string;
  /** The package name, for a bundled or npm entry. */
  name?: string;
  /** Exact version for a project-local vendored npm extension. */
  version?: string;
  /** Named module export selected as the plugin function. */
  export?: string;
  options: Record<string, unknown>;
}

/** The printer's published specification that a preset's numbers come from. */
export interface PrintSpec {
  label: string;
  url: string;
}

/**
 * Fully-resolved config. Every field is a concrete default with one
 * deliberate exception: `styles`. There is no preset
 * default for it — `undefined` means "the manifest didn't set one", and
 * `resolveActiveStyles` (style-resolver.ts) is the single source of truth for
 * what that resolves to (styles/book.css, else the first discovered `.css`,
 * else `[]`). Baking a preset default in here would defeat that fallback chain.
 */
export interface ResolvedConfig {
  title: string;
  authors: string[];
  /** BCP 47 language tag; `en` when the manifest sets none. */
  language: string;
  /** The id of the preset this book resolved against (`dtrpg`, `book`, `custom`). */
  preset: string;
  /** The printer spec that preset follows, when it follows one: how a host credits the numbers it draws. */
  spec?: PrintSpec;
  /** Validated publish-target ids for this book (may be empty). */
  targets: string[];
  styles?: string[];
  /** Enabled extensions, in manifest (= load = cascade) order. */
  extensions: ResolvedExtensionConfig[];
  /** The book's markdown files in reading order, or null for every top-level `.md` file. */
  chapters: string[] | null;
  /**
   * Each check's or lint rule's level, merged key by key: preset, then the
   * publish target's policy, then the manifest's `checks:`, then the CLI. An
   * id that is absent runs at its own severity.
   */
  checks: Record<string, CheckLevel>;
  pdfx: {
    flavor: "x1a" | "x3";
    icc: string;
    stripAnnotations: boolean;
    blackText: "icc" | "k-only";
    transparency: "flatten-page" | "preserve-text";
    flattenPages: number[];
    rasterDpi?: number;
  };
  print: {
    signature: number;
    reserveLastPage: boolean;
    lastPage?: LastPageMode;
  };
  page: {
    width: number;
    height: number;
    /** Allowed deviation (pt) of a built PDF's page size: the preset's, or `checks.pdf.print.page-size.tolerance`. */
    tolerance: number;
    /** In-sheet bleed in pt (top, bottom, outer edge; see the manifest field); absent = none. */
    bleed?: number;
    /** The text rule's inset from the trim in pt, every edge (see the manifest field); absent = none. */
    safe?: number;
    /** The art rule's inset from the trim in pt, top/bottom/outer edge (see the manifest field); absent = same as `safe`. */
    artSafe?: number;
    /** The binding edge's inset from the trim in pt, text and art alike (see the manifest field); absent = same as `safe`. */
    gutter?: number;
    /** The margins the book prints with, in pt (see the manifest field); absent = the stylesheets' `@page` margins, else 1in. */
    margin?: PageMargin;
  };
  ink: {
    maxTac: number;
    tacTolerance: number;
  };
  /**
   * The numbers the checks measure against: the preset's and the publish
   * target's (a printer's specification), overridden by a book's
   * `checks.<id>` options ({@link CheckEntry}). `ink` above too.
   */
  validate: {
    assets: {
      /** Largest image file in bytes; 0 = no limit. */
      maxImageSize: number;
      /** Glob patterns of the font files a book may ship; empty = any (`asset.font.approved-files`). */
      approvedFontFiles: string[];
    };
    pdf: {
      /** Lowest effective image resolution in DPI; 0 = no floor. */
      minImageResolution: number;
      bleedSize: number;
    };
    heuristics: {
      maxDecorativeLayers: number;
      textDensityRange: { min: number; max: number };
      maxParagraphsPerSection: number;
    };
  };
}
