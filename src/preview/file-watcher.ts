/**
 * File watcher setup and management for preview server
 *
 * Handles watching input files and triggering rebuilds on changes.
 * Uses the simplified markdown pipeline (renderChapters from lib/markdown).
 */

import { watch, type FSWatcher } from 'chokidar';
import { existsSync } from 'node:fs';
import path from 'path';
import { info, debug, error as logError } from '../utils/logger';
import { DEBOUNCE } from '../constants';
import { renderChapters } from '../lib/markdown/index';
import { loadManifest, resolveConfig } from '../lib/manifest';
import { loadPlugins, collectPluginCss } from '../lib/markdown/plugins';
import { resolveAssetDestName } from '../lib/assets';
import type { ServerState } from './server-context';
import { BREAK_INSIDE_HANDLER } from '../lib/pagedjs';

/**
 * Build the list of asset roots that live outside the input path and need
 * their own file watcher (e.g. a `../_shared` directory shared across books).
 *
 * Each entry maps an absolute source root on disk to the basename used as its
 * directory inside the temp dir — matching the layout produced by
 * `copyAssets` at startup.
 */
function resolveExternalAssetRoots(
  inputPath: string,
  assets: string[] | undefined | null
): { src: string; destName: string }[] {
  if (!assets || assets.length === 0) return [];
  const inputResolved = path.resolve(inputPath);
  const roots: { src: string; destName: string }[] = [];
  for (const assetPath of assets) {
    const src = path.resolve(path.join(inputPath, assetPath));
    if (!existsSync(src)) continue;
    // Skip assets that live inside inputPath — already covered by the main watcher.
    if (src === inputResolved || src.startsWith(inputResolved + path.sep)) continue;
    roots.push({ src, destName: resolveAssetDestName(assetPath) });
  }
  return roots;
}

/**
 * Find which watch root a changed file belongs to and compute the
 * corresponding destination path inside the temp dir.
 */
function resolveDestinationForChange(
  filePath: string,
  inputPath: string,
  tempDir: string,
  externalRoots: { src: string; destName: string }[]
): { destPath: string; relativePath: string } | null {
  if (filePath === inputPath || filePath.startsWith(inputPath + path.sep)) {
    const relativePath = path.relative(inputPath, filePath);
    return { destPath: path.join(tempDir, relativePath), relativePath };
  }
  for (const root of externalRoots) {
    if (filePath === root.src || filePath.startsWith(root.src + path.sep)) {
      const relInRoot = path.relative(root.src, filePath);
      const relativePath = path.join(root.destName, relInRoot);
      return { destPath: path.join(tempDir, relativePath), relativePath };
    }
  }
  return null;
}

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
 * Create and configure a file watcher for the input directory.
 *
 * Watches the project's input path AND any manifest-declared asset roots
 * that live outside it (e.g. a sibling `../_shared` directory). Without the
 * external roots, edits to shared CSS like `_shared/css/core/05-components.css`
 * are never mirrored into the temp dir and Vite never sees the change.
 */
export function createFileWatcher(state: ServerState): FSWatcher {
  const inputResolved = path.resolve(state.currentInputPath);
  const externalRoots = resolveExternalAssetRoots(
    state.currentInputPath,
    state.config?.source?.assets
  );
  for (const root of externalRoots) {
    debug(`Also watching external asset root: ${root.src} -> ${root.destName}/`);
  }

  const watchTargets = [inputResolved, ...externalRoots.map((r) => r.src)];
  const watcher = watch(watchTargets, {
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

        // Re-copy changed file to temp directory — handles both files inside
        // the input path and files inside any external asset root.
        const dest = resolveDestinationForChange(
          filePath,
          inputResolved,
          state.tempDir,
          externalRoots
        );
        if (dest) {
          const { mkdir } = await import('node:fs/promises');
          await mkdir(path.dirname(dest.destPath), { recursive: true });
          await Bun.write(dest.destPath, Bun.file(filePath));
          debug(`Updated: ${dest.relativePath}`);
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
