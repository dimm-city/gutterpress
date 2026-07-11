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
import { createServer } from "node:http";
import { pathToFileURL, fileURLToPath } from "node:url";

// Module directory, ESM-safe — see the note on `HERE` in main.ts. Do NOT use the
// bare `__dirname` electron-vite shim; it is not reliably in scope once the main
// bundle is split across sibling modules. This module is bundled into main.js, so
// import.meta.url resolves to out/main/ at runtime.
const HERE = path.dirname(fileURLToPath(import.meta.url));
let skServerPort: number | null = null;

function getSvelteKitHandlerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build", "handler.js")
    : path.join(HERE, "..", "..", "build", "handler.js");
}

export async function startSvelteKitServer(
  slog: (msg: string) => void,
): Promise<number> {
  if (skServerPort) return skServerPort;
  const handlerPath = getSvelteKitHandlerPath();
  slog(`loading SvelteKit handler from ${handlerPath}`);
  const { handler } = (await import(pathToFileURL(handlerPath).href)) as {
    handler: Parameters<typeof createServer>[0];
  };
  const server = createServer(handler);
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
  <p>Try again in a moment, or quit and reopen print-md if this doesn't clear up.</p>
  ${opts.detail ? `<p><code>${esc(opts.detail)}</code></p>` : ""}
  <button onclick="location.reload()">Retry</button>
</main>
</body>
</html>`;
}

const HTML_HEADERS = { "Content-Type": "text/html; charset=utf-8" };

export function registerAppProtocol(): void {
  protocol.handle("app", async (req) => {
    if (skServerPort === null) {
      return new Response(
        buildHostErrorPage({
          title: "print-md is still starting",
          message: "The app's internal server hasn't started yet.",
        }),
        { status: 503, headers: HTML_HEADERS }
      );
    }
    const url = new URL(req.url);
    const targetUrl =
      "http://127.0.0.1:" + skServerPort + url.pathname + url.search;
    try {
      const proxyReq = new Request(targetUrl, {
        method: req.method,
        headers: req.headers,
        body:
          req.method !== "GET" && req.method !== "HEAD" ? req.body : undefined,
        // @ts-expect-error — duplex is required for streaming POST bodies in Node 18+
        duplex: "half",
      });
      return await fetch(proxyReq);
    } catch (e) {
      console.error(`[app://] proxy error for ${url.pathname}:`, e);
      return new Response(
        buildHostErrorPage({
          title: "print-md ran into a problem",
          message: "A request to the app's internal server failed.",
          detail: String(e),
        }),
        { status: 502, headers: HTML_HEADERS }
      );
    }
  });
}
