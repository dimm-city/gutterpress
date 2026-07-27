/**
 * Tests for file watcher scenarios
 *
 * Validates file watching, debouncing, rebuild triggering, and state management
 */

import { describe, test, expect, beforeEach, afterEach, mock, spyOn } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir as mkdirp } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  generateAndWriteHtml,
  createFileWatcher,
  startFileWatcher,
  stopFileWatcher,
  injectPreviewScripts,
  describeChanges,
  cssHotSwapPaths,
  decideBroadcast,
  isDotPathUnderRoot,
  type ChangedFile,
} from './file-watcher';
import { pagedjsPolyfillTag } from '../lib/pagedjs-marker';
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
  };
}

/**
 * Helper to wait for a specified duration
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait (bounded) until chokidar finishes its initial scan and is ready to
 * receive events, instead of assuming a fixed 200ms. Resolves on 'ready' (the
 * fast path) or after a safety cap so a missed 'ready' can never hang the test.
 * The watcher is created with ignoreInitial, so 'ready' is the correct signal
 * that manual emits / real fs events will be handled.
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
      for (let i = 0; i < 300 && !done; i++) await wait(10); // ≤3s safety cap
      finish();
    })();
  });
}

describe('generateAndWriteHtml', () => {
  let testDir: string;
  let tempDir: string;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'print-md-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'print-md-test-temp-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  }, 60000);

  test('generates book.html with proper doctype', async () => {
    // Create test markdown file
    await writeFile(join(testDir, 'chapter-01.md'), '# Test Heading\n\nTest content.');

    const config = resolveConfig({ title: 'Test' }, {});

    await generateAndWriteHtml(testDir, tempDir, config);

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
    await generateAndWriteHtml(testDir, tempDir, config);
    const outputPath = join(tempDir, 'book.html');
    let content = await Bun.file(outputPath).text();
    expect(content).toContain('First Version');

    // Update markdown and regenerate
    await writeFile(join(testDir, 'chapter-01.md'), '# Second Version');
    await generateAndWriteHtml(testDir, tempDir, config);

    content = await Bun.file(outputPath).text();
    expect(content).toContain('Second Version');
    expect(content).not.toContain('First Version');
  }, 60000);

  test('handles multiple markdown files', async () => {
    await writeFile(join(testDir, 'chapter-01.md'), '# Chapter 1');
    await writeFile(join(testDir, 'chapter-02.md'), '# Chapter 2');

    const config = resolveConfig({ title: 'Test' }, {});

    await generateAndWriteHtml(testDir, tempDir, config);

    const content = await Bun.file(join(tempDir, 'book.html')).text();
    expect(content).toContain('Chapter 1');
    expect(content).toContain('Chapter 2');
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
      await generateAndWriteHtml(testDir, tempDir, config);
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
      await generateAndWriteHtml(testDir, tempDir, config);
      callCount = logSpy.mock.calls.length;
    } finally {
      logSpy.mockRestore();
    }

    expect(callCount).toBe(0);
  }, 60000);
});

describe('injectPreviewScripts', () => {
  const html = `<!doctype html>\n<html><head><title>t</title>\n  ${pagedjsPolyfillTag()}\n</head><body></body></html>`;

  test('swaps the polyfill slot for the interface scripts + served polyfill', () => {
    const out = injectPreviewScripts(html);
    expect(out).toContain('/preview/scripts/pagedjs-interface.js');
    expect(out).toContain('/preview/scripts/pagedjs-bridge.js');
    expect(out).toContain('/vendor/paged.polyfill.js');
    expect(out).not.toContain('data-pagedjs-polyfill');
  });

  // PAGINATION FIDELITY: the preview must not force a page break the build
  // doesn't have. This used to inject `.pmd-chapter{break-before:page}`, which
  // started every source file on a new page in the live view only.
  test('injects no page-break rule — preview paginates like the build', () => {
    const out = injectPreviewScripts(html);
    expect(out).not.toContain('break-before');
    expect(out).not.toContain('.pmd-chapter{');
  });
});

describe('cssHotSwapPaths', () => {
  const css = (p: string, event = 'change'): ChangedFile => ({ relativePath: p, ext: '.css', event });
  const md = (p: string): ChangedFile => ({ relativePath: p, ext: '.md', event: 'change' });

  test('returns every stylesheet path when the whole window is CSS', () => {
    expect(cssHotSwapPaths([css('a.css'), css('sub/b.css')], 2)).toEqual(['a.css', 'sub/b.css']);
  });

  test('returns null when any change is not a stylesheet', () => {
    expect(cssHotSwapPaths([css('a.css'), md('ch.md')], 2)).toBeNull();
  });

  test('returns null when a change resolved to no destination (count mismatch)', () => {
    // A change outside the watch root is dropped by describeChanges — the
    // fast path must not fire when it cannot account for every change.
    expect(cssHotSwapPaths([css('a.css')], 2)).toBeNull();
  });

  test('returns null for an empty window', () => {
    expect(cssHotSwapPaths([], 0)).toBeNull();
  });

  test('returns null when the stylesheet was deleted, not edited', () => {
    // Serve-in-place means the changed file IS the served file — there is no
    // copy step left to fail independently of the edit (see the old
    // `mirrored` flag this replaces). The one way a hot-swap can still go
    // stale is a DELETE: appending a fresh <link> to a path that now 404s
    // would break the live view with nothing downstream to repair it. That
    // must fall through to a full reload instead.
    const deleted: ChangedFile = { relativePath: 'a.css', ext: '.css', event: 'unlink' };
    expect(cssHotSwapPaths([deleted], 1)).toBeNull();
    expect(cssHotSwapPaths([css('ok.css'), deleted], 2)).toBeNull();
  });
});

describe('decideBroadcast', () => {
  const md = (p: string, event = 'change'): ChangedFile => ({ relativePath: p, ext: '.md', event });

  test('single surviving markdown change splices its chapter (canonical id)', () => {
    expect(decideBroadcast([md('sub/ch.md')], 1, true)).toEqual({
      kind: 'chapter-splice',
      chapterId: 'sub/ch.md',
      relativePath: 'sub/ch.md',
    });
  });

  test('multi-file windows always full-reload', () => {
    expect(decideBroadcast([md('a.md'), md('b.md')], 2, true)).toEqual({ kind: 'full-reload' });
  });

  test('a deleted markdown file full-reloads, never splices', () => {
    expect(decideBroadcast([md('a.md', 'unlink')], 1, true)).toEqual({ kind: 'full-reload' });
  });

  test('non-markdown and non-incremental changes full-reload', () => {
    expect(decideBroadcast([{ relativePath: 'x.txt', ext: '.txt', event: 'change' }], 1, true))
      .toEqual({ kind: 'full-reload' });
    expect(decideBroadcast([md('a.md')], 1, false)).toEqual({ kind: 'full-reload' });
  });
});

describe('describeChanges', () => {
  // describeChanges is pure and synchronous — no fs access at all (see its
  // doc comment: serve-in-place means there is nothing left to copy), so
  // these tests use synthetic paths instead of real directories on disk.
  const root = join(tmpdir(), 'print-md-describe-changes-fixture', 'project');

  test('describes a changed file relative to the project root', () => {
    const files = describeChanges([[join(root, 'ch.md'), 'change']], root);
    expect(files).toEqual([{ relativePath: 'ch.md', ext: '.md', event: 'change' }]);
  });

  test('a deleted file is still described — no fs existence check, the event alone says so', () => {
    const files = describeChanges([[join(root, 'gone.md'), 'unlink']], root);
    expect(files).toEqual([{ relativePath: 'gone.md', ext: '.md', event: 'unlink' }]);
  });

  test('a directory event is described with an empty extension', () => {
    const files = describeChanges([[join(root, 'themes'), 'addDir']], root);
    expect(files).toEqual([{ relativePath: 'themes', ext: '', event: 'addDir' }]);
  });

  test('a subdirectory path is described relative to the root, forward-slashed', () => {
    const files = describeChanges([[join(root, 'sub', 'ch.md'), 'change']], root);
    expect(files).toEqual([{ relativePath: 'sub/ch.md', ext: '.md', event: 'change' }]);
  });

  test('a change outside the watch root is dropped', () => {
    // There is exactly one watch root now (the project directory — the old
    // external-asset-root concept is gone with `source.assets`), so anything
    // outside it can't be named relative to the project and must be dropped
    // rather than broadcast with a meaningless path.
    const files = describeChanges([['/somewhere/else/x.css', 'change']], root);
    expect(files).toEqual([]);
  });

  test('describes every change in a multi-file window, in order', () => {
    const files = describeChanges(
      [
        [join(root, 'a.md'), 'change'],
        [join(root, 'b.css'), 'change'],
      ],
      root
    );
    expect(files).toEqual([
      { relativePath: 'a.md', ext: '.md', event: 'change' },
      { relativePath: 'b.css', ext: '.css', event: 'change' },
    ]);
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
    const dotAncestorRoot = '/home/user/.local/share/print-md/books/mybook';
    expect(isDotPathUnderRoot(join(dotAncestorRoot, 'chapter-01.md'), dotAncestorRoot)).toBe(false);
    expect(isDotPathUnderRoot(join(dotAncestorRoot, '.env'), dotAncestorRoot)).toBe(true);
  });
});

describe('createFileWatcher', () => {
  let testDir: string;
  let tempDir: string;
  let state: ServerState;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'print-md-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'print-md-test-temp-'));

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
  }, 10000);

  test('ignores dot files', async () => {
    const watcher = createFileWatcher(state);

    await waitForWatcherReady(watcher);

    await writeFile(join(testDir, '.hidden'), 'hidden content');

    await wait(700);

    const file = Bun.file(join(testDir, '.hidden'));
    const exists = await file.exists();
    expect(exists).toBe(true);

    await watcher.close();
  }, 10000);

  test('a project rooted under a dot-ancestor directory still receives change events', async () => {
    // Regression for the chokidar `ignored`-matcher bug isDotPathUnderRoot
    // fixes (see its doc comment in file-watcher.ts): the OLD regex tested
    // the FULL absolute path, so a dot-prefixed ANCESTOR directory (e.g.
    // `~/.local/share/print-md/books/mybook`) matched the dotfile rule just
    // like a real project dotfile would — silently disabling the watcher for
    // every file in the project, with no error anywhere. Root a real project
    // explicitly under a dot directory and prove an edit still reaches the
    // watcher and produces a broadcast.
    const dotAncestorBase = await mkdtemp(join(tmpdir(), 'print-md-test-dotroot-'));
    const dotProjectDir = join(dotAncestorBase, '.hidden-parent', 'book');
    await mkdirp(dotProjectDir, { recursive: true });
    await writeFile(join(dotProjectDir, 'chapter-01.md'), '# Initial');
    const dotTempDir = await mkdtemp(join(tmpdir(), 'print-md-test-temp-'));
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
  }, 30000);

  /** Mock preview server that records every broadcast. */
  function attachBroadcastRecorder(s: ServerState) {
    const calls: { type: string; arg?: string }[] = [];
    s.previewServer = {
      port: 0,
      async close() {},
      broadcastReload() { calls.push({ type: 'full-reload' }); },
      broadcastCssUpdate(p: string) { calls.push({ type: 'css-update', arg: p }); },
      broadcastContentUpdate(f: string) { calls.push({ type: 'content-update', arg: f }); },
    } as any;
    return calls;
  }

  /** Wait until the debounced rebuild has fired and finished. */
  async function waitForRebuild(s: ServerState, calls: { type: string }[]) {
    for (let i = 0; i < 400; i++) {
      await wait(25);
      if (calls.length > 0 && !s.isRebuilding) return;
    }
  }

  test('single markdown change broadcasts a content-update splice', async () => {
    await writeFile(join(testDir, 'chapter-02.md'), '# Two');
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'change', join(testDir, 'chapter-02.md'));
    await waitForRebuild(state, calls);

    expect(calls).toEqual([{ type: 'content-update', arg: 'chapter-02.md' }]);
    await watcher.close();
  }, 30000);

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
  }, 30000);

  test('css-only burst hot-swaps every changed stylesheet without a reload', async () => {
    await writeFile(join(testDir, 'a.css'), 'body{color:red}');
    await writeFile(join(testDir, 'b.css'), 'body{margin:0}');
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'change', join(testDir, 'a.css'));
    watcher.emit('all', 'change', join(testDir, 'b.css'));
    await waitForRebuild(state, calls);

    expect(calls.map((c) => c.type)).toEqual(['css-update', 'css-update']);
    expect(calls.map((c) => (c as any).arg).sort()).toEqual(['a.css', 'b.css']);
    await watcher.close();
  }, 30000);

  test('broadcast chapter paths use forward slashes (never backslashes)', async () => {
    // A chapter in a subdirectory must broadcast as "sub/file.md" so the SPA's
    // forward-slash editorChapter comparison matches on every platform.
    const { mkdir } = await import('fs/promises');
    await mkdir(join(testDir, 'sub'), { recursive: true });
    await writeFile(join(testDir, 'sub', 'chapter-03.md'), '# Three');
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'change', join(testDir, 'sub', 'chapter-03.md'));
    await waitForRebuild(state, calls);

    expect(calls).toEqual([{ type: 'content-update', arg: 'sub/chapter-03.md' }]);
    expect(calls[0]!.arg).not.toMatch(/\\/);
    await watcher.close();
  }, 30000);

  test('backslash separators in the relative path are normalized in the broadcast', async () => {
    // Windows can't be emulated here, so simulate a path whose relative part
    // contains a literal backslash separator: the emitted value must come out
    // with forward slashes and no backslash at all.
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'change', join(testDir, 'sub\\chapter-04.md'));
    await waitForRebuild(state, calls);

    expect(calls.length).toBe(1);
    expect(calls[0]!.type).toBe('content-update');
    expect(calls[0]!.arg).toBe('sub/chapter-04.md');
    expect(calls[0]!.arg).not.toMatch(/\\/);
    await watcher.close();
  }, 30000);

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
      for (let i = 0; i < 400 && loadCalls === 0; i++) await wait(10);
      expect(loadCalls).toBe(1);

      // Second change lands DURING the in-flight rebuild. Its debounce timer
      // fires into the isRebuilding guard — without the finally re-arm it
      // would be orphaned until some future fs event.
      watcher.emit('all', 'change', join(testDir, 'chapter-02.md'));
      await wait(400); // well past DEBOUNCE.FILE_WATCH
      expect(calls.length).toBe(0); // first rebuild still blocked, nothing broadcast

      release();

      // Both rebuilds complete with NO further fs events.
      for (let i = 0; i < 400; i++) {
        await wait(25);
        if (calls.length >= 2 && !state.isRebuilding) break;
      }
      expect(calls.length).toBe(2);
      expect(calls[1]).toEqual({ type: 'content-update', arg: 'chapter-02.md' });
      await watcher.close();
    } finally {
      // Restore the real module for the remaining tests.
      mock.module('../lib/manifest', () => ({ ...manifestMod }));
    }
  }, 60000);

  test('deleted markdown file triggers a full reload, not a splice', async () => {
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await waitForWatcherReady(watcher);

    watcher.emit('all', 'unlink', join(testDir, 'chapter-99.md'));
    await waitForRebuild(state, calls);

    expect(calls).toEqual([{ type: 'full-reload' }]);
    await watcher.close();
  }, 30000);

  test('prevents overlapping rebuilds with isRebuilding flag', async () => {
    state.isRebuilding = true;

    const watcher = createFileWatcher(state);

    await waitForWatcherReady(watcher);

    await writeFile(join(testDir, 'chapter-01.md'), '# During Rebuild');

    await wait(700);

    expect(state.isRebuilding).toBe(true);

    await watcher.close();
  }, 10000);
});

describe('startFileWatcher', () => {
  let testDir: string;
  let tempDir: string;
  let state: ServerState;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'print-md-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'print-md-test-temp-'));

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
    testDir = await mkdtemp(join(tmpdir(), 'print-md-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'print-md-test-temp-'));

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
