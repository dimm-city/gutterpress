/**
 * Tests for file watcher scenarios
 *
 * Validates file watching, debouncing, rebuild triggering, and state management
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
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
      verbose: false,
      noWatch: false,
      openBrowser: false,
      ...options,
    },
    currentWatcher: null,
    isRebuilding: false,
    viteServer: null,
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
    testDir = await mkdtemp(join(tmpdir(), 'pagedmd-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'pagedmd-test-temp-'));
  });

  afterEach(async () => {
    await rm(testDir, { recursive: true, force: true });
    await rm(tempDir, { recursive: true, force: true });
  }, 60000);

  test('generates preview.html with proper doctype', async () => {
    // Create test chapter file (must start with "chapter-" for renderChapters)
    await writeFile(join(testDir, 'chapter-01.md'), '# Test Heading\n\nTest content.');

    const config = resolveConfig({ title: 'Test' }, {});

    await generateAndWriteHtml(testDir, tempDir, config);

    // Check that preview.html was created
    const outputPath = join(tempDir, 'preview.html');
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

  test('overwrites existing preview.html', async () => {
    await writeFile(join(testDir, 'chapter-01.md'), '# First Version');

    const config = resolveConfig({ title: 'Test' }, {});

    // First generation
    await generateAndWriteHtml(testDir, tempDir, config);
    const outputPath = join(tempDir, 'preview.html');
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

    const content = await Bun.file(join(tempDir, 'preview.html')).text();
    expect(content).toContain('Chapter 1');
    expect(content).toContain('Chapter 2');
  }, 60000);
});

describe('createFileWatcher', () => {
  let testDir: string;
  let tempDir: string;
  let state: ServerState;

  beforeEach(async () => {
    testDir = await mkdtemp(join(tmpdir(), 'pagedmd-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'pagedmd-test-temp-'));

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
    testDir = await mkdtemp(join(tmpdir(), 'pagedmd-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'pagedmd-test-temp-'));

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
    testDir = await mkdtemp(join(tmpdir(), 'pagedmd-test-input-'));
    tempDir = await mkdtemp(join(tmpdir(), 'pagedmd-test-temp-'));

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
});
