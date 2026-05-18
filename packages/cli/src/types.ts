/**
 * Shared TypeScript interfaces for print-md CLI
 *
 * Core types used by the preview server and CLI commands.
 * Build pipeline types are in src/schema/manifest.types.ts.
 */

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
  /**
   * Hostname to bind to. Defaults to `127.0.0.1` (localhost only).
   * Pass `0.0.0.0` to expose the server on the local network — opt-in
   * because the preview serves whatever the user is editing, which may
   * include unfinished or private content.
   */
  host: string;
  /** Enable verbose logging */
  verbose: boolean;
  /** Disable file watching */
  noWatch: boolean;
  /** Automatically open browser (default: true) */
  openBrowser: boolean;
}

