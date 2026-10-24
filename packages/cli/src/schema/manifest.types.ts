import type { LastPageMode } from "../engine/shared/synthesis";

type CheckSeverity = "error" | "warning" | "info";

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
 * absent uses the default (bare-host) credential. This book-level choice
 * overrides any project/global default.
 */
interface PublishSettings {
  itch?: {
    /** itch.io project as `user/game` (the butler push target). */
    target?: string;
    /** butler channel name (default: "pdf"). */
    channel?: string;
    /** Saved-credential label to use (see PublishSettings doc). */
    credential?: string;
  };
  drivethrurpg?: {
    /** Existing product page URL, when updating a published title. */
    productUrl?: string;
  };
  kdp?: Record<string, never>;
  "azure-swa"?: {
    /** Deploy environment (default: "production"). */
    env?: string;
    /** Saved-credential label to use (see PublishSettings doc). */
    credential?: string;
  };
  shopify?: {
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

export interface GutterpressManifest {
  title?: string;
  authors?: string[];
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
  source?: {
    files?: string[] | null;
  };
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
    tolerance?: number;
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
     * (the Field Guide keeps 0.75in = 54 where DriveThruRPG asks for 0.5in).
     * An image pinned to the binding edge sits on it. The other edges keep
     * `safe` and `artSafe`. Absent = the same as `safe`; `dtrpg` sets 36
     * (DriveThruRPG's 0.5in at the binding, the same as its `safe`), `book`
     * and `custom` none.
     */
    gutter?: number;
  };
  ink?: {
    maxTac?: number;
    tacTolerance?: number;
  };
  lint?: {
    enabled?: boolean;
    configPath?: string | null;
    /**
     * Per-rule level overrides, keyed by rule id (`printsafe/*`, or a check id
     * such as `source.accessibility.heading-order`). `off` silences the rule;
     * `warn` / `error` set its severity. Unknown ids are ignored.
     */
    rules?: Record<string, "off" | "warn" | "error">;
  };
  validate?: {
    enabled?: boolean;
    checks?: Record<string, boolean | {
      enabled?: boolean;
      severity?: CheckSeverity;
      options?: Record<string, unknown>;
    }>;
    source?: {
      markdownlint?: string | false;
      htmlhint?: string | false;
      stylelint?: string | false;
      /**
       * Path to a CSS ownership contract (#232), or `false` to disable
       * `source.css-ownership`. Optional — absent means no contract, so the
       * check reports nothing. Default discovery: `.gutterpress/css-contract.yaml`
       * (or `.yml`) in the project root. See docs/css-ownership-contract.md.
       */
      cssOwnership?: string | false;
      /**
       * @deprecated `:::name` container syntax was removed 2026-05-17 and the
       * callout-validation check it gated was removed at the same time. This
       * field is now a no-op kept for backward-compatible manifest parsing.
       * Will be removed in a future major version. See
       * docs/migrations/2026-05-removing-container-syntax.md.
       */
      allowedCallouts?: string[];
    };
    assets?: {
      maxImageSize?: number;
      /**
       * @deprecated No-op. The source-image resolution check it configured
       * read DPI metadata, which says nothing about the printed size; the
       * build measures each placed image's printed DPI instead.
       */
      minImageDpi?: number;
      /**
       * @deprecated No-op. The source-image colour-space check it configured
       * was removed: a PDF/X build converts every image to the output intent,
       * and `pdf.print.color-spaces` checks the result.
       */
      allowedColorSpaces?: string[];
      allowAlpha?: boolean;
      approvedFontFiles?: string[];
      requireFontLicense?: boolean;
    };
    pdf?: {
      requireBookmarks?: boolean;
      requireTocLinks?: boolean;
      minImageResolution?: number;
      forbidTransparency?: boolean;
      requireBleed?: boolean;
      bleedSize?: number;
    };
    heuristics?: {
      maxDecorativeLayers?: number;
      textDensityRange?: { min?: number; max?: number };
      maxParagraphsPerSection?: number;
    };
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
  /** The id of the preset this book resolved against (`dtrpg`, `book`, `custom`). */
  preset: string;
  /** The printer spec that preset follows, when it follows one: how a host credits the numbers it draws. */
  spec?: PrintSpec;
  /** Validated publish-target ids for this book (may be empty). */
  targets: string[];
  styles?: string[];
  /** Enabled extensions, in manifest (= load = cascade) order. */
  extensions: ResolvedExtensionConfig[];
  source: {
    files: string[] | null;
  };
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
    tolerance: number;
    /** In-sheet bleed in pt (top, bottom, outer edge; see the manifest field); absent = none. */
    bleed?: number;
    /** The text rule's inset from the trim in pt, every edge (see the manifest field); absent = none. */
    safe?: number;
    /** The art rule's inset from the trim in pt, top/bottom/outer edge (see the manifest field); absent = same as `safe`. */
    artSafe?: number;
    /** The binding edge's inset from the trim in pt, text and art alike (see the manifest field); absent = same as `safe`. */
    gutter?: number;
  };
  ink: {
    maxTac: number;
    tacTolerance: number;
  };
  lint: {
    enabled: boolean;
    configPath: string | null;
    rules: Record<string, "off" | "warn" | "error">;
  };
  validate: {
    enabled: boolean;
    checks: Record<string, boolean | {
      enabled?: boolean;
      severity?: CheckSeverity;
      options?: Record<string, unknown>;
    }>;
    source: {
      markdownlint: string | false | null;
      htmlhint: string | false | null;
      stylelint: string | false | null;
      cssOwnership: string | false | null;
    };
    assets: {
      maxImageSize: number;
      allowAlpha: boolean;
      approvedFontFiles: string[];
      requireFontLicense: boolean;
    };
    pdf: {
      requireBookmarks: boolean;
      requireTocLinks: boolean;
      minImageResolution: number;
      forbidTransparency: boolean;
      requireBleed: boolean;
      bleedSize: number;
    };
    heuristics: {
      maxDecorativeLayers: number;
      textDensityRange: { min: number; max: number };
      maxParagraphsPerSection: number;
    };
  };
}
