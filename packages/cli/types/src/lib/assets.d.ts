/**
 * Shared asset copying utilities
 *
 * Provides consistent asset handling across build, assets, and preview commands.
 * Handles relative paths like "../_shared" correctly.
 */
/**
 * Default asset directories when no manifest is provided
 */
export declare const DEFAULT_ASSETS: string[];
/**
 * Resolve the destination name for an asset path.
 * For relative paths like "../_shared", returns just the basename ("_shared").
 * For simple paths like "css", returns the path unchanged.
 */
export declare function resolveAssetDestName(assetPath: string): string;
/**
 * Copy assets from source directory to destination directory.
 * Handles relative paths correctly by using basename for destination.
 *
 * @param inputDir - Source directory containing assets
 * @param outDir - Destination directory
 * @param assets - Array of asset paths (can include relative paths like "../_shared")
 * @param options - Optional callbacks for logging
 * @returns Array of copied asset names
 */
export declare function copyAssets(inputDir: string, outDir: string, assets: string[], options?: {
    onCopy?: (assetPath: string) => void;
    onSkip?: (assetPath: string, srcPath: string) => void;
}): Promise<string[]>;
