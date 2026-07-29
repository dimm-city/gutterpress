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
import { mkdir, mkdtemp, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { UsageError } from './cli-args';

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

  test('runLint rejects an explicit missing manifest path', async () => {
    const { runLint } = await import('./lint-runner');
    const missing = join(tmpdir(), `gutterpress-lint-missing-manifest-${Date.now()}.yaml`);

    await expect(runLint({ manifest: missing })).rejects.toThrow(UsageError);
    await expect(runLint({ manifest: missing })).rejects.toThrow(
      `manifest not found: ${missing}`
    );
  });
});

// ── manifest-driven CSS resolution matches the renderer (2026-07-28 audit) ──
//
// Before this, a manifest with no `styles:` made `gutterpress lint` fall back to
// globbing `.build/**/*.css`, then `example/**/*.css`/`demos/**/*.css` — a
// fallback chain with nothing to do with any given project (leftover from
// linting THIS REPO's own dogfooding examples). It now falls back to
// resolveActiveStyles, the SAME resolver the renderer uses, so a run against
// an arbitrary project checks exactly the stylesheet(s) that ship.
describe('runLint resolves the same active stylesheet the renderer would', () => {
  test('a manifest with no styles: lints the conventional styles/book.css, not an unrelated .build/ leftover', async () => {
    const { runLint } = await import('./lint-runner');
    const tmpDir = await mkdtemp(join(tmpdir(), 'gutterpress-lint-active-'));
    try {
      const { mkdir } = await import('fs/promises');
      await mkdir(join(tmpDir, 'styles'), { recursive: true });
      await writeFile(join(tmpDir, 'styles', 'book.css'), 'body { color: red; }');
      // A `.build/` artifact sitting alongside it — the old third fallback
      // would have linted this instead when styles: was unset; it must now
      // be ignored entirely (resolveActiveStyles never scans `.build/`).
      await mkdir(join(tmpDir, '.build'), { recursive: true });
      await writeFile(join(tmpDir, '.build', 'leftover.css'), 'body { color: blue; }');
      const manifestPath = join(tmpDir, 'manifest.yaml');
      await writeFile(manifestPath, 'title: No Styles Configured\n');

      const result = await runLint({ manifest: manifestPath });

      expect(result.filesLinted).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('a manifest with no styles: and no conventional stylesheet lints nothing (never falls back to example/demos scaffolding)', async () => {
    const { runLint } = await import('./lint-runner');
    const tmpDir = await mkdtemp(join(tmpdir(), 'gutterpress-lint-none-'));
    try {
      const { mkdir } = await import('fs/promises');
      // Only an `example/` dir with a .css file — the removed fallback chain
      // would have globbed and linted this; resolveActiveStyles does not scan
      // `example/`, so a project with no conventional stylesheet lints nothing.
      await mkdir(join(tmpDir, 'example'), { recursive: true });
      await writeFile(join(tmpDir, 'example', 'demo.css'), 'body { color: red; }');
      const manifestPath = join(tmpDir, 'manifest.yaml');
      await writeFile(manifestPath, 'title: Nothing To Lint\n');

      const result = await runLint({ manifest: manifestPath });

      expect(result.filesLinted).toBe(0);
      expect(result.ok).toBe(true);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });

  test('an explicit manifest styles: list is used verbatim, excluding other project .css files', async () => {
    const { runLint } = await import('./lint-runner');
    const tmpDir = await mkdtemp(join(tmpdir(), 'gutterpress-lint-explicit-'));
    try {
      const { mkdir } = await import('fs/promises');
      await mkdir(join(tmpDir, 'css'), { recursive: true });
      await writeFile(join(tmpDir, 'css', 'main.css'), 'body { color: red; }');
      await writeFile(join(tmpDir, 'css', 'unused.css'), 'body { color: green; }');
      const manifestPath = join(tmpDir, 'manifest.yaml');
      await writeFile(manifestPath, 'title: Explicit Styles\nstyles:\n  - css/main.css\n');

      const result = await runLint({ manifest: manifestPath });

      expect(result.filesLinted).toBe(1);
    } finally {
      await rm(tmpDir, { recursive: true, force: true });
    }
  });
});

test("a configured stylesheet that does not exist FAILS lint instead of reporting success", async () => {
  // resolveActiveStyles returns manifest `styles:` entries verbatim, without an
  // existence check, so an unreadable entry here means the author named a file
  // that isn't there. Skipping it silently returned ok:true having inspected
  // nothing — the same silent-green this resolver change exists to remove.
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-lint-missing-"));
  try {
    await writeFile(
      join(dir, "manifest.yaml"),
      "title: Missing Sheet\nstyles:\n  - styles/gone.css\n",
      "utf8",
    );

    const { runLint } = await import('./lint-runner');
    const result = await runLint({ manifest: dir });
    expect(result.ok).toBe(false);
    expect(result.filesLinted).toBe(0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a configured stylesheet that is a DIRECTORY fails lint too", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-lint-dir-"));
  try {
    await mkdir(join(dir, "styles", "book.css"), { recursive: true });
    await writeFile(
      join(dir, "manifest.yaml"),
      "title: Dir Sheet\nstyles:\n  - styles/book.css\n",
      "utf8",
    );

    const { runLint } = await import('./lint-runner');
    const result = await runLint({ manifest: dir });
    expect(result.ok).toBe(false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("filesLinted counts what was actually inspected", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-lint-count-"));
  try {
    await mkdir(join(dir, "styles"), { recursive: true });
    await writeFile(join(dir, "styles", "book.css"), "body { color: black; }\n", "utf8");
    await writeFile(join(dir, "manifest.yaml"), "title: Counted\n", "utf8");

    const { runLint } = await import('./lint-runner');
    const result = await runLint({ manifest: dir });
    expect(result.ok).toBe(true);
    expect(result.filesLinted).toBe(1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
