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
import { pathToFileURL } from "node:url";

// __dirname/__filename are injected by electron-vite for the ESM main bundle
// (resolves to out/main/ at runtime); this module is bundled into main.js.
let skServerPort: number | null = null;

function getSvelteKitHandlerPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build", "handler.js")
    : path.join(__dirname, "..", "..", "build", "handler.js");
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

export function registerAppProtocol(): void {
  protocol.handle("app", async (req) => {
    if (skServerPort === null) {
      return new Response("SvelteKit server not started", { status: 503 });
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
      return new Response("Proxy error: " + String(e), { status: 502 });
    }
  });
}
