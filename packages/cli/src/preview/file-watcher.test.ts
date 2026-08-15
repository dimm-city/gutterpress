/**
 * Tests for file watcher scenarios
 *
 * Validates file watching, debouncing, rebuild triggering, and state management
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir as mkdirp, symlink } from 'fs/promises';
import { tmpdir } from 'os';
import { join, parse } from 'path';
import {
  generateAndWriteHtml,
  renderChapterPreviewHtml,
  createFileWatcher,
  startFileWatcher,
  stopFileWatcher,
  injectPreviewScripts,
  externalWatchTargets,
  externalWatchRoots,
  isExternalWatchCandidate,
  isDotPathUnderRoot,
  isIgnoredWatchPath,
  describeChanges,
  decideBroadcast,
  type ChangedFile,
} from './file-watcher';
import { resolveConfig } from '../lib/manifest';
import type { ServerState } from './server-context';
import type { PreviewServerOptions } from '../types';

/**
 * Helper to create minimal server state for testing
 */
function createTestServerState(
  inputPath: string,
  tempDir: string,
  options: Partial<PreviewServerOptions> = {}
): ServerState {
  const config = resolveConfig({}, {});

  return {
    currentInputPath: inputPath,
    tempDir,
    config,
    options: {
      port: 3000,
      host: '127.0.0.1',
      verbose: false,
      noWatch: false,
      openBrowser: false,
      ...options,
    },
    currentWatcher: null,
    rebuildTimer: null,
    isRebuilding: false,
    previewServer: null,
    isShuttingDown: false,
    cssAssets: new Map<string, string>(),
  };
}

/**
 * Helper to wait for a specified duration
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Shared cadence + budget for every "wait until the watcher caught up" loop
 * below.
 *
 * These budgets used to be hand-written per loop at 10s (and a 3s cap on the
 * watcher-ready wait). A loaded CI runner overruns that: `recovers when a
 * manifest declares a shared stylesheet before that file exists` has failed at
 * ~10.28s on `main` as well as on PR branches — a flake, not a regression,
 * since chokidar's rescan plus the rebuild simply hadn't finished yet.
 *
 * Every loop here returns the instant its condition holds, so a larger budget
 * costs nothing on a healthy machine; it only stops a test giving up while the
 * work is still in flight. Each enclosing test's timeout is sized above the
 * sum of the budgets it can spend.
 */
const POLL_STEP_MS = 25;
const POLL_BUDGET_MS = 20_000;
const POLL_STEPS = Math.ceil(POLL_BUDGET_MS / POLL_STEP_MS);

/**
 * Poll `ready()` on the shared cadence. Returns as soon as it holds, or once
 * the budget is spent — deliberately WITHOUT throwing, so the assertion that
 * follows reports the actual state rather than a bare timeout.
 */
async function pollUntil(ready: () => boolean): Promise<void> {
  for (let i = 0; i < POLL_STEPS; i++) {
    await wait(POLL_STEP_MS);
    if (ready()) return;
  }
}

/**
 * Wait (bounded) until chokidar finishes its initial scan and is ready to
 * receive events, instead of assuming a fixed 200ms. Resolves on 'ready' (the
 * fast path) or after a safety cap so a missed 'ready' can never hang the test.
 * The watcher is created with ignoreInitial, so 'ready' is the correct signal
 * that manual emits / real fs events will be handled.
 *
 * The cap is the shared budget, not the old 3s: expiring here does NOT fail —
 * the caller proceeds and writes files the watcher may not be listening for
 * yet, so a cap that expires early turns a slow scan into a missed event and
 * an unexplained timeout further down.
 */
function waitForWatcherReady(watcher: ReturnType<typeof createFileWatcher>): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) {
        done = true;
        resolve();
      }
    };
    watcher.on("ready", finish);
    void (async () => {
      const steps = Math.ceil(POLL_BUDGET_MS / 10);
      for (let i = 0; i < steps && !done; i++) await wait(10);
      finish();
    })();
  });
}

describe('generateAndWriteHtml', () => {
  let testDir: string;
  let tempDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-temp-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  }, 60000);

  test('generates book.html with proper doctype', async () => {
    // Create test markdown file
    await writeFile(join(testDir, 'chapter-01.md'), '# Test Heading\n\nTest content.');

    const config = resolveConfig({ title: 'Test' }, {});

    await generateAndWriteHtml(testDir, tempDir, config, new Map());

    // Check that book.html was created
    const outputPath = join(tempDir, 'book.html');
    const file = Bun.file(outputPath);
    const exists = await file.exists();
    expect(exists).toBe(true);

    // Verify content includes markdown conversion
    const content = await file.text();
    expect(content).toContain('Test Heading');
    expect(content).toContain('Test content');

    // Verify doctype is present
    expect(content.toLowerCase()).toContain('<!doctype');
  }, 60000);

  test('overwrites existing book.html', async () => {
    await writeFile(join(testDir, 'chapter-01.md'), '# First Version');

    const config = resolveConfig({ title: 'Test' }, {});

    // First generation
    await generateAndWriteHtml(testDir, tempDir, config, new Map());
    const outputPath = join(tempDir, 'book.html');
    let content = await Bun.file(outputPath).text();
    expect(content).toContain('First Version');

    // Update markdown and regenerate
    await writeFile(join(testDir, 'chapter-01.md'), '# Second Version');
    await generateAndWriteHtml(testDir, tempDir, config, new Map());

    content = await Bun.file(outputPath).text();
    expect(content).toContain('Second Version');
    expect(content).not.toContain('First Version');
  }, 60000);

  test('handles multiple markdown files', async () => {
    await writeFile(join(testDir, 'chapter-01.md'), '# Chapter 1');
    await writeFile(join(testDir, 'chapter-02.md'), '# Chapter 2');

    const config = resolveConfig({ title: 'Test' }, {});

    await generateAndWriteHtml(testDir, tempDir, config, new Map());

    const content = await Bun.file(join(tempDir, 'book.html')).text();
    expect(content).toContain('Chapter 1');
    expect(content).toContain('Chapter 2');
    expect(content).not.toContain('class="gutterpress-chapter"');
    // Full previews cannot add chapter wrappers because wrappers alter native
    // pagination, but every source-mapped block still needs its chapter id so
    // preview→editor sync can disambiguate per-file line numbers.
    expect(content).toMatch(/<h1[^>]*data-chapter-src="chapter-01\.md"/);
    expect(content).toMatch(/<h1[^>]*data-chapter-src="chapter-02\.md"/);
    expect(content).not.toContain('<style>.gutterpress-chapter{break-before:page}</style>');
  }, 60000);

  test('renders one source file for the drift verifier (/__chapter, ADR 0010)', async () => {
    await writeFile(join(testDir, 'chapter-01.md'), '# Chapter 1');
    await writeFile(join(testDir, 'chapter-02.md'), '# Chapter 2');

    const content = await renderChapterPreviewHtml(
      testDir,
      'chapter-02.md',
      resolveConfig({ title: 'Test' }, {}),
    );

    expect(content).toContain('Chapter 2');
    expect(content).toContain('class="gutterpress-chapter"');
    expect(content).toContain('data-chapter-src="chapter-02.md"');
    expect(content).not.toContain('Chapter 1');
    // The consumer is DOMParser inside the edit module — the render must be
    // script-free and carry no splice-era page-isolate style.
    expect(content).not.toContain('<style>.gutterpress-chapter{break-before:page}</style>');
    expect(content).not.toContain('/engine/gutterpress-viewer.js');
    expect(content).toMatch(/<h1[^>]*data-source-range="0:1"/);
  }, 60000);

  test('omits incremental wrappers when the incremental preview is disabled', async () => {
    await writeFile(join(testDir, 'chapter-01.md'), '# Chapter 1');
    await writeFile(join(testDir, 'chapter-02.md'), '# Chapter 2');
    const previous = process.env.GUTTERPRESS_PREVIEW_INCREMENTAL;
    process.env.GUTTERPRESS_PREVIEW_INCREMENTAL = '0';
    try {
      await generateAndWriteHtml(testDir, tempDir, resolveConfig({ title: 'Test' }, {}), new Map());
    } finally {
      if (previous === undefined) delete process.env.GUTTERPRESS_PREVIEW_INCREMENTAL;
      else process.env.GUTTERPRESS_PREVIEW_INCREMENTAL = previous;
    }

    const content = await Bun.file(join(tempDir, 'book.html')).text();
    expect(content).not.toContain('class="gutterpress-chapter"');
    expect(content).toContain('data-chapter-src="chapter-01.md"');
    expect(content).toContain('data-chapter-src="chapter-02.md"');
    expect(content).not.toContain('.gutterpress-chapter{break-before:page}');
  }, 60000);

  // ARCH finding #4 — preview terminal surfacing. Before this fix, the
  // preview's renderPreviewBook() (shared by generateAndWriteHtml AND the
  // incremental per-chapter splice) called renderChapters() with no way to
  // observe markdown-it-paged's env.layoutWarnings, so an author whose marker
  // was silently ignored (e.g. a stray @continue) got zero feedback anywhere
  // in the running preview server. warn() (leveled logger) prints via
  // console.log, not console.warn — see utils/logger.ts's emit().
  test('warns via the leveled logger for a chapter with a marker mistake', async () => {
    await writeFile(
      join(testDir, 'chapter-01.md'),
      '# Chapter One\n\n@continue\n\nOrphaned continuation text.\n'
    );

    const config = resolveConfig({ title: 'Test' }, {});

    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    let lines: string[];
    try {
      await generateAndWriteHtml(testDir, tempDir, config, new Map());
      // Read mock.calls BEFORE mockRestore() — bun's mockRestore() clears the
      // recorded call history (mockReset semantics), same as Jest.
      lines = (logSpy.mock.calls as unknown[][]).map((call) => call.join(' '));
    } finally {
      logSpy.mockRestore();
    }

    const match = lines.find(
      (line) => line.includes('chapter-01.md') && line.includes('line 3') && line.includes('@continue')
    );
    expect(match).toBeDefined();
  }, 60000);

  test('does not warn for a chapter with no marker mistakes', async () => {
    await writeFile(join(testDir, 'chapter-01.md'), '# Chapter One\n\nJust prose.\n');

    const config = resolveConfig({ title: 'Test' }, {});

    const logSpy = spyOn(console, 'log').mockImplementation(() => {});
    let callCount: number;
    try {
      await generateAndWriteHtml(testDir, tempDir, config, new Map());
      callCount = logSpy.mock.calls.length;
    } finally {
      logSpy.mockRestore();
    }

    expect(callCount).toBe(0);
  }, 60000);
});

describe('injectPreviewScripts', () => {
  const html = `<!doctype html>\n<html><head><title>t</title>\n</head><body></body></html>`;

  test('injects the viewer + galley bundles + interface scripts before </head>', () => {
    const out = injectPreviewScripts(html, false);
    expect(out).toContain('/engine/gutterpress-viewer.js');
    // The galley entry orchestrates the viewer mount itself, so the manual
    // flag must land BETWEEN the viewer and galley bundles.
    expect(out).toContain('window.__GP_MANUAL__=1');
    expect(out).toContain('/engine/gutterpress-galley.js');
    expect(out.indexOf('/engine/gutterpress-viewer.js'))
      .toBeLessThan(out.indexOf('window.__GP_MANUAL__=1'));
    expect(out.indexOf('window.__GP_MANUAL__=1'))
      .toBeLessThan(out.indexOf('/engine/gutterpress-galley.js'));
    expect(out).toContain('/preview/scripts/preview-interface.js');
    expect(out).toContain('/preview/scripts/preview-bridge.js');
    // The old inline-edit module and its feature flags are gone (Galley v2).
    expect(out).not.toContain('gutterpress-edit.js');
    expect(out).not.toContain('__GP_EDIT_FEATURES__');
  });

  test('page-isolates source wrappers only for incremental preview', () => {
    const isolate = '<style>.gutterpress-chapter{break-before:page}</style>';
    expect(injectPreviewScripts(html, true)).toContain(isolate);
    expect(injectPreviewScripts(html, false)).not.toContain(isolate);
  });
});

describe('incremental broadcast decision', () => {
  const markdown = (relativePath: string, event = 'change'): ChangedFile => ({
    relativePath,
    ext: '.md',
    event,
  });

  test('uses a chapter splice for one surviving Markdown edit', () => {
    expect(decideBroadcast([markdown('chapters/one.md')], 1, true)).toEqual({
      kind: 'chapter-splice',
      chapterId: 'chapters/one.md',
      relativePath: 'chapters/one.md',
    });
  });

  test('uses a full reload for deletion, multi-file, external, and disabled cases', () => {
    expect(decideBroadcast([markdown('one.md', 'unlink')], 1, true)).toEqual({ kind: 'full-reload' });
    expect(decideBroadcast([markdown('one.md'), markdown('two.md')], 2, true)).toEqual({ kind: 'full-reload' });
    expect(decideBroadcast([], 1, true)).toEqual({ kind: 'full-reload' });
    expect(decideBroadcast([markdown('one.md')], 1, false)).toEqual({ kind: 'full-reload' });
  });

  test('describes in-project paths with canonical forward slashes', () => {
    const root = join(tmpdir(), 'gutterpress-change-root');
    expect(describeChanges([[join(root, 'sub\\chapter.md'), 'change']], root)).toEqual([{
      relativePath: 'sub/chapter.md',
      ext: '.md',
      event: 'change',
    }]);
    expect(describeChanges([[join(root, '..', 'shared', 'theme.css'), 'change']], root)).toEqual([]);
  });
});

describe('externalWatchTargets', () => {
  test('returns declared styles and authored plugins that live outside the book', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'gutterpress-shared-'));
    try {
      const book = join(repo, 'books', 'core-book');
      await mkdirp(join(book, 'styles'), { recursive: true });
      await mkdirp(join(repo, 'shared', 'styles'), { recursive: true });
      await mkdirp(join(repo, 'shared', 'plugins'), { recursive: true });
      await writeFile(join(book, 'styles', 'book.css'), 'body{}');
      await writeFile(join(repo, 'shared', 'styles', 'components.css'), 'body{}');
      await writeFile(join(repo, 'shared', 'plugins', 'components.js'), 'export default () => {};');

      const targets = await externalWatchTargets(book, {
        styles: ['../../shared/styles/components.css', 'styles/book.css'],
        plugins: [
          { path: '../../shared/plugins/components.js', priority: 100, options: {} },
          { path: './plugins/local.js', priority: 100, options: {} },
          { name: 'markdown-it-emoji', priority: 100, options: {} },
        ],
      });

      // Only the two out-of-book entries; in-book paths are already covered by
      // the project watch root, and an npm plugin has no source path at all.
      expect(targets.sort()).toEqual(
        [
          join(repo, 'shared', 'styles', 'components.css'),
          join(repo, 'shared', 'plugins', 'components.js'),
        ].sort(),
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test('watches both an authored external symlink and its current referent', async () => {
    if (process.platform === 'win32') return;
    const repo = await mkdtemp(join(tmpdir(), 'gutterpress-shared-link-'));
    try {
      const book = join(repo, 'book');
      const shared = join(repo, 'shared');
      const target = join(shared, 'theme-v1.css');
      const link = join(shared, 'theme.css');
      await mkdirp(book, { recursive: true });
      await mkdirp(shared, { recursive: true });
      await writeFile(target, 'body{}');
      await symlink(target, link);

      const targets = await externalWatchTargets(book, {
        styles: ['../shared/theme.css'],
      });

      expect(targets).toContain(link);
      expect(targets).toContain(target);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test('follows a shared stylesheet\'s url() and @import closure', async () => {
    // Codex review on PR #129: a design tool can replace a shared FONT without
    // touching one line of CSS. Watching only the declared theme.css would let
    // that swap leave the "authoritative" preview stale forever.
    const repo = await mkdtemp(join(tmpdir(), 'gutterpress-closure-'));
    try {
      const book = join(repo, 'books', 'core-book');
      const shared = join(repo, 'shared');
      await mkdirp(book, { recursive: true });
      await mkdirp(join(shared, 'themes', 'publisher'), { recursive: true });
      await mkdirp(join(shared, 'fonts'), { recursive: true });
      await writeFile(join(shared, 'fonts', 'Publisher.woff2'), 'font-bytes');
      await writeFile(join(shared, 'themes', 'publisher', 'palette.css'), ':root{--c:red}');
      await writeFile(
        join(shared, 'themes', 'publisher', 'theme.css'),
        '@import "./palette.css";\n' +
          '@font-face{font-family:P;src:url("../../fonts/Publisher.woff2")}\n',
      );

      const targets = await externalWatchTargets(book, {
        styles: ['../../shared/themes/publisher/theme.css'],
      });

      expect(targets.sort()).toEqual(
        [
          join(shared, 'themes', 'publisher', 'theme.css'),
          join(shared, 'themes', 'publisher', 'palette.css'),
          join(shared, 'fonts', 'Publisher.woff2'),
        ].sort(),
      );
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test('follows a LOCAL stylesheet out to a shared font', async () => {
    // The closure is computed from every active stylesheet, not just the
    // external ones: a book-local sheet can reference a shared face too.
    const repo = await mkdtemp(join(tmpdir(), 'gutterpress-localref-'));
    try {
      const book = join(repo, 'books', 'core-book');
      await mkdirp(join(book, 'styles'), { recursive: true });
      await mkdirp(join(repo, 'shared', 'fonts'), { recursive: true });
      await writeFile(join(repo, 'shared', 'fonts', 'Body.woff2'), 'font-bytes');
      await writeFile(
        join(book, 'styles', 'book.css'),
        '@font-face{font-family:B;src:url("../../../shared/fonts/Body.woff2")}',
      );

      const targets = await externalWatchTargets(book, { styles: ['styles/book.css'] });

      // The local sheet itself is covered by the project watch root; only the
      // font escapes the book.
      expect(targets).toEqual([join(repo, 'shared', 'fonts', 'Body.woff2')]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });

  test('a missing or unparseable stylesheet never throws', async () => {
    // A watcher that throws stops watching everything; the build is what
    // reports these properly.
    const book = await mkdtemp(join(tmpdir(), 'gutterpress-bad-'));
    try {
      await mkdirp(join(book, 'styles'), { recursive: true });
      await writeFile(join(book, 'styles', 'broken.css'), 'body { color: ');
      expect(
        await externalWatchTargets(book, {
          styles: ['styles/broken.css', 'styles/does-not-exist.css'],
        }),
      ).toEqual([]);
    } finally {
      await rm(book, { recursive: true, force: true });
    }
  });

  test('returns nothing for a self-contained book', async () => {
    const book = await mkdtemp(join(tmpdir(), 'gutterpress-book-'));
    try {
      await mkdirp(join(book, 'styles'), { recursive: true });
      await writeFile(join(book, 'styles', 'book.css'), 'body{}');
      expect(await externalWatchTargets(book, { styles: ['styles/book.css'] })).toEqual([]);
    } finally {
      await rm(book, { recursive: true, force: true });
    }
  });
});

describe('isIgnoredWatchPath', () => {
  const root = join(tmpdir(), 'proj');

  test('applies the dotfile rule inside the project', () => {
    expect(isIgnoredWatchPath(join(root, '.git', 'config'), root)).toBe(true);
    expect(isIgnoredWatchPath(join(root, 'chapter-01.md'), root)).toBe(false);
  });

  test('never ignores a declared external dependency, dot-prefixed ancestors and all', () => {
    // The dotfile rule tests every segment relative to the root; for a path
    // OUTSIDE the root that would mean testing its whole absolute path, so a
    // shared foundation under `~/.local/share/...` would vanish silently.
    expect(isIgnoredWatchPath(join(tmpdir(), '.local', 'shared', 'theme.css'), root)).toBe(false);
  });
});

describe('external watch roots', () => {
  test('allows only an exact target and its ancestors', () => {
    const target = join(tmpdir(), 'repo', 'shared', 'styles', 'book.css');
    expect(isExternalWatchCandidate(target, [target])).toBe(true);
    expect(isExternalWatchCandidate(join(tmpdir(), 'repo', 'shared'), [target])).toBe(true);
    expect(isExternalWatchCandidate(join(tmpdir(), 'repo', '.git'), [target])).toBe(false);
    expect(isExternalWatchCandidate(join(tmpdir(), 'repo', 'shared', 'other.css'), [target])).toBe(false);
  });

  test('treats a filesystem root as an ancestor of its target', () => {
    const root = parse(tmpdir()).root;
    expect(isExternalWatchCandidate(root, [join(root, 'missing', 'shared.css')])).toBe(true);
  });

  test('uses the nearest existing ancestor when the target hierarchy is missing', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'gutterpress-watch-root-'));
    try {
      const missing = join(repo, 'shared', 'styles', 'book.css');
      expect(await externalWatchRoots([missing])).toEqual([repo]);
    } finally {
      await rm(repo, { recursive: true, force: true });
    }
  });
});

describe('isDotPathUnderRoot', () => {
  const root = '/home/user/project';

  test('ignores a dotfile directly under the root', () => {
    expect(isDotPathUnderRoot(join(root, '.env'), root)).toBe(true);
  });

  test('ignores anything under a dot-directory in the project', () => {
    expect(isDotPathUnderRoot(join(root, '.git', 'config'), root)).toBe(true);
  });

  test('does not ignore an ordinary project file', () => {
    expect(isDotPathUnderRoot(join(root, 'chapter-01.md'), root)).toBe(false);
  });

  test('does not ignore the root itself', () => {
    expect(isDotPathUnderRoot(root, root)).toBe(false);
  });

  test('does not ignore a project file merely because an ANCESTOR of the root has a dot prefix', () => {
    // This is the exact chokidar bug isDotPathUnderRoot fixes: chokidar tests
    // its `ignored` matcher against the WHOLE absolute path, so the old
    // `/(^|[\/\\])\../ ` regex matched a dot-prefixed ancestor like ".local"
    // here just as readily as a real project dotfile — silently disabling
    // the watcher for every file in the project.
    const dotAncestorRoot = '/home/user/.local/share/gutterpress/books/mybook';
    expect(isDotPathUnderRoot(join(dotAncestorRoot, 'chapter-01.md'), dotAncestorRoot)).toBe(false);
    expect(isDotPathUnderRoot(join(dotAncestorRoot, '.env'), dotAncestorRoot)).toBe(true);
  });
});

describe('createFileWatcher', () => {
  let testDir: string;
  let tempDir: string;
  let state: ServerState;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-temp-'));

    await writeFile(join(testDir, 'chapter-01.md'), '# Initial');

    state = createTestServerState(testDir, tempDir);
  });

  afterEach(async () => {
    if (state.currentWatcher) {
      await state.currentWatcher.close();
      state.currentWatcher = null;
    }

    await rm(testDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  }, 60000);

  test('creates watcher for input directory', async () => {
    const watcher = createFileWatcher(state);

    expect(watcher).toBeDefined();
    expect(typeof watcher.close).toBe('function');

    await watcher.close();
  });

  test('triggers rebuild on markdown file change', async () => {
    const watcher = createFileWatcher(state);

    await waitForWatcherReady(watcher);

    await writeFile(join(testDir, 'chapter-01.md'), '# Updated Content');

    await wait(700);

    const content = await Bun.file(join(testDir, 'chapter-01.md')).text();
    expect(content).toContain('Updated Content');

    await watcher.close();
  }, 30000);

  test('ignores dot files', async () => {
    const watcher = createFileWatcher(state);

    await waitForWatcherReady(watcher);

    await writeFile(join(testDir, '.hidden'), 'hidden content');

    await wait(700);

    const file = Bun.file(join(testDir, '.hidden'));
    const exists = await file.exists();
    expect(exists).toBe(true);

    await watcher.close();
  }, 30000);

  test('a project rooted under a dot-ancestor directory still receives change events', async () => {
    // Regression for the chokidar `ignored`-matcher bug isDotPathUnderRoot
    // fixes (see its doc comment in file-watcher.ts): the OLD regex tested
    // the FULL absolute path, so a dot-prefixed ANCESTOR directory (e.g.
    // `~/.local/share/gutterpress/books/mybook`) matched the dotfile rule just
    // like a real project dotfile would — silently disabling the watcher for
    // every file in the project, with no error anywhere. Root a real project
    // explicitly under a dot directory and prove an edit still reaches the
    // watcher and produces a broadcast.
    const dotAncestorBase = await mkdtemp(join(tmpdir(), 'gutterpress-test-dotroot-'));
    const dotProjectDir = join(dotAncestorBase, '.hidden-parent', 'book');
    await mkdirp(dotProjectDir, { recursive: true });
    await writeFile(join(dotProjectDir, 'chapter-01.md'), '# Initial');
    const dotTempDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-temp-'));
    const dotState = createTestServerState(dotProjectDir, dotTempDir);

    const calls = attachBroadcastRecorder(dotState);
    const watcher = createFileWatcher(dotState);
    dotState.currentWatcher = watcher;
    try {
      await waitForWatcherReady(watcher);

      await writeFile(join(dotProjectDir, 'chapter-01.md'), '# Updated under a dot ancestor');
      await waitForRebuild(dotState, calls);

      expect(calls).toEqual([{ type: 'content-update', arg: 'chapter-01.md' }]);
    } finally {
      await watcher.close();
      await rm(dotAncestorBase, { recursive: true, force: true });
      await rm(dotTempDir, { recursive: true, force: true });
    }
  }, 50000);

  /** Mock preview server that records every broadcast. */
  function attachBroadcastRecorder(s: ServerState) {
    const calls: { type: string; arg?: string }[] = [];
    s.previewServer = {
      port: 0,
      async close() {},
      broadcastReload() { calls.push({ type: 'full-reload' }); },
      broadcastContentUpdate(file: string) { calls.push({ type: 'content-update', arg: file }); },
    } as any;
    return calls;
  }

  /** Wait until the debounced rebuild has fired and finished. */
  async function waitForRebuild(s: ServerState, calls: { type: string }[]) {
    await pollUntil(() => calls.length > 0 && !s.isRebuilding);
  }

  test('single markdown change broadcasts a chapter update', async () => {
    await writeFile(join(testDir, 'chapter-02.md'), '# Two');
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'change', join(testDir, 'chapter-02.md'));
    await waitForRebuild(state, calls);

    expect(calls).toEqual([{ type: 'content-update', arg: 'chapter-02.md' }]);
    await watcher.close();
  }, 50000);

  test('a host-confirmed settled write rebuilds immediately and suppresses its watcher echo', async () => {
    const chapter = join(testDir, 'chapter-01.md');
    const content = '# Saved directly by the desktop';
    await writeFile(chapter, content);
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    const notify = (state as ServerState & {
      notifySettledWrite?: (filePath: string, writtenContent: string) => void;
    }).notifySettledWrite;
    expect(typeof notify).toBe('function');
    notify?.(chapter, content);
    expect(state.isRebuilding).toBe(true);
    await waitForRebuild(state, calls);
    expect(calls).toEqual([{ type: 'content-update', arg: 'chapter-01.md' }]);

    watcher.emit('all', 'change', chapter);
    await wait(400);
    expect(calls).toEqual([{ type: 'content-update', arg: 'chapter-01.md' }]);
    await watcher.close();
  }, 50000);

  test('an inline-edit settled write suppresses BOTH the rebuild and its watcher echo (ADR 0010)', async () => {
    // The write is a projection of DOM the preview already shows: rebuilding
    // (and broadcasting a swap) would yank the editing surface out from
    // under the author mid-keystroke. Only the echo suppression runs.
    const chapter = join(testDir, 'chapter-01.md');
    const content = '# Saved by the inline editor';
    await writeFile(chapter, content);
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    const notify = (state as ServerState & {
      notifySettledWrite?: (filePath: string, writtenContent: string, origin?: string) => void;
    }).notifySettledWrite;
    notify?.(chapter, content, 'inline-edit');
    expect(state.isRebuilding).toBe(false);
    await wait(400);
    expect(calls).toEqual([]);

    // The watcher's echo of that same write must also stay silent — the
    // settled-write record covers it exactly like the classic path.
    watcher.emit('all', 'change', chapter);
    await wait(400);
    expect(calls).toEqual([]);
    await watcher.close();
  }, 50000);

  test('multiple files changed in one debounce window trigger a full reload, not a splice', async () => {
    // Simulates a multi-file disk rewrite (version restore / sync merge):
    // a burst of events inside one debounce window must NOT collapse into a
    // single-chapter splice — that leaves the other chapters stale.
    await writeFile(join(testDir, 'chapter-02.md'), '# Two');
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'change', join(testDir, 'chapter-01.md'));
    watcher.emit('all', 'change', join(testDir, 'chapter-02.md'));
    await waitForRebuild(state, calls);

    expect(calls).toEqual([{ type: 'full-reload' }]);
    await watcher.close();
  }, 50000);

  test('css-only burst full-reloads so the engine repaginates', async () => {
    await writeFile(join(testDir, 'a.css'), 'body{color:red}');
    await writeFile(join(testDir, 'b.css'), 'body{margin:0}');
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'change', join(testDir, 'a.css'));
    watcher.emit('all', 'change', join(testDir, 'b.css'));
    await waitForRebuild(state, calls);

    // A stylesheet edit changes page geometry, leading, spacing, break rules —
    // so the live view must repaginate, not re-link a stale layout.
    expect(calls).toEqual([{ type: 'full-reload' }]);
    await watcher.close();
  }, 50000);

  test('editing a shared stylesheet outside the book rebuilds the preview', async () => {
    // The multi-book layout: books/<book>/ reads ../../shared/styles/*.css.
    // The shared file is above the project watch root, so it is only seen
    // because the manifest declares it (externalWatchTargets).
    const repo = await mkdtemp(join(tmpdir(), 'gutterpress-test-repo-'));
    const book = join(repo, 'books', 'core-book');
    const sharedCss = join(repo, 'shared', 'styles', 'components.css');
    await mkdirp(book, { recursive: true });
    await mkdirp(join(repo, 'shared', 'styles'), { recursive: true });
    await writeFile(join(book, 'chapter-01.md'), '# One');
    await writeFile(sharedCss, 'body { color: red }');
    await writeFile(
      join(book, 'manifest.yaml'),
      'title: Core Book\nstyles:\n  - ../../shared/styles/components.css\n',
    );
    const sharedTempDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-temp-'));
    const sharedState = createTestServerState(book, sharedTempDir);
    sharedState.config = resolveConfig({}, {
      title: 'Core Book',
      styles: ['../../shared/styles/components.css'],
    });

    const calls = attachBroadcastRecorder(sharedState);
    const watcher = createFileWatcher(sharedState);
    sharedState.currentWatcher = watcher;
    try {
      await waitForWatcherReady(watcher);
      // The external target is added asynchronously after the watcher exists.
      await wait(300);

      // A REAL write (not an emitted event) — this only reaches the watcher
      // if the external target was genuinely added to it.
      await writeFile(sharedCss, 'body { color: blue }');
      await waitForRebuild(sharedState, calls);

      expect(calls).toEqual([{ type: 'full-reload' }]);
    } finally {
      await watcher.close();
      await rm(repo, { recursive: true, force: true });
      await rm(sharedTempDir, { recursive: true, force: true });
    }
  }, 50000);

  test('replacing a shared font referenced only by CSS rebuilds the preview', async () => {
    // The font is never named by the manifest — it is reached through the
    // shared theme's url(). Swapping the file must still repaginate.
    const repo = await mkdtemp(join(tmpdir(), 'gutterpress-test-font-'));
    const book = join(repo, 'books', 'core-book');
    const fontPath = join(repo, 'shared', 'fonts', 'Publisher.woff2');
    await mkdirp(book, { recursive: true });
    await mkdirp(join(repo, 'shared', 'themes', 'publisher'), { recursive: true });
    await mkdirp(join(repo, 'shared', 'fonts'), { recursive: true });
    await writeFile(join(book, 'chapter-01.md'), '# One');
    await writeFile(fontPath, 'original-font-bytes');
    await writeFile(
      join(repo, 'shared', 'themes', 'publisher', 'theme.css'),
      '@font-face{font-family:P;src:url("../../fonts/Publisher.woff2")}',
    );
    const fontTempDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-temp-'));
    const fontState = createTestServerState(book, fontTempDir);
    fontState.config = resolveConfig({}, {
      title: 'Core Book',
      styles: ['../../shared/themes/publisher/theme.css'],
    });

    const calls = attachBroadcastRecorder(fontState);
    const watcher = createFileWatcher(fontState);
    fontState.currentWatcher = watcher;
    try {
      await waitForWatcherReady(watcher);
      await wait(300); // external targets are added asynchronously

      await writeFile(fontPath, 'replaced-font-bytes');
      await waitForRebuild(fontState, calls);

      expect(calls).toEqual([{ type: 'full-reload' }]);
    } finally {
      await watcher.close();
      await rm(repo, { recursive: true, force: true });
      await rm(fontTempDir, { recursive: true, force: true });
    }
  }, 50000);

  test('recovers when a manifest declares a shared stylesheet before that file exists', async () => {
    const repo = await mkdtemp(join(tmpdir(), 'gutterpress-test-late-shared-'));
    const book = join(repo, 'books', 'core-book');
    const sharedDir = join(repo, 'shared', 'styles');
    const sharedCss = join(sharedDir, 'late.css');
    const manifestPath = join(book, 'manifest.yaml');
    await mkdirp(book, { recursive: true });
    await writeFile(join(book, 'chapter-01.md'), '# One');
    await writeFile(manifestPath, 'title: Core Book\n');
    const lateTempDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-temp-'));
    const lateState = createTestServerState(book, lateTempDir);

    const calls = attachBroadcastRecorder(lateState);
    const watcher = createFileWatcher(lateState);
    lateState.currentWatcher = watcher;
    try {
      await waitForWatcherReady(watcher);
      await writeFile(
        manifestPath,
        'title: Core Book\nstyles:\n  - ../../shared/styles/late.css\n',
      );

      // The manifest rebuild fails because late.css is missing, but the updated
      // config and its missing external target must already be under watch.
      await pollUntil(
        () =>
          !!lateState.config.styles?.includes('../../shared/styles/late.css') &&
          !lateState.isRebuilding,
      );
      expect(lateState.config.styles).toContain('../../shared/styles/late.css');
      expect(calls).toEqual([]);

      await mkdirp(sharedDir, { recursive: true });
      await writeFile(sharedCss, 'body { color: blue }');
      await waitForRebuild(lateState, calls);

      expect(calls).toEqual([{ type: 'full-reload' }]);
      expect(await Bun.file(join(lateTempDir, 'book.html')).text()).toContain('color: blue');
    } finally {
      await watcher.close();
      await rm(repo, { recursive: true, force: true });
      await rm(lateTempDir, { recursive: true, force: true });
    }
  }, 70000);

  test('a change arriving during an in-flight rebuild triggers a follow-up rebuild without a new fs event', async () => {
    await writeFile(join(testDir, 'chapter-02.md'), '# Two');

    // Block the FIRST rebuild mid-flight by gating loadManifest.
    const manifestMod = await import('../lib/manifest');
    const realLoadManifest = manifestMod.loadManifest;
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let loadCalls = 0;
    mock.module('../lib/manifest', () => ({
      ...manifestMod,
      loadManifest: async (p: string) => {
        loadCalls++;
        if (loadCalls === 1) await gate;
        return realLoadManifest(p);
      },
    }));

    try {
      const calls = attachBroadcastRecorder(state);
      const watcher = createFileWatcher(state);
      state.currentWatcher = watcher;
      await waitForWatcherReady(watcher);

      // First change → debounce fires → rebuild starts and blocks on the gate.
      watcher.emit('all', 'change', join(testDir, 'chapter-01.md'));
      await pollUntil(() => loadCalls > 0);
      expect(loadCalls).toBe(1);

      // Second change lands DURING the in-flight rebuild. Its debounce timer
      // fires into the isRebuilding guard — without the finally re-arm it
      // would be orphaned until some future fs event.
      watcher.emit('all', 'change', join(testDir, 'chapter-02.md'));
      await wait(400); // well past DEBOUNCE.FILE_WATCH
      expect(calls.length).toBe(0); // first rebuild still blocked, nothing broadcast

      release();

      // Both rebuilds complete with NO further fs events.
      await pollUntil(() => calls.length >= 2 && !state.isRebuilding);
      expect(calls.length).toBe(2);
      expect(calls).toEqual([
        { type: 'content-update', arg: 'chapter-01.md' },
        { type: 'content-update', arg: 'chapter-02.md' },
      ]);
      await watcher.close();
    } finally {
      // Restore the real module for the remaining tests.
      mock.module('../lib/manifest', () => ({ ...manifestMod }));
    }
  }, 70000);

  test('deleted markdown file triggers a full reload, not a splice', async () => {
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'unlink', join(testDir, 'chapter-99.md'));
    await waitForRebuild(state, calls);

    expect(calls).toEqual([{ type: 'full-reload' }]);
    await watcher.close();
  }, 50000);

  test('prevents overlapping rebuilds with isRebuilding flag', async () => {
    state.isRebuilding = true;

    const watcher = createFileWatcher(state);

    await waitForWatcherReady(watcher);

    await writeFile(join(testDir, 'chapter-01.md'), '# During Rebuild');

    await wait(700);

    expect(state.isRebuilding).toBe(true);

    await watcher.close();
  }, 30000);
});

describe('startFileWatcher', () => {
  let testDir: string;
  let tempDir: string;
  let state: ServerState;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-temp-'));

    await writeFile(join(testDir, 'chapter-01.md'), '# Test');

    state = createTestServerState(testDir, tempDir);
  });

  afterEach(async () => {
    if (state.currentWatcher) {
      await state.currentWatcher.close();
      state.currentWatcher = null;
    }

    await rm(testDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  }, 60000);

  test('creates watcher when noWatch is false', () => {
    state.options.noWatch = false;
    startFileWatcher(state);
    expect(state.currentWatcher).not.toBeNull();
  });

  test('does not create watcher when noWatch is true', () => {
    state.options.noWatch = true;
    startFileWatcher(state);
    expect(state.currentWatcher).toBeNull();
  });
});

describe('stopFileWatcher', () => {
  let testDir: string;
  let tempDir: string;
  let state: ServerState;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'gutterpress-test-temp-'));

    await writeFile(join(testDir, 'chapter-01.md'), '# Test');

    state = createTestServerState(testDir, tempDir);
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  }, 60000);

  test('stops watcher and clears reference', async () => {
    startFileWatcher(state);
    expect(state.currentWatcher).not.toBeNull();

    await stopFileWatcher(state);

    expect(state.currentWatcher).toBeNull();
  });

  test('safe to call when no watcher exists', async () => {
    state.currentWatcher = null;
    await stopFileWatcher(state);
    expect(state.currentWatcher).toBeNull();
  });

  test('safe to call multiple times', async () => {
    startFileWatcher(state);

    await stopFileWatcher(state);
    await stopFileWatcher(state);
    await stopFileWatcher(state);

    expect(state.currentWatcher).toBeNull();
  });

  test('cancels a pending debounced rebuild scheduled just before close', async () => {
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;

    // Track whether the rebuild callback ever started running.
    let rebuildStarted = false;
    Object.defineProperty(state, 'isRebuilding', {
      configurable: true,
      get() {
        return false;
      },
      set(_v: boolean) {
        // The debounced rebuild callback flips isRebuilding = true as its
        // first action. If the timer was cleared on close this never fires.
        rebuildStarted = true;
      },
    });

    // Emit a change to schedule the debounced rebuild timer, then immediately
    // close the watcher — exactly the race restartPreview can hit.
    watcher.emit('all', 'change', join(testDir, 'chapter-01.md'));
    await stopFileWatcher(state);

    // Advance real time well past DEBOUNCE.FILE_WATCH (100ms).
    await wait(400);

    expect(rebuildStarted).toBe(false);
  }, 10000);
});

// ── 2026-07-29 audit: generated output is not a source edit ──────────────────
//
// The in-project ignore rule was the dotfile rule alone, so `gutterpress build`
// (which writes a whole book's worth of files into `dist/`) and a plugin install
// (which vendors a tree under `plugins/npm/`) both stormed the watcher and
// triggered full preview re-renders for output nobody edited. Generated and
// vendored trees are never publication SOURCE (R15).

describe("isIgnoredWatchPath — generated and vendored subtrees", () => {
  const root = "/book";

  test("ignores build output under dist/", () => {
    expect(isIgnoredWatchPath("/book/dist/field-guide/field-guide-pdf.pdf", root)).toBe(true);
    expect(isIgnoredWatchPath("/book/dist", root)).toBe(true);
    expect(isIgnoredWatchPath("/book/dist/book.html", root)).toBe(true);
  });

  test("ignores the vendored npm plugin tree", () => {
    expect(isIgnoredWatchPath("/book/plugins/npm/some-plugin/1.0.0/index.js", root)).toBe(true);
    expect(isIgnoredWatchPath("/book/node_modules/.bin/x", root)).toBe(true);
  });

  test("does NOT ignore a book's own authored plugin source", () => {
    // `plugins/*.js` is author-written source; only `plugins/npm/**` is managed.
    expect(isIgnoredWatchPath("/book/plugins/components.js", root)).toBe(false);
  });

  test("does NOT ignore a source file whose name merely starts with an ignored segment", () => {
    expect(isIgnoredWatchPath("/book/distribution.md", root)).toBe(false);
    expect(isIgnoredWatchPath("/book/chapters/distant-shores.md", root)).toBe(false);
  });

  test("still ignores dotfiles, and still leaves OUT-of-project paths alone", () => {
    expect(isIgnoredWatchPath("/book/.env", root)).toBe(true);
    // A declared external dependency under a dot-prefixed ancestor must keep
    // firing — the regression isDotPathUnderRoot exists for.
    expect(isIgnoredWatchPath("/home/u/.local/share/shared/styles/x.css", root)).toBe(false);
  });
});
