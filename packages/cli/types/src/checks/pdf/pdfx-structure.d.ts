type PdfxFlavor = "x1a" | "x3";
type JsonObject = Record<string, unknown>;
export declare function parseQpdfObjectsJson(stdout: string): JsonObject | null;
export declare function getPdfxOutputIntentIssues(objects: JsonObject): string[];
export declare function getPdfxMetadataIssues(objects: JsonObject, flavor: PdfxFlavor): string[];
export {};
