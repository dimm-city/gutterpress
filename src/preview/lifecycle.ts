/**
 * Server lifecycle management
 *
 * Handles startup, restart, shutdown, and client connection tracking.
 * Uses the simplified manifest + config pipeline from lib/manifest.
 */

import path from 'path';
import { tmpdir } from 'os';
import { randomBytes } from 'crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { mkdir, remove, copyDirectory, fileExists } from '../utils/file-utils';
import { info, debug } from '../utils/logger';
import { loadManifest, resolveConfig } from '../lib/manifest';
import { copyAssets } from '../lib/assets';
import type { PreviewServerOptions } from '../types';
import type { ResolvedConfig } from '../schema/manifest.types';
import type { ServerState } from './server-context';
import { generateAndWriteHtml, stopFileWatcher, startFileWatcher } from './file-watcher';

const TEMP_DIR_BASE = path.join(tmpdir(), 'print-md-preview');
const PID_FILE_NAME = '.print-md.pid';

/**
 * Check whether a process is alive by sending signal 0.
 * Returns false for any error (ESRCH = no such process, EPERM = exists but
 * not ours, which we treat as "not ours, leave alone").
 */
function isProcessAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/**
 * Best-effort cleanup of orphan preview temp dirs left behind by previous
 * runs that didn't shut down cleanly (SIGKILL, terminal hangup, crash, etc).
 *
 * Each live preview writes its PID to `<tempDir>/.print-md.pid` after setup.
 * On startup we walk the base dir and remove any subdirectory whose recorded
 * PID is no longer alive. Dirs without a PID file are conservatively kept
 * (they may belong to an older print-md version still in flight).
 */
async function cleanupOrphanTempDirs(): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(TEMP_DIR_BASE);
  } catch {
    return; // base dir doesn't exist yet — nothing to clean
  }
  for (const entry of entries) {
    const dir = path.join(TEMP_DIR_BASE, entry);
    const pidFile = path.join(dir, PID_FILE_NAME);
    try {
      const raw = await readFile(pidFile, 'utf8');
      const pid = parseInt(raw.trim(), 10);
      if (!isProcessAlive(pid)) {
        debug(`Removing orphan temp dir ${dir} (pid ${pid} not alive)`);
        await remove(dir);
      }
    } catch {
      // No PID file — leave it alone to be safe.
    }
  }
}

/**
 * Initialize preview directories and copy source files
 */
export async function initializePreviewDirectories(
  inputPath: string,
  assetsSourceDir: string,
  config?: ResolvedConfig
): Promise<string> {
  // Reap any orphan temp dirs from previous runs before creating ours.
  await cleanupOrphanTempDirs();

  const tempDirSuffix = randomBytes(8).toString('hex');
  const tempDir = path.join(TEMP_DIR_BASE, tempDirSuffix);
  await mkdir(tempDir);
  debug(`Created temporary directory: ${tempDir}`);

  // Mark this dir as ours so a future startup can detect orphan-ship.
  await writeFile(path.join(tempDir, PID_FILE_NAME), `${process.pid}\n`, 'utf8');

  await copyDirectory(inputPath, tempDir);
  debug(`Copied input files to ${tempDir}`);

  await copyDirectory(assetsSourceDir, tempDir);
  debug(`Copied preview assets to ${tempDir}`);

  // Copy manifest assets (e.g., ../_shared directories)
  if (config?.source?.assets) {
    await copyAssets(inputPath, tempDir, config.source.assets, {
      onCopy: (assetPath) => debug(`Copied manifest asset: ${assetPath}`),
      onSkip: (assetPath, srcPath) => debug(`Manifest asset not found: ${srcPath} (skipping)`),
    });
  }

  return tempDir;
}

/**
 * Resolve the preview assets directory path. In dev this is `src/assets`;
 * in the standalone binary the assets are extracted to a temp dir so they
 * can be served from a real filesystem path.
 */
export async function resolveAssetsDir(): Promise<string> {
  const { getAssetsDir } = await import('../lib/embedded-assets');
  return getAssetsDir();
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
 * Wrap a promise with a timeout so a misbehaving close step (Vite/chokidar
 * occasionally hang on close) cannot prevent the temp-dir cleanup from running.
 */
async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T | undefined> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => {
      debug(`shutdownServer: ${label} exceeded ${ms}ms — continuing`);
      resolve(undefined);
    }, ms);
  });
  try {
    return (await Promise.race([p, timeout])) as T | undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/**
 * Perform graceful server shutdown and cleanup.
 *
 * Each step runs independently so that a hang or throw in one (e.g.
 * `viteServer.close()` blocking on a stuck WebSocket client) cannot
 * prevent the temp-dir from being removed. Without this discipline,
 * SIGTERM during a wedged close leaks ~1GB of `/tmp` per session.
 */
export async function shutdownServer(state: ServerState): Promise<void> {
  if (state.isShuttingDown) return;
  state.isShuttingDown = true;

  info('\nShutting down preview server...');

  try {
    await withTimeout(stopFileWatcher(state), 2000, 'stopFileWatcher');
  } catch (err) {
    debug(`stopFileWatcher failed during shutdown: ${err}`);
  }

  if (state.viteServer) {
    try {
      await withTimeout(state.viteServer.close(), 2000, 'viteServer.close');
    } catch (err) {
      debug(`viteServer.close failed during shutdown: ${err}`);
    }
  }

  try {
    await remove(state.tempDir);
  } catch (err) {
    debug(`Failed to remove temp dir ${state.tempDir}: ${err}`);
  }

  info('Server stopped. You can close this browser window.');
  process.exit(0);
}
