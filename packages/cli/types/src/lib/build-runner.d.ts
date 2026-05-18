export type BuildFormat = "html" | "pdf" | "pdfx";
export type PdfxFlavor = "x1a" | "x3";
export declare class BuildError extends Error {
    exitCode: number;
    constructor(message: string, exitCode?: number);
}
export interface BuildRunnerOptions {
    inputDir: string;
    format: BuildFormat;
    outDir?: string;
    pdfFileOverride?: string | null;
    title?: string;
    pdfxFlavor?: PdfxFlavor;
    iccPath?: string;
    manifestPath?: string;
    stripAnnotations?: boolean;
    skipLint?: boolean;
    skipPreValidate?: boolean;
    skipPostValidate?: boolean;
    rawArgs: Record<string, unknown>;
}
export interface BuildRunnerResult {
    outDir: string;
    htmlPath: string;
    pdfPath: string | null;
    fingerprintPath: string;
}
export interface SplitOutPath {
    outDir?: string;
    pdfFileOverride: string | null;
}
/**
 * Split --out into outDir + optional pdfFileOverride.
 *  - For pdf/pdfx, accept "*.pdf" forms (file path) and split into dirname + path.
 *  - For html or any non-.pdf string, treat as a directory.
 */
export declare function splitOutPath(outArg: string | undefined, format: BuildFormat): SplitOutPath;
export declare function runBuild(opts: BuildRunnerOptions): Promise<BuildRunnerResult>;
