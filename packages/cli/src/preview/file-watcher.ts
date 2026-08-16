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
import { resolveActiveStyles } from '../lib/style-resolver';
import { collectStyleDependencies, type AssetCopy } from '../lib/asset-inline';
import { loadPluginsWithCss } from '../lib/markdown/plugins';
import { BOOK_HTML_FILENAME } from '../lib/desktop';
import type { ServerState } from './server-context';
import type { ResolvedPluginConfig } from '../schema/manifest.types';

/**
 * Tiny placeholder book.html for no-input mode. The desktop's iframe needs a
 * valid src to load; the desktop app (packages/desktop) detects `hasInput: false`
 * via /api/status and shows its own folder picker. Plain text only — no
 * engine, no plugins, no manifest.
 */
const EMPTY_BOOK_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>gutterpress preview</title>
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
 * Whether the incremental preview shell is active. The historical env name is
 * retained because users may already set it. A single Markdown edit paginates
 * only that source file; geometry-wide changes still swap a full document.
 */
export function incrementalPreviewEnabled(): boolean {
  return process.env.GUTTERPRESS_PREVIEW_INCREMENTAL !== "0";
}

/**
 * Shared preview render path. renderChapters() does all Markdown + CSS work.
 *
 * Named `renderPreviewBook` (ARCH finding #53) to distinguish it from
 * build-runner.ts's `renderBook` — same name, different module, and a
 * genuinely different contract: this one is degrade-and-report (a plugin the
 * author enabled but hasn't installed yet is skipped with a loud warning so
 * the rest of the live preview still renders); build-runner.ts's is
 * fail-fast, because a final artifact must never silently drop a plugin.
 * Both preambles now share {@link loadPluginsWithCss}.
 */
async function renderPreviewBook(
  inputPath: string,
  config: { title?: string; styles?: string[]; plugins?: ResolvedPluginConfig[] },
  opts: {
    files: string[] | null;
    wrapChapters: boolean;
    /**
     * Receives the inliner's copy plan so the HTTP server can resolve the
     * rewritten asset URLs — see {@link ServerState.cssAssets}. The build
     * COPIES these files; the preview serves them from their real location.
     */
    onCssAssets?: (copies: AssetCopy[]) => void;
  }
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
    annotateSourceChapters: true,
    ...(opts.onCssAssets ? { onCssAssets: opts.onCssAssets } : {}),
    // ARCH finding #4: Gutterpress's typed, line-numbered marker warnings
    // (env.layoutWarnings) used to be discarded here too — this is the
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
 * Rewrite rendered book HTML for the live preview: inject the Gutterpress
 * engine's viewer bundle (`/engine/gutterpress-viewer.js`, embedded the same
 * way as every other preview asset — see lib/embedded-assets.ts) PLUS the
 * galley editor bundle and the preview-interface.js/preview-bridge.js pair,
 * before `</head>`.
 * preview-interface.js defines `window.previewAPI` for in-iframe controls;
 * preview-bridge.js is the postMessage bridge for the cross-origin desktop
 * toolbar — together they make the desktop's whole
 * `gutterpress:cmd/reply/event` command protocol work.
 *
 * The galley editor (Galley v2 — see docs/tiptap-galley-architecture.md)
 * orchestrates the viewer mount itself, so `window.__GP_MANUAL__=1` is set
 * between the viewer and galley bundles to suppress the viewer's auto-mount.
 * Both bundles are preview-only by construction — build output goes through
 * shipViewerHtml, never through this injector.
 *
 * `pageIsolateChapters` is reserved for the one-source render. The full book
 * always paginates as one document: native preview updates use a full iframe
 * swap, so forcing every source wrapper to a new page buys no incremental
 * splice boundary and diverges from the PDF whenever a source file begins in
 * the middle of a printed page.
 */
export function injectPreviewScripts(
  html: string,
  pageIsolateChapters: boolean,
): string {
  const scripts =
    // ORDER IS LOAD-BEARING: the viewer decides whether to arm its
    // DOMContentLoaded auto-mount AT SCRIPT EVALUATION, so the manual flag
    // must exist BEFORE the viewer bundle runs. With the flag after it, the
    // viewer auto-mounted AND the galley mounted — a double mount that
    // doubled every sheet (the cross-browser smoke caught it: gp:layout
    // said 4 pages, the DOM held 8).
    '  <script>window.__GP_MANUAL__=1</script>\n  '
    + '<script src="/engine/gutterpress-viewer.js"></script>\n  '
    + '<script src="/engine/gutterpress-galley.js"></script>\n  '
    + '<script src="/preview/scripts/preview-interface.js"></script>\n  '
    + '<script src="/preview/scripts/preview-bridge.js"></script>\n';
  let output = /<\/head>/i.test(html)
    ? html.replace(/<\/head>/i, scripts + '</head>')
    : html + scripts;
  if (pageIsolateChapters && /<\/head>/i.test(output)) {
    output = output.replace(
      /<\/head>/i,
      '<style>.gutterpress-chapter{break-before:page}</style>\n</head>'
    );
  }
  return output;
}

/**
 * Generate HTML from markdown and write book.html to the temp directory.
 * The desktop's iframe loads `book.html` via a relative URL — same name in
 * dev and in published static-site builds.
 *
 * Empty `inputPath` writes a static placeholder — the desktop app (packages/desktop)
 * supplies a real path via its own folder picker.
 *
 * `cssAssets` is REQUIRED, not optional: it is the map the HTTP server resolves
 * the inliner's rewritten asset URLs against (see {@link ServerState.cssAssets}),
 * so a caller that skipped it would render a book.html whose shared-art URLs
 * 404 — the exact bug this parameter exists to fix, reintroduced silently.
 * Every render replaces its contents.
 */
export async function generateAndWriteHtml(
  inputPath: string,
  tempDir: string,
  config: { title?: string; styles?: string[]; source?: { files?: string[] | null }; plugins?: ResolvedPluginConfig[] },
  cssAssets: Map<string, string>
): Promise<void> {
  if (!inputPath) {
    cssAssets.clear();
    await fsp.writeFile(path.join(tempDir, BOOK_HTML_FILENAME), EMPTY_BOOK_HTML, "utf-8");
    return;
  }
  // Collect into a fresh map and swap at the end, so a render that throws
  // leaves the previous (still-served) book.html's assets resolvable instead
  // of half-clearing them.
  const nextAssets = new Map<string, string>();
  const html = await renderPreviewBook(inputPath, config, {
    files: config.source?.files ?? null,
    wrapChapters: false,
    onCssAssets: (copies) => {
      for (const copy of copies) nextAssets.set(copy.to, copy.from);
    },
  });
  cssAssets.clear();
  for (const [to, from] of nextAssets) cssAssets.set(to, from);
  await fsp.writeFile(
    path.join(tempDir, BOOK_HTML_FILENAME),
    injectPreviewScripts(html, false),
    "utf-8"
  );
}

/** One changed project file, named for the preview broadcast decision. */
export interface ChangedFile {
  relativePath: string;
  ext: string;
  event: string;
}

/**
 * Describe in-project changes using the same canonical path form emitted in
 * `data-chapter-src`. Declared external dependencies intentionally drop out;
 * their presence in the original change count forces a full reload.
 */
export function describeChanges(
  changes: [filePath: string, event: string][],
  inputResolved: string
): ChangedFile[] {
  const files: ChangedFile[] = [];
  for (const [changedPath, event] of changes) {
    const relative = path.relative(inputResolved, path.resolve(changedPath));
    if (
      relative === '' ||
      relative === '..' ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) continue;
    files.push({
      relativePath: canonicalChapterId(relative),
      ext: path.extname(changedPath).toLowerCase(),
      event,
    });
  }
  return files;
}

export type BroadcastDecision =
  | { kind: 'chapter-splice'; chapterId: string; relativePath: string }
  | { kind: 'full-reload' };

/** A single surviving Markdown edit can be paginated independently. */
export function decideBroadcast(
  files: ChangedFile[],
  changeCount: number,
  incremental: boolean
): BroadcastDecision {
  const only = files.length === 1 ? files[0]! : null;
  if (
    incremental &&
    changeCount === 1 &&
    only?.ext === '.md' &&
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
 * `~/.local/share/gutterpress/books/mybook`, or any `~/.config/...` tree) had
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
 * Path segments inside the project whose subtrees are GENERATED or VENDORED, and
 * so are never publication source (R15): `dist/` is build output — one
 * `gutterpress build` writes a whole book's worth of files there — and
 * `plugins/npm/`, `node_modules/` are managed dependency trees a plugin install
 * writes wholesale. Watching them meant a build or an install stormed the
 * debounce and triggered full preview re-renders for output nobody edited.
 *
 * A book's OWN `plugins/*.js` is author-written source and keeps firing; only the
 * `npm` subtree under it is managed.
 */
function isGeneratedProjectPath(relative: string): boolean {
  const segments = relative.split("/");
  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (segment === "dist" || segment === "node_modules") return true;
    if (segment === "plugins" && segments[i + 1] === "npm") return true;
  }
  return false;
}

/**
 * Whether the watcher should ignore a path.
 *
 * IN-PROJECT paths get the dotfile rule ({@link isDotPathUnderRoot}) — a
 * project's own `.git/`, `.DS_Store`, editor swap files, and so on are noise —
 * plus the generated/vendored-subtree rule ({@link isGeneratedProjectPath}).
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
  // The root itself is not `<root>/…`, so it falls out here as "not ignored" —
  // which is what the dotfile rule returned for it anyway.
  if (!normalizedPath.startsWith(normalizedRoot + "/")) return false;
  const relative = normalizedPath.slice(normalizedRoot.length + 1);
  return isDotPathUnderRoot(candidatePath, projectRoot) || isGeneratedProjectPath(relative);
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
 * `chokidar.FSWatcher#add()` returns the watcher instance synchronously —
 * the real work (stat the path, read the directory, THEN call `fs.watch()`)
 * runs as a fire-and-forget internal promise that `add()` never returns to
 * the caller. Await-ing only the synchronous return therefore does not mean
 * the OS-level watch is live yet: `runSyncExternalWatches` could resolve,
 * `state.isRebuilding` could flip back to `false`, and a caller could write
 * the newly-declared file before chokidar had actually started listening —
 * the exact race behind the `file-watcher.test.ts` "recovers when a manifest
 * declares a shared stylesheet before that file exists" flake (~1-in-3, 20s
 * timeout: the manifest rebuild registers the missing file's watch
 * asynchronously, and the test's write can land before the watch does).
 *
 * Chokidar 5 doesn't expose that internal promise publicly. This captures it
 * by wrapping the internal handler method `add()` itself calls, for the
 * duration of ONE `add()` call only, then awaits every promise it produced —
 * `add()`'s own bookkeeping (ready-count, ignore state, …) runs completely
 * untouched; this only observes the promise it already creates. If a future
 * chokidar version renames or removes that internal method, this silently
 * falls back to plain `add()` — still correct, just racy again on that
 * fallback path (the behavior this function replaces).
 *
 * ALL roots go through ONE call: the wrap/unwrap pair is not reentrant, and
 * two overlapping calls would nest their wrappers and restore them out of
 * order, leaving one installed on the shared handler for the life of the
 * process (its `pending` array then retains every later add's promise).
 * `add()` takes an array, so one call covers every new root anyway.
 */
async function addAndAwaitWatch(watcher: FSWatcher, roots: string[]): Promise<void> {
  const handler = (watcher as unknown as { _nodeFsHandler?: Record<string, unknown> })
    ._nodeFsHandler;
  const original = handler?._addToNodeFs;
  if (!handler || typeof original !== "function") {
    watcher.add(roots);
    return;
  }
  const pending: Array<Promise<unknown>> = [];
  handler._addToNodeFs = (...args: unknown[]) => {
    const p = (original as (...a: unknown[]) => Promise<unknown>).apply(handler, args);
    pending.push(p);
    return p;
  };
  try {
    watcher.add(roots); // synchronously invokes the wrapped method above
    await Promise.all(pending);
  } finally {
    handler._addToNodeFs = original;
  }
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
  // coalesced into one full-document rebuild; one Markdown save can splice.
  const pendingChanges = new Map<string, string>(); // filePath -> last event
  /** Debounced no-broadcast regeneration after inline-edit saves (ADR 0011). */
  let silentRegenTimer: ReturnType<typeof setTimeout> | null = null;
  const suppressInitialExternalAdds = new Set<string>();
  const settledWrites = new Map<string, { content: string; expiresAt: number }>();
  let immediatePending = false;

  /** (Re-)arm the debounced rebuild timer. */
  function scheduleRebuild(): void {
    if (closed) return;
    if (state.rebuildTimer) clearTimeout(state.rebuildTimer);
    const timer = setTimeout(() => {
      if (state.rebuildTimer === timer) state.rebuildTimer = null;
      void runRebuild();
    }, DEBOUNCE.FILE_WATCH);
    state.rebuildTimer = timer;
  }

  async function recordChange(event: string, filePath: string): Promise<void> {
    if (closed) return;
    const target = path.resolve(filePath);
    const settled = settledWrites.get(target);
    if (settled && event !== 'unlink' && Date.now() <= settled.expiresAt) {
      const diskContent = await fsp.readFile(target, 'utf8').catch(() => null);
      if (closed) return;
      if (settledWrites.get(target) === settled && diskContent === settled.content) {
        debug(`Suppressed settled-write watcher echo: ${target}`);
        return;
      }
    }
    if (settledWrites.get(target) === settled) settledWrites.delete(target);
    debug(`File ${event}: ${target}`);
    pendingChanges.set(target, event);
    scheduleRebuild();
  }

  watcher.on('all', (event, filePath) => { void recordChange(event, filePath); });
  externalWatcher.on('all', (event, filePath) => {
    const target = path.resolve(filePath);
    if (!desiredExternals.has(target)) return;
    if (event === 'add' && suppressInitialExternalAdds.delete(target)) return;
    void recordChange(event, target);
  });

  function isWatchedSource(target: string): boolean {
    const rel = path.relative(inputResolved, target);
    const inProject =
      rel === '' ||
      (rel !== '..' && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel));
    if (inProject) return !isIgnoredWatchPath(target, inputResolved);
    return desiredExternals.has(target);
  }

  function acceptSettledWrite(target: string, writtenContent: string, origin?: string): void {
    const settled = { content: writtenContent, expiresAt: Date.now() + 2000 };
    settledWrites.set(target, settled);
    const expiry = setTimeout(() => {
      if (settledWrites.get(target) === settled) settledWrites.delete(target);
    }, 2000);
    expiry.unref?.();
    // An inline-edit write is a projection of the DOM the author is looking
    // at (ADR 0011): suppress the watcher echo and NEVER broadcast — the
    // editing surface must not swap mid-session. But DO regenerate
    // book.html quietly after typing settles, so the next load (a readonly
    // toggle, a fresh window, the CLI preview) serves the edited book
    // instead of a stale one.
    if (origin === 'inline-edit') {
      if (silentRegenTimer) clearTimeout(silentRegenTimer);
      silentRegenTimer = setTimeout(() => {
        silentRegenTimer = null;
        if (closed) return;
        // A rebuild in flight may have STARTED before this inline save
        // landed on disk — its render would not include the edit, so
        // dropping the regen here could leave book.html stale forever.
        // Re-arm instead of dropping.
        if (state.isRebuilding) {
          if (!closed) {
            silentRegenTimer = setTimeout(() => acceptSettledWrite(target, writtenContent, origin), 1500);
            silentRegenTimer.unref?.();
          }
          return;
        }
        const regen = (async () => {
          try {
            const manifest = await loadManifest(inputResolved);
            // Re-check AFTER the await: stopFileWatcher (project switch)
            // sets `closed` synchronously and AWAITS this promise, so this
            // check is what prevents a stale regen from overwriting the
            // NEW project's book.html (Opus-verified TOCTOU race).
            if (closed) return;
            const updatedConfig = resolveConfig({ engine: state.options.engine }, manifest);
            await generateAndWriteHtml(inputResolved, state.tempDir, updatedConfig, state.cssAssets);
          } catch {
            /* best-effort freshness — the next ordinary rebuild converges */
          }
        })();
        state.silentRegenPromise = regen;
        void regen.finally(() => {
          if (state.silentRegenPromise === regen) state.silentRegenPromise = null;
        });
      }, 3000);
      silentRegenTimer.unref?.();
      return;
    }
    pendingChanges.set(target, 'change');
    immediatePending = true;
    if (state.rebuildTimer) {
      clearTimeout(state.rebuildTimer);
      state.rebuildTimer = null;
    }
    if (!state.isRebuilding) void runRebuild();
  }

  state.notifySettledWrite = (filePath, writtenContent, origin) => {
    if (closed) return;
    const target = path.resolve(filePath);
    if (isWatchedSource(target)) {
      acceptSettledWrite(target, writtenContent, origin);
      return;
    }
    // Initial discovery of declared shared dependencies is asynchronous. Recheck
    // once that scan settles so a save immediately after preview startup cannot
    // fall between direct notification and the external watcher's initial add.
    void syncQueue.then(() => {
      if (!closed && isWatchedSource(target)) acceptSettledWrite(target, writtenContent, origin);
    });
  };

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
    const newRoots = [...nextRoots].filter((root) => !watchedExternalRoots.has(root));
    if (newRoots.length) await addAndAwaitWatch(externalWatcher, newRoots);
    for (const target of nextTargets) {
      if (!previousTargets.has(target)) info(`Watching shared dependency: ${target}`);
    }
    watchedExternalRoots = nextRoots;
  }
  void syncExternalWatches();

  async function runRebuild(): Promise<void> {
      if (closed || state.isRebuilding) return;
      if (state.rebuildTimer) {
        clearTimeout(state.rebuildTimer);
        state.rebuildTimer = null;
      }

      // Snapshot + clear AFTER the isRebuilding guard so changes skipped by an
      // in-flight rebuild stay pending until the rebuild's finally re-arms the
      // timer (see below) — no further fs event is required to flush them.
      const changes = [...pendingChanges.entries()];
      pendingChanges.clear();
      if (changes.length === 0) return;
      immediatePending = false;

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
        const updatedConfig = resolveConfig({ engine: state.options.engine }, manifest);
        state.config = updatedConfig;
        // Subscribe from the new manifest BEFORE rendering it. A newly declared
        // shared file may not exist yet, which correctly makes this render fail;
        // watching the missing path first lets its later creation recover the
        // preview without another manifest edit or a server restart.
        await syncExternalWatches();
        if (closed) return;
        await generateAndWriteHtml(inputResolved, state.tempDir, updatedConfig, state.cssAssets);
        if (closed) return;

        const decision = decideBroadcast(
          describeChanges(changes, inputResolved),
          changes.length,
          incrementalPreviewEnabled(),
        );
        if (decision.kind === 'chapter-splice') {
          state.previewServer?.broadcastContentUpdate(decision.chapterId);
          info(`Chapter updated: ${decision.relativePath}`);
        } else {
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
        resolveInFlight();
        if (state.rebuildPromise === inFlight) state.rebuildPromise = null;
        // Changes that arrived DURING this rebuild had their debounce timer
        // fire into the isRebuilding guard above — with no further fs event
        // they would be orphaned forever. Re-arm the timer so they rebuild.
        if (!closed && pendingChanges.size > 0) {
          if (immediatePending) void runRebuild();
          else scheduleRebuild();
        }
      }
  }

  const closeBookWatcher = watcher.close.bind(watcher);
  watcher.close = async () => {
    closed = true;
    state.notifySettledWrite = null;
    settledWrites.clear();
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
 * watcher once the user picks a directory through the desktop.
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
  await state.silentRegenPromise?.catch(() => {});
  await closePromise;
  if (state.rebuildTimer) {
    clearTimeout(state.rebuildTimer);
    state.rebuildTimer = null;
  }
  if (closeError) throw closeError;
}
