type PdfxFingerprintConfig = {
    requestedFlavor: "x1a" | "x3" | null;
    resolvedFlavor: "x1a" | "x3";
    iccPath: string | null;
    stripAnnotations: boolean | null;
};
export type BuildFingerprintInput = {
    command: "build";
    outputDir: string;
    sourceDir?: string;
    args: Record<string, unknown>;
    pdfx: PdfxFingerprintConfig;
};
export declare function writeBuildFingerprint(input: BuildFingerprintInput): Promise<string>;
export {};
