import type { CheckCategory, CheckContext, CheckPhase, CheckResult } from "./types";
export interface RunnerOptions {
    category?: CheckCategory[];
    phase?: CheckPhase;
    only?: string[];
    skip?: string[];
    /** Check IDs to skip due to missing tools (set by tool-check) */
    skipMissingTools?: string[];
}
export interface RunnerReport {
    results: CheckResult[];
    errors: CheckResult[];
    warnings: CheckResult[];
    infos: CheckResult[];
    passed: string[];
    summary: {
        total: number;
        errors: number;
        warnings: number;
        infos: number;
        passed: number;
    };
}
export declare function runChecks(ctx: CheckContext, opts?: RunnerOptions): Promise<RunnerReport>;
