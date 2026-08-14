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
import { mkdtemp, rm, writeFile, mkdir, utimes } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import {
  isPortAvailable,
  findAvailablePort,
  createPreviewServer,
  type PreviewServer,
} from './http-server';
import { UsageError } from '../lib/cli-args';
import { BuildError, EXIT_CODES } from '../lib/build-error';
import { resolveConfig } from '../lib/manifest';
import { generateAndWriteHtml } from './file-watcher';
import type { ServerState } from './server-context';
import type { PreviewServerOptions } from '../types';

/**
 * `currentInputPath` (the served PROJECT root) and `tempDir` (where
 * gutterpress's own generated `book.html` lives) default to the SAME directory
 * when only one is given — most tests here don't care about the split. The
 * two-arg form is used where a test specifically needs to prove
 * serve-in-place behavior: that a non-book.html path is read from the real
 * project directory and NOT from the (possibly distinct, possibly empty)
 * temp dir.
 */
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

  test('classifies valid-port exhaustion as a pipeline BuildError', async () => {
    // findAvailablePort probes base..base+9 (10 attempts); occupy all of them.
    const { base, servers } = reserveContiguousPorts(10);
    try {
      try {
        await findAvailablePort(base);
        throw new Error('expected findAvailablePort to reject');
      } catch (error) {
        expect(error).toBeInstanceOf(BuildError);
        expect((error as BuildError).exitCode).toBe(EXIT_CODES.PIPELINE);
        expect((error as Error).message).toContain('all are already in use');
        expect((error as Error).message).toContain('--port');
        expect((error as Error).cause).toBeInstanceOf(Error);
        expect(((error as Error).cause as Error & { code?: string }).code).toBe('EADDRINUSE');
      }
    } finally {
      await stopAll(servers);
    }
  });

  test('classifies an unavailable bind host as an actionable pipeline BuildError', async () => {
    // TEST-NET-1 is not a local interface, so binding it must fail. The old
    // loopback-only probe incorrectly returned port 0 as available here.
    try {
      await findAvailablePort(0, '192.0.2.1');
      throw new Error('expected findAvailablePort to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BuildError);
      expect((error as BuildError).exitCode).toBe(EXIT_CODES.PIPELINE);
      expect((error as Error).message).toContain('Could not bind the preview server');
      expect((error as Error).message).toContain('192.0.2.1:0');
      expect((error as Error).message).toContain('--host');
      expect((error as Error).cause).toBeInstanceOf(Error);
    }
  });

  test('stops cleanly at 65535 instead of probing an invalid overflow port', async () => {
    try {
      await findAvailablePort(65535, '192.0.2.1');
      throw new Error('expected findAvailablePort to reject');
    } catch (error) {
      expect(error).toBeInstanceOf(BuildError);
      expect((error as Error).message).not.toContain('ERR_SOCKET_BAD_PORT');
    }
  });

  test('rejects an out-of-range starting port as a UsageError', async () => {
    await expect(findAvailablePort(65536)).rejects.toBeInstanceOf(UsageError);
  });
});

describe('createPreviewServer', () => {
  let tempDir: string;
  /** The served PROJECT root — deliberately a SEPARATE directory from
   * tempDir in every test below that exercises serve-in-place, so a passing
   * test proves the file actually came from the project directory and not
   * from an accidental alias between the two roots. */
  let projectDir: string;
  let server: PreviewServer | null;
  let port: number;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'gutterpress-http-test-temp-'));
    projectDir = await mkdtemp(join(tmpdir(), 'gutterpress-http-test-project-'));
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
    await rm(projectDir, { recursive: true, force: true });
  });

  test('serves a static file directly from the project root (serve-in-place)', async () => {
    // note.txt lives ONLY in projectDir — tempDir stays empty for this test.
    // A 200 here can only mean the non-book.html path resolved against
    // state.currentInputPath, not a copy sitting in state.tempDir (there is
    // no copy anymore — see lifecycle.ts's initializePreviewDirectories).
    await writeFile(join(projectDir, 'note.txt'), 'hello world');

    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/note.txt`);
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('hello world');
  });

  test('project assets reuse unchanged bytes but revalidate a same-size edit with a preserved timestamp', async () => {
    const asset = join(projectDir, 'image.png');
    const fixedTime = new Date('2026-01-01T00:00:00.000Z');
    await writeFile(asset, 'first-image');
    await utimes(asset, fixedTime, fixedTime);

    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);

    const first = await fetch(`http://localhost:${port}/image.png`);
    const etag = first.headers.get('etag');
    expect(first.status).toBe(200);
    expect(first.headers.get('cache-control')).toBe('private, no-cache');
    expect(etag).toBeTruthy();
    expect(await first.text()).toBe('first-image');

    const unchanged = await fetch(`http://localhost:${port}/image.png`, {
      headers: { 'if-none-match': etag! },
    });
    expect(unchanged.status).toBe(304);

    await writeFile(asset, 'other-image');
    await utimes(asset, fixedTime, fixedTime);
    const changed = await fetch(`http://localhost:${port}/image.png`, {
      headers: { 'if-none-match': etag! },
    });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('etag')).not.toBe(etag);
    expect(await changed.text()).toBe('other-image');
  });

  test('serves the double-buffered preview shell for "/" by default', async () => {
    // With the preview shell enabled (the default), "/" returns the thin
    // shell loader — it embeds book.html in an iframe (?gutterpressshell=1) and owns
    // HMR via preview-shell.js (flicker-free double-buffered reloads, the same
    // iframe pattern the Electron desktop uses). It does NOT inline the book.
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
    expect(body).toContain('/book.html?gutterpressshell=1');
    expect(body).toContain('preview-shell.js');
    expect(body).toContain('window.__GUTTERPRESS_INSTANCE=');
    expect(body).toContain('window.__GUTTERPRESS_REVISION=0');
    // The shell is a loader, not the book itself.
    expect(body).not.toContain('<h1>Hi</h1>');
  });

  test('serves book.html with the HMR client injected', async () => {
    // The CLI no longer ships a desktop chrome index.html; the rendered paginated
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
    expect(body).toContain('__gutterpress-hmr');
    expect(body).toContain('full-reload');
    expect(body).toContain('content-update');
    expect(body).toContain('reload-state');
    expect(body).toContain('reload-applied');
    expect(body).toContain("closest('[data-chapter-src]')");
    expect(body).toContain('chapterId === a.chapter');
  });

  test('returns 404 for missing file', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/nope.txt`);
    expect(res.status).toBe(404);
  });

  test('refuses to serve files outside the project root (path traversal)', async () => {
    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/../../etc/passwd`);
    // Either 404 (resolve outside the project root -> null) or 400 — never 200.
    expect(res.status).not.toBe(200);
    expect([400, 404]).toContain(res.status);
  });

  test('404s a dotfile at the project root instead of reading it (e.g. ".env")', async () => {
    // Serve-in-place (this test's whole describe block) reads the REAL
    // project directory instead of a throwaway copy — the old whole-tree
    // copy this replaced happened to leak a project's .env into the served
    // temp dir too, but nobody could reach it without knowing the temp dir's
    // random name. Serving the real tree removes that obscurity, so this
    // guard is now load-bearing: a request for a dotfile must 404, and the
    // secret's contents must never appear in the response body.
    await writeFile(join(projectDir, '.env'), 'SECRET_API_KEY=do-not-leak-this');

    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/.env`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('do-not-leak-this');
  });

  test('404s a file inside a dot-directory at the project root (e.g. ".git/config")', async () => {
    await mkdir(join(projectDir, '.git'), { recursive: true });
    await writeFile(join(projectDir, '.git', 'config'), '[remote "origin"]\n\turl = do-not-leak-this\n');

    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/.git/config`);
    expect(res.status).toBe(404);
    const body = await res.text();
    expect(body).not.toContain('do-not-leak-this');
  });

  test('404s a dotfile requested with an encoded BACKSLASH separator (%5C)', async () => {
    // The Windows bypass. `new URL("/%5C.env", …).pathname` keeps the
    // percent-encoding (only a RAW backslash gets normalized to "/"), so the
    // guard saw the single segment "\.env" — which does not start with "." —
    // and passed it. `path.win32.resolve` then treated "\" as a separator and
    // landed on `<project>\.env`, INSIDE the root, so containment passed too
    // and Windows served the secret.
    //
    // On POSIX the same request resolves to a file literally NAMED "\.env",
    // so this test writes that file to make the assertion bite here as well:
    // before the guard fix this request returned 200 with the file's contents
    // on every platform; the difference on Windows was only WHICH file it hit.
    await writeFile(join(projectDir, '\\.env'), 'SECRET_API_KEY=do-not-leak-this');

    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/%5C.env`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('do-not-leak-this');
  });

  test('404s a dot-directory reached through an encoded backslash (%5C.git%5Cconfig)', async () => {
    await mkdir(join(projectDir, 'sub'), { recursive: true });
    await writeFile(join(projectDir, 'sub', '\\.git\\config'), 'url = do-not-leak-this');

    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/sub/%5C.git%5Cconfig`);
    expect(res.status).toBe(404);
    expect(await res.text()).not.toContain('do-not-leak-this');
  });

  test('an ordinary file next to a dotfile still serves normally (the guard is scoped, not overbroad)', async () => {
    await writeFile(join(projectDir, '.env'), 'SECRET=1');
    await writeFile(join(projectDir, 'chapter-01.md'), '# Chapter One');

    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/chapter-01.md`);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('# Chapter One');
  });

  test('serves a content-addressed CSS asset from OUTSIDE the project (shared repo-root art)', async () => {
    // R6: a shared repo-root stylesheet's `url()` closure crosses out of the
    // book folder, and an image over IMAGE_INLINE_MAX_BYTES is too big to
    // embed — the inliner rewrites it to `assets/<contentHash><ext>` and
    // returns a copy plan. The BUILD executes that plan into its output dir;
    // the preview serves the project in place and has no such dir, so the
    // rewritten URL used to 404 and shared art rendered broken in the live
    // preview while building correctly.
    //
    // The plan is now an explicit allow-map the server resolves BEFORE the
    // project-root fallback, so preview and build agree on the URL and neither
    // copies anything.
    const repoRoot = await mkdtemp(join(tmpdir(), 'gutterpress-repo-'));
    try {
      const book = join(repoRoot, 'books', 'field-guide');
      const sharedStyles = join(repoRoot, 'shared', 'styles');
      const sharedArt = join(repoRoot, 'shared', 'images');
      await mkdir(book, { recursive: true });
      await mkdir(sharedStyles, { recursive: true });
      await mkdir(sharedArt, { recursive: true });

      // A PNG over the 512 KB inline threshold.
      const big = Buffer.alloc(600 * 1024, 7);
      await writeFile(join(sharedArt, 'backdrop.png'), big);
      await writeFile(
        join(sharedStyles, 'components.css'),
        'body { background-image: url("../images/backdrop.png"); }\n',
      );
      await writeFile(join(book, 'chapter-01.md'), '# One\n');
      await writeFile(
        join(book, 'manifest.yaml'),
        ['title: Field Guide', 'styles:', '  - ../../shared/styles/components.css', ''].join('\n'),
      );

      const state = makeState(book, tempDir);
      state.config = resolveConfig({}, { title: 'Field Guide', styles: ['../../shared/styles/components.css'] });
      await generateAndWriteHtml(book, tempDir, state.config, state.cssAssets);
      server = await createPreviewServer(state, port);

      const bookHtml = await (await fetch(`http://localhost:${port}/book.html`)).text();
      const match = bookHtml.match(/url\((?:"|')?(assets\/[^"')]+)(?:"|')?\)/);
      expect(match).not.toBeNull();

      const res = await fetch(`http://localhost:${port}/${match![1]}`);
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect((await res.arrayBuffer()).byteLength).toBe(big.byteLength);
    } finally {
      await rm(repoRoot, { recursive: true, force: true });
    }
  });

  test('a CSS-asset URL the current render did not emit still 404s', async () => {
    // The map is an exact-match allow-list rebuilt on every render — never a
    // second traversal surface.
    const state = makeState(projectDir, tempDir);
    server = await createPreviewServer(state, port);
    const res = await fetch(`http://localhost:${port}/assets/deadbeef.png`);
    expect(res.status).toBe(404);
  });

  test('no-input mode (no project root) 404s any non-book.html path instead of erroring', async () => {
    // state.currentInputPath === '' models the desktop's "no directory picked
    // yet" mode (see lifecycle.ts). There is no project to serve a
    // non-book.html path from, so every such request must 404, not throw or
    // crash the server.
    const state = makeState('', tempDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(`http://localhost:${port}/anything.png`);
    expect(res.status).toBe(404);
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

  test('reload revisions are acknowledged and recover after a disconnected broadcast', async () => {
    const state = makeState(tempDir);
    server = await createPreviewServer(state, port);

    const ws = new WebSocket(`ws://localhost:${port}/__gutterpress-hmr`);
    const initialState = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(typeof e.data === 'string' ? e.data : '');
    });
    await new Promise<void>((resolve, reject) => {
      ws.onopen = () => resolve();
      ws.onerror = (e) => reject(e);
    });
    const initial = JSON.parse(await initialState);
    expect(initial.type).toBe('reload-state');
    expect(typeof initial.instance).toBe('string');
    expect(initial.instance.length).toBeGreaterThan(0);
    expect(initial.revision).toBe(0);
    ws.send(JSON.stringify({ type: 'reload-applied', instance: initial.instance, revision: 0 }));

    const reloadMessage = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(typeof e.data === 'string' ? e.data : '');
    });
    server.broadcastReload();
    const data = await Promise.race([
      reloadMessage,
      new Promise<string>((_, reject) =>
        setTimeout(() => reject(new Error('timeout waiting for HMR message')), 2000)
      ),
    ]);
    expect(JSON.parse(data)).toEqual({
      type: 'full-reload',
      instance: initial.instance,
      revision: 1,
    });

    ws.send(JSON.stringify({ type: 'reload-applied', instance: initial.instance, revision: 1 }));
    await new Promise((resolve) => setTimeout(resolve, 25));

    const chapterMessage = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(typeof e.data === 'string' ? e.data : '');
    });
    server.broadcastContentUpdate('chapters/one.md');
    expect(JSON.parse(await chapterMessage)).toEqual({
      type: 'content-update',
      instance: initial.instance,
      revision: 2,
      file: 'chapters/one.md',
    });

    const cumulativeMessage = new Promise<string>((resolve) => {
      ws.onmessage = (e) => resolve(typeof e.data === 'string' ? e.data : '');
    });
    server.broadcastContentUpdate('chapters/two.md');
    expect(JSON.parse(await cumulativeMessage)).toEqual({
      type: 'full-reload',
      instance: initial.instance,
      revision: 3,
    });
    ws.send(JSON.stringify({ type: 'reload-applied', instance: initial.instance, revision: 3 }));

    await new Promise<void>((resolve) => {
      ws.onclose = () => resolve();
      ws.close();
    });

    // No client receives this edge. A new connection still learns the current
    // revision and can update, which is the stale-view recovery contract.
    server.broadcastContentUpdate('chapters/three.md');
    const reconnected = new WebSocket(`ws://localhost:${port}/__gutterpress-hmr`);
    const recoveredState = new Promise<string>((resolve) => {
      reconnected.onmessage = (e) => resolve(typeof e.data === 'string' ? e.data : '');
    });
    await new Promise<void>((resolve, reject) => {
      reconnected.onopen = () => resolve();
      reconnected.onerror = (e) => reject(e);
    });
    expect(JSON.parse(await recoveredState)).toEqual({
      type: 'reload-state',
      instance: initial.instance,
      revision: 4,
    });
    reconnected.send(JSON.stringify({
      type: 'reload-applied',
      instance: initial.instance,
      revision: 4,
    }));
    reconnected.close();
  });

  test('serves files from nested subdirectories of the project root', async () => {
    await mkdir(join(projectDir, 'sub'));
    await writeFile(join(projectDir, 'sub', 'data.json'), '{"ok":true}');

    const state = makeState(projectDir, tempDir);
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
    workDir = await mkdtemp(join(tmpdir(), 'gutterpress-chapter-test-'));
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

  test('renders one source file with chapter metadata and preview scripts', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'chapter1.md'), '# Hello Chapter');
    await writeFile(join(projectDir, 'chapter2.md'), '# Other Chapter');

    const state = makeState(projectDir);
    server = await createPreviewServer(state, port);

    const res = await fetch(
      `http://localhost:${port}/__chapter?file=${encodeURIComponent('chapter1.md')}`
        + '&revision=0'
    );
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain('Hello Chapter');
    expect(body).toContain('data-chapter-src="chapter1.md"');
    expect(body).toContain('/engine/gutterpress-viewer.js');
    expect(body).not.toContain('Other Chapter');
  });

  test('rejects a source outside the configured file list and a stale revision', async () => {
    const projectDir = join(workDir, 'project');
    await mkdir(projectDir, { recursive: true });
    await writeFile(join(projectDir, 'chapter1.md'), '# Configured');
    await writeFile(join(projectDir, 'private.md'), '# Not Configured');

    const state = makeState(projectDir);
    state.config = resolveConfig({}, { source: { files: ['chapter1.md'] } });
    server = await createPreviewServer(state, port);

    const unconfigured = await fetch(
      `http://localhost:${port}/__chapter?file=private.md&revision=0`,
    );
    expect(unconfigured.status).toBe(400);
    expect(await unconfigured.text()).not.toContain('Not Configured');

    const stale = await fetch(
      `http://localhost:${port}/__chapter?file=chapter1.md&revision=1`,
    );
    expect(stale.status).toBe(400);
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
    expect(res.status).not.toBe(200);
    expect([400, 404]).toContain(res.status);
    const body = await res.text();
    expect(body).not.toContain('TOP SECRET DATA');
  });

  test('rejects a backslash-based path-traversal file param', async () => {
    // The render sink canonicalizes backslashes before reading the file.
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
