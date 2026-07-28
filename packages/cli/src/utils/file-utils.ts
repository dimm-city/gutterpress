/**
 * Simplified file utilities - core file I/O only
 *
 * Provides essential file operations: read, write, resolve paths, check existence
 */

import { promises as fs, type Dirent } from 'fs';
import path from 'path';

/**
 * Read a file as UTF-8 text
 * @throws Error if file doesn't exist or can't be read
 */
export async function readFile(filePath: string): Promise<string> {
  return await fs.readFile(filePath, 'utf-8');
}

/**
 * Write content to a file, creating parent directories if needed
 */
export async function writeFile(filePath: string, content: string): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, content, 'utf-8');
}

/**
 * Check if a file exists
 */
export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Remove a directory or file recursively
 * Safe to call even if path doesn't exist
 */
export async function remove(targetPath: string): Promise<void> {
  await fs.rm(targetPath, { recursive: true, force: true });
}

/**
 * Create a directory, including parent directories if needed
 */
export async function mkdir(dirPath: string): Promise<void> {
  await fs.mkdir(dirPath, { recursive: true });
}

/**
 * Check if a path is a directory
 */
export async function isDirectory(targetPath: string): Promise<boolean> {
  try {
    const stats = await fs.stat(targetPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Read all files in a directory
 * @param dirPath Directory path to read
 * @returns Array of directory entries
 */
export async function readDirectory(dirPath: string): Promise<Dirent[]> {
  return await fs.readdir(dirPath, { withFileTypes: true });
}

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
export async function waitForFile(
  filePath: string,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 10000, interval: initialInterval = 10 } = options;
  const startTime = Date.now();
  let interval = initialInterval;
  const maxInterval = 500;

  while (Date.now() - startTime < timeout) {
    if (await fileExists(filePath)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
    // Exponential backoff: 10ms -> 20ms -> 40ms -> ... -> 500ms
    interval = Math.min(interval * 2, maxInterval);
  }

  throw new Error(
    `Timeout waiting for file ${filePath} (waited ${timeout}ms)`
  );
}
