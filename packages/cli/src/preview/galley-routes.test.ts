/**
 * Unit tests for the galley editor routes (preview-interface protocol v8).
 *
 * Covers:
 *   - GET /__galley/book: chapters in book order with canonical ids, normalized
 *     source, and markdown-it tokens from the render path's parser config
 *   - POST /__galley/tokens and /__galley/fragment round-trips
 *   - JSON 4xx errors for bad bodies, wrong methods, unknown subpaths
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { createPreviewServer, type PreviewServer } from './http-server';
import { resolveConfig } from '../lib/manifest';
import type { ServerState } from './server-context';
import type { PreviewServerOptions } from '../types';

function makeState(currentInputPath: string, tempDir: string = currentInputPath): ServerState {
  const config = resolveConfig({}, {});
  const options: PreviewServerOptions = {
    port: 3000,
    host: '127.0.0.1',
    verbose: false,
    noWatch: true,
    openBrowser: false,
  };
  return {
    currentInputPath,
    currentWatcher: null,
    rebuildTimer: null,
    isRebuilding: false,
    previewServer: null,
    isShuttingDown: false,
    cssAssets: new Map<string, string>(),
    tempDir,
    config,
    options,
  };
}

interface GalleyToken {
  type: string;
  content?: string;
  children?: GalleyToken[] | null;
}

describe('/__galley routes', () => {
  let workDir: string;
  let server: PreviewServer | null;
  let port: number;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'gutterpress-galley-test-'));
    server = null;
    port = 50000 + Math.floor(Math.random() * 5000);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    await rm(workDir, { recursive: true, force: true });
  });

  test('GET /__galley/book returns every chapter in book order with source and tokens', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(join(projectDir, 'chapters'), { recursive: true });
    await writeFile(join(projectDir, 'chapters', 'one.md'), '# Chapter One\n\nSome **bold** prose.\n');
    // CRLF on disk must come back normalized to \n.
    await writeFile(join(projectDir, 'chapters', 'two.md'), '# Chapter Two\r\n\r\nWindows line endings.\r\n');

    const state = makeState(projectDir);
    // Manifest order is book order — deliberately NOT alphabetical, and with
    // an author spelling (./-prefixed) that must canonicalize.
    state.config = resolveConfig({}, {
      source: { files: ['./chapters/two.md', 'chapters/one.md'] },
    });
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/__galley/book`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('application/json');
    const body = await res.json() as { chapters: Array<{ chapter: string; source: string; tokens: GalleyToken[] }> };

    expect(body.chapters.map((c) => c.chapter)).toEqual(['chapters/two.md', 'chapters/one.md']);

    const [two, one] = body.chapters;
    expect(two!.source).toBe('# Chapter Two\n\nWindows line endings.\n');
    expect(one!.source).toBe('# Chapter One\n\nSome **bold** prose.\n');

    // Tokens are the render path's markdown-it stream (plain JSON round-trip).
    const oneTypes = one!.tokens.map((t) => t.type);
    expect(oneTypes).toContain('heading_open');
    expect(oneTypes).toContain('paragraph_open');
    const inline = one!.tokens.find((t) => t.type === 'inline' && t.content?.includes('bold'));
    expect(inline).toBeDefined();
    expect(inline!.children!.some((c) => c.type === 'strong_open')).toBe(true);
  });

  test('GET /__galley/book without a configured file list falls back to root-level .md files', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'b.md'), '# B\n');
    await writeFile(join(projectDir, 'a.md'), '# A\n');

    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/__galley/book`);
    expect(res.status).toBe(200);
    const body = await res.json() as { chapters: Array<{ chapter: string }> };
    expect(body.chapters.map((c) => c.chapter)).toEqual(['a.md', 'b.md']);
  });

  test('GET /__galley/book 404s as JSON in no-input mode', async () => {
    const tempDir = join(workDir, 'temp');
    await mkdir(tempDir, { recursive: true });
    const state = makeState('', tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/__galley/book`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toContain('application/json');
  });

  test('POST /__galley/tokens round-trips a snippet through the render parser', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/__galley/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '## Hello\n\nA *snippet* here.\n' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { tokens: GalleyToken[] };
    const types = body.tokens.map((t) => t.type);
    expect(types).toContain('heading_open');
    const inline = body.tokens.find((t) => t.type === 'inline' && t.content?.includes('snippet'));
    expect(inline).toBeDefined();
    expect(inline!.children!.some((c) => c.type === 'em_open')).toBe(true);
  });

  test('POST /__galley/fragment renders a snippet through the full pipeline', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/__galley/fragment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: '# Title\n\nSome **bold** text.\n' }),
    });
    expect(res.status).toBe(200);
    const body = await res.json() as { html: string };
    expect(body.html).toContain('<h1');
    expect(body.html).toContain('<strong>bold</strong>');
  });

  test('POST bodies that are not valid JSON or lack a string markdown field 400 as JSON', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    for (const path of ['/__galley/tokens', '/__galley/fragment']) {
      const notJson = await fetch(`http://localhost:${port}${path}`, {
        method: 'POST',
        body: 'this is not json',
      });
      expect(notJson.status).toBe(400);
      expect(notJson.headers.get('content-type')).toContain('application/json');

      const wrongShape = await fetch(`http://localhost:${port}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown: 42 }),
      });
      expect(wrongShape.status).toBe(400);
    }
  });

  test('an oversized body is rejected with 413', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    // Just over the 2 MB cap once JSON-wrapped.
    const huge = 'x'.repeat(2 * 1024 * 1024 + 1024);
    // The server must NOT destroy the socket mid-request (that resets the
    // connection before the 413 can be read) — it stops buffering, drains,
    // and answers with Connection: close. The assertion is unconditional: a
    // reintroduced req.destroy() must fail this test, not skip it.
    const res = await fetch(`http://localhost:${port}/__galley/tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdown: huge }),
    });
    expect(res.status).toBe(413);
    expect(((await res.json()) as { error: string }).error).toContain('exceeds');
  });

  test('wrong methods 405 and unknown subpaths 404, both as JSON', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    const wrongMethod = await fetch(`http://localhost:${port}/__galley/book`, { method: 'POST' });
    expect(wrongMethod.status).toBe(405);
    const wrongMethod2 = await fetch(`http://localhost:${port}/__galley/tokens`);
    expect(wrongMethod2.status).toBe(405);
    const unknown = await fetch(`http://localhost:${port}/__galley/nope`);
    expect(unknown.status).toBe(404);
    expect(unknown.headers.get('content-type')).toContain('application/json');
  });
});
