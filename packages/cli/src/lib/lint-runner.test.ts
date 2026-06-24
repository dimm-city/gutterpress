/**
 * Smoke tests for lint-runner.
 *
 * The key invariant being tested: `glob` is loaded lazily inside runLint(),
 * not at module import time. This was a regression that caused the AppImage to
 * crash on startup because `glob` was absent from node_modules (it had been
 * in devDependencies only).
 *
 * We verify the lazy-load by importing the module and confirming it loads
 * without throwing, then calling runLint() with a trivial fixture to confirm
 * glob is resolved at call-time.
 */

import { describe, test, expect } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';

describe('lint-runner lazy glob import', () => {
  test('importing the module does not throw (glob is not eagerly loaded)', async () => {
    // If glob were imported at the top of lint-runner, this would fail in any
    // environment where glob is missing from node_modules.
    await expect(import('./lint-runner')).resolves.toBeDefined();
  });

  test('runLint resolves glob at call time and completes without crashing', async () => {
    const { runLint } = await import('./lint-runner');
    const tmpDir = await mkdtemp(join(tmpdir(), 'lint-runner-test-'));
    await writeFile(join(tmpDir, 'style.css'), 'body { color: red; }');

    try {
      // We don't assert linting results — just that it doesn't throw a
      // "Cannot find package 'glob'" error or similar import error.
      const result = await runLint({ files: join(tmpDir, '*.css') });
      expect(typeof result.ok).toBe('boolean');
      expect(typeof result.filesLinted).toBe('number');
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});
