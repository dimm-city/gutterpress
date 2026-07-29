/**
 * SvelteKit adapter-node host — extracted from electron/main.ts (composition
 * root).
 *
 * adapter-node emits a Node.js HTTP handler to build/handler.js. We start a
 * local HTTP server bound to 127.0.0.1 on an OS-assigned port, then forward
 * all app:// requests to it via fetch. This lets +server.ts routes run in the
 * Electron main process where they can import { dialog, shell } from 'electron'
 * directly, while the renderer stays PWA-clean (fetch('/api/...') only).
 *
 * Owns the resolved server port. main.ts starts the server (passing its startup
 * logger) and registers the app:// protocol; the privileged-scheme registration
 * itself stays in main.ts so it runs at its original point before app.whenReady.
 */
import { app, protocol } from "electron";
import path from "node:path";
import { createServer, type IncomingHttpHeaders, type RequestListener } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";

// Module directory, ESM-safe — see the note on `HERE` in main.ts. Do NOT use the
// bare `__dirname` electron-vite shim; it is not reliably in scope once the main
// bundle is split across sibling modules. This module is bundled into main.js, so
// import.meta.url resolves to out/main/ at runtime.
const HERE = path.dirname(fileURLToPath(import.meta.url));
let skServerPort: number | null = null;

/**
 * Test-only: lets unit tests exercise registerAppProtocol's "server is up,
 * host is local" proxy path directly, without spinning up a real adapter-node
 * build via startSvelteKitServer (which loads handler.js from disk). Never
 * called from production code — main.ts only ever sets skServerPort by
 * actually starting the server. Mirrors the `__resetPlatform`-style test seam
 * in src/lib/platform/index.ts.
 */
export function __setSkServerPortForTests(port: number | null): void {
  skServerPort = port;
}

// ── Caller authentication (P1 review, PR #98, finding #2) ──────────────────
// The adapter-node HTTP server is bound to 127.0.0.1 with an OS-assigned
// port, but a loopback bind alone is NOT caller authentication — any other
// local process (another user-level app, a script) can discover the port
// (e.g. by scanning 127.0.0.1) and call the same privileged
// `src/routes/api/**/+server.ts` routes (fs, git, GitHub token, …) the
// renderer uses. main.ts mints a per-session random bearer token
// (node:crypto, never persisted) once at process start and passes it to both
// startSvelteKitServer() and registerAppProtocol() below: the app:// proxy
// injects it into every request it forwards, and the loopback server itself
// rejects any request that doesn't carry it — so a stray process that finds
// the port but not the token gets a 401.
const AUTH_HEADER = "x-gutterpress-token";

/** Pure — does `headers` carry the expected bearer token? Unit-testable with a plain header object, no live server required. */
export function isAuthorizedRequest(
  headers: IncomingHttpHeaders,
  token: string,
): boolean {
  const provided = headers[AUTH_HEADER];
  return typeof provided === "string" && token.length > 0 && provided === token;
}

/**
 * Wrap a raw Node HTTP handler (SvelteKit adapter-node's `handler`, or any
 * fake handler in tests) so a request without the correct bearer token is
 * rejected with 401 before it ever reaches the real handler. Exported
 * separately from startSvelteKitServer (which loads the real handler from an
 * on-disk build) so the auth behavior is testable against a plain
 * node:http server with no Electron process or build output involved.
 */
export function withTokenAuth(
  handler: RequestListener,
  token: string,
): RequestListener {
  return (req, res) => {
    if (!isAuthorizedRequest(req.headers, token)) {
      res.statusCode = 401;
      res.setHeader("Content-Type", "text/plain; charset=utf-8");
      res.end("Unauthorized");
      return;
    }
    handler(req, res);
  };
}

function getSvelteKitHandlerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build", "handler.js")
    : path.join(HERE, "..", "..", "build", "handler.js");
}

export async function startSvelteKitServer(
  slog: (msg: string) => void,
  authToken: string,
): Promise<number> {
  if (skServerPort) return skServerPort;
  const handlerPath = getSvelteKitHandlerPath();
  slog(`loading SvelteKit handler from ${handlerPath}`);
  const { handler } = (await import(pathToFileURL(handlerPath).href)) as {
    handler: RequestListener;
  };
  const server = createServer(withTokenAuth(handler, authToken));
  return new Promise<number>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Failed to get SvelteKit server address"));
        return;
      }
      skServerPort = addr.port;
      slog(`SvelteKit server listening on 127.0.0.1:${skServerPort}`);
      resolve(skServerPort);
    });
    server.on("error", reject);
  });
}

/**
 * A small, self-contained HTML error page shown in the `app://` window when
 * the SvelteKit host server isn't reachable — either it hasn't started yet
 * (503, {@link registerAppProtocol}'s early-return below) or a request to it
 * failed after startup (502, the proxy `catch` below). Previously both cases
 * returned a raw text body ("SvelteKit server not started" / "Proxy error:
 * …") with no explanation and no way to recover short of force-quitting the
 * app (ARCH review #28). No external assets/fonts/scripts — this must render
 * standalone, since it exists precisely because the app's own server may not
 * be up. Extracted as a pure function (no `protocol`/`Response` dependency)
 * so it's unit-testable without a running Electron process.
 */
export function buildHostErrorPage(opts: {
  title: string;
  message: string;
  detail?: string;
}): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(opts.title)}</title>
<style>
  html, body { height: 100%; margin: 0; }
  body {
    display: flex; align-items: center; justify-content: center;
    background: #1e1e1e; color: #e6e6e6;
    font: 14px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
  }
  main { max-width: 32rem; padding: 2rem; text-align: center; }
  h1 { font-size: 1.15rem; margin: 0 0 0.75rem; }
  p { margin: 0 0 0.75rem; color: #b7b7b7; }
  code { color: #8a8a8a; font-size: 0.8rem; word-break: break-word; }
  button {
    margin-top: 0.5rem; padding: 0.5rem 1.25rem; border-radius: 6px;
    border: 1px solid #4a4a4a; background: #2d2d2d; color: #e6e6e6;
    font-size: 0.9rem; cursor: pointer;
  }
  button:hover { background: #383838; }
</style>
</head>
<body>
<main>
  <h1>${esc(opts.title)}</h1>
  <p>${esc(opts.message)}</p>
  <p>Try again in a moment, or quit and reopen Gutterpress if this doesn't clear up.</p>
  ${opts.detail ? `<p><code>${esc(opts.detail)}</code></p>` : ""}
  <button onclick="location.reload()">Retry</button>
</main>
</body>
</html>`;
}

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" };

/**
 * Build the outgoing loopback request for an incoming `app://local/...`
 * request: rewrites the target to `http://127.0.0.1:<port>` and injects the
 * session bearer token as a header. Exported separately from
 * registerAppProtocol so the header-injection behavior is unit-testable
 * without an Electron process or a live server on either end.
 */
export function buildProxyRequest(
  req: Request,
  port: number,
  authToken: string,
): Request {
  const url = new URL(req.url);
  const targetUrl = "http://127.0.0.1:" + port + url.pathname + url.search;
  const headers = new Headers(req.headers);
  headers.set(AUTH_HEADER, authToken);
  return new Request(targetUrl, {
    method: req.method,
    headers,
    body: req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
    // @ts-expect-error — duplex is required for streaming POST bodies in Node 18+
    duplex: "half",
  });
}

export function registerAppProtocol(authToken: string): void {
  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    // P1 review (PR #98, finding #2): the app:// scheme is registered as
    // "standard", which means ANY host under it — app://evil/... just as
    // much as app://local/... — is a well-formed request this handler
    // receives. The pre-fix handler ignored `url.host` entirely and proxied
    // every app:// request to the privileged loopback server regardless of
    // host. Only the app's own "local" host may reach the proxy; anything
    // else is rejected outright (never forwarded).
    if (url.hostname !== "local") {
      console.warn(`[app://] rejected request for untrusted host "${url.hostname}"`);
      return new Response("Not Found", { status: 404 });
    }
    if (skServerPort === null) {
      return new Response(
        buildHostErrorPage({
          title: "Gutterpress is still starting",
          message: "The app's internal server hasn't started yet.",
        }),
        { status: 503, headers: HTML_HEADERS }
      );
    }
    try {
      return await fetch(buildProxyRequest(req, skServerPort, authToken));
    } catch (e) {
      console.error(`[app://] proxy error for ${url.pathname}:`, e);
      return new Response(
        buildHostErrorPage({
          title: "Gutterpress ran into a problem",
          message: "A request to the app's internal server failed.",
          detail: String(e),
        }),
        { status: 502, headers: HTML_HEADERS }
      );
    }
  });
}
