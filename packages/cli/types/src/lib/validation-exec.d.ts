import { type OutputFormat } from "../checks/formatter";
import { type RunnerOptions, type RunnerReport } from "../checks/runner";
import { type ToolCheckResult } from "../checks/tool-check";
import type { CheckContext } from "../checks/types";
import { type ValidationProfile } from "./validation-profile";
import type { ResolvedConfig } from "../schema/manifest.types";
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
export declare function executeValidation(args: ValidationExecutionArgs): Promise<ValidationExecutionResult>;
export interface ReportAndCheckResult {
    ok: boolean;
    execution: ValidationExecutionResult;
}
/**
 * Run validation and emit the standard text/json report. Returns ok=false when
 * the report contains errors so callers can decide how to surface failure
 * (process.exit for the CLI; throw for the build runner).
 */
export declare function executeAndReport(args: ValidationExecutionArgs, format?: OutputFormat): Promise<ReportAndCheckResult>;
