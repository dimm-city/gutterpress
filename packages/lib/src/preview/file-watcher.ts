/**
 * File watcher setup and management for preview server
 *
 * Handles watching input files and triggering rebuilds on changes.
 * Uses the simplified markdown pipeline (renderChapters from lib/markdown).
 */

import { watch, type FSWatcher } from 'chokidar';
import { existsSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'path';
import { info, debug, error as logError } from '../utils/logger';
import { DEBOUNCE } from '../constants';
import { renderChapters } from '../lib/markdown/index';
import { loadManifest, resolveConfig } from '../lib/manifest';
import { loadPlugins, collectPluginCss } from '../lib/markdown/plugins';
import { resolveAssetDestName } from '../lib/assets';
import { BOOK_HTML_FILENAME } from '../lib/viewer';
import type { ServerState } from './server-context';
import { BREAK_INSIDE_HANDLER } from '../lib/pagedjs';
import { getAssetPath } from '../lib/embedded-assets';
import { prepaginatePreviewHtml } from '../lib/build-runner';

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
 * Tiny placeholder book.html for no-input mode. The viewer's iframe needs a
 * valid src to load; the viewer app (packages/viewer) detects `hasInput: false`
 * via /api/status and shows its own folder picker. Plain text only — no
 * Paged.js, no plugins, no manifest.
 */
const EMPTY_BOOK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>print-md preview</title>
  <style>
    html, body { margin: 0; height: 100%; }
    body { display: flex; align-items: center; justify-content: center;
           font: 16px/1.4 -apple-system, "Segoe UI", sans-serif; color: #6b6b6b; }
  </style>
</head>
<body>
  <p>No directory selected.</p>
</body>
</html>
`;

/**
 * Generate HTML from markdown and write book.html to the temp directory.
 * renderChapters() does all the work (CSS, Paged.js script). We only inject
 * the toolbar interface script. The viewer's iframe loads `book.html` via
 * a relative URL — same name in dev and in published static-site builds.
 *
 * Empty `inputPath` writes a static placeholder — the viewer app (packages/viewer)
 * supplies a real path via its own folder picker.
 */
export async function generateAndWriteHtml(
  inputPath: string,
  tempDir: string,
  config: { title?: string; styles?: string[]; source?: { files?: string[] | null }; plugins?: any[] }
): Promise<void> {
  if (!inputPath) {
    await fsp.writeFile(path.join(tempDir, BOOK_HTML_FILENAME), EMPTY_BOOK_HTML, "utf-8");
    return;
  }
  // Load plugins if configured
  let plugins;
  let pluginCss = '';
  if (config.plugins && config.plugins.length > 0) {
    plugins = await loadPlugins(config.plugins, inputPath);
    pluginCss = collectPluginCss(plugins);
  }

  const incremental = process.env.PRINTMD_PREVIEW_INCREMENTAL === "1";
  const html = await renderChapters(inputPath, {
    title: config.title ?? "Document",
    styles: config.styles,
    files: config.source?.files ?? null,
    plugins,
    pluginCss,
    wrapChapters: incremental,
  });

  // Inject into book.html, in order:
  //   1. pagedjs-interface.js — defines window.previewAPI for in-iframe controls
  //   2. pagedjs-bridge.js    — postMessage bridge for cross-origin toolbar (viewer)
  //   3. BREAK_INSIDE_HANDLER — polyfill for break-inside: avoid
  //   4. Paged.js polyfill itself, served directly from the process-wide
  //      embedded-assets dir by the HTTP server (see http-server.ts route
  //      for /vendor/*). We no longer copy it into the per-project tempDir
  //      because:
  //        - The polyfill is 904 KB and copying it per open is wasted IO
  //          (one of the worst-case Defender scan targets on Windows).
  //        - The per-process extracted copy is identical across opens so
  //          serving it from a stable disk path lets the OS file-cache
  //          and Defender hash-cache stay warm across sessions.
  const iface =
    '<script src="/preview/scripts/pagedjs-interface.js"></script>\n  '
    + '<script src="/preview/scripts/pagedjs-bridge.js"></script>\n  ';
  let output = html.replace(
    /<script[^>]*src="[^"]*pagedjs[^"]*"[^>]*><\/script>/i,
    iface + BREAK_INSIDE_HANDLER + `\n  <script src="/vendor/paged.polyfill.js"></script>`
  );

  // Incremental preview: page-isolate each chapter so the shell can re-paginate
  // and splice a single edited chapter without disturbing the others.
  if (incremental && /<\/head>/i.test(output)) {
    output = output.replace(/<\/head>/i, '<style>.pmd-chapter{break-before:page}</style>\n</head>');
  }

  // Opt-in: pre-paginate at build time in the warm pooled browser so the preview
  // browser loads STATIC pages on each hot reload (no runtime re-pagination, no
  // screenshifting). Falls back to the polyfill output on any error so the
  // preview never breaks. Enable with PRINTMD_PREVIEW_PREPAGINATE=1.
  if (process.env.PRINTMD_PREVIEW_PREPAGINATE === "1") {
    try {
      const staticHtml = await prepaginatePreviewHtml(output, tempDir);
      await fsp.writeFile(path.join(tempDir, BOOK_HTML_FILENAME), staticHtml, "utf-8");
      return;
    } catch (err) {
      debug(`Pre-pagination failed, serving runtime-polyfill HTML: ${err}`);
    }
  }

  await fsp.writeFile(path.join(tempDir, BOOK_HTML_FILENAME), output, "utf-8");
}

/**
 * Render a SINGLE source file as a standalone, paginatable preview document
 * (same CSS/plugins/scripts as the full book, chapter-wrapped + page-isolated).
 * The incremental shell loads this in a hidden iframe, paginates just this
 * chapter, and splices its pages into the live view — so an edit re-paginates
 * one chapter (~hundreds of ms) instead of the whole document (~seconds).
 */
export async function renderChapterPreviewHtml(
  inputPath: string,
  file: string,
  config: { title?: string; styles?: string[]; plugins?: any[] }
): Promise<string> {
  let plugins;
  let pluginCss = '';
  if (config.plugins && config.plugins.length > 0) {
    plugins = await loadPlugins(config.plugins, inputPath);
    pluginCss = collectPluginCss(plugins);
  }
  const html = await renderChapters(inputPath, {
    title: config.title ?? "Document",
    styles: config.styles,
    files: [file],
    plugins,
    pluginCss,
    wrapChapters: true,
  });
  const iface =
    '<script src="/preview/scripts/pagedjs-interface.js"></script>\n  '
    + '<script src="/preview/scripts/pagedjs-bridge.js"></script>\n  ';
  let out = html.replace(
    /<script[^>]*src="[^"]*pagedjs[^"]*"[^>]*><\/script>/i,
    iface + BREAK_INSIDE_HANDLER + `\n  <script src="/vendor/paged.polyfill.js"></script>`
  );
  if (/<\/head>/i.test(out)) {
    out = out.replace(/<\/head>/i, '<style>.pmd-chapter{break-before:page}</style>\n</head>');
  }
  return out;
}

/**
 * Create and configure a file watcher for the input directory.
 *
 * Watches the project's input path AND any manifest-declared asset roots
 * that live outside it (e.g. a sibling `../_shared` directory). Without the
 * external roots, edits to shared CSS like `_shared/css/core/05-components.css`
 * are never mirrored into the temp dir and the preview server never broadcasts
 * a reload.
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

  watcher.on('all', async (event, filePath) => {
    debug(`File ${event}: ${filePath}`);

    if (state.rebuildTimer) clearTimeout(state.rebuildTimer);

    state.rebuildTimer = setTimeout(async () => {
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
          await fsp.mkdir(path.dirname(dest.destPath), { recursive: true });
          await fsp.copyFile(filePath, dest.destPath);
          debug(`Updated: ${dest.relativePath}`);
        }

        // CSS hot-swap fast path: a stylesheet edit doesn't change content flow,
        // so we re-copy it (above) and tell the client to re-fetch JUST that
        // <link> — no markdown re-render, no re-pagination, no reload. Scroll
        // position is preserved and the new styles apply on the next frame.
        // (Geometry-affecting CSS like @page size won't re-flow page boxes until
        // a content change triggers a full rebuild — acceptable for live tweaks.)
        if (dest && path.extname(filePath).toLowerCase() === '.css') {
          state.previewServer?.broadcastCssUpdate(dest.relativePath);
          info(`CSS hot-swapped: ${dest.relativePath}`);
          return;
        }

        // Content change: re-render markdown + regenerate book.html (keeps fresh
        // loads correct) then update the live view.
        const manifest = await loadManifest(state.currentInputPath);
        const updatedConfig = resolveConfig({}, manifest);
        state.config = updatedConfig;
        await generateAndWriteHtml(state.currentInputPath, state.tempDir, updatedConfig);

        // Incremental: a single markdown file changed → splice just that chapter
        // in the live shell (re-paginate one chapter, not the whole doc).
        if (
          process.env.PRINTMD_PREVIEW_INCREMENTAL === "1" &&
          dest &&
          path.extname(filePath).toLowerCase() === ".md"
        ) {
          state.previewServer?.broadcastContentUpdate(dest.relativePath);
          info(`Chapter updated: ${dest.relativePath}`);
        } else {
          // Tell every connected HMR client to reload.
          state.previewServer?.broadcastReload();
          info('Preview updated');
        }
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
 * Start file watching if not disabled via options. No-input mode skips the
 * watcher entirely (nothing to watch yet) — restartPreview wires up a
 * watcher once the user picks a directory through the viewer.
 */
export function startFileWatcher(state: ServerState): void {
  if (state.options.noWatch) return;
  if (!state.currentInputPath) return;
  state.currentWatcher = createFileWatcher(state);
}

/**
 * Stop the file watcher and clean up resources
 */
export async function stopFileWatcher(state: ServerState): Promise<void> {
  // Cancel any pending debounced rebuild so a callback scheduled just before
  // close cannot fire against stale ServerState after restartPreview repoints
  // currentInputPath/config at a different directory.
  if (state.rebuildTimer) {
    clearTimeout(state.rebuildTimer);
    state.rebuildTimer = null;
  }
  if (state.currentWatcher) {
    await state.currentWatcher.close();
    state.currentWatcher = null;
  }
}
