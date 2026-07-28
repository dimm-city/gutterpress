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
import { loadManifest, resolveConfig } from '../lib/manifest';
import { resolveActiveStyles } from '../lib/style-resolver';
import { collectStyleDependencies } from '../lib/asset-inline';
import { loadPluginsWithCss } from '../lib/markdown/plugins';
import { BOOK_HTML_FILENAME } from '../lib/viewer';
import type { ServerState } from './server-context';
import { BREAK_INSIDE_HANDLER } from '../lib/pagedjs';
import { pagedjsPolyfillTagRegex } from '../lib/pagedjs-marker';
import type { ResolvedPluginConfig } from '../schema/manifest.types';

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
 * Whether the double-buffered preview shell is active. The historical env name
 * is retained because users may already set it; chapter splicing is gone and
 * every source change now performs a full-document pagination.
 */
export function incrementalPreviewEnabled(): boolean {
  return process.env.PRINTMD_PREVIEW_INCREMENTAL !== "0";
}

/**
 * Shared preview render path. renderChapters() does all Markdown, CSS, and
 * Paged.js-slot work.
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
    // ONE preview render path, so wiring it here surfaces a marker mistake live
    // in the terminal on both startup and every rebuild.
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
 * Chapter identity is attached to existing source-mapped blocks. No wrapper or
 * preview-only CSS is emitted, so selectors see exactly the same document tree
 * as the build.
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
  const html = await renderPreviewBook(inputPath, config, {
    files: config.source?.files ?? null,
    // Source identity is metadata on existing blocks and is required by both
    // the shell and direct-book HMR paths. It never changes document structure.
    wrapChapters: true,
  });
  await fsp.writeFile(
    path.join(tempDir, BOOK_HTML_FILENAME),
    injectPreviewScripts(html),
    "utf-8"
  );
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
export function isDotPathUnderRoot(candidatePath: string, root: string): boolean {
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
 * Whether the watcher should ignore a path.
 *
 * IN-PROJECT paths get the dotfile rule ({@link isDotPathUnderRoot}) — a
 * project's own `.git/`, `.DS_Store`, editor swap files, and so on are noise.
 *
 * A path OUTSIDE the project is only ever seen because it is a DECLARED
 * external dependency the manifest named explicitly (see
 * {@link externalWatchTargets}); it is never ignored. Running the dotfile rule
 * on it would test every ANCESTOR segment of its absolute path — so a shared
 * foundation checked out under, say, `~/.local/share/books/shared/` would be
 * silently dropped, which is the exact failure mode the in-project rule was
 * rewritten to avoid.
 */
export function isIgnoredWatchPath(candidatePath: string, projectRoot: string): boolean {
  const normalizedRoot = projectRoot.replace(/\\/g, "/").replace(/\/+$/, "");
  const normalizedPath = candidatePath.replace(/\\/g, "/");
  const inProject =
    normalizedPath === normalizedRoot || normalizedPath.startsWith(normalizedRoot + "/");
  return inProject ? isDotPathUnderRoot(candidatePath, projectRoot) : false;
}

/**
 * External watcher roots may be broader than one dependency when a declared
 * file or its parent directory does not exist yet. Traverse only paths that are
 * either a desired file or one of its ancestors; this keeps a nearest-existing
 * ancestor watch from scanning unrelated sibling trees such as `.git/`.
 */
export function isExternalWatchCandidate(
  candidatePath: string,
  targets: Iterable<string>
): boolean {
  const candidate = path.resolve(candidatePath);
  for (const rawTarget of targets) {
    const target = path.resolve(rawTarget);
    const rel = path.relative(candidate, target);
    if (
      rel === "" ||
      (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
    ) return true;
  }
  return false;
}

async function nearestExistingDirectory(start: string): Promise<string> {
  let current = path.resolve(start);
  while (true) {
    try {
      if ((await fsp.stat(current)).isDirectory()) return current;
    } catch {
      // Walk upward until chokidar has a real directory it can subscribe to.
    }
    const parent = path.dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

/** Directories chokidar must subscribe to for exact external file targets. */
export async function externalWatchRoots(targets: Iterable<string>): Promise<string[]> {
  const roots = new Set<string>();
  for (const target of targets) {
    roots.add(await nearestExistingDirectory(path.dirname(path.resolve(target))));
  }
  return [...roots];
}

/**
 * Everything the book reads from OUTSIDE its own folder — absolute paths,
 * deduped. The project watch root covers in-book files; this is what it can't
 * see.
 *
 * A multi-book repository keeps its shared foundation next to the books
 * (`shared/styles/publisher-components.css`, `shared/plugins/components.js`)
 * and each book's manifest points at it directly: a `styles:` entry is a path
 * to READ (asset-inline.ts inlines it; nothing is staged or copied) and an
 * authored plugin `path:` resolves against the manifest directory. Both may sit
 * above the book root.
 *
 * The stylesheet side is the DEPENDENCY CLOSURE, not just the declared entry —
 * `collectStyleDependencies` follows each active stylesheet's `@import` chain
 * and every local `url()` it references. A shared theme's
 * `url("../../fonts/Publisher.woff2")` is a file a design tool can replace
 * without touching one line of CSS; watching only `theme.css` would leave the
 * preview stale after that swap with nothing downstream to correct it. The
 * closure is computed from ALL active stylesheets, including in-book ones,
 * because a local stylesheet can reference a shared font just as easily — only
 * the results that land outside the book are added here.
 *
 * Watching is per-FILE, never per-directory, so the set stays exact and cannot
 * accidentally pull a large sibling tree into the watcher.
 */
export async function externalWatchTargets(
  projectDir: string,
  config: { styles?: string[]; plugins?: ResolvedPluginConfig[] }
): Promise<string[]> {
  const root = path.resolve(projectDir);
  let canonicalRoot = root;
  try {
    canonicalRoot = await fsp.realpath(root);
  } catch {
    // The preview root is validated elsewhere; retain the resolved spelling if
    // it disappears during a restart race.
  }
  const styles = await resolveActiveStyles(root, config.styles);
  const candidates = [
    ...(await collectStyleDependencies(root, styles)),
    ...(config.plugins ?? [])
      .map((p) => p.path)
      .filter((p): p is string => !!p)
      .map((p) => path.resolve(root, p)),
  ];

  const external = new Set<string>();
  for (const abs of candidates) {
    const authoredPath = path.resolve(abs);
    const authoredRel = path.relative(root, authoredPath);
    if (
      authoredRel !== "" &&
      (authoredRel === ".." ||
        authoredRel.startsWith(`..${path.sep}`) ||
        path.isAbsolute(authoredRel))
    ) {
      // Keep the manifest-authored path so replacing or retargeting a symlink is
      // observable, not only edits to its current referent.
      external.add(authoredPath);
    }

    let canonicalPath = authoredPath;
    try {
      // Chokidar reports the filesystem's canonical casing. Resolve existing
      // targets too so exact event filtering works on case-insensitive filesystems
      // and direct edits to a symlink's referent are observed.
      canonicalPath = await fsp.realpath(canonicalPath);
    } catch {
      // Missing targets retain their authored path so ancestor watching can
      // observe their later creation.
    }
    const rel = path.relative(canonicalRoot, canonicalPath);
    // Inside the project (or the project itself) — already covered by the
    // project watch root.
    if (
      rel === "" ||
      (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel))
    ) continue;
    external.add(canonicalPath);
  }
  return [...external];
}

/**
 * Create and configure a file watcher for the project's input directory plus
 * the book's declared external dependencies (see {@link externalWatchTargets}).
 *
 * Nothing is mirrored anywhere: the old external-asset-root watching (a sibling
 * `../_shared` directory copied under its own name into the temp dir) went away
 * with `copyAssets` and the manifest's `source.assets` field it depended on.
 * The project is served straight from disk and stylesheets are inlined at
 * render time, so an external dependency needs watching, not staging.
 */
export function createFileWatcher(state: ServerState): FSWatcher {
  const inputResolved = path.resolve(state.currentInputPath);
  const watcher = watch(inputResolved, {
    persistent: true,
    ignoreInitial: true,
    ignored: (candidatePath: string) => isIgnoredWatchPath(candidatePath, inputResolved),
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
  let desiredExternals = new Set<string>();
  const externalWatcher = watch([], {
    persistent: true,
    // Initial adds are observed so a missing target created while its new watch
    // root is still scanning cannot fall through an ignoreInitial race.
    ignoreInitial: false,
    ignored: (candidatePath: string) =>
      !isExternalWatchCandidate(candidatePath, desiredExternals),
    awaitWriteFinish: {
      stabilityThreshold: 100,
      pollInterval: 50,
    },
  });
  let closed = false;

  // Paths changed during the current debounce window. Multi-file rewrites are
  // coalesced into one full-document rebuild.
  const pendingChanges = new Map<string, string>(); // filePath -> last event
  const suppressInitialExternalAdds = new Set<string>();

  /** (Re-)arm the debounced rebuild timer. */
  function scheduleRebuild(): void {
    if (closed) return;
    if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
    state.rebuildTimer = setTimeout(runRebuild, DEBOUNCE.FILE_WATCH);
  }

  function recordChange(event: string, filePath: string): void {
    if (closed) return;
    debug(`File ${event}: ${filePath}`);
    pendingChanges.set(path.resolve(filePath), event);
    scheduleRebuild();
  }

  watcher.on('all', recordChange);
  externalWatcher.on('all', (event, filePath) => {
    const target = path.resolve(filePath);
    if (!desiredExternals.has(target)) return;
    if (event === 'add' && suppressInitialExternalAdds.delete(target)) return;
    recordChange(event, target);
  });

  /**
   * Declared external dependencies currently under watch. A separate watcher
   * owns them so watching a nearest existing ancestor can never unwatch or
   * duplicate the book root. Re-synced before each render.
   */
  let watchedExternalRoots = new Set<string>();
  let syncQueue: Promise<void> = Promise.resolve();
  function syncExternalWatches(): Promise<void> {
    syncQueue = syncQueue.then(runSyncExternalWatches, runSyncExternalWatches);
    return syncQueue;
  }
  async function runSyncExternalWatches(): Promise<void> {
    if (closed) return;
    let nextTargets: Set<string>;
    try {
      nextTargets = new Set(
        (await externalWatchTargets(inputResolved, state.config)).map((target) => path.resolve(target))
      );
    } catch (err) {
      debug(`Could not resolve external watch targets: ${err}`);
      return;
    }
    if (closed) return;

    const previousTargets = desiredExternals;
    // The ignored callback reads this set while add() scans a new root.
    desiredExternals = nextTargets;
    const nextRoots = new Set(await externalWatchRoots(nextTargets));

    for (const root of watchedExternalRoots) {
      if (!nextRoots.has(root)) await externalWatcher.unwatch(root);
    }
    for (const target of nextTargets) {
      if (desiredExternals.has(target)) {
        try {
          if ((await fsp.stat(target)).isFile()) {
            suppressInitialExternalAdds.add(target);
            setTimeout(() => suppressInitialExternalAdds.delete(target), 1000);
          }
        } catch {
          suppressInitialExternalAdds.delete(target);
        }
      }
    }
    for (const root of nextRoots) {
      if (!watchedExternalRoots.has(root)) externalWatcher.add(root);
    }
    for (const target of nextTargets) {
      if (!previousTargets.has(target)) info(`Watching shared dependency: ${target}`);
    }
    watchedExternalRoots = nextRoots;
  }
  void syncExternalWatches();

  async function runRebuild(): Promise<void> {
      if (closed || state.isRebuilding) return;

      // Snapshot + clear AFTER the isRebuilding guard so changes skipped by an
      // in-flight rebuild stay pending until the rebuild's finally re-arms the
      // timer (see below) — no further fs event is required to flush them.
      const changes = [...pendingChanges.entries()];
      pendingChanges.clear();
      if (changes.length === 0) return;

      state.isRebuilding = true;
      let resolveInFlight!: () => void;
      const inFlight = new Promise<void>((resolve) => { resolveInFlight = resolve; });
      state.rebuildPromise = inFlight;
      try {
        info('Regenerating preview...');

        // Re-render book.html for EVERY burst, including a CSS-only one. CSS is
        // INLINED into book.html's `<style data-project-css>` block at render
        // time (asset-inline.ts), so a style edit really does change book.html
        // — skipping the re-render would leave the persisted file holding stale
        // styles until some later markdown edit happened to force one.
        const manifest = await loadManifest(inputResolved);
        if (closed) return;
        const updatedConfig = resolveConfig({}, manifest);
        state.config = updatedConfig;
        // Subscribe from the new manifest BEFORE rendering it. A newly declared
        // shared file may not exist yet, which correctly makes this render fail;
        // watching the missing path first lets its later creation recover the
        // preview without another manifest edit or a server restart.
        await syncExternalWatches();
        if (closed) return;
        await generateAndWriteHtml(inputResolved, state.tempDir, updatedConfig);
        if (closed) return;

        state.previewServer?.broadcastReload();
        info(
          changes.length > 1
            ? `Preview updated (${changes.length} files changed — full reload)`
            : 'Preview updated'
        );
      } catch (err) {
        logError('Failed to regenerate preview:', err);
      } finally {
        state.isRebuilding = false;
        resolveInFlight();
        if (state.rebuildPromise === inFlight) state.rebuildPromise = null;
        // Changes that arrived DURING this rebuild had their debounce timer
        // fire into the isRebuilding guard above — with no further fs event
        // they would be orphaned forever. Re-arm the timer so they rebuild.
        if (!closed && pendingChanges.size > 0) scheduleRebuild();
      }
  }

  const closeBookWatcher = watcher.close.bind(watcher);
  watcher.close = async () => {
    closed = true;
    await syncQueue.catch(() => {});
    await state.rebuildPromise?.catch(() => {});
    await externalWatcher.close();
    await closeBookWatcher();
  };

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
  // Mark the watcher closed before waiting for an active render. Its close
  // override flips the watcher-local `closed` flag synchronously, preventing
  // new events and follow-up rebuilds even if shutdown's outer timeout expires.
  const watcher = state.currentWatcher;
  state.currentWatcher = null;
  let closeError: unknown;
  const closePromise = watcher?.close().catch((err) => { closeError = err; });

  // restartPreview changes currentInputPath/config only after this returns. Let
  // an active render finish against its original project so old and new projects
  // can never write the same book.html.
  await state.rebuildPromise?.catch(() => {});
  await closePromise;
  if (state.rebuildTimer) {
    clearTimeout(state.rebuildTimer);
    state.rebuildTimer = null;
  }
  if (closeError) throw closeError;
}
