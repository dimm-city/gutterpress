/**
 * Bun-native preview HTTP server with WebSocket-based live reload.
 *
 * Replaces the previous Vite-based dev server. Provides:
 *   - Static file serving from `state.tempDir`
 *   - JSON API routes (delegated to `routes.ts` via `api-middleware.ts`)
 *   - A `/__print-md-hmr` WebSocket endpoint that broadcasts a
 *     `{ type: "full-reload" }` message to all subscribers when the file
 *     watcher fires
 *   - A tiny inline HMR client snippet injected into served HTML files
 *
 * This module deliberately avoids any bundler runtime (vite/rollup/esbuild)
 * — see ADR `docs/adr/0001-no-bundlers-at-runtime.md`.
 */

import path from 'path';
import type { Server, ServerWebSocket } from 'bun';
import { info } from '../utils/logger.ts';
import { openPath } from '../lib/open-path.ts';
import type { ServerState } from './server-context.ts';
import { handleApiRequest } from './api-middleware.ts';

/**
 * WebSocket topic used to broadcast reload events to all connected clients.
 */
const HMR_TOPIC = 'reload';

/**
 * URL path that upgrades to a WebSocket subscribed to the HMR topic.
 */
const HMR_PATH = '/__print-md-hmr';

/**
 * Tiny client snippet injected into served HTML. Listens for `full-reload`
 * messages on the HMR WebSocket and reloads the page.
 *
 * Kept inline (not a separate static file) so the snippet works regardless
 * of whether the HTML lives in the temp dir or any subdirectory.
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

/**
 * Public handle for the running preview server. Owns the underlying
 * `Bun.Server` and exposes a small lifecycle surface.
 */
export interface PreviewServer {
  /** Port the server is listening on. */
  port: number;
  /** Stop the server (force-close active connections and websockets). */
  close(): Promise<void>;
  /**
   * Broadcast a `{ type: "full-reload" }` message to every connected HMR
   * client. Safe to call after `close()` (no-op).
   */
  broadcastReload(): void;
}

/**
 * Check if a TCP port is available for binding.
 *
 * Attempts to bind a temporary `Bun.serve` listener on the requested port.
 * The temporary server is forcibly stopped on success.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  try {
    const server = Bun.serve({
      port,
      fetch() {
        return new Response();
      },
    });
    server.stop(true);
    // Give the kernel a moment to fully release the port.
    await new Promise((resolve) => setTimeout(resolve, 10));
    return true;
  } catch {
    return false;
  }
}

/**
 * Find the next available port starting from `startPort`.
 *
 * Tries up to 10 consecutive ports before giving up. Useful when a preferred
 * port is in use and any nearby alternative is acceptable.
 *
 * @throws {Error} If no available port found after 10 attempts.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  const maxAttempts = 10;

  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortAvailable(port)) {
      return port;
    }
    port++;
  }

  throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

/**
 * Resolve a request URL pathname to an absolute path inside `tempDir`.
 *
 * Defends against `..` traversal: returns `null` if the resolved path escapes
 * the temp dir root. Trailing slash and bare-root requests resolve to the
 * directory itself; the caller decides how to handle directory hits
 * (typically by serving `index.html`).
 */
function resolveStaticPath(urlPathname: string, tempDir: string): string | null {
  // Strip query/hash already handled by URL; just decode the pathname.
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  // Normalize the resolved path and ensure it stays inside tempDir.
  const resolvedTemp = path.resolve(tempDir);
  const candidate = path.resolve(resolvedTemp, '.' + decoded);
  if (candidate !== resolvedTemp && !candidate.startsWith(resolvedTemp + path.sep)) {
    return null;
  }
  return candidate;
}

/**
 * Inject the HMR client snippet just before the closing `</body>` tag.
 * If no `</body>` exists (rare for fragmented HTML), append it.
 */
function injectHmrClient(html: string): string {
  const closingBody = html.lastIndexOf('</body>');
  if (closingBody === -1) {
    return html + HMR_CLIENT_SNIPPET;
  }
  return html.slice(0, closingBody) + HMR_CLIENT_SNIPPET + html.slice(closingBody);
}

/**
 * Serve a static file (or directory's `index.html`) with HMR injection for
 * HTML responses. Returns 404 if the path doesn't resolve to a real file.
 */
async function serveStatic(absPath: string): Promise<Response> {
  let filePath = absPath;
  let file = Bun.file(filePath);
  let exists = await file.exists();

  // Directory hit -> try index.html inside it.
  if (exists) {
    const stat = await file.stat().catch(() => null);
    if (stat && stat.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      file = Bun.file(filePath);
      exists = await file.exists();
    }
  }

  if (!exists) {
    return new Response('Not Found', { status: 404 });
  }

  const isHtml = filePath.endsWith('.html') || filePath.endsWith('.htm');
  if (isHtml) {
    const html = await file.text();
    const withHmr = injectHmrClient(html);
    return new Response(withHmr, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-cache',
      },
    });
  }

  // Let Bun.file infer Content-Type and stream the body. Disable caching so
  // the file watcher's reload always fetches the latest bytes.
  // Empty files: Bun.file() returns 204 (No Content) by default, which makes
  // fetch() reject in some clients (e.g. Paged.js). Force 200 with empty body
  // so empty placeholder CSS files load without error.
  const stat = await file.stat().catch(() => null);
  if (stat && stat.size === 0) {
    return new Response('', {
      status: 200,
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }

  return new Response(file, {
    status: 200,
    headers: { 'Cache-Control': 'no-cache' },
  });
}

/**
 * Create and start a preview HTTP+WebSocket server bound to `state.tempDir`.
 *
 * Behavior:
 *   - `GET ${HMR_PATH}` upgrades to a WebSocket subscribed to `HMR_TOPIC`.
 *   - `/api/*` requests dispatch to `handleApiRequest`.
 *   - Anything else serves a static file from `state.tempDir`. HTML files
 *     have the HMR client snippet injected.
 *   - Requests that escape `tempDir` (via `..`) get 404.
 *   - If `state.options.openBrowser` is true, `xdg-open`/`open` is invoked
 *     once the server is listening.
 *
 * @param state             Preview server state (temp dir, options, config).
 * @param port              TCP port to bind.
 * @param restartPreviewFn  Callback to switch the preview to a new directory.
 * @returns A handle exposing `close()` and `broadcastReload()`.
 */
export async function createPreviewServer(
  state: ServerState,
  port: number,
  restartPreviewFn: (newPath: string) => Promise<void>
): Promise<PreviewServer> {
  const server: Server<undefined> = Bun.serve<undefined>({
    port,
    hostname: state.options.host,
    async fetch(req, srv) {
      const url = new URL(req.url);

      // 1. WebSocket upgrade for HMR.
      if (url.pathname === HMR_PATH) {
        if (srv.upgrade(req)) {
          // Returning undefined tells Bun the response was hijacked.
          return undefined as unknown as Response;
        }
        return new Response('Expected WebSocket upgrade', { status: 426 });
      }

      // 2. API routes — try the middleware first.
      if (url.pathname.startsWith('/api/')) {
        const apiResponse = await handleApiRequest(req, state, restartPreviewFn);
        if (apiResponse) return apiResponse;
        return new Response('Not Found', { status: 404 });
      }

      // 3. Static file fallback.
      // Treat bare "/" as book.html (the rendered paginated book) — there is no
      // longer a viewer chrome index.html in the CLI; the desktop app
      // (packages/viewer) wraps book.html in its own iframe-based toolbar.
      const pathname = url.pathname === '/' ? '/book.html' : url.pathname;
      const absPath = resolveStaticPath(pathname, state.tempDir);
      if (!absPath) {
        return new Response('Not Found', { status: 404 });
      }
      return serveStatic(absPath);
    },
    websocket: {
      open(ws: ServerWebSocket<undefined>) {
        ws.subscribe(HMR_TOPIC);
      },
      message() {
        // Server doesn't expect inbound messages from HMR clients.
      },
      close(ws: ServerWebSocket<undefined>) {
        ws.unsubscribe(HMR_TOPIC);
      },
    },
    error(err) {
      return new Response(`Internal Server Error: ${err.message}`, { status: 500 });
    },
  });

  // Bun assigns a real port when `port: 0` is passed; read it back so callers
  // (and our handle) always see the actually-bound port.
  const boundPort = server.port as number;
  const serverUrl = `http://localhost:${boundPort}`;
  info(`Preview server running at ${serverUrl}`);
  if (state.options.host !== '127.0.0.1' && state.options.host !== 'localhost') {
    info(`Bound on ${state.options.host}:${boundPort} (reachable from the network)`);
  }
  info('Press Ctrl+C to stop');

  if (state.options.openBrowser) {
    // Fire-and-forget; failure to open a browser shouldn't crash the server.
    openPath(serverUrl).catch(() => {
      /* no-op */
    });
  }

  let stopped = false;

  return {
    port: boundPort,
    async close() {
      if (stopped) return;
      stopped = true;
      // `true` forces in-flight connections (including WS) closed so the
      // shutdown timeout in `lifecycle.ts` doesn't have to fire.
      server.stop(true);
    },
    broadcastReload() {
      if (stopped) return;
      const message = JSON.stringify({ type: 'full-reload' });
      // `publish` returns the number of bytes sent, but we don't need it.
      server.publish(HMR_TOPIC, message);
    },
  };
}
