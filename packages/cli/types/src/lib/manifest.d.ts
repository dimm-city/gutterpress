import type { PrintMdManifest, ResolvedConfig } from "../schema/manifest.types";
/**
 * Load manifest.yaml from a given path or CWD.
 * Returns an empty object if the file doesn't exist.
 */
export declare function loadManifest(pathOrDir?: string): Promise<PrintMdManifest>;
/**
 * Load manifest.yaml and return both the manifest and the directory it was found in.
 * Returns an empty manifest and the current working directory if no manifest is found.
 */
export declare function loadManifestWithPath(pathOrDir?: string): Promise<{
    manifest: PrintMdManifest;
    manifestDir: string;
}>;
/**
 * Merge CLI args > manifest > preset defaults into a fully-resolved config.
 * Any field explicitly set in `cliOverrides` wins, then manifest, then preset.
 */
export declare function resolveConfig(cliOverrides: Partial<PrintMdManifest>, manifest: PrintMdManifest): ResolvedConfig;
