import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { loadManifestWithPath, resolveConfig, resolveConfigForTarget } from "./manifest";
import { resolveOutputDir } from "./output-paths";
import { log } from "../utils/logger";
import { BOOK_HTML_FILENAME } from "./desktop";
import { UsageError } from "./cli-args";
import { resolveActiveStyles } from "./style-resolver";
import { collectStyleDependencies, escapesProjectRoot } from "./asset-inline";
import { resolveActiveMarkdownFiles } from "./markdown/index";
import { canonicalChapterId } from "./markdown/chapter-id";
import { formatReport, type OutputFormat } from "../checks/formatter";
import { runChecks, type RunnerOptions, type RunnerReport } from "../checks/runner";
import { getChecks, getKnownCategories, resolveCheckSelectors } from "../checks/registry";
import {
  checkToolAvailability,
  reportMissingTools,
  type ToolCheckResult,
} from "../checks/tool-check";
import type { CheckCategory, CheckContext, CheckPhase, CheckResult } from "../checks/types";
import {
  applyDefaultPdfStrictChecks,
  publishTargetFor,
  resolveTargets,
  type PublishTarget,
} from "./targets";
import type { GutterpressManifest, ResolvedConfig } from "../schema/manifest.types";

// Trigger built-in check self-registration (audit B5: one shared entry point,
// also imported by checks/runner.ts so the registry is never empty).
import "../checks/register-builtins";

export interface ValidationExecutionArgs {
  manifest?: string;
  pdf?: string;
  input?: string;
  category?: string;
  only?: string;
  skip?: string;
  phase?: string;
  /** Publish-target ids (CSV) to validate against, overriding the manifest's `targets:` for this run. */
  target?: string;
}

export interface ValidationExecutionResult {
  config: ResolvedConfig;
  /** The publish targets this run validated against (may be empty). */
  targets: string[];
  context: CheckContext;
  runnerOptions: RunnerOptions;
  tools: ToolCheckResult;
  report: RunnerReport;
}

/** Asset extensions whose files ship inside the built book (see asset-inline.ts). */
const SHIPPED_ASSET_EXTS = new Set([
  ".woff2", ".woff", ".ttf", ".otf",
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".svg", ".tif", ".tiff",
]);

/**
 * Directories holding the active stylesheets' asset closure that lives OUTSIDE
 * the book — a shared repo-root theme's fonts and images, which the build
 * embeds into the PDF and which therefore have to pass the same asset checks as
 * in-book art.
 *
 * Only the asset files' own directories are returned: not the whole shared tree,
 * and not the stylesheets' directories (which may hold unrelated CSS and art
 * that never ships). Deduped, and anything already inside `inputDir` is dropped
 * since the wholesale project scan covers it. Never throws — a missing or
 * mid-edit stylesheet just contributes nothing, exactly as the preview watcher's
 * use of the same collector does.
 */
async function sharedAssetDirs(
  manifestDir: string,
  relStyles: string[],
  inputDir: string,
): Promise<string[]> {
  let closure: string[];
  try {
    closure = await collectStyleDependencies(manifestDir, relStyles);
  } catch {
    return [];
  }
  const projectRoot = resolve(inputDir);
  const dirs = new Set<string>();
  for (const file of closure) {
    const ext = file.slice(file.lastIndexOf(".")).toLowerCase();
    if (!SHIPPED_ASSET_EXTS.has(ext)) continue;
    const dir = dirname(resolve(file));
    // Only dirs OUTSIDE the project; the wholesale project scan already covers
    // the rest. Same containment predicate the asset inliner uses.
    if (escapesProjectRoot(projectRoot, dir)) dirs.add(dir);
  }
  return [...dirs];
}

function parseCsv(value?: string): string[] | undefined {
  if (!value) return undefined;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
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

/**
 * Resolve `--category` (CSV) to validated {@link CheckCategory} values. This
 * mirrors {@link resolvePhaseArg}'s bug shape: `args.category` was previously
 * cast straight to `CheckCategory` (`s as CheckCategory`) with no validation,
 * so a typo like `--category asset,srouce` silently produced a category that
 * matches zero registered checks instead of failing loudly. Unknown values
 * now throw `UsageError`, same as an unrecognized `--phase`.
 */
function resolveCategoryArg(raw?: string): CheckCategory[] | undefined {
  const parsed = parseCsv(raw);
  if (!parsed) return undefined;

  const known = new Set(getKnownCategories());
  const invalid = parsed.filter((c) => !known.has(c as CheckCategory));
  if (invalid.length > 0) {
    const knownList = Array.from(known).sort().join(", ");
    throw new UsageError(
      `Invalid --category value: "${invalid.join(", ")}". Expected one of: ${knownList}.`
    );
  }

  return parsed as CheckCategory[];
}

/**
 * A target's required check that was SKIPPED because its tools are missing
 * becomes a synthetic error (ADR 0008): "validated for dtrpg" must never
 * silently mean "the dtrpg checks didn't run".
 */
function withTargetRequiredCheckErrors(
  report: RunnerReport,
  tools: ToolCheckResult,
  target: PublishTarget
): RunnerReport {
  const skippedSet = new Set(tools.skippedChecks);
  const missingRequired = target.requiredChecks.filter((checkId) => skippedSet.has(checkId));
  if (missingRequired.length === 0) return report;

  const syntheticErrors: CheckResult[] = missingRequired.map((checkId) => ({
    checkId,
    target: target.id,
    severity: "error",
    message:
      `Target ${target.id} requires check ${checkId}, but it was skipped because required tools are not available.`,
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

/**
 * Categories whose findings depend on the destination's policy (color
 * spaces, ink, PDF/X, bleed…) versus those that are about the source itself.
 * Multi-target runs execute the independent set once and the dependent set
 * once per target.
 */
const TARGET_INDEPENDENT_CATEGORIES: readonly CheckCategory[] = ["source", "heuristic"];
const TARGET_DEPENDENT_CATEGORIES: readonly CheckCategory[] = ["asset", "pdf"];

/** One planned invocation of the check runner. */
interface ValidationRun {
  /** Target id, or null for the target-independent base run. */
  targetId: string | null;
  config: ResolvedConfig;
  category: CheckCategory[] | undefined;
  only: string[] | undefined;
}

/** Tag every result in a report with the target it was produced for. */
function tagReport(report: RunnerReport, targetId: string): RunnerReport {
  const tag = (r: CheckResult): CheckResult => ({ ...r, target: targetId });
  return {
    results: report.results.map(tag),
    errors: report.errors.map(tag),
    warnings: report.warnings.map(tag),
    infos: report.infos.map(tag),
    passed: report.passed,
    summary: report.summary,
  };
}

function mergeReports(reports: RunnerReport[]): RunnerReport {
  const merged: RunnerReport = {
    results: [],
    errors: [],
    warnings: [],
    infos: [],
    passed: [],
    summary: { total: 0, errors: 0, warnings: 0, infos: 0, passed: 0 },
  };
  for (const r of reports) {
    merged.results.push(...r.results);
    merged.errors.push(...r.errors);
    merged.warnings.push(...r.warnings);
    merged.infos.push(...r.infos);
    merged.passed.push(...r.passed);
    merged.summary.total += r.summary.total;
    merged.summary.errors += r.summary.errors;
    merged.summary.warnings += r.summary.warnings;
    merged.summary.infos += r.summary.infos;
    merged.summary.passed += r.summary.passed;
  }
  return merged;
}

function mergeTools(results: ToolCheckResult[]): ToolCheckResult {
  const available = new Set<string>();
  const missing = new Set<string>();
  const skippedChecks = new Set<string>();
  const toolToChecks = new Map<string, string[]>();
  for (const r of results) {
    for (const t of r.available) available.add(t);
    for (const t of r.missing) missing.add(t);
    for (const id of r.skippedChecks) skippedChecks.add(id);
    for (const [tool, ids] of r.toolToChecks) {
      const merged = new Set([...(toolToChecks.get(tool) ?? []), ...ids]);
      toolToChecks.set(tool, [...merged]);
    }
  }
  return {
    available: [...available],
    missing: [...missing],
    skippedChecks: [...skippedChecks],
    toolToChecks,
  };
}

/**
 * Plan the runner invocations for this validation (ADR 0008).
 *
 * Zero targets: one run against the base config — exactly the pre-target
 * behavior. With targets: the target-independent categories run once against
 * the base config; the target-dependent categories run once per target
 * against that target's config (cli > manifest > target > preset).
 *
 * `--only` resolves to concrete check ids first and each id follows its
 * category to the run that owns it; unmatched (typo'd) selectors ride with
 * the base run so the runner's unmatched-selector error fires exactly once.
 */
function planRuns(opts: {
  manifest: GutterpressManifest;
  baseConfig: ResolvedConfig;
  targetIds: string[];
  pdfPath: string | undefined;
  categories: CheckCategory[] | undefined;
  only: string[] | undefined;
}): ValidationRun[] {
  const { manifest, baseConfig, targetIds, pdfPath, categories, only } = opts;

  const finalize = (config: ResolvedConfig): ResolvedConfig =>
    pdfPath ? applyDefaultPdfStrictChecks(config) : config;

  if (targetIds.length === 0) {
    return [{ targetId: null, config: finalize(baseConfig), category: categories, only }];
  }

  const requested = categories ?? [...TARGET_INDEPENDENT_CATEGORIES, ...TARGET_DEPENDENT_CATEGORIES];
  const independentCats = requested.filter((c) =>
    (TARGET_INDEPENDENT_CATEGORIES as readonly string[]).includes(c)
  );
  const dependentCats = requested.filter((c) =>
    (TARGET_DEPENDENT_CATEGORIES as readonly string[]).includes(c)
  );

  let baseOnly: string[] | undefined;
  let dependentOnly: string[] | undefined;
  if (only && only.length > 0) {
    const { resolved, unmatched } = resolveCheckSelectors(only);
    const categoryById = new Map(getChecks({}).map((c) => [c.id, c.category]));
    const independentIds = resolved.filter((id) =>
      (TARGET_INDEPENDENT_CATEGORIES as readonly string[]).includes(categoryById.get(id) ?? "")
    );
    const dependentIds = resolved.filter((id) =>
      (TARGET_DEPENDENT_CATEGORIES as readonly string[]).includes(categoryById.get(id) ?? "")
    );
    baseOnly = [...independentIds, ...unmatched];
    dependentOnly = dependentIds;
  }

  const runs: ValidationRun[] = [];
  const baseWanted = only ? (baseOnly?.length ?? 0) > 0 : independentCats.length > 0;
  if (baseWanted) {
    runs.push({
      targetId: null,
      config: baseConfig,
      category: only ? undefined : independentCats,
      only: baseOnly,
    });
  }
  const dependentWanted = only ? (dependentOnly?.length ?? 0) > 0 : dependentCats.length > 0;
  if (dependentWanted) {
    for (const targetId of targetIds) {
      runs.push({
        targetId,
        config: finalize(resolveConfigForTarget({}, manifest, targetId)),
        category: only ? undefined : dependentCats,
        only: dependentOnly,
      });
    }
  }
  return runs;
}

export async function executeValidation(
  args: ValidationExecutionArgs
): Promise<ValidationExecutionResult> {
  const manifestPath = typeof args.manifest === "string" ? args.manifest : undefined;
  const { manifest, manifestDir } = await loadManifestWithPath(
    manifestPath ?? args.input ?? undefined,
    { explicit: manifestPath !== undefined }
  );

  const config = resolveConfig({}, manifest);
  // Explicit --target overrides the manifest's targets for this run; both go
  // through the registry so an unknown id fails loudly either way.
  const targetIds = resolveTargets(
    parseCsv(typeof args.target === "string" ? args.target : undefined),
    config.targets
  );
  const pdfPath = typeof args.pdf === "string" ? resolve(args.pdf) : undefined;
  const inputDir = typeof args.input === "string" ? resolve(args.input) : undefined;

  if (pdfPath && !existsSync(pdfPath)) {
    throw new Error(`File not found: ${pdfPath}`);
  }

  const categories = resolveCategoryArg(
    typeof args.category === "string" ? args.category : undefined
  );
  const only = parseCsv(typeof args.only === "string" ? args.only : undefined);
  const skip = parseCsv(typeof args.skip === "string" ? args.skip : undefined);

  let phase: CheckPhase | undefined;
  if (typeof args.phase === "string" && args.phase !== "") {
    phase = resolvePhaseArg(args.phase);
  } else if (pdfPath && !inputDir) {
    phase = "post-build";
  } else if (inputDir && !pdfPath) {
    phase = "pre-build";
  }

  // Mirror the unmatched --only/--skip selector guard in registry.ts: a
  // phase/category selection that matches no registered check is a usage
  // error, never a silent "VALIDATION PASSED". This MUST run for every way
  // `phase` can end up set here, not just an explicit non-"all" `--phase`:
  //   - an explicit narrow value ("--phase pre-build")
  //   - "--phase all", which resolves to `phase === undefined` ("no filter")
  //   - a phase auto-selected above from --pdf/--input with no --phase given
  // The previous implementation only guarded inside the explicit-and-non-"all"
  // branch, so `--phase all --category bogus` (or an unknown category with no
  // --phase at all, auto-selecting a phase) matched zero checks and reported
  // a false-green PASS. It intentionally does NOT run when `--only` is set:
  // runChecks() (runner.ts) selects checks purely by resolved ids in that
  // case and never consults phase/category, and --only already has its own
  // unmatched-selector guard there.
  if (!only || only.length === 0) {
    const matched = getChecks({ phase, category: categories });
    if (matched.length === 0) {
      const phasePart = phase ? `--phase ${phase}` : "--phase all";
      const categoryPart = categories?.length
        ? ` --category ${categories.join(",")}`
        : "";
      throw new UsageError(
        `${phasePart}${categoryPart} matched zero registered checks.`
      );
    }
  }

  let markdownFiles: string[] | undefined;
  let cssFiles: string[] | undefined;
  let assetDirs: string[] | undefined;
  let htmlPath: string | undefined;

  // Output location is the shared convention (./output-paths.ts), anchored on
  // the MANIFEST's directory — the same anchor `resolveBuildContext`
  // (build-runner.ts) uses, so a validation run looks for `book.html` exactly
  // where a build of the same manifest would have written it.
  const outDir = resolveOutputDir(manifestDir, config.title);

  if (inputDir) {
    // THE canonical file-set resolvers — the SAME ones the renderer uses
    // (renderChapters, lib/markdown/index.ts / renderBook, build-runner.ts) —
    // instead of an independent recursive glob across the whole project.
    // Before this (2026-07-28 duplication audit), a manifest with no
    // `source.files`/`styles` made validation glob `**/*.md` / `**/*.css`
    // project-wide: an unused theme, a drafts folder, or a design system's own
    // docs got linted/validated even though the book never references them,
    // and the print-safety `checkCss` gate ran on stylesheets that don't ship.
    //
    // Anchored on `manifestDir` — the SAME single anchor the build resolves
    // every manifest-relative path against (`BuildContext.renderDir`). This
    // used to say `inputDir` "to match what the build anchors renderChapters on",
    // which was true at the time and wrong in the same way the build was: the
    // two differ only under an explicit `--manifest` outside `--input`, and the
    // docs are unambiguous that `source.files` and `styles:` are BOTH
    // manifest-relative (2026-07-29 audit).
    const relMarkdown = await resolveActiveMarkdownFiles(manifestDir, config.source.files);
    markdownFiles = relMarkdown.map((f) => join(manifestDir, canonicalChapterId(f)));

    // stylelint (source.stylelint) skips minified CSS, since line/column
    // findings on a minified file are meaningless; it still ships via
    // resolveActiveStyles/inlineStyles regardless.
    //
    // NOT the same list lint-runner.ts builds: since #238 that one also folds
    // in plugin-declared `styles` files, so a plugin's CSS is print-safety and
    // ownership checked by `gutterpress lint` but not by `validate`/`preflight`
    // or the desktop Problems panel. Closing that gap means paying a plugin
    // load here too — see the follow-up issue before doing it, because a build
    // already loads plugins twice (lint gate, then render).
    const relStyles = await resolveActiveStyles(manifestDir, config.styles);
    cssFiles = relStyles
      .map((rel) => resolve(manifestDir, rel))
      .filter((f) => !f.endsWith(".min.css"));

    // The project root, wholesale. Excluding node_modules/.git/dist happens at
    // the GLOB level (ASSET_SCAN_IGNORE_GLOBS, checks/asset/extensions.ts), not
    // by choosing which directories to scan — picking directories silently
    // dropped every file sitting at the project root, and scanned nothing at
    // all for a project whose only subdirectory was `dist`.
    //
    // Plus the directories holding the ACTIVE stylesheets' out-of-book asset
    // closure (2026-07-29 audit). A shared repo-root theme's own `url()`
    // targets are embedded into the built PDF — fonts always, images under the
    // inline cap — so a scan limited to the book folder never checked shipped
    // shared fonts or art for resolution, colour space, TAC, file size, alpha,
    // or font licence. Only the asset files' OWN directories are added, not the
    // whole shared tree and not the stylesheets' directories, so the scan stays
    // as tight as the closure itself.
    assetDirs = [inputDir, ...(await sharedAssetDirs(manifestDir, relStyles, inputDir))];

    const possibleHtml = join(outDir, BOOK_HTML_FILENAME);
    if (existsSync(possibleHtml)) {
      htmlPath = possibleHtml;
    }
  }

  const context: CheckContext = {
    config,
    inputDir: inputDir ?? process.cwd(),
    outputDir: outDir,
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

  const runs = planRuns({ manifest, baseConfig: config, targetIds, pdfPath, categories, only });

  const reports: RunnerReport[] = [];
  const toolResults: ToolCheckResult[] = [];
  for (const run of runs) {
    const runOptions: RunnerOptions = {
      category: run.category,
      phase,
      only: run.only,
      skip,
    };
    const runTools = await checkToolAvailability(run.config, runOptions);
    toolResults.push(runTools);
    let runReport = await runChecks(
      { ...context, config: run.config },
      { ...runOptions, skipMissingTools: runTools.skippedChecks }
    );
    if (run.targetId !== null) {
      runReport = withTargetRequiredCheckErrors(
        runReport,
        runTools,
        publishTargetFor(run.targetId)
      );
      runReport = tagReport(runReport, run.targetId);
    }
    reports.push(runReport);
  }

  const tools = mergeTools(toolResults);
  const report = mergeReports(reports);

  return {
    config,
    targets: targetIds,
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
