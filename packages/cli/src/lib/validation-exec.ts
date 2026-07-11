import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { log } from "../utils/logger";
import { BOOK_HTML_FILENAME } from "./viewer";
import { UsageError } from "./cli-args";
import { formatReport, type OutputFormat } from "../checks/formatter";
import { runChecks, type RunnerOptions, type RunnerReport } from "../checks/runner";
import { getChecks } from "../checks/registry";
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

/**
 * Resolve `--phase` to a real {@link CheckPhase} (or `undefined`, meaning "no
 * phase filter" — i.e. both phases). The README documents the friendly
 * `pre`/`post`/`all` aliases; the internal filter only knows `pre-build`/
 * `post-build`. Previously `args.phase` was cast straight to `CheckPhase`
 * with no validation, so every documented value except the internal ones
 * matched zero registered checks in `registry.ts` (strict equality) and the
 * CLI silently reported "VALIDATION PASSED" with `total: 0`. Unknown values
 * now throw `UsageError`, mirroring `parseFormat`/`parsePdfxFlavor`/
 * `resolvePort` in `cli-args.ts`.
 */
function resolvePhaseArg(raw: string): CheckPhase | undefined {
  const normalized = raw.trim().toLowerCase();
  if (normalized === "pre" || normalized === "pre-build") return "pre-build";
  if (normalized === "post" || normalized === "post-build") return "post-build";
  if (normalized === "all") return undefined;
  throw new UsageError(
    `Invalid --phase value: "${raw}". Expected "pre", "post", "all", "pre-build", or "post-build".`
  );
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
  const { manifest, manifestDir } = await loadManifestWithPath(
    manifestPath ?? args.input ?? undefined
  );

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
  if (typeof args.phase === "string" && args.phase !== "") {
    phase = resolvePhaseArg(args.phase);
    if (phase) {
      // Mirror the unmatched --only/--skip selector guard in registry.ts: a
      // --phase (optionally narrowed further by --category) that matches no
      // registered check is a usage error, not a silent "VALIDATION PASSED".
      const matched = getChecks({ phase, category: categories });
      if (matched.length === 0) {
        const categorySuffix = categories?.length
          ? ` with --category ${categories.join(",")}`
          : "";
        throw new UsageError(
          `--phase ${args.phase}${categorySuffix} matched zero registered checks.`
        );
      }
    }
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
    // A manifest may omit source.files / styles (auto-discover everything).
    // glob() throws on a null/undefined pattern, so fall back to a recursive
    // glob when the config doesn't enumerate them explicitly.
    markdownFiles = await glob(config.source.files ?? "**/*.md", {
      cwd: manifestDir,
      absolute: true,
      nodir: true,
      ignore: ["**/node_modules/**"],
    });
    cssFiles = await glob(
      config.styles?.length
        ? config.styles.map((stylePath) => resolve(manifestDir, stylePath))
        : "**/*.css",
      {
        cwd: manifestDir,
        absolute: true,
        nodir: true,
        ignore: ["**/node_modules/**", "**/*.min.css"],
      }
    );
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
    for (const line of buildPdfSummaryLines(report.results)) {
      log.info(line);
    }
  }

  return { ok: report.summary.errors === 0, execution };
}

/**
 * Derive the extra PDF summary lines (Max TAC / Fonts / Rasterized pages) shown
 * after the standard report in text mode.
 *
 * These read the structured `code` / `data` fields on each CheckResult — NOT the
 * human-readable `message` — so rewording a check message can never silently
 * break the CLI summary. A line is emitted only when the corresponding check
 * actually produced a result; a check skipped by missing tools / filters yields
 * no result and therefore no (misleading) summary line.
 */
export function buildPdfSummaryLines(results: CheckResult[]): string[] {
  const lines: string[] = [];

  const tacResults = results.filter(
    (r) => r.checkId === "pdf.print.ink-coverage"
  );
  const tacFinding = tacResults.find((r) => r.code === "ink-coverage-exceeded");
  if (tacFinding) {
    const maxTac = tacFinding.data?.maxTac;
    if (typeof maxTac === "number") {
      lines.push(`Max TAC: ${maxTac.toFixed(1)}% (high!)`);
    }
  } else if (tacResults.length > 0) {
    lines.push("Max TAC: within limits");
  }

  const fontResults = results.filter(
    (r) => r.checkId === "pdf.print.embedded-fonts"
  );
  if (fontResults.length > 0) {
    const hasFontIssue = fontResults.some(
      (r) => r.code === "no-fonts" || r.code === "fonts-not-embedded"
    );
    if (!hasFontIssue) {
      lines.push("Fonts: all embedded");
    }
  }

  const rasterResults = results.filter(
    (r) => r.checkId === "pdf.print.rasterized-pages"
  );
  if (rasterResults.length > 0) {
    const rasterFinding = rasterResults.find(
      (r) => r.code === "rasterized-pages-detected"
    );
    const pages = rasterFinding?.data?.pages;
    lines.push(
      `Rasterized pages: ${Array.isArray(pages) ? pages.join(", ") : "none"}`
    );
  }

  return lines;
}
