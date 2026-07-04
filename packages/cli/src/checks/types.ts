import type { ResolvedConfig } from "../schema/manifest.types";

export type CheckSeverity = "error" | "warning" | "info";
export type CheckCategory = "source" | "pdf" | "asset" | "heuristic";
export type CheckPhase = "pre-build" | "post-build";

export interface CheckResult {
  checkId: string;
  severity: CheckSeverity;
  message: string;
  file?: string;
  line?: number;
  column?: number;
  detail?: string;
  /**
   * Stable machine-readable identifier for the KIND of finding (e.g.
   * "ink-coverage-exceeded", "rasterized-pages-detected"). Lets the report /
   * summary layer branch on the finding without parsing `message` prose.
   */
  code?: string;
  /**
   * Structured payload for the finding (e.g. `{ maxTac, pages }`). The canonical
   * source for summary numbers — `message`/`detail` are for humans only.
   */
  data?: Record<string, unknown>;
}

export interface CheckContext {
  config: ResolvedConfig;
  inputDir: string;
  outputDir: string;
  pdfPath?: string;
  htmlPath?: string;
  markdownFiles?: string[];
  cssFiles?: string[];
  assetDirs?: string[];
}

export interface Check {
  id: string;
  name: string;
  description: string;
  category: CheckCategory;
  phase: CheckPhase;
  /** External CLI tools this check requires (e.g. ["qpdf", "pdfinfo"]) */
  requiredTools?: string[];
  run(ctx: CheckContext): Promise<CheckResult[]>;
}
