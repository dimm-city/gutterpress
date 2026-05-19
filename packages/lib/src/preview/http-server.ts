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
import { readFile, stat } from 'node:fs/promises';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { info } from '../utils/logger.ts';
import { openPath } from '../lib/open-path.ts';
import { getAssetPath } from '../lib/embedded-assets.ts';
import type { ServerState } from './server-context.ts';
import { handleApiRequest } from './api-middleware.ts';

/**
 * URL path that upgrades to a WebSocket subscribed to the reload topic.
 */
const HMR_PATH = '/__print-md-hmr';

/**
 * Tiny client snippet injected into served HTML. Listens for `full-reload`
 * messages on the HMR WebSocket and reloads the page.
 */
const HMR_CLIENT_SNIPPET = `
<script>
  (function () {
    var ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '${HMR_PATH}');
    ws.onmessage = function (e) {
      try { if (JSON.parse(e.data).type === 'full-reload') location.reload(); } catch (_) {}
    };
  })();
</script>
`;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css",
  ".js": "application/javascript",
  ".mjs": "application/javascript",
  ".json": "application/json",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/**
 * Public handle for the running preview server.
 */
export interface PreviewServer {
  /** Port the server is listening on. */
  port: number;
  /** Stop the server and close all connections. */
  close(): Promise<void>;
  /**
   * Broadcast a `{ type: "full-reload" }` message to every connected HMR
   * client. Safe to call after `close()` (no-op).
   */
  broadcastReload(): void;
}

/**
 * Check if a TCP port is available for binding.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    // @types/bun's node:net shim omits EventEmitter methods from Server; cast to use .on().
    (srv as unknown as { on(e: 'error', fn: () => void): void }).on('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/**
 * Find the next available port starting from `startPort`.
 *
 * @throws {Error} If no available port found after 10 attempts.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortAvailable(port)) return port;
    port++;
  }
  throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

/**
 * Resolve a request URL pathname to an absolute path inside `tempDir`.
 * Returns `null` if the resolved path escapes the temp dir root.
 */
function resolveStaticPath(urlPathname: string, tempDir: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  const resolvedTemp = path.resolve(tempDir);
  const candidate = path.resolve(resolvedTemp, '.' + decoded);
  if (candidate !== resolvedTemp && !candidate.startsWith(resolvedTemp + path.sep)) {
    return null;
  }
  return candidate;
}

/**
 * Inject the HMR client snippet just before the closing `</body>` tag.
 */
function injectHmrClient(html: string): string {
  const closingBody = html.lastIndexOf('</body>');
  if (closingBody === -1) return html + HMR_CLIENT_SNIPPET;
  return html.slice(0, closingBody) + HMR_CLIENT_SNIPPET + html.slice(closingBody);
}

/**
 * Serve a static file (or directory's `index.html`) with HMR injection for
 * HTML responses. Writes 404 if the path doesn't resolve to a real file.
 *
 * `cacheControl` is the value sent in the Cache-Control header. Defaults to
 * 'no-cache' (HMR-friendly). Vendor assets that never change content within
 * a process pass 'public, max-age=31536000, immutable' so Chrome's HTTP
 * cache reuses them across page reloads within the same session.
 */
async function serveStatic(
  absPath: string,
  res: http.ServerResponse,
  cacheControl: string = 'no-cache',
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
    const withHmr = injectHmrClient(data.toString('utf-8'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(withHmr);
    return;
  }

  const ct = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  // Empty files: force 200 with empty body so placeholders (e.g. empty CSS)
  // load without error in some clients.
  res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': cacheControl });
  res.end(data);
}

/**
 * URL paths that resolve to the process-wide embedded assets dir, NOT the
 * per-project tempDir. These never change within a process lifetime so we
 * serve them from a stable disk location (avoids per-open copies, lets
 * Defender hash-cache stay warm, and lets Chrome's HTTP cache reuse the
 * response across reloads in the same session).
 */
const EMBEDDED_PREFIXES = ['/vendor/', '/preview/scripts/'];
const EMBEDDED_EXACT = new Set(['/favicon.ico']);

function matchesEmbedded(urlPathname: string): boolean {
  if (EMBEDDED_EXACT.has(urlPathname)) return true;
  return EMBEDDED_PREFIXES.some((p) => urlPathname.startsWith(p));
}

/**
 * Pipe a Web API `Response` object into a Node.js `http.ServerResponse`.
 */
async function pipeWebResponse(webRes: Response, res: http.ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(webRes.status, headers);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

/**
 * Create and start a preview HTTP+WebSocket server bound to `state.tempDir`.
 */
export async function createPreviewServer(
  state: ServerState,
  port: number,
  restartPreviewFn: (newPath: string) => Promise<void>
): Promise<PreviewServer> {
  const clients = new Set<WebSocket>();

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');

    // 1. WebSocket HMR path — non-upgrade hits get 426.
    if (url.pathname === HMR_PATH) {
      res.writeHead(426, { 'Content-Type': 'text/plain', Upgrade: 'websocket' });
      res.end('Expected WebSocket upgrade');
      return;
    }

    // 2. API routes.
    if (url.pathname.startsWith('/api/')) {
      const webReq = new Request(`http://127.0.0.1${req.url!}`, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])
        ),
      });
      const webRes = await handleApiRequest(webReq, state, restartPreviewFn);
      if (webRes) {
        await pipeWebResponse(webRes, res);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // 3. Embedded assets (vendor + viewer scripts) — served from the
    // process-wide extracted assets dir, with long cache headers. These
    // never change within a process lifetime, so we never copy them into
    // per-project tempDirs (avoids redundant disk writes that Windows
    // Defender re-scans on every folder open).
    if (matchesEmbedded(url.pathname)) {
      const rel = url.pathname.slice(1); // strip leading '/'
      try {
        const absPath = await getAssetPath(rel);
        await serveStatic(
          absPath,
          res,
          'public, max-age=31536000, immutable',
        );
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }

    // 4. Static file fallback.
    // Treat bare "/" as book.html — the desktop app (packages/viewer) wraps
    // book.html in its own iframe-based toolbar.
    const pathname = url.pathname === '/' ? '/book.html' : url.pathname;
    const absPath = resolveStaticPath(pathname, state.tempDir);
    if (!absPath) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    await serveStatic(absPath, res).catch((err: Error) => {
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

  return {
    port: boundPort,
    async close() {
      if (stopped) return;
      stopped = true;
      for (const ws of clients) ws.terminate();
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
      if (stopped) return;
      const message = JSON.stringify({ type: 'full-reload' });
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    },
  };
}
