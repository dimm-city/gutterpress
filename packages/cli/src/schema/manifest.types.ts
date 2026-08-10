type CheckSeverity = "error" | "warning" | "info";

export interface PluginConfig {
  path?: string;
  name?: string;
  /** Exact project-local npm version. Legacy ranges remain informational. */
  version?: string;
  /** Named module export to use when the package has no default plugin export. */
  export?: string;
  priority?: number;
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
}

export interface GutterpressManifest {
  title?: string;
  authors?: string[];
  publish?: PublishSettings;
  /** How the book is designed (ADR 0008). The registry in lib/presets.ts is authoritative. */
  preset?: "dtrpg" | "book" | "custom";
  /**
   * Pagination engine (MIGRATION.md Decision #5): "native" (default) routes
   * both `gutterpress build` and `gutterpress preview` through the
   * Gutterpress engine (`src/engine/`) — native Chromium pagination, no
   * Paged.js polyfill. "paged" is the deprecated Chromium+Paged.js pipeline,
   * kept for compatibility. Preview and PDF always use the SAME engine for a
   * given project — never independently. `--engine` on the CLI overrides
   * this per invocation.
   */
  engine?: "paged" | "native";
  /**
   * Engine-conditional stylesheets, appended AFTER `styles` for the resolved
   * engine only. The transition mechanism for per-book migration: a book
   * whose chrome is coupled to one engine's DOM (e.g. `.pagedjs_sheet`
   * backgrounds) declares the other engine's replacement furniture here, so
   * one project renders correctly under BOTH engines while it migrates.
   * Loaded last, so furniture wins the cascade over the shared layers.
   */
  engineStyles?: { paged?: string[]; native?: string[] };
  /**
   * Where the book is published (ADR 0008): publish-target ids whose
   * validation policies this book is checked against. Absent = the preset's
   * defaults (`dtrpg` -> ["dtrpg"]; `book`/`custom` -> []). The registry in
   * lib/targets.ts is authoritative.
   */
  targets?: string[];
  styles?: string[];
  plugins?: (string | PluginConfig)[];
  source?: {
    files?: string[] | null;
  };
  pdfx?: {
    flavor?: "x1a" | "x3";
    icc?: string;
    stripAnnotations?: boolean;
  };
  /**
   * Native-engine print-production options with no other manifest home
   * (`engine/compiler/postprocess.ts` already implements them; this is the
   * missing manifest surface for reaching them — B.12).
   */
  print?: {
    /** Pad the PDF with blank pages until pageCount is a multiple of this. */
    signature?: number;
  };
  page?: {
    width?: number;
    height?: number;
    tolerance?: number;
  };
  ink?: {
    maxTac?: number;
    tacTolerance?: number;
  };
  lint?: {
    enabled?: boolean;
    configPath?: string | null;
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
      minImageDpi?: number;
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

export interface ResolvedPluginConfig {
  path?: string;
  name?: string;
  /** Exact version for a project-local vendored npm plugin. */
  version?: string;
  /** Named module export selected as the plugin function. */
  export?: string;
  priority: number;
  options: Record<string, unknown>;
}

/**
 * Fully-resolved config. Every field is a concrete default with one
 * deliberate exception: `styles` (ARCH finding #2). There is no preset
 * default for it — `undefined` means "the manifest didn't set one", and
 * `resolveActiveStyles` (style-resolver.ts) is the single source of truth for
 * what that resolves to (styles/book.css, else the first discovered `.css`,
 * else `[]`). Baking a preset default in here defeated that fallback chain.
 */
export interface ResolvedConfig {
  title: string;
  authors: string[];
  /**
   * Resolved pagination engine (cli > manifest > default "native"). See
   * {@link GutterpressManifest.engine}.
   */
  engine: "paged" | "native";
  /** Validated publish-target ids for this book (may be empty). */
  targets: string[];
  styles?: string[];
  plugins: ResolvedPluginConfig[];
  source: {
    files: string[] | null;
  };
  pdfx: {
    flavor: "x1a" | "x3";
    icc: string;
    stripAnnotations: boolean;
  };
  print: {
    signature: number;
  };
  page: {
    width: number;
    height: number;
    tolerance: number;
  };
  ink: {
    maxTac: number;
    tacTolerance: number;
  };
  lint: {
    enabled: boolean;
    configPath: string | null;
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
    };
    assets: {
      maxImageSize: number;
      minImageDpi: number;
      allowedColorSpaces: string[];
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
