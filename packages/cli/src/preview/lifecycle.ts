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
import { mkdir, remove, fileExists } from '../utils/file-utils';
import { info, debug } from '../utils/logger';
import { loadManifest, resolveConfig } from '../lib/manifest';
import type { ResolvedConfig } from '../schema/manifest.types';
import type { ServerState } from './server-context';
import { generateAndWriteHtml, stopFileWatcher, startFileWatcher } from './file-watcher';

const TEMP_DIR_BASE = path.join(tmpdir(), 'gutterpress-preview');
const PID_FILE_NAME = '.gutterpress.pid';

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
 * Each live preview writes its PID to `<tempDir>/.gutterpress.pid` after setup.
 * On startup we walk the base dir and remove any subdirectory whose recorded
 * PID is no longer alive. Dirs without a PID file are conservatively kept
 * (they may belong to an older gutterpress version still in flight).
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
 * Initialize the preview's temp directory.
 *
 * SERVE-IN-PLACE (this replaces the old whole-tree `copyDirectory(inputPath,
 * tempDir)` + manifest-asset `copyAssets` call): the temp dir is no longer a
 * mirror of the project. It holds ONLY files gutterpress itself generates — right
 * now that's `book.html` (written later by {@link generateAndWriteHtml}) and
 * the PID marker file below. Every other path the served HTML asks for
 * (images, anything else under the project) is read straight from the
 * project directory by the HTTP server (see http-server.ts) — the project is
 * never copied anywhere.
 *
 * This is what makes preview asset resolution identical to the build's BY
 * CONSTRUCTION: both read the same real files off the same real project tree,
 * so there is no separate copy step that can drift from what a build actually
 * ships (the "works in preview, broken in the PDF" bug class). It also means
 * a project's `.env`, `.git`, or any other dotfile is never duplicated into a
 * world-readable temp dir the way the old whole-tree copy did — see
 * http-server.ts's dotfile guard, which is what stands between a request and
 * the project's real dotfiles now that the project is served directly.
 *
 * No longer takes `inputPath`/`config` — both were needed only for the copy
 * steps removed above, and there is nothing left to configure here.
 */
export async function initializePreviewDirectories(): Promise<string> {
  // Reap any orphan temp dirs from previous runs before creating ours.
  await cleanupOrphanTempDirs();

  const tempDirSuffix = randomBytes(8).toString('hex');
  const tempDir = path.join(TEMP_DIR_BASE, tempDirSuffix);
  await mkdir(tempDir);
  debug(`Created temporary directory: ${tempDir}`);

  // Mark this dir as ours so a future startup can detect orphan-ship.
  await writeFile(path.join(tempDir, PID_FILE_NAME), `${process.pid}\n`, 'utf8');

  // Preview assets (the native engine's viewer bundle, preview-bridge.js,
  // preview-interface.js, favicon) are served directly from the process-wide
  // embedded-assets dir by
  // the HTTP server (see http-server.ts EMBEDDED_PREFIXES/EMBEDDED_EXACT), not
  // copied into the per-project temp dir. manifest.schema.json is embedded too
  // but is NOT served or read at runtime — it is editor-facing only (authors
  // reference it via a `# yaml-language-server: $schema=` comment; see
  // docs/schema-autocomplete.md).

  return tempDir;
}

/**
 * Validate that the input path exists on the filesystem.
 * No-op for empty input (no-input mode — the desktop desktop app
 * supplies the path via its own folder picker).
 */
export async function validateInputPath(inputPath: string): Promise<void> {
  if (!inputPath) return;
  if (!(await fileExists(inputPath))) {
    throw new Error(`Input path not found: ${inputPath}`);
  }
}

/**
 * Initialize configuration by loading manifest and resolving config.
 * For empty input (no-input mode), skip manifest loading entirely and
 * return a default resolved config.
 */
export async function initializeConfiguration(
  inputPath: string,
  engine?: "paged" | "native",
): Promise<ResolvedConfig> {
  if (!inputPath) return resolveConfig({ engine }, {});
  const manifest = await loadManifest(inputPath);
  return resolveConfig({ engine }, manifest);
}

/**
 * Restart the preview server with a new input directory.
 *
 * SERVE-IN-PLACE makes this trivially correct where the old copy-based
 * version was not: the HTTP server (http-server.ts) reads `state.
 * currentInputPath` fresh on every request instead of serving a stale mirror,
 * so repointing that one field IS the switch — there is no per-project copy
 * to redo, and therefore no old project's files left behind in the (now
 * shared-nothing, generated-files-only) temp dir the way the previous
 * `copyDirectory(newInputPath, state.tempDir)` could leave a stale mix of two
 * projects' content if it partially failed.
 */
export async function restartPreview(newInputPath: string, state: ServerState): Promise<void> {
  info(`Restarting preview for: ${newInputPath}`);

  await stopFileWatcher(state);

  state.currentInputPath = newInputPath;

  const manifest = await loadManifest(newInputPath);
  state.config = resolveConfig({ engine: state.options.engine }, manifest);

  await generateAndWriteHtml(newInputPath, state.tempDir, state.config, state.cssAssets);

  startFileWatcher(state);

  // The browser is on the old index — push a reload so it picks up the
  // new directory's content immediately.
  state.previewServer?.broadcastReload();

  info('Preview restarted successfully');
}

/**
 * Wrap a promise with a timeout so a misbehaving close step (chokidar
 * occasionally hangs on close) cannot prevent the temp-dir cleanup from running.
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
 * `previewServer.close()` blocking on a stuck WebSocket client) cannot
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

  if (state.previewServer) {
    try {
      await withTimeout(state.previewServer.close(), 2000, 'previewServer.close');
    } catch (err) {
      debug(`previewServer.close failed during shutdown: ${err}`);
    }
  }

  try {
    await remove(state.tempDir);
  } catch (err) {
    debug(`Failed to remove temp dir ${state.tempDir}: ${err}`);
  }

  info('Server stopped. You can close this browser window.');
  // NOTE: callers that need process termination (signal handlers in server.ts)
  // are responsible for calling process.exit() themselves. shutdownServer()
  // only cleans up — it does not decide to terminate the process, so that the
  // desktop's PreviewServerHandle.stop() can call this safely without killing
  // the SvelteKit host process.
}
