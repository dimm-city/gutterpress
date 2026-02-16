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
import { loadPlugins, collectPluginCss } from '../lib/markdown/plugins';
import type { ServerState } from './server-context';
import { BREAK_INSIDE_HANDLER } from '../lib/pagedjs';

/**
 * Generate HTML from markdown and write preview.html to temp directory.
 * renderChapters() does all the work (CSS, Paged.js script).
 * We only inject the toolbar interface script.
 */
export async function generateAndWriteHtml(
  inputPath: string,
  tempDir: string,
  config: { title?: string; styles?: string[]; source?: { files?: string[] | null }; plugins?: any[] }
): Promise<void> {
  // Load plugins if configured
  let plugins;
  let pluginCss = '';
  if (config.plugins && config.plugins.length > 0) {
    plugins = await loadPlugins(config.plugins, inputPath);
    pluginCss = collectPluginCss(plugins);
  }

  const html = await renderChapters(inputPath, {
    title: config.title ?? "Document",
    styles: config.styles,
    files: config.source?.files ?? null,
    plugins,
    pluginCss,
  });

  // Read debug CSS to inline it (Vite's <link> transformation breaks CSS in iframes)
  const debugCssPath = path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'assets', 'preview', 'styles', 'debug.css');
  let debugCss = '';
  try {
    debugCss = await Bun.file(debugCssPath).text();
  } catch { /* debug CSS is optional */ }

  // Inject interface script + debug CSS + break-inside polyfill before Paged.js polyfill
  // Debug CSS is injected via JS to bypass Vite's <style> tag transformation which strips CSS
  const escapedDebugCss = debugCss.replace(/\\/g, '\\\\').replace(/`/g, '\\`').replace(/\$/g, '\\$');
  const iface = '<script src="/preview/scripts/pagedjs-interface.js"></script>\n  '
    + (debugCss ? `<script>(function(){var s=document.createElement("style");s.setAttribute("data-debug-css","true");s.textContent=\`${escapedDebugCss}\`;document.head.appendChild(s)})()</script>\n  ` : '');
  const output = html.replace(
    '<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>',
    iface + BREAK_INSIDE_HANDLER + '\n  <script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>'
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

        // Re-copy changed file to temp directory
        if (filePath.startsWith(state.currentInputPath)) {
          const relativePath = path.relative(state.currentInputPath, filePath);
          const destPath = path.join(state.tempDir, relativePath);
          const { mkdir } = await import('node:fs/promises');
          await mkdir(path.dirname(destPath), { recursive: true });
          await Bun.write(destPath, Bun.file(filePath));
          debug(`Updated: ${relativePath}`);
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
