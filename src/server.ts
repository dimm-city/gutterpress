/**
 * Preview server using Vite with custom API middleware
 *
 * Loads config via lib/manifest and generates HTML via lib/markdown.
 * Vite provides HMR for live preview updates.
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
import { findAvailablePort, createConfiguredViteServer } from './preview/vite-setup';

/**
 * Start preview server with Vite as primary server
 */
export async function startPreviewServer(options: PreviewServerOptions): Promise<void> {
  // Stage 1: Validate and initialize
  const inputPath = options.input || process.cwd();
  await validateInputPath(inputPath);

  info(`Starting preview server for: ${inputPath}`);

  // Stage 2: Setup directories
  const assetsSourceDir = resolveAssetsDir();
  const tempDir = await initializePreviewDirectories(inputPath, assetsSourceDir);

  // Stage 3: Initialize configuration
  const config = await initializeConfiguration(inputPath, options);

  // Generate initial HTML
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

  // Stage 7: Create Vite server with middleware
  state.viteServer = await createConfiguredViteServer(
    state,
    availablePort,
    restartPreview
  );

  // Stage 8: Start file watching if enabled
  startFileWatcher(state);

  // Stage 9: Register signal handlers for Ctrl+C and SIGTERM
  const handleShutdown = async () => {
    await shutdownServer(state);
  };
  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}
