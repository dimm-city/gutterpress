/**
 * File watcher setup and management for preview server
 *
 * Handles watching input files and triggering rebuilds on changes.
 * Uses the simplified markdown pipeline (renderChapters from lib/markdown).
 */

import { watch, type FSWatcher } from 'chokidar';
import fsp from 'node:fs/promises';
import path from 'path';
import { info, debug, warn, error as logError } from '../utils/logger';
import { DEBOUNCE } from '../constants';
import { renderChapters } from '../lib/markdown/index';
import { canonicalChapterId } from '../lib/markdown/chapter-id';
import { loadManifest, resolveConfig } from '../lib/manifest';
import { loadPluginsWithCss } from '../lib/markdown/plugins';
import { BOOK_HTML_FILENAME } from '../lib/viewer';
import type { ServerState } from './server-context';
import { BREAK_INSIDE_HANDLER } from '../lib/pagedjs';
import { pagedjsPolyfillTagRegex } from '../lib/pagedjs-marker';
import type { ResolvedPluginConfig } from '../schema/manifest.types';

/**
 * Resolve a changed file's canonical, forward-slash path relative to the
 * project root, or `null` if the file isn't under it. There is exactly ONE
 * watch root now (the project directory — see `createFileWatcher` below):
 * the old external-asset-root concept (a sibling `../_shared` directory
 * mirrored under its own name in the temp dir) went away with `copyAssets`
 * and the manifest's `source.assets` field it depended on, since a project
 * is served straight from disk (see http-server.ts) and there is no longer
 * a destination path to mirror INTO.
 *
 * `relativePath` is normalized to FORWARD slashes regardless of platform —
 * it is broadcast to clients (content-update chapter splices, CSS hot-swap
 * paths) and compared against the SPA's forward-slash chapter paths, so
 * Windows `path.sep` backslashes must never leak into it.
 *
 * Exported for the chapter-identity contract test
 * (lib/markdown/chapter-id.test.ts): the `content-update` broadcast derived
 * from this value MUST equal the `data-chapter-src` the build writes for the
 * same file (see lib/markdown/chapter-id.ts).
 */
export function describeChange(
  filePath: string,
  inputResolved: string
): { relativePath: string } | null {
  if (filePath !== inputResolved && !filePath.startsWith(inputResolved + path.sep)) {
    return null;
  }
  return { relativePath: path.relative(inputResolved, filePath).replace(/\\/g, "/") };
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
 *
 * Named `renderPreviewBook` (ARCH finding #53) to distinguish it from
 * build-runner.ts's `renderBook` — same name, different module, and a
 * genuinely different contract: this one is degrade-and-report (a plugin the
 * author enabled but hasn't installed yet is skipped with a loud warning so
 * the rest of the live preview still renders); build-runner.ts's is
 * fail-fast, because a final artifact must never silently drop a plugin.
 * Both preambles now share {@link loadPluginsWithCss}.
 */
export async function renderPreviewBook(
  inputPath: string,
  config: { title?: string; styles?: string[]; plugins?: ResolvedPluginConfig[] },
  opts: { files: string[] | null; wrapChapters: boolean }
): Promise<string> {
  const { plugins, pluginCss } = await loadPluginsWithCss(
    config.plugins,
    inputPath,
    (ref, err) => warn(`Skipping plugin "${ref}" in preview — ${err.message}`)
  );
  return renderChapters(inputPath, {
    title: config.title ?? "Document",
    styles: config.styles,
    files: opts.files,
    plugins,
    pluginCss,
    wrapChapters: opts.wrapChapters,
    // ARCH finding #4: markdown-it-paged's typed, line-numbered author-mistake
    // warnings (env.layoutWarnings) used to be discarded here too — this is the
    // ONE render path shared by the full book (generateAndWriteHtml) and the
    // incremental per-chapter splice (renderChapterPreviewHtml), so wiring it
    // here surfaces a marker mistake live in the preview terminal on both a
    // full rebuild and a single-chapter edit.
    onChapterWarnings: (file, warnings) => {
      for (const w of warnings) {
        warn(`  ${file}, line ${w.line}: ${w.message}`);
      }
    },
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
 * PAGINATION FIDELITY: this injects NO page-break rule. It used to add
 * `<style>.pmd-chapter{break-before:page}</style>` whenever the incremental
 * preview was on (i.e. by default), which started EVERY source file on a new
 * page in the live view. `print-md build` emits no such rule — assembleBookHtml
 * in lib/markdown/assemble.ts concatenates source files flat into <body> and
 * breaks only where project CSS or a markdown-it-paged marker says to — so any
 * project that splits one chapter across several source files previewed with
 * different page boundaries than the PDF it built. Preview and build now take
 * their breaks from exactly the same rules.
 *
 * KNOWN RESIDUAL (predates this, was masked by the removed rule): if the first
 * source file's first element carries `break-before: page` (a `.page` marker,
 * or an `h1` in most themes), the `.pmd-chapter` wrapper makes Paged.js treat
 * that break as a real one instead of dropping it at the start of the flow, so
 * the preview leads with one blank page and every page NUMBER is one higher
 * than the build's. Page CONTENT and boundaries match; the offset does not.
 *
 * The `.pmd-chapter` wrappers stay (see `wrapChapters` in assemble.ts): they are
 * how the shell locates and splices a single edited chapter, and they carry no
 * break of their own. Without the forced break, neighbouring chapters routinely
 * share a page — preview-shell.js already handles that (see `tagPages`,
 * `pagesFor` and the shared-page branch of `spliceChapter`), at the cost of a
 * content-correct-but-un-reflowed neighbour page until the next full reload.
 */
export function injectPreviewScripts(html: string): string {
  const iface =
    '<script src="/preview/scripts/pagedjs-interface.js"></script>\n  '
    + '<script src="/preview/scripts/pagedjs-bridge.js"></script>\n  ';
  return html.replace(
    pagedjsPolyfillTagRegex(),
    iface + BREAK_INSIDE_HANDLER + `\n  <script src="/vendor/paged.polyfill.js"></script>`
  );
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
  config: { title?: string; styles?: string[]; source?: { files?: string[] | null }; plugins?: ResolvedPluginConfig[] }
): Promise<void> {
  if (!inputPath) {
    await fsp.writeFile(path.join(tempDir, BOOK_HTML_FILENAME), EMPTY_BOOK_HTML, "utf-8");
    return;
  }
  const incremental = incrementalPreviewEnabled();
  const html = await renderPreviewBook(inputPath, config, {
    files: config.source?.files ?? null,
    wrapChapters: incremental,
  });
  await fsp.writeFile(
    path.join(tempDir, BOOK_HTML_FILENAME),
    injectPreviewScripts(html),
    "utf-8"
  );
}

/**
 * Render a SINGLE source file as a standalone, paginatable preview document
 * (same CSS/plugins/scripts as the full book, chapter-wrapped). The incremental
 * shell loads this in a hidden iframe, paginates just this chapter, and splices
 * its pages into the live view — so an edit re-paginates one chapter
 * (~hundreds of ms) instead of the whole document (~seconds).
 *
 * This document holds exactly ONE chapter, so there is nothing to isolate it
 * from and no break rule to inject — it paginates on the project's own rules,
 * same as the full book.
 */
export async function renderChapterPreviewHtml(
  inputPath: string,
  file: string,
  config: { title?: string; styles?: string[]; plugins?: ResolvedPluginConfig[] }
): Promise<string> {
  const html = await renderPreviewBook(inputPath, config, { files: [file], wrapChapters: true });
  return injectPreviewScripts(html);
}

/**
 * One changed file, described relative to the project root — NOT a temp-dir
 * mirror destination. Since the project is served in place (http-server.ts
 * reads straight from `state.currentInputPath`), a change needs no copy step
 * and therefore carries no "did the copy actually land" flag the way the old
 * `ChangedDest.mirrored` did; the file described here IS the served file.
 */
export interface ChangedFile {
  /** Forward-slash path relative to the project root (broadcast to clients). */
  relativePath: string;
  /** Lower-cased extension of the changed file (e.g. ".css"). */
  ext: string;
  /** The chokidar event that reported the change (change, unlink, …). */
  event: string;
}

/**
 * Describe every changed file relative to the project root. Pure and
 * synchronous — no fs access at all — because with serve-in-place there is
 * nothing to copy: `book.html` is re-rendered straight from the project
 * (the source of truth) and every other path is served directly from it, so
 * this step is now just naming the change for the broadcast decision below,
 * not moving any bytes. A change that doesn't resolve under `inputResolved`
 * is dropped (defensively — there is exactly one watch root today, see
 * `createFileWatcher`) rather than broadcast with a meaningless path.
 */
export function describeChanges(
  changes: [filePath: string, event: string][],
  inputResolved: string
): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const [changedPath, event] of changes) {
    const described = describeChange(changedPath, inputResolved);
    if (!described) continue;
    files.push({
      relativePath: described.relativePath,
      ext: path.extname(changedPath).toLowerCase(),
      event,
    });
  }
  return files;
}

/**
 * CSS hot-swap fast path: a stylesheet edit doesn't change content flow, so
 * the client can re-fetch JUST that file (over HTTP, from wherever it
 * actually lives — serve-in-place means the project's own CSS files are
 * already reachable at their authored relative path, see http-server.ts) —
 * no re-pagination, no reload. Scroll position is preserved and the new
 * styles apply on the next frame. Returns the stylesheet paths to hot-swap,
 * or null unless EVERY change in the window resolved to a still-existing
 * stylesheet.
 *
 * A DELETED stylesheet is excluded on purpose: appending a fresh `<link>` to
 * a path that now 404s would leave the live view broken with nothing
 * downstream to correct it (unlike a deleted markdown chapter, which
 * full-reloads from a freshly re-rendered book.html). That case — and any
 * mixed window — falls through to `decideBroadcast`'s full-reload path below.
 *
 * NOTE: book.html's own `<style data-project-css>` block is re-rendered
 * unconditionally by the caller regardless of this fast path (CSS is now
 * INLINED there, unlike the old copied-CSS-file model where book.html never
 * needed to change for a pure style edit) — this function only decides
 * whether the LIVE view can skip a reload while that happens.
 * (Geometry-affecting CSS like @page size won't re-flow page boxes until a
 * content change triggers a full rebuild — acceptable for live tweaks.)
 */
export function cssHotSwapPaths(changedFiles: ChangedFile[], changeCount: number): string[] | null {
  if (
    changedFiles.length === changeCount &&
    changedFiles.length > 0 &&
    changedFiles.every((f) => f.ext === '.css' && f.event !== 'unlink')
  ) {
    return changedFiles.map((f) => f.relativePath);
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
  dests: ChangedFile[],
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
 * Chokidar 5's `ignored` matcher (regex or function) is tested against the
 * fully-qualified, forward-slash-normalized ABSOLUTE path — never a path
 * relative to whatever root was passed to `watch()` (see chokidar's internal
 * `matchPatterns`/`normalizePath`, which run before any matcher, function or
 * regex, ever sees the string). The previous `ignored: /(^|[\/\\])\../`
 * therefore matched a dot segment ANYWHERE in that absolute path — including
 * every ANCESTOR directory of the project, not just the project's own dot
 * files/dirs. A project rooted under a dot-prefixed parent (e.g.
 * `~/.local/share/print-md/books/mybook`, or any `~/.config/...` tree) had
 * every single path rejected by this rule, which silently disabled the
 * watcher entirely — no error, just a preview that never picked up an edit.
 *
 * The fix: strip the (normalized) watch root off the front of the path
 * first, and apply the dotfile rule only to what's left — i.e. to the
 * PROJECT's own files/dirs, regardless of which ancestor directories the
 * project itself happens to live under.
 */
function isDotPathUnderRoot(candidatePath: string, root: string): boolean {
  const normalizedRoot = root.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = candidatePath.replace(/\\/g, "/");
  let rel: string;
  if (normalizedPath === normalizedRoot) {
    rel = "";
  } else if (normalizedPath.startsWith(normalizedRoot + "/")) {
    rel = normalizedPath.slice(normalizedRoot.length + 1);
  } else {
    // Not under the root at all — shouldn't happen (chokidar only calls this
    // for paths under what we asked it to watch), but never silently ignore
    // something we can't place relative to the root.
    rel = normalizedPath;
  }
  if (rel === "") return false;
  return rel.split("/").some((segment) => segment.startsWith("."));
}

/**
 * Create and configure a file watcher for the project's input directory.
 *
 * Watches ONLY the project directory. The old external-asset-root watching
 * (a sibling `../_shared` directory mirrored under its own name in the temp
 * dir) went away with `copyAssets` and the manifest's `source.assets` field
 * it depended on — there is no longer a place to declare a shared directory
 * outside the project, and nothing to mirror it INTO even if there were
 * (serve-in-place means the project's own files need no mirroring either;
 * see http-server.ts).
 */
export function createFileWatcher(state: ServerState): FSWatcher {
  const inputResolved = path.resolve(state.currentInputPath);

  const watcher = watch(inputResolved, {
    persistent: true,
    ignoreInitial: true,
    ignored: (candidatePath: string) => isDotPathUnderRoot(candidatePath, inputResolved),
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
