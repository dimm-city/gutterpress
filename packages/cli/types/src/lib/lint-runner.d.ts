export interface LintRunnerOptions {
    files?: string;
    configPath?: string;
    manifest?: string;
}
export interface LintRunnerResult {
    ok: boolean;
    riskyCount: number;
    filesLinted: number;
}
export declare function runLint(opts?: LintRunnerOptions): Promise<LintRunnerResult>;
