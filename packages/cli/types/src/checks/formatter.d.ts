import type { RunnerReport } from "./runner";
export type OutputFormat = "text" | "json";
export declare function formatReport(report: RunnerReport, format?: OutputFormat): void;
