/**
 * Unit tests for the Bun-native preview HTTP server.
 *
 * Covers:
 *   - Port availability helpers
 *   - Static serving with HMR-snippet injection
 *   - WebSocket reload broadcast
 *   - /api/* routing through the request dispatcher
 *   - Path-traversal defense
 */

import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isPortAvailable,
  findAvailablePort,
  createPreviewServer,
  type PreviewServer,
} from './http-server';
import { resolveConfig } from '../lib/manifest';
import type { ServerState } from './server-context';
import type { PreviewServerOptions } from '../types';

function makeState(tempDir: string): ServerState {
  const config = resolveConfig({}, {});
  const options: PreviewServerOptions = {
    port: 3000,
    host: '127.0.0.1',
    verbose: false,
    noWatch: true,
    openBrowser: false,
  };
  return {
    currentInputPath: tempDir,
    currentWatcher: null,
    rebuildTimer: null,
    isRebuilding: false,
    previewServer: null,
    isShuttingDown: false,
    tempDir,
    config,
    options,
  };
}

describe('isPortAvailable', () => {
  test('returns true for available port', async () => {
    // Bind an OS-assigned port, capture it, then release it — so we test a port
    // we KNOW was bindable a moment ago rather than a hardcoded guess that may
    // be occupied on a busy CI runner (the old fixed 59999 was flaky).
    const probe = Bun.serve({ port: 0, fetch: () => new Response('probe') });
    const freedPort = probe.port!; // a just-bound server always has a port
    probe.stop(true);
    await new Promise((resolve) => setTimeout(resolve, 50));

    const result = await isPortAvailable(freedPort);
    expect(result).toBe(true);
  });

  test('returns false for unavailable port', async () => {
    // Let the OS pick a free port (port: 0) instead of a hardcoded 58888, which
    // collided under back-to-back CI runs (EADDRINUSE → "Failed to start server").
    const server = Bun.serve({
      port: 0,
      fetch() {
        return new Response('test');
      },
    });
    const testPort = server.port!; // a just-bound server always has a port

    try {
      const result = await isPortAvailable(testPort);
      expect(result).toBe(false);
    } finally {
      server.stop(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
});

describe('findAvailablePort', () => {
  // Reserve `count` CONTIGUOUS, currently-bindable ports starting at a randomly
  // chosen base in the ephemeral range. Retries with a fresh base on any bind
  // collision (a still-listening server or a TIME_WAIT socket from a prior run),
  // so these tests never depend on hardcoded ports being free — which made the
  // old fixed-port version flaky under back-to-back runs (EADDRINUSE).
  function reserveContiguousPorts(count: number): {
    base: number;
    servers: ReturnType<typeof Bun.serve>[];
  } {
    for (let attempt = 0; attempt < 100; attempt++) {
      const base = 49152 + Math.floor(Math.random() * (65535 - 49152 - count));
      const servers: ReturnType<typeof Bun.serve>[] = [];
      let ok = true;
      for (let i = 0; i < count; i++) {
        try {
          servers.push(Bun.serve({ port: base + i, fetch: () => new Response() }));
        } catch {
          ok = false;
          break;
        }
      }
      if (ok) return { base, servers };
      for (const s of servers) s.stop(true);
    }
    throw new Error(`could not reserve ${count} contiguous ports for test`);
  }

  async function stopAll(servers: ReturnType<typeof Bun.serve>[]) {
    for (const s of servers) s.stop(true);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  test('returns same port if available', async () => {
    // Find a port that's bindable right now, free it, then assert it's chosen.
    const { base, servers } = reserveContiguousPorts(1);
    await stopAll(servers);
    const port = await findAvailablePort(base);
    expect(port).toBe(base);
  });

  test('finds next available port if first is taken', async () => {
    const { base, servers } = reserveContiguousPorts(1); // occupy `base` only
    try {
      const port = await findAvailablePort(base);
      expect(port).toBeGreaterThan(base);
      expect(port).toBeLessThanOrEqual(base + 10);
    } finally {
      await stopAll(servers);
    }
  });

  test('throws error if no ports available after max attempts', async () => {
    // findAvailablePort probes base..base+9 (10 attempts); occupy all of them.
    const { base, servers } = reserveContiguousPorts(10);
    try {
      await expect(findAvailablePort(base)).rejects.toThrow(/Could not find an available port/);
    } finally {
      await stopAll(servers);
    }
  });
});

describe('createPreviewServer', () => {
  let tempDir: string;
  let server: PreviewServer | null;
  let port: number;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'print-md-http-test-'));
    server = null;
    // Pick an unlikely-to-be-busy port range per test.
    port = 50000 + Math.floor(Math.random() * 5000);
  });

  afterEach(async () => {
    if (server) {
      await server.close();
      server = null;
    }
    await rm(tempDir, { recursive: true, force: true });
  });

  test('serves a static text file from tempDir', async () => {
    await writeFile(join(tempDir, 'note.txt'), 'hello world');

    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/note.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });

  test('serves the preview shell for "/" by default (incremental preview on)', async () => {
    // With incremental preview enabled (the default), "/" returns the thin
    // shell loader — it embeds book.html in an iframe (?pmdshell=1) and owns
    // HMR via preview-shell.js (flicker-free double-buffered reloads, the same
    // iframe pattern the Electron viewer uses). It does NOT inline the book.
    await writeFile(
      join(tempDir, 'book.html'),
      '<!doctype html><html><body><h1>Hi</h1></body></html>'
    );

    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const body = await res.text();
    expect(body).toContain('/book.html?pmdshell=1');
    expect(body).toContain('preview-shell.js');
    // The shell is a loader, not the book itself.
    expect(body).not.toContain('<h1>Hi</h1>');
  });

  test('serves book.html with the HMR client injected', async () => {
    // The CLI no longer ships a viewer chrome index.html; the rendered paginated
    // book lives at /book.html. Any served HTML gets the HMR client injected so
    // direct embedders (and the shell's inner frame) can hot-reload.
    await writeFile(
      join(tempDir, 'book.html'),
      '<!doctype html><html><body><h1>Hi</h1></body></html>'
    );

    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/book.html`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const body = await res.text();
    expect(body).toContain('<h1>Hi</h1>');
    expect(body).toContain('__print-md-hmr');
    expect(body).toContain('full-reload');
  });

  test('returns 404 for missing file', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/nope.txt`);
    expect(res.status).toBe(404);
  });

  test('refuses to serve files outside tempDir (path traversal)', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/../../etc/passwd`);
    // Either 404 (resolve outside tempDir -> null) or 400 — never 200.
    expect(res.status).not.toBe(200);
    expect([400, 404]).toContain(res.status);
  });

  test('routes /api/status through the dispatcher', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('currentPath');
    expect(body).toHaveProperty('hasInput');
  });

  test('returns 404 for unknown /api/* route', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/api/does-not-exist`);
    expect(res.status).toBe(404);
  });

  test('broadcastReload publishes full-reload over WebSocket', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const ws = new WebSocket(`ws://localhost:${port}/__print-md-hmr`);

    // Wait for connection.
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });

    const messagePromise = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(typeof e.data === 'string' ? e.data : '');
    });

    // Bun.serve.publish needs the WS to be subscribed first; the `open` handler
    // subscribes synchronously, but give the loop a tick to be safe.
    await new Promise((r) => setTimeout(r, 50));

    server.broadcastReload();

    const data = await Promise.race([
      messagePromise,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('timeout waiting for HMR message')), 2000)
      ),
    ]);

    const parsed = JSON.parse(data);
    expect(parsed.type).toBe('full-reload');

    ws.close();
  });

  test('serves files from nested subdirectories', async () => {
    await mkdir(join(tempDir, 'sub'));
    await writeFile(join(tempDir, 'sub', 'data.json'), '{"ok":true}');

    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/sub/data.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

describe('/__chapter route', () => {
  let workDir: string;
  let server: PreviewServer | null;
  let port: number;

  beforeEach(async () => {
    workDir = await mkdtemp(join(tmpdir(), 'print-md-chapter-test-'));
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

  test('renders an in-project chapter', async () => {
    // `currentInputPath` (the served project/markdown source root) is
    // deliberately a SUBDIRECTORY of workDir, distinct from `tempDir` — the
    // route confines `file` to currentInputPath, not tempDir.
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'chapter1.md'), '# Hello Chapter');

    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(
      `http://localhost:${port}/__chapter?file=${encodeURIComponent('chapter1.md')}`
    );
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('Hello Chapter');
  });

  test('rejects a path-traversal file param that escapes the project root', async () => {
    const projectDir = join(workDir, 'project');
    const outsideDir = join(workDir, 'outside');
    await mkdir(projectDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(projectDir, 'chapter1.md'), '# In Project');
    await writeFile(join(outsideDir, 'secret.md'), '# TOP SECRET DATA');

    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(
      `http://localhost:${port}/__chapter?file=${encodeURIComponent('../outside/secret.md')}`
    );
    // Never 200, and the outside file's content must never reach the client
    // — a traversal that "succeeds" as a 500 (e.g. some other read error)
    // but still leaks the body would be just as bad as a 200.
    expect(res.status).not.toBe(200);
    expect([400, 404]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toContain('TOP SECRET DATA');
  });

  test('rejects a backslash-based path-traversal file param', async () => {
    // The raw `file` query param is guarded with `resolveWithinRoot`, but the
    // actual read sink (assembleBookHtml -> canonicalChapterId) normalizes
    // `\` to `/` BEFORE resolving against the project root. `path.resolve`
    // on POSIX treats `\` as a literal filename character, so a raw guard
    // check on `..\\..\\secret.md` passes containment while the sink's
    // canonicalized form (`../../secret.md`) escapes the root. The guard
    // must run on the same canonicalized string the sink reads.
    const projectDir = join(workDir, 'project');
    const outsideDir = join(workDir, 'outside');
    await mkdir(projectDir, { recursive: true });
    await mkdir(outsideDir, { recursive: true });
    await writeFile(join(projectDir, 'chapter1.md'), '# In Project');
    await writeFile(join(outsideDir, 'secret.md'), '# TOP SECRET DATA');

    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(
      `http://localhost:${port}/__chapter?file=${encodeURIComponent('..\\outside\\secret.md')}`
    );
    expect(res.status).not.toBe(200);
    expect([400, 404]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toContain('TOP SECRET DATA');
  });
});
