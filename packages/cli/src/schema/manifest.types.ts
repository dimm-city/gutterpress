export type CheckSeverity = "error" | "warning" | "info";

export interface PluginConfig {
  path?: string;
  name?: string;
  version?: string;
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
 * the same spelling as `print-md publish --provider <id>`. Secrets (API
 * keys, tokens) NEVER live in the manifest — they belong to the host's
 * credential store (CLI: 0600 file under the user config dir; viewer:
 * Electron safeStorage).
 */
export interface PublishSettings {
  itch?: {
    /** itch.io project as `user/game` (the butler push target). */
    target?: string;
    /** butler channel name (default: "pdf"). */
    channel?: string;
  };
  drivethrurpg?: {
    /** Existing product page URL, when updating a published title. */
    productUrl?: string;
  };
  kdp?: Record<string, never>;
  "azure-swa"?: {
    /** Deploy environment (default: "production"). */
    env?: string;
  };
  shopify?: {
    /** The store domain, e.g. `my-store.myshopify.com`. */
    shop?: string;
    /** Existing product GID/id to update instead of creating a new one. */
    productId?: string;
    /** Admin GraphQL API version (default: "2026-04"). */
    apiVersion?: string;
  };
}

export interface PrintMdManifest {
  title?: string;
  authors?: string[];
  publish?: PublishSettings;
  preset?: "dtrpg" | "book";
  styles?: string[];
  plugins?: (string | PluginConfig)[];
  source?: {
    files?: string[] | null;
    assets?: string[];
  };
  output?: {
    dir?: string;
    filename?: string;
    /**
     * @deprecated Removed in favor of the fixed filename `book.html`. If set,
     * the value is ignored and a deprecation warning is logged. Kept on the
     * type so existing manifests parse without error.
     */
    html?: string;
  };
  pdfx?: {
    flavor?: "x1a" | "x3";
    icc?: string;
    stripAnnotations?: boolean;
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
  styles?: string[];
  plugins: ResolvedPluginConfig[];
  source: {
    files: string[] | null;
    assets: string[];
  };
  output: {
    dir: string;
    filename: string;
  };
  pdfx: {
    flavor: "x1a" | "x3";
    icc: string;
    stripAnnotations: boolean;
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
