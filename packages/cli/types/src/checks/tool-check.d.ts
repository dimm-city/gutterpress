import type { ResolvedConfig } from "../schema/manifest.types";
import type { RunnerOptions } from "./runner";
export interface ToolCheckResult {
    /** Tools that were checked and found present */
    available: string[];
    /** Tools that are missing */
    missing: string[];
    /** Check IDs that will be skipped due to missing tools */
    skippedChecks: string[];
    /** Mapping: missing tool → check IDs that need it */
    toolToChecks: Map<string, string[]>;
}
/**
 * Checks whether external tools required by active checks are installed.
 * Skips tools whose only dependent checks are explicitly disabled in the manifest.
 * Returns which tools are missing and which checks will be skipped.
 */
export declare function checkToolAvailability(config: ResolvedConfig, opts?: RunnerOptions): Promise<ToolCheckResult>;
/**
 * Log warnings for missing tools, showing which checks will be skipped.
 */
export declare function reportMissingTools(result: ToolCheckResult): void;
