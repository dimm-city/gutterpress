/**
 * Shared asset copying utilities
 *
 * Provides consistent asset handling across the build and preview paths.
 * Handles relative paths like "../_shared" correctly.
 */

import { existsSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
import { copyDir } from "./exec";

/**
 * Top-level file names (not directories) directly inside `dir`.
 * Used to detect destructive filename overlaps when two asset entries
 * flatten to the same destination folder. Returns an empty array if the
 * directory can't be read (it may be a single file or not exist).
 */
function topLevelFileNames(dir: string): string[] {
  try {
    return readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile())
      .map((e) => e.name);
  } catch {
    return [];
  }
}

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
    /**
     * Fired when a file copied by `assetPath` overwrites a file with the same
     * name already placed in the shared destination folder by an earlier asset
     * entry (e.g. local `css/index.css` and `../shared/css/index.css` both
     * flatten to `css/index.css`). The last entry silently wins, which is a
     * common cause of "my shared styles aren't being applied" — surfacing it
     * lets callers warn the author.
     */
    onCollision?: (info: {
      destName: string;
      fileName: string;
      winnerAsset: string;
      loserAsset: string;
    }) => void;
  }
): Promise<string[]> {
  const copied: string[] = [];
  // destName -> (fileName -> assetPath that last wrote it). Tracks which asset
  // entry owns each flattened file so we can report destructive overwrites.
  const ownership = new Map<string, Map<string, string>>();

  for (const assetPath of assets) {
    const src = join(inputDir, assetPath);
    const destName = resolveAssetDestName(assetPath);

    // Fallback: when a relative path like "../_shared" doesn't exist (e.g. during
    // build re-staging from the output dir), check the flattened basename ("_shared")
    // directly inside inputDir — a prior asset step already copied it there.
    const fallbackSrc = join(inputDir, destName);
    const resolvedSrc = existsSync(src) ? src : existsSync(fallbackSrc) ? fallbackSrc : null;

    if (resolvedSrc) {
      // Detect filename overlaps with earlier entries that share this destName
      // BEFORE the copy overwrites them.
      if (options?.onCollision) {
        const seen = ownership.get(destName) ?? new Map<string, string>();
        for (const fileName of topLevelFileNames(resolvedSrc)) {
          const loserAsset = seen.get(fileName);
          if (loserAsset && loserAsset !== assetPath) {
            options.onCollision({ destName, fileName, winnerAsset: assetPath, loserAsset });
          }
          seen.set(fileName, assetPath);
        }
        ownership.set(destName, seen);
      }

      options?.onCopy?.(assetPath);
      await copyDir(resolvedSrc, join(outDir, destName));
      copied.push(destName);
    } else {
      options?.onSkip?.(assetPath, src);
    }
  }

  return copied;
}
