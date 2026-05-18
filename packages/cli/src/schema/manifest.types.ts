export type CheckSeverity = "error" | "warning" | "info";

export interface PluginConfig {
  path?: string;
  name?: string;
  version?: string;
  priority?: number;
  options?: Record<string, unknown>;
}

export interface PrintMdManifest {
  title?: string;
  authors?: string[];
  preset?: "dtrpg";
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
  version?: string;
  priority: number;
  options: Record<string, unknown>;
}

/** Fully-resolved config with no optional fields. */
export interface ResolvedConfig {
  title: string;
  authors: string[];
  styles: string[];
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
      allowedCallouts: string[];
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
