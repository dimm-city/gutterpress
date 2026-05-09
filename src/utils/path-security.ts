/**
 * Path Security Utilities
 *
 * Provides robust path validation to prevent directory traversal attacks
 * in the preview server's API endpoints.
 *
 * Security Measures:
 * - Path normalization using path.resolve()
 * - Boundary checking with path.sep
 * - Symlink resolution via Bun.file().realpath()
 * - Character validation (null bytes, etc.)
 * - URL decoding normalization
 */

import path from 'path';
import { homedir } from 'os';
import { realpath as fsRealpath } from 'fs/promises';

/**
 * Result of path validation
 */
export interface PathValidationResult {
  /** Whether the path is valid and safe to serve */
  valid: boolean;
  /** Resolved absolute path (only present if valid) */
  resolvedPath?: string;
  /** Error message (only present if invalid) */
  error?: string;
}

/**
 * Decode URL-encoded path with multiple passes to handle double-encoding
 * @param encodedPath - URL-encoded path string
 * @returns Decoded path string
 */
function decodeUrlPath(encodedPath: string): string {
  let decoded = encodedPath;
  let prevDecoded = '';

  // Keep decoding until no more changes (handles double/triple encoding)
  while (decoded !== prevDecoded) {
    prevDecoded = decoded;
    try {
      decoded = decodeURIComponent(decoded);
    } catch (error) {
      // If decoding fails, return the last valid decoded value
      break;
    }
  }

  return decoded;
}

/**
 * Check if a path contains dangerous characters
 * @param pathStr - Path string to check
 * @returns True if path contains dangerous characters
 */
function containsDangerousCharacters(pathStr: string): boolean {
  // Check for null bytes (path truncation attack)
  if (pathStr.includes('\0')) {
    return true;
  }

  // Check for Unicode characters that might normalize to path separators
  // U+FF0E (fullwidth dot), U+FF0F (fullwidth slash)
  if (/[\uFF0E\uFF0F]/.test(pathStr)) {
    return true;
  }

  return false;
}

/**
 * Normalize Unicode characters that might be used in path traversal attacks
 * @param pathStr - Path string to normalize
 * @returns Normalized path string
 */
function normalizeUnicode(pathStr: string): string {
  // Use NFD normalization to decompose characters
  return pathStr.normalize('NFD');
}

/**
 * Validate that a static file path is safe to serve
 *
 * This function prevents directory traversal attacks by:
 * 1. Decoding URL-encoded paths (including double-encoding)
 * 2. Checking for dangerous characters (null bytes, Unicode tricks)
 * 3. Resolving the path to its canonical form
 * 4. Ensuring the resolved path is within the allowed directory
 * 5. Checking for symlinks that point outside the allowed directory
 *
 * @param requestPath - The requested path from the URL (may be URL-encoded)
 * @param allowedDirectory - The directory that files must be within
 * @returns PathValidationResult with validation status and resolved path or error
 */
export async function validateStaticPath(
  requestPath: string,
  allowedDirectory: string
): Promise<PathValidationResult> {
  // Step 1: Handle empty paths
  if (!requestPath || requestPath.trim() === '') {
    return {
      valid: false,
      error: 'Path cannot be empty',
    };
  }

  // Step 2: Decode URL encoding (handles multiple levels of encoding)
  const decodedPath = decodeUrlPath(requestPath);

  // Step 3: Normalize Unicode to prevent Unicode normalization attacks
  const normalizedPath = normalizeUnicode(decodedPath);

  // Step 4: Check for dangerous characters
  if (containsDangerousCharacters(normalizedPath)) {
    return {
      valid: false,
      error: 'Path contains invalid characters',
    };
  }

  // Step 5: Resolve both paths to their canonical absolute forms
  // This normalizes . and .. components
  const normalizedAllowedDir = path.resolve(allowedDirectory);
  const resolvedPath = path.resolve(normalizedAllowedDir, normalizedPath);

  // Step 6: Ensure the resolved path is within the allowed directory
  // Use path.sep to ensure we're checking directory boundaries correctly
  // This prevents attacks like /home/user/project vs /home/user/projectile
  if (resolvedPath !== normalizedAllowedDir &&
      !resolvedPath.startsWith(normalizedAllowedDir + path.sep)) {
    return {
      valid: false,
      error: 'Path is outside allowed directory',
    };
  }

  // Step 7: Check for symlinks that escape the allowed directory
  // This prevents attacks where a symlink inside the allowed directory
  // points to a file outside it (e.g., symlink to /etc/passwd)
  try {
    // Resolve symlinks using node:fs/promises.realpath — works on
    // both Bun and Node, unlike Bun's old `BunFile.realpath()` which
    // was removed in newer Bun versions.
    const realPath = await fsRealpath(resolvedPath);
    const realAllowedDir = await fsRealpath(normalizedAllowedDir);

    // Check if the real path (following symlinks) is still within the allowed directory
    if (realPath !== realAllowedDir &&
        !realPath.startsWith(realAllowedDir + path.sep)) {
      return {
        valid: false,
        error: 'Path symlink points outside allowed directory',
      };
    }
  } catch (error) {
    // If realpath fails, it likely means the file doesn't exist yet
    // This is not a security issue - the file existence check will happen later
    // We just need to ensure the *intended* path is within the allowed directory
    // which we already validated in step 6
  }

  // Path is valid and safe to serve
  return {
    valid: true,
    resolvedPath,
  };
}

/**
 * Check if a path is within the home directory
 * Used for folder navigation restrictions in the preview server
 *
 * @param checkPath - Path to validate
 * @param homeDirectory - User's home directory
 * @returns True if the path is within the home directory
 */
export function isWithinHomeDirectory(checkPath: string, homeDirectory: string): boolean {
  const normalizedHome = path.resolve(homeDirectory);
  const normalizedPath = path.resolve(checkPath);

  return normalizedPath === normalizedHome ||
         normalizedPath.startsWith(normalizedHome + path.sep);
}

/**
 * Get the user's home directory
 * @returns Absolute path to the user's home directory
 */
export function getHomeDirectory(): string {
  return homedir();
}
