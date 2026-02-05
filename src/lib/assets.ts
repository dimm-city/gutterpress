/**
 * Shared asset copying utilities
 *
 * Provides consistent asset handling across build, assets, and preview commands.
 * Handles relative paths like "../_shared" correctly.
 */

import { existsSync } from "node:fs";
import { join, basename } from "node:path";
import { copyDir } from "./exec";

/**
 * Default asset directories when no manifest is provided
 */
export const DEFAULT_ASSETS = ["css", "fonts", "images"];

/**
 * Resolve the destination name for an asset path.
 * For relative paths like "../_shared", returns just the basename ("_shared").
 * For simple paths like "css", returns the path unchanged.
 */
export function resolveAssetDestName(assetPath: string): string {
  return assetPath.startsWith("..") ? basename(assetPath) : assetPath;
}

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
export async function copyAssets(
  inputDir: string,
  outDir: string,
  assets: string[],
  options?: {
    onCopy?: (assetPath: string) => void;
    onSkip?: (assetPath: string, srcPath: string) => void;
  }
): Promise<string[]> {
  const copied: string[] = [];

  for (const assetPath of assets) {
    const src = join(inputDir, assetPath);
    const destName = resolveAssetDestName(assetPath);

    if (existsSync(src)) {
      options?.onCopy?.(assetPath);
      await copyDir(src, join(outDir, destName));
      copied.push(destName);
    } else {
      options?.onSkip?.(assetPath, src);
    }
  }

  return copied;
}
