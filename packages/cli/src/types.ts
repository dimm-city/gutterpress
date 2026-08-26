/**
 * Shared TypeScript interfaces for the Gutterpress CLI
 *
 * Core types used by the preview server and CLI commands.
 * Build pipeline types are in src/schema/manifest.types.ts.
 */

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
  /**
   * CLI `--engine` override, fed into {@link resolveConfig} the same way
   * `build`'s does — preview and PDF switch together, per project, behind
   * one flag. `undefined` defers to the
   * manifest's `engine:` field (or the "native" default).
   */
  engine?: "paged" | "native";
}
