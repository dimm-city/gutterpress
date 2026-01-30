/**
 * Shared TypeScript interfaces for pagedmd CLI
 *
 * Core types used by the preview server and CLI commands.
 * Build pipeline types are in src/schema/manifest.types.ts.
 */

import type { ServerWebSocket } from 'bun';

// Re-export manifest types for convenience
export type { PrintMdManifest, ResolvedConfig } from './schema/manifest.types';

/**
 * Options for preview server (internal)
 */
export interface PreviewServerOptions {
  /** Input markdown file path or directory (optional, defaults to cwd) */
  input?: string;
  /** Debug mode (preserve temporary files) */
  debug?: boolean;
  /** Port for preview server */
  port: number;
  /** Enable verbose logging */
  verbose: boolean;
  /** Disable file watching */
  noWatch: boolean;
  /** Automatically open browser (default: true) */
  openBrowser: boolean;
}

/**
 * Directory entry for folder navigation
 */
export interface DirectoryEntry {
  /** Directory name */
  name: string;
  /** Full path to directory */
  path: string;
}

/**
 * API response for directory listing
 */
export interface DirectoryListResponse {
  /** Current path being listed */
  currentPath: string;
  /** User's home directory */
  homeDirectory: string;
  /** Whether current path is the home directory */
  isAtHome: boolean;
  /** Parent directory path (undefined if at home or if parent is outside home) */
  parent?: string;
  /** List of subdirectories */
  directories: DirectoryEntry[];
}

/**
 * API response for folder change
 */
export interface FolderChangeResponse {
  /** Whether the operation succeeded */
  success: boolean;
  /** New path (if successful) */
  path?: string;
  /** Error message (if failed) */
  error?: string;
}

/**
 * API response for current folder
 */
export interface CurrentFolderResponse {
  /** Current input path (file or directory) */
  path: string;
  /** Current input directory */
  directory: string;
}

/**
 * API response for metadata
 */
export interface MetadataResponse {
  /** Title from manifest (if present) */
  title: string | null;
  /** Folder name */
  folderName: string;
  /** Display title (manifest title or folder name) */
  displayTitle: string;
  /** Error message (if metadata loading failed) */
  error?: string;
}
