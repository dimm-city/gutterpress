/**
 * Parse page size from `pdfinfo -box` output.
 */
export declare function parsePdfInfoBox(pdfinfo: string): {
    w: number;
    h: number;
} | null;
/**
 * Parse font embedding info from `pdffonts` output.
 */
export declare function parsePdfFonts(pdffontsOut: string): Array<{
    name: string;
    embedded: boolean;
}>;
/**
 * Parse ink coverage from `gs -sDEVICE=inkcov` output.
 */
export declare function parseInkCov(out: string): {
    c: number;
    m: number;
    y: number;
    k: number;
    sum: number;
}[];
/**
 * Get per-page ink coverage using Ghostscript's inkcov device.
 * Returns an array of per-page CMYK coverage values (in percentages).
 */
export declare function getPerPageInkCoverage(pdfPath: string): Promise<Array<{
    page: number;
    c: number;
    m: number;
    y: number;
    k: number;
    tac: number;
}>>;
/**
 * Parse full-page images from `pdfimages -list` output.
 */
export declare function parsePdfImages(out: string, pageSizePts: {
    w: number;
    h: number;
}): number[];
/**
 * Filter candidate pages to find truly rasterized ones (vs intentional artwork).
 */
export declare function filterRasterized(candidates: number[], pdfPath: string, pdfimagesOut: string): Promise<number[]>;
