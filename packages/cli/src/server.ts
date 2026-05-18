/**
 * Preview server entry point.
 *
 * Loads config via lib/manifest, generates HTML via lib/markdown, and serves
 * the preview through a Bun-native HTTP+WebSocket server (see
 * `src/preview/http-server.ts`). Live reload is handled by broadcasting
 * `full-reload` over the HMR WebSocket whenever the file watcher fires.
 */

import { info } from './utils/logger';
import type { PreviewServerOptions } from './types';
import {
  validateInputPath,
  resolveAssetsDir,
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
 * Start the preview server backed by a Bun-native HTTP/WebSocket server.
 *
 * Returns a handle the caller can use to introspect the URL or stop the server.
 * CLI callers can simply ignore the handle and rely on SIGINT/SIGTERM.
 */
export async function startPreviewServer(
  options: StartPreviewServerOptions
): Promise<PreviewServerHandle> {
  // Stage 1: Validate and initialize. Empty input is a deliberate "no
  // directory picked yet" mode: the server boots, the browser opens, and
  // the viewer's folder picker fires automatically so the user can choose
  // a directory. Compare to the previous behavior of silently defaulting
  // to process.cwd().
  const inputPath = options.input ?? '';
  await validateInputPath(inputPath);

  if (inputPath) {
    info(`Starting preview server for: ${inputPath}`);
  } else {
    info('Starting preview server (no input directory — folder picker will open in the browser)');
  }

  // Stage 2: Initialize configuration (needed for manifest assets)
  const config = await initializeConfiguration(inputPath, options);

  // Stage 3: Setup directories (with config for manifest assets)
  const assetsSourceDir = await resolveAssetsDir();
  const tempDir = await initializePreviewDirectories(inputPath, assetsSourceDir, config);

  // Generate initial HTML (or a placeholder when there's no input yet)
  await generateAndWriteHtml(inputPath, tempDir, config);

  // Stage 4: Create state
  const state = createServerState(inputPath, tempDir, assetsSourceDir, config, options);

  // Stage 5: Define restart function
  const restartPreview = async (newInputPath: string): Promise<void> => {
    await executeRestartPreview(newInputPath, state);
  };

  // Stage 6: Find available port
  const availablePort = await findAvailablePort(options.port);
  if (availablePort !== options.port) {
    info(`Port ${options.port} is in use, using port ${availablePort} instead`);
  }

  // Stage 7: Create preview HTTP/WebSocket server
  state.previewServer = await createPreviewServer(
    state,
    availablePort,
    restartPreview
  );

  // Stage 8: Start file watching if enabled
  startFileWatcher(state);

  // Stage 9: Register signal handlers for Ctrl+C and SIGTERM (CLI usage).
  const installSignals = options.installSignalHandlers !== false;
  const handleShutdown = async () => {
    await shutdownServer(state);
  };
  if (installSignals) {
    process.on('SIGINT', handleShutdown);
    process.on('SIGTERM', handleShutdown);
  }

  const host = options.host ?? '127.0.0.1';
  // Read the actually-bound port (Bun resolves port:0 to a free port).
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
  };
}
