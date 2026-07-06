import type { RunnerReport } from "./runner";
import { log } from "../utils/logger";

export type OutputFormat = "text" | "json";

export function formatReport(
  report: RunnerReport,
  format: OutputFormat = "text"
): void {
  if (format === "json") {
    formatJson(report);
  } else {
    formatText(report);
  }
}

function formatText(report: RunnerReport): void {
  // Ascending severity — infos, then warnings, then errors — so the most
  // severe findings sit directly above the verdict line and stay visible
  // when a long report scrolls the terminal. (Previously errors were
  // sandwiched between warnings and infos.)
  for (const r of report.infos) {
    const loc = formatLocation(r.file, r.line, r.column);
    log.info(`${loc}${r.message}`);
    if (r.detail) log.info(`  ${r.detail}`);
  }

  for (const r of report.warnings) {
    const loc = formatLocation(r.file, r.line, r.column);
    log.warn(`${loc}${r.message}`);
    if (r.detail) log.warn(`  ${r.detail}`);
  }

  for (const r of report.errors) {
    const loc = formatLocation(r.file, r.line, r.column);
    log.error(`${loc}${r.message}`);
    if (r.detail) log.error(`  ${r.detail}`);
  }

  const { summary } = report;
  if (summary.errors > 0) {
    log.error(
      `VALIDATION FAILED (${summary.errors} error${summary.errors > 1 ? "s" : ""})`
    );
  } else if (summary.warnings > 0) {
    log.warn("VALIDATION PASSED (with warnings)");
  } else {
    log.success("VALIDATION PASSED");
  }
}

function formatJson(report: RunnerReport): void {
  console.log(
    JSON.stringify(
      {
        results: report.results,
        summary: report.summary,
        passed: report.passed,
      },
      null,
      2
    )
  );
}

function formatLocation(
  file?: string,
  line?: number,
  column?: number
): string {
  if (!file) return "";
  let loc = `${file}`;
  if (line != null) {
    loc += `:${line}`;
    if (column != null) loc += `:${column}`;
  }
  return `${loc}: `;
}
