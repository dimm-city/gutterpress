// ──────────────────────────────────────────────────────────────────────────
// sveltekit-host.ts — serves the SvelteKit app (the SPA and its +server.ts
// host routes) to the window over the app:// protocol, IN-PROCESS.
//
// adapter-electron.js (svelte.config.js) writes the SvelteKit server
// unbundled to build/server/ — index.js exports `Server`, manifest.js its
// manifest — and the browser assets to build/client/. loadSvelteKitServer()
// constructs that Server once; registerAppProtocol() answers each
// app://local/* request by serving the file under build/client/ when one
// exists at that path, and otherwise handing the Request to Server.respond(),
// the same call adapter-node's handler made behind an HTTP server.
//
// No HTTP server: nothing listens on a port, so there is no port for another
// local process to discover, no bearer token to guard it, and no proxy hop
// (whose fetch gave up on any route slower than five minutes — a long clone).
// The scheme stays `app://local` (registered privileged in main.ts): a stable
// origin for the SPA's origin-bound storage, and a secure context.
// ──────────────────────────────────────────────────────────────────────────

import { app, net, protocol } from "electron";
import { stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logAppError } from "./app-log";

// import.meta.url resolves to out/main/ at runtime.
const HERE = path.dirname(fileURLToPath(import.meta.url));

/** The slice of SvelteKit's generated `Server` this host calls. */
export interface SvelteKitServer {
  respond(request: Request, options: { getClientAddress: () => string }): Promise<Response>;
}

interface SvelteKitHost {
  server: SvelteKitServer;
  /** build/client — the browser assets, served straight from disk. */
  clientDir: string;
}

let host: SvelteKitHost | null = null;

/**
 * Test-only: lets unit tests exercise registerAppProtocol's "server is up,
 * host is local" path against a fake Server and a temp client dir, without
 * a real SvelteKit build on disk. Never called from production code — main.ts
 * only ever sets the host by loading the real build.
 */
export function __setHostForTests(h: SvelteKitHost | null): void {
  host = h;
}

function getBuildDir(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build")
    : path.join(HERE, "..", "..", "build");
}

/** Construct the SvelteKit Server from build/server/ (once). */
export async function loadSvelteKitServer(slog: (msg: string) => void): Promise<void> {
  if (host) return;
  const dir = getBuildDir();
  slog(`loading SvelteKit server from ${path.join(dir, "server")}`);
  const { Server } = (await import(pathToFileURL(path.join(dir, "server", "index.js")).href)) as {
    Server: new (manifest: unknown) => SvelteKitServer & { init(opts: { env: Record<string, string | undefined> }): Promise<void> };
  };
  const { manifest } = (await import(pathToFileURL(path.join(dir, "server", "manifest.js")).href)) as {
    manifest: unknown;
  };
  const server = new Server(manifest);
  await server.init({ env: process.env });
  host = { server, clientDir: path.join(dir, "client") };
  slog("SvelteKit server ready (in-process)");
}

/**
 * The file under `clientDir` that an app:// pathname names, or null when
 * there is none. Pure path work plus one stat, exported for its test: a
 * pathname can never reach outside build/client (`..`, encoded or not), and
 * a directory is not a file.
 */
export async function resolveClientFile(clientDir: string, pathname: string): Promise<string | null> {
  let rel: string;
  try {
    rel = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  const root = path.resolve(clientDir);
  const file = path.resolve(root, "." + rel);
  if (file !== root && !file.startsWith(root + path.sep)) return null;
  try {
    return (await stat(file)).isFile() ? file : null;
  } catch {
    return null;
  }
}

/**
 * A small, self-contained HTML error page shown in the `app://` window when
 * the SvelteKit server can't answer — it hasn't loaded yet (503, below) or
 * Server.respond() itself threw (500, below). No external assets/fonts/
 * scripts — this must render standalone, since it exists precisely because
 * the app's own server is not up. Extracted as a pure function (no
 * `protocol`/`Response` dependency) so it's unit-testable without a running
 * Electron process.
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

/** `String(e)` plus the cause Node attaches to many failures (the part that says why). */
function describeError(e: unknown): string {
  const cause = (e as { cause?: unknown } | null)?.cause;
  return cause ? `${String(e)} — ${String(cause)}` : String(e);
}

export function registerAppProtocol(): void {
  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    // The app:// scheme is registered as "standard", so ANY host under it —
    // app://evil/... as much as app://local/... — is a well-formed request
    // this handler receives. Only the app's own "local" host is served.
    if (url.hostname !== "local") {
      console.warn(`[app://] rejected request for untrusted host "${url.hostname}"`);
      return new Response("Not Found", { status: 404 });
    }
    if (!host) {
      return new Response(
        buildHostErrorPage({
          title: "Gutterpress is still starting",
          message: "The app's interface hasn't loaded yet.",
        }),
        { status: 503, headers: HTML_HEADERS }
      );
    }
    const file = await resolveClientFile(host.clientDir, url.pathname);
    if (file) return net.fetch(pathToFileURL(file).href);
    try {
      return await host.server.respond(req, { getClientAddress: () => "127.0.0.1" });
    } catch (e) {
      const detail = describeError(e);
      // Console AND the app log, so the Logs tab (and a problem report) says why.
      void logAppError(`[app://] ${url.pathname} failed: ${detail}`);
      return new Response(
        buildHostErrorPage({
          title: "Gutterpress ran into a problem",
          message: "The app couldn't answer a request from its own interface.",
          detail,
        }),
        { status: 500, headers: HTML_HEADERS }
      );
    }
  });
}
