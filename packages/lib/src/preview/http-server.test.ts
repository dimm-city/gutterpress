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
    assetsSourceDir: tempDir,
    config,
    options,
  };
}

describe('isPortAvailable', () => {
  test('returns true for available port', async () => {
    const result = await isPortAvailable(59999);
    expect(result).toBe(true);
  });

  test('returns false for unavailable port', async () => {
    const testPort = 58888;
    const server = Bun.serve({
      port: testPort,
      fetch() {
        return new Response('test');
      },
    });

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
  test('returns same port if available', async () => {
    const desiredPort = 59998;
    const port = await findAvailablePort(desiredPort);
    expect(port).toBe(desiredPort);
  });

  test('finds next available port if first is taken', async () => {
    const startPort = 58887;
    const server1 = Bun.serve({
      port: startPort,
      fetch() {
        return new Response();
      },
    });

    try {
      const port = await findAvailablePort(startPort);
      expect(port).toBeGreaterThan(startPort);
      expect(port).toBeLessThanOrEqual(startPort + 10);
    } finally {
      server1.stop(true);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });

  test('throws error if no ports available after max attempts', async () => {
    const startPort = 58886;
    const servers: ReturnType<typeof Bun.serve>[] = [];

    try {
      for (let i = 0; i < 11; i++) {
        const server = Bun.serve({
          port: startPort + i,
          fetch() {
            return new Response();
          },
        });
        servers.push(server);
      }

      await expect(findAvailablePort(startPort)).rejects.toThrow(/Could not find an available port/);
    } finally {
      for (const server of servers) {
        server.stop(true);
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
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
    server = await createPreviewServer(state, port, async () => {});

    const res = await fetch(`http://localhost:${port}/note.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });

  test('serves book.html for "/" and injects the HMR client', async () => {
    // The CLI no longer ships a viewer chrome index.html; "/" now maps to
    // book.html (the rendered paginated book). The desktop viewer wraps it
    // in an iframe-based toolbar (packages/viewer).
    await writeFile(
      join(tempDir, 'book.html'),
      '<!doctype html><html><body><h1>Hi</h1></body></html>'
    );

    const state = makeState(tempDir);
    server = await createPreviewServer(state, port, async () => {});

    const res = await fetch(`http://localhost:${port}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/html');

    const body = await res.text();
    expect(body).toContain('<h1>Hi</h1>');
    expect(body).toContain('__print-md-hmr');
    expect(body).toContain('full-reload');
  });

  test('returns 404 for missing file', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port, async () => {});

    const res = await fetch(`http://localhost:${port}/nope.txt`);
    expect(res.status).toBe(404);
  });

  test('refuses to serve files outside tempDir (path traversal)', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port, async () => {});

    const res = await fetch(`http://localhost:${port}/../../etc/passwd`);
    // Either 404 (resolve outside tempDir -> null) or 400 — never 200.
    expect(res.status).not.toBe(200);
    expect([400, 404]).toContain(res.status);
  });

  test('routes /api/status through the dispatcher', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port, async () => {});

    const res = await fetch(`http://localhost:${port}/api/status`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty('currentPath');
    expect(body).toHaveProperty('hasInput');
  });

  test('returns 404 for unknown /api/* route', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port, async () => {});

    const res = await fetch(`http://localhost:${port}/api/does-not-exist`);
    expect(res.status).toBe(404);
  });

  test('broadcastReload publishes full-reload over WebSocket', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port, async () => {});

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
    server = await createPreviewServer(state, port, async () => {});

    const res = await fetch(`http://localhost:${port}/sub/data.json`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
