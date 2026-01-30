/**
 * File watcher setup and management for preview server
 *
 * Handles watching input files and triggering rebuilds on changes.
 * Uses the simplified markdown pipeline (renderChapters from lib/markdown).
 */

import { watch, type FSWatcher } from 'chokidar';
import path from 'path';
import { info, debug, error as logError } from '../utils/logger';
import { DEBOUNCE } from '../constants';
import { renderChapters } from '../lib/markdown/index';
import { loadManifest, resolveConfig } from '../lib/manifest';
import type { ServerState } from './server-context';

/**
 * Generate HTML from markdown and write preview.html to temp directory.
 * renderChapters() does all the work (CSS, Paged.js script).
 * We only inject the toolbar interface script.
 */
export async function generateAndWriteHtml(
  inputPath: string,
  tempDir: string,
  config: { title?: string; source?: { css?: string } }
): Promise<void> {
  const html = await renderChapters(inputPath, {
    title: config.title ?? "Document",
    cssPath: config.source?.css,
  });

  // Inject interface script before Paged.js polyfill so PagedConfig.after is set first
  const iface = '<script src="/preview/scripts/pagedjs-interface.js"></script>\n  ';
  const output = html.replace(
    '<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>',
    iface + '<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>'
  );

  await Bun.write(path.join(tempDir, 'preview.html'), output);
}

/**
 * Create and configure a file watcher for the input directory
 */
export function createFileWatcher(state: ServerState): FSWatcher {
  const watcher = watch(state.currentInputPath, {
    persistent: true,
    ignoreInitial: true,
    ignored: /(^|[\/\\])\../, // Ignore dot files
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });

  let rebuildTimer: NodeJS.Timeout | null = null;

  watcher.on('all', async (event, filePath) => {
    debug(`File ${event}: ${filePath}`);

    if (rebuildTimer) clearTimeout(rebuildTimer);

    rebuildTimer = setTimeout(async () => {
      if (state.isRebuilding) return;

      state.isRebuilding = true;
      try {
        info('Regenerating preview...');

        // Re-copy changed file if relevant
        if (
          filePath.endsWith('.md') ||
          filePath.endsWith('.yaml') ||
          filePath.endsWith('.yml')
        ) {
          if (filePath.startsWith(state.currentInputPath)) {
            const relativePath = path.relative(state.currentInputPath, filePath);
            const destPath = path.join(state.tempDir, relativePath);
            const { mkdir } = await import('node:fs/promises');
            await mkdir(path.dirname(destPath), { recursive: true });
            await Bun.write(destPath, Bun.file(filePath));
            debug(`Updated: ${relativePath}`);
          }
        }

        // Reload config and regenerate
        const manifest = await loadManifest(state.currentInputPath);
        const updatedConfig = resolveConfig({}, manifest);
        state.config = updatedConfig;
        await generateAndWriteHtml(state.currentInputPath, state.tempDir, updatedConfig);

        info('Preview updated');
      } catch (err) {
        logError('Failed to regenerate preview:', err);
      } finally {
        state.isRebuilding = false;
      }
    }, DEBOUNCE.FILE_WATCH);
  });

  info('Watching for file changes...');
  return watcher;
}

/**
 * Start file watching if not disabled via options
 */
export function startFileWatcher(state: ServerState): void {
  if (!state.options.noWatch) {
    state.currentWatcher = createFileWatcher(state);
  }
}

/**
 * Stop the file watcher and clean up resources
 */
export async function stopFileWatcher(state: ServerState): Promise<void> {
  if (state.currentWatcher) {
    await state.currentWatcher.close();
    state.currentWatcher = null;
  }
}
