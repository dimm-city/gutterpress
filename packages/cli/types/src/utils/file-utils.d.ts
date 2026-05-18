/**
 * Simplified file utilities - core file I/O only
 *
 * Provides essential file operations: read, write, resolve paths, check existence
 */
import { type Dirent } from 'fs';
/**
 * Read a file as UTF-8 text
 * @throws Error if file doesn't exist or can't be read
 */
export declare function readFile(filePath: string): Promise<string>;
/**
 * Write content to a file, creating parent directories if needed
 */
export declare function writeFile(filePath: string, content: string): Promise<void>;
/**
 * Resolve a file path to absolute
 * If already absolute, returns as-is
 * If relative, resolves from current working directory
 */
export declare function resolveAbsolutePath(filePath: string): string;
/**
 * Check if a file exists
 */
export declare function fileExists(filePath: string): Promise<boolean>;
/**
 * Remove a directory or file recursively
 * Safe to call even if path doesn't exist
 */
export declare function remove(targetPath: string): Promise<void>;
/**
 * Create a directory, including parent directories if needed
 */
export declare function mkdir(dirPath: string): Promise<void>;
/**
 * Check if a path is a directory
 */
export declare function isDirectory(targetPath: string): Promise<boolean>;
/**
 * Read all files in a directory
 * @param dirPath Directory path to read
 * @returns Array of directory entries
 */
export declare function readDirectory(dirPath: string): Promise<Dirent[]>;
/**
 * Copy a directory recursively with comprehensive error handling
 *
 * Attempts to copy all files even if some fail. Collects all errors and reports them
 * together at the end, allowing the caller to decide if partial success is acceptable.
 * Symlinks are skipped to avoid ENOENT/ENOTSUP errors.
 *
 * @param src Source directory path
 * @param dest Destination directory path
 * @param options Copy options
 * @param options.overwrite Whether to overwrite existing files (default: true)
 * @param options.exclude Directory names to skip (default: node_modules, .git, .claude, etc.)
 * @throws {Error} If source doesn't exist or isn't a directory
 * @throws {BuildError} If any files fail to copy (includes details of all failures)
 */
export declare function copyDirectory(src: string, dest: string, options?: {
    overwrite?: boolean;
    exclude?: Set<string>;
}): Promise<void>;
/**
 * Wait for a file to be created
 * Polls for file existence with exponential backoff
 *
 * @param filePath - Path to file to wait for
 * @param options - Configuration options
 * @param options.timeout - Maximum wait time in milliseconds (default: 10000)
 * @param options.interval - Initial polling interval in milliseconds (default: 10)
 * @returns Promise that resolves when file exists
 * @throws {Error} If timeout is reached before file appears
 */
export declare function waitForFile(filePath: string, options?: {
    timeout?: number;
    interval?: number;
}): Promise<void>;
