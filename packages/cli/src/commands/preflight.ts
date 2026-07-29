import { defineCommand } from "citty";
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, resolve } from "node:path";
import {
  log,
  reportMissingTools,
  executeValidation,
  type ValidationExecutionResult,
} from "../index.ts";
import {
  EXIT_CODES,
  UsageError,
  rejectExtraPositionals,
  rejectUnknownFlags,
} from "../lib/cli-args.ts";

type PreflightStatus = "GO" | "FIX" | "NO-GO";

export interface PreflightPayload {
  schemaVersion: 1;
  profile: string | null;
  status: PreflightStatus;
  pdf: string;
  summary: {
    total: number;
    errors: number;
    warnings: number;
    infos: number;
    passed: number;
  };
  tools: {
    missing: string[];
    skippedChecks: string[];
  };
  requiredChecks: Array<{
    id: string;
    status: "pass" | "fail" | "skipped";
  }>;
  issues: Array<{
    checkId: string;
    severity: "error" | "warning" | "info";
    message: string;
    file?: string;
    line?: number;
    column?: number;
  }>;
}

function computeStatus(
  errors: number,
  warnings: number,
  missingTools: number,
  skippedRequired: boolean
): PreflightStatus {
  if (errors > 0 || skippedRequired) return "NO-GO";
  if (warnings > 0 || missingTools > 0) return "FIX";
  return "GO";
}

function severityRank(severity: "error" | "warning" | "info"): number {
  if (severity === "error") return 0;
  if (severity === "warning") return 1;
  return 2;
}

function buildRequiredChecks(execution: ValidationExecutionResult): Array<{
  id: string;
  status: "pass" | "fail" | "skipped";
}> {
  if (execution.profile !== "dtrpg") return [];

  const requiredIds = [
    "pdf.structure.qpdf",
    "pdf.print.pdfx-markers",
    "pdf.print.pdfx-metadata",
    "pdf.print.embedded-fonts",
  ];

  const skipped = new Set(execution.tools.skippedChecks);
  const failed = new Set(
    execution.report.errors.map((item) => item.checkId)
  );
  const passed = new Set(execution.report.passed);

  return requiredIds.map((id) => {
    if (skipped.has(id)) return { id, status: "skipped" as const };
    if (failed.has(id)) return { id, status: "fail" as const };
    if (passed.has(id)) return { id, status: "pass" as const };
    return { id, status: "fail" as const };
  });
}

export function buildPreflightPayload(
  execution: ValidationExecutionResult
): PreflightPayload {
  const sortedIssues = [...execution.report.results]
    .sort((a, b) => {
      const severityCmp = severityRank(a.severity) - severityRank(b.severity);
      if (severityCmp !== 0) return severityCmp;
      const checkCmp = a.checkId.localeCompare(b.checkId);
      if (checkCmp !== 0) return checkCmp;
      const fileCmp = (a.file ?? "").localeCompare(b.file ?? "");
      if (fileCmp !== 0) return fileCmp;
      const lineCmp = (a.line ?? 0) - (b.line ?? 0);
      if (lineCmp !== 0) return lineCmp;
      const colCmp = (a.column ?? 0) - (b.column ?? 0);
      if (colCmp !== 0) return colCmp;
      return a.message.localeCompare(b.message);
    })
    .map((item) => ({
      checkId: item.checkId,
      severity: item.severity,
      message: item.message,
      file: item.file,
      line: item.line,
      column: item.column,
    }));

  const requiredChecks = buildRequiredChecks(execution);
  const skippedRequired = requiredChecks.some((check) => check.status === "skipped");

  return {
    schemaVersion: 1,
    profile: execution.profile ?? null,
    status: computeStatus(
      execution.report.summary.errors,
      execution.report.summary.warnings,
      execution.tools.missing.length,
      skippedRequired
    ),
    pdf: execution.context.pdfPath ?? "",
    summary: { ...execution.report.summary },
    tools: {
      missing: [...execution.tools.missing].sort((a, b) => a.localeCompare(b)),
      skippedChecks: [...execution.tools.skippedChecks].sort((a, b) => a.localeCompare(b)),
    },
    requiredChecks,
    issues: sortedIssues,
  };
}

export function toPreflightMarkdown(payload: PreflightPayload): string {
  const lines: string[] = [];
  lines.push("# gutterpress preflight");
  lines.push("");
  lines.push(`- Status: **${payload.status}**`);
  lines.push(`- Profile: ${payload.profile ?? "none"}`);
  lines.push(`- PDF: ${payload.pdf}`);
  lines.push(
    `- Summary: ${payload.summary.errors} error(s), ${payload.summary.warnings} warning(s), ${payload.summary.passed}/${payload.summary.total} checks passed`
  );

  if (payload.tools.missing.length > 0) {
    lines.push("");
    lines.push("## Missing Tools");
    for (const tool of payload.tools.missing) {
      lines.push(`- ${tool}`);
    }
  }

  if (payload.requiredChecks.length > 0) {
    lines.push("");
    lines.push("## Required Checks");
    for (const check of payload.requiredChecks) {
      lines.push(`- ${check.id}: ${check.status}`);
    }
  }

  if (payload.issues.length > 0) {
    lines.push("");
    lines.push("## Issues");
    for (const issue of payload.issues) {
      lines.push(`- [${issue.severity}] ${issue.checkId}: ${issue.message}`);
    }
  }

  return `${lines.join("\n")}\n`;
}

function defaultReportName(pdfPath: string): string {
  const ext = extname(pdfPath);
  const base = ext ? basename(pdfPath, ext) : basename(pdfPath);
  return `${base}.preflight`;
}

export const preflightArgs = {
  dir: {
    type: "positional",
    description:
      "Project directory (default: cwd). Sets the pre-build source directory unless --input is also given.",
    required: false,
  },
  pdf: {
    type: "string",
    description: "Path to the PDF file to preflight",
    required: true,
  },
  input: {
    type: "string",
    description: "Optional source directory for pre-build checks (overrides the positional directory)",
  },
  manifest: {
    type: "string",
    description: "Path to manifest.yaml",
  },
  profile: {
    type: "string",
    description: "Validation profile lock (currently: dtrpg)",
  },
  "report-dir": {
    type: "string",
    description: "Output directory for preflight reports",
  },
  name: {
    type: "string",
    description: "Base filename for report outputs",
  },
} as const;

export default defineCommand({
  meta: {
    name: "preflight",
    description: "Run deterministic print preflight for a built PDF",
  },
  args: preflightArgs,
  async run({ args, rawArgs }) {
    // M46: `dir` (positional) sets the same source directory `--input` does —
    // an explicit --input still wins.
    const positionalDir = typeof args.dir === "string" ? args.dir : undefined;
    const inputFlag = typeof args.input === "string" ? args.input : undefined;
    const input = inputFlag ?? positionalDir;

    let execution;
    try {
      rejectUnknownFlags(rawArgs, preflightArgs, "preflight");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "preflight");

      execution = await executeValidation({
        manifest: typeof args.manifest === "string" ? args.manifest : undefined,
        pdf: typeof args.pdf === "string" ? args.pdf : undefined,
        input,
        phase: "post-build",
        profile: typeof args.profile === "string" ? args.profile : undefined,
      });
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(error instanceof UsageError ? error.exitCode : EXIT_CODES.USAGE);
    }

    if (!execution) return;

    reportMissingTools(execution.tools);

    const payload = buildPreflightPayload(execution);
    const pdfPath = execution.context.pdfPath!;
    const reportDir = resolve(
      typeof args["report-dir"] === "string"
        ? args["report-dir"]
        : dirname(pdfPath)
    );
    const baseName =
      typeof args.name === "string" && args.name.trim().length > 0
        ? args.name.trim()
        : defaultReportName(pdfPath);

    const jsonPath = join(reportDir, `${baseName}.json`);
    const markdownPath = join(reportDir, `${baseName}.md`);

    await mkdir(reportDir, { recursive: true });
    await writeFile(jsonPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    await writeFile(markdownPath, toPreflightMarkdown(payload), "utf8");

    log.info(`Preflight status: ${payload.status}`);
    log.info(`JSON report: ${jsonPath}`);
    log.info(`Markdown report: ${markdownPath}`);

    if (payload.status === "NO-GO") {
      process.exit(EXIT_CODES.FINDINGS);
    }
  },
});
