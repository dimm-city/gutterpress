/**
 * File watcher setup and management for preview server
 *
 * Handles watching input files and triggering rebuilds on changes.
 * Uses the simplified markdown pipeline (renderChapters from lib/markdown).
 */

import { watch, type FSWatcher } from 'chokidar';
import { existsSync, statSync } from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'path';
import { info, debug, warn, error as logError } from '../utils/logger';
import { DEBOUNCE } from '../constants';
import { renderChapters } from '../lib/markdown/index';
import { canonicalChapterId } from '../lib/markdown/chapter-id';
import { loadManifest, resolveConfig } from '../lib/manifest';
import { loadPlugins, collectPluginCss } from '../lib/markdown/plugins';
import { resolveAssetDestName } from '../lib/assets';
import { BOOK_HTML_FILENAME } from '../lib/viewer';
import type { ServerState } from './server-context';
import { BREAK_INSIDE_HANDLER } from '../lib/pagedjs';
import { pagedjsPolyfillTagRegex } from '../lib/pagedjs-marker';

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
 *
 * `relativePath` is normalized to FORWARD slashes regardless of platform —
 * it is broadcast to clients (CSS hot-swap hrefs, content-update chapter
 * splices) and compared against the SPA's forward-slash chapter paths, so
 * Windows `path.sep` backslashes must never leak into it.
 *
 * Exported for the chapter-identity contract tests: the `content-update`
 * broadcast derived from this value MUST equal the `data-chapter-src` the
 * build writes for the same file (see lib/markdown/chapter-id.ts).
 */
export function resolveDestinationForChange(
  filePath: string,
  inputPath: string,
  tempDir: string,
  externalRoots: { src: string; destName: string }[]
): { destPath: string; relativePath: string } | null {
  if (filePath === inputPath || filePath.startsWith(inputPath + path.sep)) {
    const relativePath = path.relative(inputPath, filePath);
    return {
      destPath: path.join(tempDir, relativePath),
      relativePath: relativePath.replace(/\\/g, "/"),
    };
  }
  for (const root of externalRoots) {
    if (filePath === root.src || filePath.startsWith(root.src + path.sep)) {
      const relInRoot = path.relative(root.src, filePath);
      const relativePath = path.join(root.destName, relInRoot);
      return {
        destPath: path.join(tempDir, relativePath),
        relativePath: relativePath.replace(/\\/g, "/"),
      };
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
 * Whether the incremental live-preview (shell + per-chapter splice) is active.
 * DEFAULT ON; opt out with PRINTMD_PREVIEW_INCREMENTAL=0 to fall back to the
 * direct book.html preview (CSS hot-swap + full reload on content).
 */
export function incrementalPreviewEnabled(): boolean {
  return process.env.PRINTMD_PREVIEW_INCREMENTAL !== "0";
}

/**
 * Shared preview render path — the full book and the single-chapter splice
 * document differ ONLY in which files render and whether chapters are wrapped.
 * renderChapters() does all the work (CSS, Paged.js script slot).
 */
export async function renderBook(
  inputPath: string,
  config: { title?: string; styles?: string[]; plugins?: any[] },
  opts: { files: string[] | null; wrapChapters: boolean }
): Promise<string> {
  let plugins;
  let pluginCss = '';
  if (config.plugins && config.plugins.length > 0) {
    // Live preview degrades gracefully: a plugin the author enabled but hasn't
    // installed yet is skipped (with a loud warning) so the rest of the document
    // still renders instead of the whole preview going blank. Build/export keep
    // fail-fast (no onError) — a final artifact must not silently drop a plugin.
    plugins = await loadPlugins(config.plugins, inputPath, (ref, err) =>
      warn(`Skipping plugin "${ref}" in preview — ${err.message}`));
    pluginCss = collectPluginCss(plugins);
  }
  return renderChapters(inputPath, {
    title: config.title ?? "Document",
    styles: config.styles,
    files: opts.files,
    plugins,
    pluginCss,
    wrapChapters: opts.wrapChapters,
  });
}

/**
 * Rewrite rendered book HTML for the live preview. Injects, in order:
 *   1. pagedjs-interface.js — defines window.previewAPI for in-iframe controls
 *   2. pagedjs-bridge.js    — postMessage bridge for cross-origin toolbar (viewer)
 *   3. BREAK_INSIDE_HANDLER — polyfill for break-inside: avoid
 *   4. Paged.js polyfill itself, served directly from the process-wide
 *      embedded-assets dir by the HTTP server (see http-server.ts route
 *      for /vendor/*). We no longer copy it into the per-project tempDir
 *      because:
 *        - The polyfill is 904 KB and copying it per open is wasted IO
 *          (one of the worst-case Defender scan targets on Windows).
 *        - The per-process extracted copy is identical across opens so
 *          serving it from a stable disk path lets the OS file-cache
 *          and Defender hash-cache stay warm across sessions.
 *
 * With `pageIsolateChapters` (the incremental preview), each chapter is also
 * page-isolated so the shell can re-paginate and splice a single edited
 * chapter without disturbing the others.
 */
export function injectPreviewScripts(html: string, pageIsolateChapters: boolean): string {
  const iface =
    '<script src="/preview/scripts/pagedjs-interface.js"></script>\n  '
    + '<script src="/preview/scripts/pagedjs-bridge.js"></script>\n  ';
  let output = html.replace(
    pagedjsPolyfillTagRegex(),
    iface + BREAK_INSIDE_HANDLER + `\n  <script src="/vendor/paged.polyfill.js"></script>`
  );
  if (pageIsolateChapters && /<\/head>/i.test(output)) {
    output = output.replace(/<\/head>/i, '<style>.pmd-chapter{break-before:page}</style>\n</head>');
  }
  return output;
}

/**
 * Generate HTML from markdown and write book.html to the temp directory.
 * The viewer's iframe loads `book.html` via a relative URL — same name in
 * dev and in published static-site builds.
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
  const incremental = incrementalPreviewEnabled();
  const html = await renderBook(inputPath, config, {
    files: config.source?.files ?? null,
    wrapChapters: incremental,
  });
  await fsp.writeFile(
    path.join(tempDir, BOOK_HTML_FILENAME),
    injectPreviewScripts(html, incremental),
    "utf-8"
  );
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
  const html = await renderBook(inputPath, config, { files: [file], wrapChapters: true });
  return injectPreviewScripts(html, true);
}

/** One changed file, resolved to its temp-dir mirror destination. */
export interface ChangedDest {
  /** Forward-slash path relative to the temp dir (broadcast to clients). */
  relativePath: string;
  /** Lower-cased extension of the changed source file (e.g. ".css"). */
  ext: string;
  /** The chokidar event that reported the change (change, unlink, …). */
  event: string;
}

/**
 * Mirror every changed file into the temp directory — handles files inside
 * the input path and files inside any external asset root. Deleted files are
 * NOT copied (book.html is re-rendered from inputPath, the source of truth)
 * but still appear in the returned list so the broadcast decision sees them.
 */
export async function mirrorChanges(
  changes: [filePath: string, event: string][],
  inputResolved: string,
  tempDir: string,
  externalRoots: { src: string; destName: string }[]
): Promise<ChangedDest[]> {
  const dests: ChangedDest[] = [];
  for (const [changedPath, changedEvent] of changes) {
    const dest = resolveDestinationForChange(changedPath, inputResolved, tempDir, externalRoots);
    if (!dest) continue;
    // A watch event can fire for a DIRECTORY (e.g. applying a theme
    // creates `themes/<id>/`, bumping the parent dir's mtime). copyFile
    // throws EISDIR on a directory, which previously aborted the entire
    // rebuild and froze the live preview. The contained file gets its own
    // event and is mirrored on its own; skip the directory itself.
    if (existsSync(changedPath) && statSync(changedPath).isFile()) {
      await fsp.mkdir(path.dirname(dest.destPath), { recursive: true });
      await fsp.copyFile(changedPath, dest.destPath);
      debug(`Updated: ${dest.relativePath}`);
    }
    dests.push({
      relativePath: dest.relativePath,
      ext: path.extname(changedPath).toLowerCase(),
      event: changedEvent,
    });
  }
  return dests;
}

/**
 * CSS hot-swap fast path: a stylesheet edit doesn't change content flow, so
 * the client can re-fetch JUST those <link>s — no markdown re-render, no
 * re-pagination, no reload. Scroll position is preserved and the new styles
 * apply on the next frame. Returns the stylesheet paths to hot-swap, or null
 * unless EVERY change in the window resolved to a stylesheet.
 * (Geometry-affecting CSS like @page size won't re-flow page boxes until a
 * content change triggers a full rebuild — acceptable for live tweaks.)
 */
export function cssHotSwapPaths(dests: ChangedDest[], changeCount: number): string[] | null {
  if (
    dests.length === changeCount &&
    dests.length > 0 &&
    dests.every((d) => d.ext === '.css')
  ) {
    return dests.map((d) => d.relativePath);
  }
  return null;
}

/** How a content change is pushed to connected preview clients. */
export type BroadcastDecision =
  | { kind: 'chapter-splice'; chapterId: string; relativePath: string }
  | { kind: 'full-reload' };

/**
 * Incremental: EXACTLY ONE markdown file changed (and still exists) →
 * splice just that chapter in the live shell (re-paginate one chapter,
 * not the whole doc). Any multi-file change — restore, sync merge —
 * must full-reload instead: a single-chapter splice can only refresh
 * one chapter and would leave the others stale.
 *
 * The chapterId is the CANONICAL chapter id — must equal the build's
 * data-chapter-src for the same file (see lib/markdown/chapter-id.ts)
 * or the shell can't find the chapter and degrades to a full swap.
 */
export function decideBroadcast(
  dests: ChangedDest[],
  changeCount: number,
  incremental: boolean
): BroadcastDecision {
  const only = dests.length === 1 ? dests[0]! : null;
  if (
    incremental &&
    changeCount === 1 &&
    only &&
    only.ext === '.md' &&
    only.event !== 'unlink' &&
    only.event !== 'unlinkDir'
  ) {
    return {
      kind: 'chapter-splice',
      chapterId: canonicalChapterId(only.relativePath),
      relativePath: only.relativePath,
    };
  }
  return { kind: 'full-reload' };
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

  // Paths changed during the current debounce window. A single edit fires one
  // event, but multi-file disk rewrites (version restore, sync merge, bulk
  // save) fire a burst — the rebuild must see ALL of them, not just the last
  // event's path, or it splices one (possibly wrong) chapter and leaves the
  // rest of the live preview stale.
  const pendingChanges = new Map<string, string>(); // filePath -> last event

  /** (Re-)arm the debounced rebuild timer. */
  function scheduleRebuild(): void {
    if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
    state.rebuildTimer = setTimeout(runRebuild, DEBOUNCE.FILE_WATCH);
  }

  async function runRebuild(): Promise<void> {
      if (state.isRebuilding) return;

      // Snapshot + clear AFTER the isRebuilding guard so changes skipped by an
      // in-flight rebuild stay pending until the rebuild's finally re-arms the
      // timer (see below) — no further fs event is required to flush them.
      const changes = [...pendingChanges.entries()];
      pendingChanges.clear();
      if (changes.length === 0) return;

      state.isRebuilding = true;
      try {
        info('Regenerating preview...');

        const dests = await mirrorChanges(changes, inputResolved, state.tempDir, externalRoots);

        // Stylesheet-only burst → hot-swap the re-copied <link>s and stop.
        const cssPaths = cssHotSwapPaths(dests, changes.length);
        if (cssPaths) {
          for (const p of cssPaths) {
            state.previewServer?.broadcastCssUpdate(p);
            info(`CSS hot-swapped: ${p}`);
          }
          return;
        }

        // Content change: re-render markdown + regenerate book.html (keeps fresh
        // loads correct) then update the live view.
        const manifest = await loadManifest(state.currentInputPath);
        const updatedConfig = resolveConfig({}, manifest);
        state.config = updatedConfig;
        await generateAndWriteHtml(state.currentInputPath, state.tempDir, updatedConfig);

        const decision = decideBroadcast(dests, changes.length, incrementalPreviewEnabled());
        if (decision.kind === 'chapter-splice') {
          state.previewServer?.broadcastContentUpdate(decision.chapterId);
          info(`Chapter updated: ${decision.relativePath}`);
        } else {
          // Tell every connected HMR client to reload.
          state.previewServer?.broadcastReload();
          info(
            changes.length > 1
              ? `Preview updated (${changes.length} files changed — full reload)`
              : 'Preview updated'
          );
        }
      } catch (err) {
        logError('Failed to regenerate preview:', err);
      } finally {
        state.isRebuilding = false;
        // Changes that arrived DURING this rebuild had their debounce timer
        // fire into the isRebuilding guard above — with no further fs event
        // they would be orphaned forever. Re-arm the timer so they rebuild.
        if (pendingChanges.size > 0) scheduleRebuild();
      }
  }

  watcher.on('all', (event, filePath) => {
    debug(`File ${event}: ${filePath}`);
    pendingChanges.set(filePath, event);
    scheduleRebuild();
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
