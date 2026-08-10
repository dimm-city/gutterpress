/**
 * Node.js-compatible preview HTTP server with WebSocket-based live reload.
 *
 * Uses node:http + the `ws` package in place of Bun.serve so this module
 * runs under both Bun (dev / compiled binary) and Node.js (Electron in-process).
 *
 * This module deliberately avoids any bundler runtime (vite/rollup/esbuild)
 * — see ADR `docs/adr/0001-no-bundlers-at-runtime.md`.
 */

import http from 'node:http';
import net from 'node:net';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { info } from '../utils/logger.ts';
import { openPath } from '../lib/open-path.ts';
import { getAssetPath } from '../lib/embedded-assets.ts';
import {
  STATIC_MIME,
  hasDotSegment,
  resolveStaticPath,
  resolveWithinRoot,
} from '../lib/static-serve.ts';
import { PACKAGE_VERSION } from '../lib/version.ts';
import type { ServerState } from './server-context.ts';
import { incrementalPreviewEnabled, renderChapterPreviewHtml } from './file-watcher.ts';
import { canonicalChapterId } from '../lib/markdown/chapter-id.ts';
import { resolvePort, UsageError } from '../lib/cli-args.ts';
import { BuildError } from '../lib/build-error.ts';

/**
 * URL path that upgrades to a WebSocket subscribed to the reload topic.
 */
const HMR_PATH = '/__gutterpress-hmr';

/**
 * Tiny client snippet injected into served HTML. Reconciles the visible page
 * to the server's latest rendered revision across reloads and reconnects.
 */
function hmrClientSnippet(initialRevision: number, instanceId: string): string {
  return `
<script>
  (function () {
    // When loaded by the preview SHELL (iframe double-buffer), the shell loads us
    // with ?gutterpressshell=1 and owns HMR (it swaps frames + syncs scroll), so we stay
    // inert. We must NOT bail merely because we're framed — other hosts (the
    // Electron desktop's SPA) embed book.html directly and rely on this HMR client
    // for scroll-anchor and reload.
    if (/[?&]gutterpressshell=1/.test(location.search)) return;
  var ANCHOR_KEY = 'gutterpress-scroll-anchor';
  var appliedRevision = ${initialRevision};
  var appliedInstance = ${JSON.stringify(instanceId)};
  var readyToAcknowledge = false;
  var reloadRequested = false;

    // Find the element nearest the top of the viewport that carries a source
    // line (markdown-it-source-map emits data-source-line on block elements).
    // We anchor on SOURCE position, not pixels, because page breaks move when
    // content re-paginates.
    function captureAnchor() {
      var els = document.querySelectorAll('[data-source-line]');
      var best = null, bestTop = -Infinity;
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (r.bottom < 0 || r.height === 0) continue;
        if (r.top <= 80 && r.top > bestTop) { bestTop = r.top; best = els[i]; }
      }
      if (!best) {
        for (var j = 0; j < els.length; j++) {
          var rr = els[j].getBoundingClientRect();
          if (rr.bottom > 0 && rr.height > 0) { best = els[j]; break; }
        }
      }
      if (!best) return null;
      var chapter = best.closest && best.closest('[data-chapter-src]');
      return {
        chapter: chapter ? chapter.getAttribute('data-chapter-src') : null,
        line: best.getAttribute('data-source-line'),
        offset: best.getBoundingClientRect().top
      };
    }

    // After a content reload, put the same source line back at the same viewport
    // offset so the author keeps their place (no jump to the top).
    function restoreAnchor() {
      var raw;
      try { raw = sessionStorage.getItem(ANCHOR_KEY); } catch (_) { return; }
      if (!raw) return;
      try { sessionStorage.removeItem(ANCHOR_KEY); } catch (_) {}
      var a; try { a = JSON.parse(raw); } catch (_) { return; }
      var tries = 0;
      (function attempt() {
        var blocks = document.querySelectorAll('[data-source-line]');
        var el = null;
        for (var i = 0; i < blocks.length; i++) {
          var chapter = blocks[i].closest && blocks[i].closest('[data-chapter-src]');
          var chapterId = chapter ? chapter.getAttribute('data-chapter-src') : null;
          if ((!a.chapter || chapterId === a.chapter) &&
              blocks[i].getAttribute('data-source-line') === String(a.line)) {
            el = blocks[i];
            break;
          }
        }
        if (el) {
          window.scrollBy({
            top: el.getBoundingClientRect().top - a.offset,
            behavior: 'instant'
          });
          if (window.previewAPI && typeof window.previewAPI.refresh === 'function') {
            window.previewAPI.refresh();
          }
          return;
        }
        if (tries++ < 240) setTimeout(attempt, 25); // wait for pagination
      })();
    }
    var restored = false;
    function restoreOnce() { if (restored) return; restored = true; restoreAnchor(); }
    function finishInitialRender() {
      restoreOnce();
      readyToAcknowledge = true;
      acknowledge();
    }
    // CRITICAL ordering: when the pagination engine is present it restructures
    // the DOM after load, so restoring the scroll anchor early would target
    // pre-pagination geometry. The Gutterpress engine viewer fires
    // 'gp:layout' when its pagination completes — wait for it. In static
    // mode (no engine) the content is final immediately, so restore right
    // after load.
    var hasEngine = !!document.querySelector('script[src*="/engine/gutterpress-viewer.js"]');
    window.addEventListener('gp:layout', finishInitialRender, { once: true });
    if (!hasEngine) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(finishInitialRender, 50); });
      } else {
        setTimeout(finishInitialRender, 50);
      }
    }
    var ws = null;
    var reconnectTimer = null;
    var reconnectDelay = 250;
    var stopped = false;

    function acknowledge() {
      if (!readyToAcknowledge || !ws || ws.readyState !== 1) return;
      try {
        ws.send(JSON.stringify({
          type: 'reload-applied',
          instance: appliedInstance,
          revision: appliedRevision
        }));
      } catch (_) {}
    }

    function connect() {
      if (stopped) return;
      ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '${HMR_PATH}');
      ws.onopen = function () {
        reconnectDelay = 250;
        acknowledge();
      };
      ws.onmessage = function (e) {
        var msg;
        try { msg = JSON.parse(e.data); } catch (_) { return; }
        if (
          msg.type !== 'reload-state' &&
          msg.type !== 'full-reload' &&
          msg.type !== 'content-update'
        ) return;
        var instance = typeof msg.instance === 'string' ? msg.instance : null;
        var revision = Number(msg.revision);
        if (!instance || !Number.isSafeInteger(revision) || revision < 0) return;
        if (instance === appliedInstance && revision <= appliedRevision) {
          acknowledge();
          return;
        }
        if (reloadRequested) return;
        reloadRequested = true;
        try { var a = captureAnchor(); if (a) sessionStorage.setItem(ANCHOR_KEY, JSON.stringify(a)); } catch (_) {}
        location.reload();
      };
      ws.onclose = function () {
        ws = null;
        if (stopped || reconnectTimer !== null) return;
        reconnectTimer = setTimeout(function () {
          reconnectTimer = null;
          connect();
        }, reconnectDelay);
        reconnectDelay = Math.min(reconnectDelay * 2, 5000);
      };
      ws.onerror = function () { try { ws.close(); } catch (_) {} };
    }

    window.addEventListener('beforeunload', function () {
      stopped = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
    });
    connect();
  })();
</script>
`;
}

/**
 * Preview shell (enabled by default; legacy opt-out is
 * GUTTERPRESS_PREVIEW_INCREMENTAL=0). Hosts book.html in an iframe and
 * paginates one edited Markdown source in a hidden frame, while geometry-wide
 * changes still double-buffer and swap a full document.
 */
function shellHtml(initialRevision: number, instanceId: string): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>gutterpress preview</title>
<style>html,body{margin:0;height:100%;background:#fff;overflow:hidden}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}</style>
</head><body>
<iframe id="gutterpress-active" src="/book.html?gutterpressshell=1" title="preview"></iframe>
<script>window.__GUTTERPRESS_HMR=${JSON.stringify(HMR_PATH)};window.__GUTTERPRESS_INSTANCE=${JSON.stringify(instanceId)};window.__GUTTERPRESS_REVISION=${initialRevision};</script>
<script src="/preview/scripts/preview-shell.js"></script>
</body></html>`;
}

/**
 * Public handle for the running preview server.
 */
export interface PreviewServer {
  /** Port the server is listening on. */
  port: number;
  /** Stop the server and close all connections. */
  close(): Promise<void>;
  /**
   * Advance the rendered revision and notify every connected HMR client.
   * Disconnected clients reconcile to the latest revision when they reconnect.
   * Safe to call after `close()` (no-op).
   */
  broadcastReload(): void;
  /** Paginate and replace one edited Markdown source in connected shells. */
  broadcastContentUpdate(file: string): void;
}

/**
 * Check if a TCP port is available on the address the preview will bind.
 */
type PortProbeError = Error & { code?: string };
type PortProbeResult =
  | { available: true }
  | { available: false; error: PortProbeError };

function probePort(port: number, host: string): Promise<PortProbeResult> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    let settled = false;
    const finish = (result: PortProbeResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    // @types/bun's node:net shim omits EventEmitter methods from Server.
    (srv as unknown as {
      once(e: 'error', fn: (error: PortProbeError) => void): void;
    }).once('error', (error) => finish({ available: false, error }));
    try {
      srv.listen(port, host, () => {
        srv.close(() => finish({ available: true }));
      });
    } catch (error) {
      finish({
        available: false,
        error: error instanceof Error ? error : new Error(String(error)),
      });
    }
  });
}

export async function isPortAvailable(
  port: number,
  host: string = '127.0.0.1',
): Promise<boolean> {
  return (await probePort(port, host)).available;
}

/**
 * Find the next available port starting from `startPort`.
 *
 * @throws {UsageError} If the start port itself is invalid.
 * @throws {BuildError} If valid ports are exhausted or the host cannot bind.
 */
export async function findAvailablePort(
  startPort: number,
  host: string = '127.0.0.1',
): Promise<number> {
  const firstPort = resolvePort(startPort);
  let port = firstPort;
  const maxAttempts = Math.min(10, 65536 - firstPort);
  let lastBusyError: PortProbeError | undefined;
  for (let i = 0; i < maxAttempts; i++) {
    const probe = await probePort(port, host);
    if (probe.available) return port;
    if (probe.error.code !== 'EADDRINUSE') {
      throw new BuildError(
        `Could not bind the preview server to ${host}:${port}: ${probe.error.message}. ` +
          'Check that --host names an address on this computer and --port is permitted, or omit them to use the defaults.',
        undefined,
        { cause: probe.error },
      );
    }
    lastBusyError = probe.error;
    port++;
  }
  throw new BuildError(
    `Could not find an available port on ${host} from ${firstPort} to ${port - 1}; all are already in use. ` +
      'Stop another preview server or pass --port with an available port.',
    undefined,
    { cause: lastBusyError },
  );
}

/**
 * Inject the HMR client snippet just before the closing `</body>` tag.
 */
function injectHmrClient(html: string, revision: number, instanceId: string): string {
  const snippet = hmrClientSnippet(revision, instanceId);
  const closingBody = html.lastIndexOf('</body>');
  if (closingBody === -1) return html + snippet;
  return html.slice(0, closingBody) + snippet + html.slice(closingBody);
}

/**
 * Serve a static file (or directory's `index.html`) with HMR injection for
 * HTML responses. Writes 404 if the path doesn't resolve to a real file.
 *
 * `cacheControl` is the value sent in the Cache-Control header. Defaults to
 * 'no-store' — the preview server binds a NEW port every launch, so any disk
 * caching keys per-origin and accumulates a fresh copy of every asset on each
 * run (this grew a user's HTTP cache to ~1.5 GB and made launch take ~10s as
 * Chromium indexed it). Live preview content changes on every edit anyway —
 * `state.tempDir`'s book.html on every rebuild, and any project file served
 * in place under `state.currentInputPath` whenever the author edits it — so
 * neither should ever be written to the HTTP disk cache; every caller below
 * serving one of those two roots relies on the 'no-store' default. The one
 * override is the embedded-assets route just below, which passes a long
 * cache value: those files are content-fixed per binary build (not per
 * project), so caching them across reloads within one preview session is
 * safe and saves re-downloading the ~900 KB polyfill on every page load.
 */
async function serveStatic(
  absPath: string,
  res: http.ServerResponse,
  cacheControl: string = 'no-store',
  extraHeaders: Record<string, string> = {},
  hmrRevision: number = 0,
  hmrInstance: string = '',
): Promise<void> {
  let filePath = absPath;

  // Directory hit → try index.html inside it.
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const isHtml = filePath.endsWith('.html') || filePath.endsWith('.htm');
  if (isHtml) {
    const withHmr = injectHmrClient(data.toString('utf-8'), hmrRevision, hmrInstance);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(withHmr);
    return;
  }

  const ct = STATIC_MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  // Empty files: force 200 with empty body so placeholders (e.g. empty CSS)
  // load without error in some clients.
  res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': cacheControl, ...extraHeaders });
  res.end(data);
}

/**
 * URL paths that resolve to the process-wide embedded assets dir, NOT the
 * per-project tempDir. These never change within a process lifetime so we
 * serve them from a stable disk location (avoids per-open copies, lets
 * Defender hash-cache stay warm) AND with a long, immutable Cache-Control
 * (see `EMBEDDED_CACHE_CONTROL` below) so Chrome's HTTP cache reuses the
 * response across reloads within the same preview session instead of
 * re-fetching the ~900 KB polyfill on every load.
 */
const EMBEDDED_PREFIXES = ['/preview/scripts/', '/engine/'];
const EMBEDDED_EXACT = new Set(['/favicon.ico']);

/**
 * Embedded assets are content-fixed per gutterpress VERSION, not forever: the
 * preview server binds a fixed default port (3579), so the SAME URL on the
 * SAME origin serves DIFFERENT bytes after a gutterpress upgrade. `immutable`
 * would pin a browser to the old ~900 KB polyfill for a year (it forbids even
 * a reload from revalidating), silently serving stale vendored scripts across
 * an upgrade. Instead we tag each response with a version ETag and use
 * `no-cache` (store, but revalidate before every use): an unchanged version
 * returns a 304 with no body — so the polyfill is still never re-downloaded
 * within or across sessions — while an upgrade's new ETag forces a fresh 200.
 */
const EMBEDDED_CACHE_CONTROL = 'public, no-cache';
/** Version-stamped ETag so a gutterpress upgrade invalidates the browser cache. */
const EMBEDDED_ETAG = `"gutterpress-${PACKAGE_VERSION}"`;

function matchesEmbedded(urlPathname: string): boolean {
  if (EMBEDDED_EXACT.has(urlPathname)) return true;
  return EMBEDDED_PREFIXES.some((p) => urlPathname.startsWith(p));
}

/**
 * Create and start a preview HTTP+WebSocket server.
 *
 * `book.html` — the one file gutterpress generates — is served from
 * `state.tempDir`. Everything else a served page can ask for (an `<img src>`
 * at its authored project-relative path, or any other project file) is
 * served DIRECTLY from `state.currentInputPath`, the real project directory,
 * not a copy of it — see lifecycle.ts's `initializePreviewDirectories` for
 * why. This is what makes preview asset resolution identical to the build's
 * BY CONSTRUCTION: both resolve a reference against the same real project
 * tree, so a path that works in one works in the other.
 */
export async function createPreviewServer(
  state: ServerState,
  port: number,
): Promise<PreviewServer> {
  const ACK_RETRY_MS = 2000;
  const MAX_ACK_RETRIES = 95;
  const instanceId = randomUUID();
  let reloadRevision = 0;
  const clients = new Map<WebSocket, {
    acknowledgedRevision: number;
    retryAttempts: number;
    retryTimer: ReturnType<typeof setTimeout> | null;
  }>();

  function sendRevision(
    ws: WebSocket,
    type: 'reload-state' | 'full-reload' | 'content-update',
    file?: string,
  ): void {
    if (ws.readyState !== WebSocket.OPEN) return;
    try {
      ws.send(JSON.stringify({
        type,
        instance: instanceId,
        revision: reloadRevision,
        ...(file ? { file } : {}),
      }));
    } catch {
      // The close handler removes the client; a reconnect receives current state.
    }
  }

  function waitForAcknowledgement(ws: WebSocket): void {
    const client = clients.get(ws);
    if (!client) return;
    if (client.acknowledgedRevision >= reloadRevision) {
      if (client.retryTimer !== null) clearTimeout(client.retryTimer);
      client.retryTimer = null;
      client.retryAttempts = 0;
      return;
    }
    if (client.retryTimer !== null) return;
    client.retryTimer = setTimeout(() => {
      const current = clients.get(ws);
      if (!current) return;
      current.retryTimer = null;
      if (current.retryAttempts >= MAX_ACK_RETRIES) {
        ws.terminate();
        return;
      }
      current.retryAttempts++;
      sendRevision(ws, 'reload-state');
      waitForAcknowledgement(ws);
    }, ACK_RETRY_MS);
    client.retryTimer.unref?.();
  }

  function removeClient(ws: WebSocket): void {
    const client = clients.get(ws);
    if (client && client.retryTimer !== null) clearTimeout(client.retryTimer);
    clients.delete(ws);
  }

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    clients.set(ws, { acknowledgedRevision: -1, retryAttempts: 0, retryTimer: null });
    ws.on('message', (raw) => {
      let message: unknown;
      try {
        message = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      const payload = message as { type?: unknown; instance?: unknown; revision?: unknown };
      if (payload.type !== 'reload-applied') return;
      const revision = Number(payload.revision);
      if (
        payload.instance !== instanceId ||
        !Number.isSafeInteger(revision) ||
        revision < 0 ||
        revision > reloadRevision
      ) return;
      const client = clients.get(ws);
      if (!client) return;
      client.acknowledgedRevision = Math.max(client.acknowledgedRevision, revision);
      waitForAcknowledgement(ws);
    });
    ws.on('close', () => removeClient(ws));
    ws.on('error', () => {
      removeClient(ws);
      ws.terminate();
    });
    sendRevision(ws, 'reload-state');
    waitForAcknowledgement(ws);
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');

    // 1. WebSocket HMR path — non-upgrade hits get 426.
    if (url.pathname === HMR_PATH) {
      res.writeHead(426, { 'Content-Type': 'text/plain', Upgrade: 'websocket' });
      res.end('Expected WebSocket upgrade');
      return;
    }

    // 2. API routes. The preview server is headless (desktop chrome — folder
    // picker, GitHub clone — lives in the desktop app), so GET /api/status is
    // the only endpoint: kept for backwards compatibility with any external
    // tooling that checks server liveness. Inlined directly (finding #54) —
    // a two-module Web-Request/Response dispatcher was retained scaffolding
    // for exactly one hard-coded route.
    if (url.pathname === '/api/status' && req.method === 'GET') {
      const body = JSON.stringify({
        hasInput: !!state.currentInputPath,
        currentPath: state.currentInputPath,
      });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(body);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // 3. Render one source file for the shell's fast Markdown-update path.
    if (url.pathname === '/__chapter' && req.method === 'GET') {
      const rawFile = url.searchParams.get('file');
      const file = rawFile ? canonicalChapterId(rawFile) : '';
      const revision = Number(url.searchParams.get('revision'));
      const configuredFiles = state.config.source?.files;
      if (
        !file ||
        !state.currentInputPath ||
        !incrementalPreviewEnabled() ||
        !Number.isSafeInteger(revision) ||
        revision !== reloadRevision ||
        path.extname(file).toLowerCase() !== '.md' ||
        hasDotSegment(file) ||
        !resolveWithinRoot(file, state.currentInputPath) ||
        (Array.isArray(configuredFiles) && configuredFiles.length > 0 &&
          !configuredFiles.some((configured) => canonicalChapterId(configured) === file))
      ) {
        res.writeHead(400);
        res.end('Bad Request');
        return;
      }
      try {
        const html = await renderChapterPreviewHtml(
          state.currentInputPath,
          file,
          state.config,
        );
        if (revision !== reloadRevision) {
          res.writeHead(409);
          res.end('Superseded');
          return;
        }
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store',
        });
        res.end(html);
      } catch (error) {
        res.writeHead(500);
        res.end(error instanceof Error ? error.message : String(error));
      }
      return;
    }

    // 4. Embedded assets (vendor + desktop scripts) — served from the
    // process-wide extracted assets dir, with a long, immutable cache header
    // (EMBEDDED_CACHE_CONTROL). These never change within a process
    // lifetime, so we never copy them into per-project tempDirs (avoids
    // redundant disk writes that Windows Defender re-scans on every folder
    // open) and it's safe to let the browser cache them across reloads.
    if (matchesEmbedded(url.pathname)) {
      // Conditional request: when the browser already has this version's copy
      // (If-None-Match matches the version ETag), answer 304 with no body —
      // the ~900 KB polyfill is never re-read from disk or re-sent.
      if (req.headers['if-none-match'] === EMBEDDED_ETAG) {
        res.writeHead(304, { ETag: EMBEDDED_ETAG, 'Cache-Control': EMBEDDED_CACHE_CONTROL });
        res.end();
        return;
      }
      const rel = url.pathname.slice(1); // strip leading '/'
      try {
        const absPath = await getAssetPath(rel);
        await serveStatic(
          absPath,
          res,
          EMBEDDED_CACHE_CONTROL,
          { ETag: EMBEDDED_ETAG },
        );
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }

    // 5. Preview shell: serve the incremental/double-buffered shell at "/".
    if (url.pathname === '/' && incrementalPreviewEnabled()) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(shellHtml(reloadRevision, instanceId));
      return;
    }

    // 6. Static file fallback: book.html vs the project root.
    // Treat bare "/" as book.html — the desktop app (packages/desktop) wraps
    // book.html in its own iframe-based toolbar.
    //
    // book.html is the ONE file gutterpress generates (CSS + fonts are inlined
    // into it at render time — see asset-inline.ts), so it is the only path
    // served out of `state.tempDir`. Every other path is served DIRECTLY from
    // the project directory (`state.currentInputPath`) — an `<img src>` at its
    // authored project-relative path, or any other project file a served page
    // asks for. Serving the project in place (instead of copying the whole
    // tree into tempDir at startup) is what makes preview asset resolution
    // identical to the build's BY CONSTRUCTION: both read straight off the
    // real project tree, so nothing can drift between "works in preview" and
    // "shipped in the PDF".
    //
    // Serving the project root for the first time means its OWN dotfiles are
    // now in the request path too (the old whole-tree copy leaked `.env` and
    // an external `.git` into a throwaway dir; this reads the real thing), so
    // `hasDotSegment` (lib/static-serve.ts — shared with the containment
    // guard it must accompany) is a hard requirement here, not a nicety: a
    // request for `/.env` or anything under a dot-directory must 404, never
    // read through, INCLUDING the `%5C`-spelled separator that `path.resolve`
    // honors on Windows. No-input mode (`state.currentInputPath === ''`) has
    // no project to serve from either, so every non-book.html path 404s there
    // too.
    const pathname = url.pathname === '/' ? '/book.html' : url.pathname;

    // 4a. Inlined-CSS assets the render could not embed. `asset-inline.ts`
    // rewrites an oversized image to `assets/<contentHash><ext>` when it lives
    // OUTSIDE the book — art referenced from a repo-root shared stylesheet,
    // the normative multi-book layout — and returns a copy plan. The build
    // executes that plan into its output dir; the preview serves the project
    // in place and has no such dir, so the rewritten URL used to 404 and
    // shared art rendered broken in the live preview while building fine.
    //
    // `state.cssAssets` IS that plan (see ServerState.cssAssets): an exact
    // URL→source map rebuilt on every render. Looked up by exact key, so it
    // adds no traversal surface, and consulted BEFORE the dotfile guard
    // because the SOURCE may legitimately sit under a dot-directory (a shared
    // foundation checked out under `~/.local/share/…`) — what makes it safe is
    // that our own inliner put it there, not where it happens to live.
    const cssAssetSource = state.cssAssets.get(pathname.replace(/^\/+/, ''));
    if (cssAssetSource) {
      await serveStatic(cssAssetSource, res).catch((err: Error) => {
        if (!res.headersSent) {
          res.writeHead(500);
          res.end(`Internal Server Error: ${err.message}`);
        }
      });
      return;
    }

    const servingProjectRoot = pathname !== '/book.html';
    if (servingProjectRoot && (!state.currentInputPath || hasDotSegment(pathname))) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    const staticRoot = servingProjectRoot ? state.currentInputPath : state.tempDir;
    const absPath = resolveStaticPath(pathname, staticRoot);
    if (!absPath) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    await serveStatic(absPath, res, 'no-store', {}, reloadRevision, instanceId).catch((err: Error) => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(`Internal Server Error: ${err.message}`);
      }
    });
  });

  // Handle WebSocket upgrade for the HMR path.
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    if (url.pathname === HMR_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(port, state.options.host, resolve));

  const boundPort = (server.address() as net.AddressInfo).port;
  const serverUrl = `http://localhost:${boundPort}`;
  info(`Preview server running at ${serverUrl}`);
  if (state.options.host !== '127.0.0.1' && state.options.host !== 'localhost') {
    info(`Bound on ${state.options.host}:${boundPort} (reachable from the network)`);
  }
  info('Press Ctrl+C to stop');

  if (state.options.openBrowser) {
    openPath(serverUrl).catch(() => { /* no-op */ });
  }

  let stopped = false;

  const broadcastUpdate = (
    type: 'full-reload' | 'content-update',
    file?: string,
  ): void => {
    if (stopped) return;
    reloadRevision++;
    for (const [ws] of clients) {
      sendRevision(ws, type, file);
      waitForAcknowledgement(ws);
    }
  };

  const updateInFlight = (): boolean => {
    for (const client of clients.values()) {
      if (client.acknowledgedRevision < reloadRevision) return true;
    }
    return false;
  };

  return {
    port: boundPort,
    async close() {
      if (stopped) return;
      stopped = true;
      for (const [ws, client] of clients) {
        if (client.retryTimer !== null) clearTimeout(client.retryTimer);
        ws.terminate();
      }
      clients.clear();
      wss.close();
      await new Promise<void>((resolve) => {
        // closeAllConnections() available in Node 18.2+ / all Electron 33 builds
        if (typeof (server as any).closeAllConnections === 'function') {
          (server as any).closeAllConnections();
        }
        server.close(() => resolve());
      });
    },
    broadcastReload() {
      broadcastUpdate('full-reload');
    },
    broadcastContentUpdate(file: string) {
      // Revisions are cumulative. If any visible client is still applying an
      // older update, a second isolated splice could omit it; the latest
      // authoritative book.html safely subsumes both changes.
      if (updateInFlight()) broadcastUpdate('full-reload');
      else broadcastUpdate('content-update', canonicalChapterId(file));
    },
  };
}
