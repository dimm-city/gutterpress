import type { ResolvedConfig } from "../schema/manifest.types";
export type ValidationProfile = "dtrpg";
export declare const DTRPG_STRICT_PDF_CHECKS: readonly ["pdf.structure.qpdf", "pdf.print.pdfx-markers", "pdf.print.pdfx-metadata", "pdf.print.embedded-fonts"];
export declare function applyDtrpgPdfDefaults(config: ResolvedConfig): ResolvedConfig;
export declare function applyValidationProfile(config: ResolvedConfig, profile: ValidationProfile): ResolvedConfig;
