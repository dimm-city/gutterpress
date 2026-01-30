/**
 * Server lifecycle management
 *
 * Handles startup, restart, shutdown, and client connection tracking.
 * Uses the simplified manifest + config pipeline from lib/manifest.
 */

import path from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { mkdir, remove, copyDirectory, fileExists } from '../utils/file-utils';
import { info, debug } from '../utils/logger';
import { loadManifest, resolveConfig } from '../lib/manifest';
import type { PreviewServerOptions } from '../types';
import type { ResolvedConfig } from '../schema/manifest.types';
import type { ServerState, ClientTracker } from './server-context';
import { generateAndWriteHtml, stopFileWatcher, startFileWatcher } from './file-watcher';

/**
 * Initialize preview directories and copy source files
 */
export async function initializePreviewDirectories(
  inputPath: string,
  assetsSourceDir: string
): Promise<string> {
  const tempDirBase = path.join(tmpdir(), 'pagedmd-preview');
  const tempDirSuffix = randomBytes(8).toString('hex');
  const tempDir = path.join(tempDirBase, tempDirSuffix);
  await mkdir(tempDir);
  debug(`Created temporary directory: ${tempDir}`);

  await copyDirectory(inputPath, tempDir);
  debug(`Copied input files to ${tempDir}`);

  await copyDirectory(assetsSourceDir, tempDir);
  debug(`Copied preview assets to ${tempDir}`);

  return tempDir;
}

/**
 * Resolve the preview assets directory path
 */
export function resolveAssetsDir(): string {
  const thisFileDir = path.dirname(new URL(import.meta.url).pathname);
  return path.join(thisFileDir, '..', 'assets');
}

/**
 * Validate that the input path exists on the filesystem
 */
export async function validateInputPath(inputPath: string): Promise<void> {
  if (!(await fileExists(inputPath))) {
    throw new Error(`Input path not found: ${inputPath}`);
  }
}

/**
 * Initialize configuration by loading manifest and resolving config
 */
export async function initializeConfiguration(
  inputPath: string,
  _options: PreviewServerOptions
): Promise<ResolvedConfig> {
  const manifest = await loadManifest(inputPath);
  return resolveConfig({}, manifest);
}

/**
 * Restart the preview server with a new input directory
 */
export async function restartPreview(newInputPath: string, state: ServerState): Promise<void> {
  info(`Restarting preview for: ${newInputPath}`);

  await stopFileWatcher(state);

  state.currentInputPath = newInputPath;

  // Only re-copy the input content — preview assets are already in the temp dir
  // and re-copying them triggers Vite to full-reload index.html, killing the browser session
  await copyDirectory(newInputPath, state.tempDir);

  const manifest = await loadManifest(newInputPath);
  state.config = resolveConfig({}, manifest);

  await generateAndWriteHtml(newInputPath, state.tempDir, state.config);

  startFileWatcher(state);

  info('Preview restarted successfully');
}

/**
 * Check client connections and schedule automatic server shutdown if needed
 */
export function checkForAutoShutdown(
  clientTracker: ClientTracker,
  shutdownFn: () => Promise<void>
): void {
  if (clientTracker.connectedClients.size === 0) {
    if (clientTracker.autoShutdownTimer) {
      clearTimeout(clientTracker.autoShutdownTimer);
    }

    info(
      `All clients disconnected. Server will shutdown in ${clientTracker.AUTO_SHUTDOWN_DELAY / 1000}s...`
    );
    clientTracker.autoShutdownTimer = setTimeout(() => {
      if (clientTracker.connectedClients.size === 0) {
        info('No clients reconnected. Shutting down...');
        void shutdownFn();
      }
    }, clientTracker.AUTO_SHUTDOWN_DELAY);
  } else {
    if (clientTracker.autoShutdownTimer) {
      clearTimeout(clientTracker.autoShutdownTimer);
      clientTracker.autoShutdownTimer = null;
    }
  }
}

/**
 * Perform graceful server shutdown and cleanup
 */
export async function shutdownServer(state: ServerState, clientTracker: ClientTracker): Promise<void> {
  if (state.isShuttingDown) return;
  state.isShuttingDown = true;

  if (clientTracker.autoShutdownTimer) {
    clearTimeout(clientTracker.autoShutdownTimer);
    clientTracker.autoShutdownTimer = null;
  }

  info('\nShutting down preview server...');
  await stopFileWatcher(state);
  if (state.viteServer) await state.viteServer.close();
  await remove(state.tempDir);
  info('Server stopped. You can close this browser window.');
  process.exit(0);
}
