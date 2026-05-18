/**
 * Strip all annotations from a PDF using qpdf.
 *
 * Chromium embeds internal link annotations (from HTML `id` attributes)
 * that are not permitted in PDF/X output. Removing them before Ghostscript
 * prevents the "Annotation not TrapNet or PrinterMark" warning and keeps
 * the output in strict PDF/X compliance.
 */
export declare function stripAnnotations(pdfPath: string): Promise<void>;
type PdfxFlavor = "x1a" | "x3";
/**
 * Generate the PostScript definition file for PDF/X output intent + GCR.
 */
export declare function makePdfxDefPs(params: {
    iccPath: string;
    pdfx: PdfxFlavor;
    title: string;
    maxTac?: number;
}): string;
/**
 * Stamp the Creator metadata field on an existing PDF using Ghostscript.
 */
export declare function stampCreator(pdfPath: string): Promise<void>;
/**
 * Convert an RGB PDF to CMYK PDF/X using Ghostscript.
 */
export declare function convertToPdfxCmyk(inputPdf: string, outPdf: string, config: {
    iccPath: string;
    pdfx: PdfxFlavor;
    title?: string;
    maxTac?: number;
}): Promise<void>;
export {};
