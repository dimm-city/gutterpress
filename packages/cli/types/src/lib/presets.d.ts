import type { ResolvedConfig } from "../schema/manifest.types";
export type VendorPreset = Omit<ResolvedConfig, "title" | "authors">;
export declare const DTRPG_PRESET: VendorPreset;
export declare const PRESETS: Record<string, VendorPreset>;
