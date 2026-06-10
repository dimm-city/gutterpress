/**
 * Tests for file watcher scenarios
 *
 * Validates file watching, debouncing, rebuild triggering, and state management
 */

import { describe, test, expect, beforeEach, afterEach, mock } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  generateAndWriteHtml,
  createFileWatcher,
  startFileWatcher,
  stopFileWatcher,
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
    assetsSourceDir: tempDir,
  };
}

/**
 * Helper to wait for a specified duration
 */
function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

    await wait(200);

    await writeFile(join(testDir, 'chapter-01.md'), '# Updated Content');

    await wait(700);

    const content = await Bun.file(join(testDir, 'chapter-01.md')).text();
    expect(content).toContain('Updated Content');

    await watcher.close();
  }, 10000);

  test('ignores dot files', async () => {
    const watcher = createFileWatcher(state);

    await wait(200);

    await writeFile(join(testDir, '.hidden'), 'hidden content');

    await wait(700);

    const file = Bun.file(join(testDir, '.hidden'));
    const exists = await file.exists();
    expect(exists).toBe(true);

    await watcher.close();
  }, 10000);

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
    await wait(200);

    watcher.emit('all', 'change', join(testDir, 'chapter-02.md'));
    await waitForRebuild(state, calls);

    expect(calls).toEqual([{ type: 'content-update', arg: 'chapter-02.md' }]);
    await watcher.close();
  }, 30000);

  test('multiple files changed in one debounce window trigger a full reload, not a splice', async () => {
    // Simulates a multi-file disk rewrite (version restore / publish merge):
    // a burst of events inside one debounce window must NOT collapse into a
    // single-chapter splice — that leaves the other chapters stale.
    await writeFile(join(testDir, 'chapter-02.md'), '# Two');
    const calls = attachBroadcastRecorder(state);
    const watcher = createFileWatcher(state);
    state.currentWatcher = watcher;
    await wait(200);

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
    await wait(200);

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
    await wait(200);

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
    await wait(200);

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
      await wait(200);

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
    await wait(200);

    watcher.emit('all', 'unlink', join(testDir, 'chapter-99.md'));
    await waitForRebuild(state, calls);

    expect(calls).toEqual([{ type: 'full-reload' }]);
    await watcher.close();
  }, 30000);

  test('prevents overlapping rebuilds with isRebuilding flag', async () => {
    state.isRebuilding = true;

    const watcher = createFileWatcher(state);

    await wait(200);

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
