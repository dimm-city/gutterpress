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
  run(ctx: CheckContext): Promise<CheckResult[]>;
}
