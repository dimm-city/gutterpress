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
  /** Bypass watcher settling for a host write that has already completed. */
  notifySettledWrite?: ((filePath: string, writtenContent: string) => void) | null;
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
   * `asset-inline.ts` embeds fonts; every image becomes
   * `assets/<contentHash><ext>`, wherever it lives — in the book, or in a
   * repo-root shared stylesheet's art folder (the normative multi-book
   * layout). The inliner returns a COPY PLAN, which the build executes into
   * its output dir. Content-addressing is what keeps a CSS image's URL
   * distinct from a prose image's; see `inlineOne`.
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
  /**
   * Every image the current render references (`onImageRefs`, the same list
   * the build plans its asset copies from), normalized to the URL path the
   * preview serves it at. A request for one whose file does not exist gets
   * the build's magenta placeholder (`placeholderPng`) instead of a 404, so
   * the preview lays out the same 640×480 box the PDF does rather than a
   * small broken-image icon — that difference moved every later page by one
   * in a real book (#354). Rebuilt on every render; exact-match lookups only.
   */
  imageRefs: Set<string>;
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
    notifySettledWrite: null,
    previewServer: null,
    isShuttingDown: false,
    tempDir,
    config,
    options,
    cssAssets: new Map(),
    imageRefs: new Set(),
  };
}
