import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadManifest, resolveConfig } from "./manifest";
import { log } from "./logger";
import { BOOK_HTML_FILENAME } from "./viewer";
import { formatReport, type OutputFormat } from "../checks/formatter";
import { runChecks, type RunnerOptions, type RunnerReport } from "../checks/runner";
import {
  checkToolAvailability,
  reportMissingTools,
  type ToolCheckResult,
} from "../checks/tool-check";
import type { CheckCategory, CheckContext, CheckPhase, CheckResult } from "../checks/types";
import {
  applyDtrpgPdfDefaults,
  applyValidationProfile,
  DTRPG_STRICT_PDF_CHECKS,
  type ValidationProfile,
} from "./validation-profile";
import type { ResolvedConfig } from "../schema/manifest.types";

// Import check modules to trigger self-registration.
import "../checks/pdf/index";
import "../checks/source/index";
import "../checks/asset/index";
import "../checks/heuristic/index";

export interface ValidationExecutionArgs {
  manifest?: string;
  pdf?: string;
  input?: string;
  category?: string;
  only?: string;
  skip?: string;
  phase?: string;
  profile?: string;
}

export interface ValidationExecutionResult {
  config: ResolvedConfig;
  profile?: ValidationProfile;
  context: CheckContext;
  runnerOptions: RunnerOptions;
  tools: ToolCheckResult;
  report: RunnerReport;
}

function parseCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseProfile(raw?: string): ValidationProfile | undefined {
  if (!raw) return undefined;
  if (raw === "dtrpg") return raw;
  throw new Error(`Unsupported profile: ${raw}. Supported profiles: dtrpg`);
}

function withProfileRequiredCheckErrors(
  report: RunnerReport,
  tools: ToolCheckResult,
  profile?: ValidationProfile
): RunnerReport {
  if (!profile) return report;

  const required = profile === "dtrpg" ? DTRPG_STRICT_PDF_CHECKS : [];
  if (required.length === 0) return report;

  const skippedSet = new Set(tools.skippedChecks);
  const missingRequired = required.filter((checkId) => skippedSet.has(checkId));
  if (missingRequired.length === 0) return report;

  const syntheticErrors: CheckResult[] = missingRequired.map((checkId) => ({
    checkId,
    severity: "error",
    message:
      `Profile ${profile} requires check ${checkId}, but it was skipped because required tools are not available.`,
  }));

  const results = [...report.results, ...syntheticErrors];
  const errors = [...report.errors, ...syntheticErrors];

  return {
    ...report,
    results,
    errors,
    summary: {
      ...report.summary,
      errors: errors.length,
    },
  };
}

export async function executeValidation(
  args: ValidationExecutionArgs
): Promise<ValidationExecutionResult> {
  const manifestPath = typeof args.manifest === "string" ? args.manifest : undefined;
  const manifest = await loadManifest(manifestPath ?? args.input ?? undefined);

  const profile = parseProfile(typeof args.profile === "string" ? args.profile : undefined);

  let config = resolveConfig({}, manifest);
  const pdfPath = typeof args.pdf === "string" ? resolve(args.pdf) : undefined;
  const inputDir = typeof args.input === "string" ? resolve(args.input) : undefined;

  if (pdfPath) {
    config = applyDtrpgPdfDefaults(config);
  }
  if (profile) {
    config = applyValidationProfile(config, profile);
  }

  if (pdfPath && !existsSync(pdfPath)) {
    throw new Error(`File not found: ${pdfPath}`);
  }

  const categories = parseCsv(typeof args.category === "string" ? args.category : undefined)
    ?.map((s) => s as CheckCategory);
  const only = parseCsv(typeof args.only === "string" ? args.only : undefined);
  const skip = parseCsv(typeof args.skip === "string" ? args.skip : undefined);

  let phase: CheckPhase | undefined;
  if (typeof args.phase === "string") {
    phase = args.phase as CheckPhase;
  } else if (pdfPath && !inputDir) {
    phase = "post-build";
  } else if (inputDir && !pdfPath) {
    phase = "pre-build";
  }

  let markdownFiles: string[] | undefined;
  let cssFiles: string[] | undefined;
  let assetDirs: string[] | undefined;
  let htmlPath: string | undefined;

  if (inputDir) {
    const { glob } = await import("glob");
    markdownFiles = await glob("**/*.md", {
      cwd: inputDir,
      absolute: true,
      ignore: ["**/node_modules/**"],
    });
    cssFiles = await glob("**/*.css", {
      cwd: inputDir,
      absolute: true,
      ignore: ["**/node_modules/**"],
    });
    assetDirs = config.source.assets.map((assetDir) => resolve(inputDir, assetDir));

    const outDir = resolve(config.output.dir);
    const possibleHtml = join(outDir, BOOK_HTML_FILENAME);
    if (existsSync(possibleHtml)) {
      htmlPath = possibleHtml;
    }
  }

  const context: CheckContext = {
    config,
    inputDir: inputDir ?? process.cwd(),
    outputDir: resolve(config.output.dir),
    pdfPath,
    htmlPath,
    markdownFiles,
    cssFiles,
    assetDirs,
  };

  const runnerOptions: RunnerOptions = {
    category: categories,
    phase,
    only,
    skip,
  };

  const tools = await checkToolAvailability(config, runnerOptions);
  const initialReport = await runChecks(context, {
    ...runnerOptions,
    skipMissingTools: tools.skippedChecks,
  });

  const report = withProfileRequiredCheckErrors(initialReport, tools, profile);

  return {
    config,
    profile,
    context,
    runnerOptions,
    tools,
    report,
  };
}

export interface ReportAndCheckResult {
  ok: boolean;
  execution: ValidationExecutionResult;
}

/**
 * Run validation and emit the standard text/json report. Returns ok=false when
 * the report contains errors so callers can decide how to surface failure
 * (process.exit for the CLI; throw for the build runner).
 */
export async function executeAndReport(
  args: ValidationExecutionArgs,
  format: OutputFormat = "text"
): Promise<ReportAndCheckResult> {
  const execution = await executeValidation(args);
  const { report, tools, context } = execution;

  if (format === "text") {
    reportMissingTools(tools);
  }

  formatReport(report, format);

  if (format === "text" && context.pdfPath) {
    const tacResults = report.results.filter(
      (r) => r.checkId === "pdf.print.ink-coverage"
    );
    const fontResults = report.results.filter(
      (r) => r.checkId === "pdf.print.embedded-fonts"
    );
    const rasterResults = report.results.filter(
      (r) => r.checkId === "pdf.print.rasterized-pages"
    );

    const tacMsg = tacResults.find((r) =>
      r.message.startsWith("Total ink coverage")
    );
    if (tacMsg) {
      const tacMatch = tacMsg.message.match(/max\s+([\d.]+)%/);
      if (tacMatch) {
        log.info(`Max TAC: ${tacMatch[1]}% (high!)`);
      }
    } else {
      log.info("Max TAC: within limits");
    }

    const fontWarning = fontResults.find((r) =>
      r.message.includes("No fonts detected")
    );
    const fontError = fontResults.find((r) =>
      r.message.includes("Not all fonts")
    );
    if (!fontWarning && !fontError) {
      log.info("Fonts: all embedded");
    }

    const rasterMsg = rasterResults.find((r) =>
      r.message.startsWith("Possible rasterized")
    );
    log.info(
      `Rasterized pages: ${rasterMsg ? rasterMsg.message.replace("Possible rasterized pages detected: ", "") : "none"}`
    );
  }

  return { ok: report.summary.errors === 0, execution };
}
