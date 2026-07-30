/**
 * Preview server context and state management
 */

import type { FSWatcher } from 'chokidar';
import type { PreviewServerOptions } from '../types';
import type { ResolvedConfig } from '../schema/manifest.types';
import type { PreviewServer } from './http-server';

/**
 * Server lifecycle state
 */
export interface ServerState {
  /** Current input directory being previewed */
  currentInputPath: string;
  /** File watcher instance */
  currentWatcher: FSWatcher | null;
  /** Pending debounced rebuild timer scheduled by the file watcher */
  rebuildTimer: NodeJS.Timeout | null;
  /** Is currently rebuilding? (prevents overlapping builds) */
  isRebuilding: boolean;
  /** Active rebuild, awaited before a project restart closes its watcher. */
  rebuildPromise?: Promise<void> | null;
  /** node:http + `ws` preview HTTP/WebSocket server instance */
  previewServer: PreviewServer | null;
  /** Is server shutting down? (prevents multiple shutdown calls) */
  isShuttingDown: boolean;
  /** Temporary directory for preview files */
  tempDir: string;
  /** Resolved configuration */
  config: ResolvedConfig;
  /** Server options */
  options: PreviewServerOptions;
  /**
   * Files the inlined CSS references but could not embed, as
   * `book.html`-relative URL path → absolute source path.
   *
   * `asset-inline.ts` embeds fonts and images up to
   * `IMAGE_INLINE_MAX_BYTES`; anything larger keeps its project-relative path
   * (if it lives in the book) or becomes `assets/<contentHash><ext>` (if it
   * does not — e.g. art referenced from a repo-root shared stylesheet, the
   * normative multi-book layout). Either way the inliner returns a COPY PLAN,
   * which the build executes into its output dir.
   *
   * The preview serves the project in place and has no output dir, so a
   * rewritten `assets/<hash>` URL had nothing behind it and shared art
   * rendered broken in the live preview while building correctly. Keeping the
   * plan here lets the server resolve those URLs straight from their real
   * location — same URL as the build, still nothing copied.
   *
   * Rebuilt from scratch on every render, so a stylesheet edit that drops an
   * image drops its URL too. Exact-match lookups only: never a path-traversal
   * surface.
   */
  cssAssets: Map<string, string>;
}

/**
 * Create initial server state
 */
export function createServerState(
  inputPath: string,
  tempDir: string,
  config: ResolvedConfig,
  options: PreviewServerOptions
): ServerState {
  return {
    currentInputPath: inputPath,
    currentWatcher: null,
    rebuildTimer: null,
    isRebuilding: false,
    rebuildPromise: null,
    previewServer: null,
    isShuttingDown: false,
    tempDir,
    config,
    options,
    cssAssets: new Map(),
  };
}
