/**
 * Preview server entry point.
 *
 * Loads config via lib/manifest, generates HTML via lib/markdown, and serves
 * the preview through a node:http + `ws` HTTP+WebSocket server (see
 * `src/preview/http-server.ts`). Live reload is handled by broadcasting
 * `full-reload` over the HMR WebSocket whenever the file watcher fires.
 */

import { info, setLogLevel } from './utils/logger';
import type { PreviewServerOptions } from './types';
import {
  validateInputPath,
  initializePreviewDirectories,
  initializeConfiguration,
  restartPreview as executeRestartPreview,
  shutdownServer,
} from './preview/lifecycle';
import { createServerState } from './preview/server-context';
import { generateAndWriteHtml, startFileWatcher } from './preview/file-watcher';
import { findAvailablePort, createPreviewServer } from './preview/http-server';

export interface PreviewServerHandle {
  url: string;
  port: number;
  host: string;
  inputPath: string;
  /** Stop the server, file watcher, and any signal handlers. */
  stop: () => Promise<void>;
  /** Switch the watched directory and regenerate HTML. */
  restart: (newInputPath: string) => Promise<void>;
  /** Rebuild immediately after a host-managed write has fully settled.
   *  `origin: "inline-edit"` suppresses the rebuild (ADR 0010) — the write
   *  is a projection of DOM the preview already shows. */
  notifySettledWrite: (filePath: string, writtenContent: string, origin?: string) => void;
}

export interface StartPreviewServerOptions extends PreviewServerOptions {
  /**
   * Install SIGINT/SIGTERM handlers that shut down the server on Ctrl+C.
   * Defaults to true (CLI usage). Library/embedded callers (Electron+SvelteKit)
   * should pass false and call handle.stop() themselves.
   */
  installSignalHandlers?: boolean;
}

/**
 * Start the preview server backed by a node:http + `ws` HTTP/WebSocket server.
 *
 * Returns a handle the caller can use to introspect the URL or stop the server.
 * CLI callers can simply ignore the handle and rely on SIGINT/SIGTERM.
 */
export async function startPreviewServer(
  options: StartPreviewServerOptions
): Promise<PreviewServerHandle> {
  // Honor --verbose/--debug (threaded in from the preview command): raise the
  // shared log level so the leveled debug() lines in the preview internals
  // actually emit. Without this, every debug() call is permanently suppressed.
  if (options.verbose || options.debug) {
    setLogLevel('DEBUG');
  }

  // Stage 1: Validate and initialize. Empty input is a deliberate "no
  // directory picked yet" mode: the server boots with a placeholder page,
  // and the desktop desktop app (packages/desktop) shows its own folder picker.
  // Compare to the previous behavior of silently defaulting to process.cwd().
  const inputPath = options.input ?? '';
  await validateInputPath(inputPath);

  if (inputPath) {
    info(`Starting preview server for: ${inputPath}`);
  } else {
    info('Starting preview server (no input directory)');
  }

  // Stage 2: Initialize configuration
  const config = await initializeConfiguration(inputPath, options.engine);

  // Stage 3: Set up the temp dir. No longer takes inputPath/config — it only
  // ever creates the (now generated-files-only) temp dir; see lifecycle.ts's
  // initializePreviewDirectories for why there is nothing left to copy.
  const tempDir = await initializePreviewDirectories();

  // Stage 4: Create state. BEFORE the initial render, because that render owns
  // `state.cssAssets` — the map the HTTP server resolves the inliner's
  // rewritten asset URLs against (see ServerState.cssAssets). Rendering first
  // and creating state after would leave the FIRST book.html's shared-art URLs
  // unresolvable until some later edit triggered a rebuild.
  const state = createServerState(inputPath, tempDir, config, options);

  // Generate initial HTML (or a placeholder when there's no input yet)
  await generateAndWriteHtml(inputPath, tempDir, config, state.cssAssets);

  // Stage 5: Define restart function
  const restartPreview = async (newInputPath: string): Promise<void> => {
    await executeRestartPreview(newInputPath, state);
  };

  // Stage 6: Find available port
  const availablePort = await findAvailablePort(options.port, options.host);
  if (availablePort !== options.port) {
    info(`Port ${options.port} is in use, using port ${availablePort} instead`);
  }

  // Stage 7: Create preview HTTP/WebSocket server
  state.previewServer = await createPreviewServer(state, availablePort);

  // Stage 8: Start file watching if enabled
  startFileWatcher(state);

  // Stage 9: Register signal handlers for Ctrl+C and SIGTERM (CLI usage).
  const installSignals = options.installSignalHandlers !== false;
  // Signal handlers terminate the process after cleanup. shutdownServer()
  // itself no longer calls process.exit() — that's the signal handler's job.
  const handleShutdown = async () => {
    await shutdownServer(state);
    process.exit(0);
  };
  if (installSignals) {
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
  }

  const host = options.host ?? '127.0.0.1';
  // Read the actually-bound port (listening on port 0 resolves to a free port).
  const boundPort = state.previewServer.port;
  return {
    url: `http://${host}:${boundPort}`,
    port: boundPort,
    host,
    inputPath,
    stop: async () => {
      if (installSignals) {
        process.off('SIGINT', handleShutdown);
        process.off('SIGTERM', handleShutdown);
      }
      await shutdownServer(state);
    },
    restart: restartPreview,
    notifySettledWrite: (filePath, writtenContent, origin) => {
      state.notifySettledWrite?.(filePath, writtenContent, origin);
    },
  };
}
