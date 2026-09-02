/**
 * `app://` protocol — serves the static SvelteKit SPA directly from disk.
 *
 * SFE-P5d replaced adapter-node (a Node HTTP server started on a loopback
 * port, proxied to from this protocol handler via `fetch`) with
 * adapter-static (svelte.config.js): the desktop app has zero server routes
 * — every request/reply operation moved to typed IPC in SFE-P5c — so
 * `vite build` now emits a plain static file tree (`build/index.html`,
 * `build/_app/**`, …) with no server bundle at all. This handler reads that
 * tree straight from disk, with no intermediate server, no bearer token, and
 * no proxy request to build.
 *
 * Security note (Checkpoint C equivalence statement): the deleted bearer
 * token existed to authenticate callers of the loopback HTTP server — a
 * local process that discovered the OS-assigned port could otherwise reach
 * the same privileged routes the renderer used. There is no longer a server
 * to protect: this handler only ever reads static files out of the packaged
 * build directory and returns their bytes. The surviving boundary is
 * path-scoping — {@link resolveAssetPath} refuses to resolve outside
 * `buildDir` — proven by the traversal-refusal tests in
 * tests/platform/app-protocol.test.ts.
 */
import { protocol } from "electron";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isWithinAnyRootCanonical } from "./server-bridge/fs-guard";

/** Only this app:// host is ever served — matches navigation-policy.ts's `APP_ORIGIN` ("app://local"), keeping one consistent origin for the whole security model (CSP, IPC sender checks, will-navigate). */
export const APP_HOST = "local";

/**
 * URL prefix under which the OPEN PROJECT's own files are readable.
 *
 * The editor lays a chapter out with the book's own CSS, and that chapter
 * refers to its art the way the book does — `images/chapter-00/art.png`,
 * relative to the project. Rendered inside the app's own origin those
 * resolve to `app://local/images/…` and 404, so every image in the editor
 * collapsed to a broken-image box: a 502px plate became 24px, and the
 * editor paginated a book it was not actually showing.
 *
 * Authorization is NOT a new source of truth here — the handler resolves
 * against the same host-owned `projectRoots()` the fs IPC guard uses, and
 * re-checks containment canonically (project content is user-writable, so
 * a symlink out of the book is a real threat model here in a way it is not
 * for the packaged build directory).
 */
export const PROJECT_ASSET_PREFIX = "/__project/";

/**
 * Where the static SvelteKit build lives, packaged vs dev. Pure and
 * unit-testable — mirrors the pattern used by `resolveDevServerUrl` in
 * navigation-policy.ts (a plain boolean + string in, no Electron import
 * needed to test it).
 */
export function resolveBuildDir(isPackaged: boolean, hereDir: string): string {
  return isPackaged
    ? path.join(process.resourcesPath, "app.asar", "build")
    : path.join(hereDir, "..", "..", "build");
}

/**
 * True if `segment` is a raw ".." component or contains a colon (a
 * drive-letter marker on Windows — `path.resolve`/`path.win32.resolve`
 * treats an argument like `"C:/evil"` as absolute and would otherwise let it
 * replace `buildDir` entirely instead of being joined under it). This is a
 * fast PRE-FILTER over `/`-delimited segments, not a complete defense: it
 * does not split on `\`, so a decoded pathname carrying a literal backslash
 * (directly, or via `%5c`) — which `path.win32.resolve` treats as a
 * separator on Windows — passes straight through this check as one opaque
 * segment. {@link resolveAssetPath}'s final lexical containment check is
 * the layer that actually catches that shape; see that function's header
 * and the `WIN32 CONTAINMENT` tests in tests/platform/app-protocol.test.ts.
 */
function hasUnsafeSegment(decodedPathname: string): boolean {
  return decodedPathname
    .split("/")
    .some((segment) => segment === ".." || segment.includes(":"));
}

/**
 * Resolve an incoming `app://local/<pathname>` request to an absolute path
 * inside `buildDir`, or `null` if the request is malformed or attempts to
 * escape `buildDir` (path traversal). Pure — no filesystem access, so it is
 * directly unit-testable with plain strings (see
 * tests/platform/app-protocol.test.ts's traversal-refusal tests).
 *
 * `pathApi` defaults to the host's own `path` module (posix on Linux/macOS,
 * win32 on Windows — the module Electron's real `readFile` calls this
 * function's result against) but is injectable so a Linux/CI test process
 * can still exercise the win32 resolution semantics a Windows *build* of
 * this app runs under (`path.win32.resolve`'s backslash/drive-letter
 * handling cannot be reproduced by calling the platform `path` module on a
 * non-Windows CI runner).
 *
 * A segment-level pre-filter plus a final containment check, matching the
 * belt-and-suspenders pattern already used by the fs IPC guard
 * (server-bridge/fs-guard.ts) — but they are complementary, not
 * independent, and the second is the one that actually matters:
 *   1. {@link hasUnsafeSegment} rejects `..` and drive-letter segments,
 *      split on `/` only, before any path is built — fast, but it misses
 *      an entire class (any traversal expressed with `\` instead of `/`;
 *      Windows-only, since only `path.win32.resolve` treats `\` as a
 *      separator).
 *   2. The final resolved path must equal `buildDir` or start with
 *      `buildDir + pathApi.sep` — a lexical containment check. This is the
 *      AUTHORITATIVE boundary, not a redundant second opinion: it is what
 *      actually decides whether the request escaped `buildDir`, and it is
 *      the only layer that catches the backslash class layer 1 misses (see
 *      the `WIN32 CONTAINMENT` tests). (The build directory ships read-only
 *      inside the packaged app/asar, not user-writable content, so — unlike
 *      the project-root guard — a symlink-escape threat model does not
 *      apply here; the lexical check is sufficient.)
 */
export function resolveAssetPath(
  buildDir: string,
  pathname: string,
  pathApi: path.PlatformPath = path,
): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  // Reject an embedded NUL up front — Node's fs calls throw on it anyway,
  // but rejecting here keeps this function's contract "safe path or null"
  // without leaking a raw filesystem error to the caller.
  if (decoded.includes("\0")) return null;
  if (hasUnsafeSegment(decoded)) return null;

  const relative = decoded.replace(/^\/+/, "");
  const resolvedBuildDir = pathApi.resolve(buildDir);
  const resolved = pathApi.resolve(resolvedBuildDir, relative);
  if (resolved !== resolvedBuildDir && !resolved.startsWith(resolvedBuildDir + pathApi.sep)) {
    return null;
  }
  return resolved;
}

/**
 * True if the request's last path segment looks like a real asset filename
 * (has a "." — `main.js`, `app.css`, `favicon.ico`, …) rather than a
 * client-side route (`/settings`, `/`). Missing files that look like assets
 * 404 for real; missing paths that look like routes fall back to
 * `index.html` so the SvelteKit client router can handle them (the SPA
 * fallback deep links need).
 */
export function looksLikeAssetRequest(pathname: string): boolean {
  const lastSegment = pathname.split("/").pop() ?? "";
  return lastSegment.includes(".");
}

const MIME_TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".txt": "text/plain; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".wasm": "application/wasm",
  ".webmanifest": "application/manifest+json",
};

/** Content-Type for `filePath` by extension; unknown extensions get a safe binary default. */
export function mimeTypeFor(filePath: string): string {
  return MIME_TYPES[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
}

/**
 * Register the `app://` protocol handler that serves `buildDir` (the
 * adapter-static output) directly from disk. Call once, from `whenReady`
 * (matching the original `registerAppProtocol`'s call site in main.ts) —
 * the privileged-scheme registration (`protocol.registerSchemesAsPrivileged`)
 * stays in main.ts, at its original point before `app.whenReady`.
 */
export function registerAppProtocol(
  buildDir: string,
  projectRoots: () => readonly string[] = () => [],
): void {
  /**
   * Serve one file from the open project (see {@link PROJECT_ASSET_PREFIX}).
   * Resolved against the active book root, then canonically contained
   * against every host-owned root before a single byte is read.
   */
  async function projectAsset(pathname: string): Promise<Response> {
    const roots = projectRoots();
    const bookRoot = roots[0];
    if (!bookRoot) return new Response("Not Found", { status: 404 });
    const relative = pathname.slice(PROJECT_ASSET_PREFIX.length);
    const resolved = resolveAssetPath(bookRoot, relative);
    if (resolved === null) return new Response("Not Found", { status: 404 });
    if (!(await isWithinAnyRootCanonical(resolved, roots))) {
      return new Response("Not Found", { status: 404 });
    }
    try {
      const data = await readFile(resolved);
      return new Response(data, { headers: { "Content-Type": mimeTypeFor(resolved) } });
    } catch {
      return new Response("Not Found", { status: 404 });
    }
  }

  protocol.handle("app", async (req) => {
    const url = new URL(req.url);
    // Keep one consistent origin ("app://local") for the whole security
    // model — the `app` scheme is registered as "standard", so any host
    // under it (app://evil/... just as much as app://local/...) is
    // otherwise a well-formed request this handler would receive.
    if (url.hostname !== APP_HOST) {
      return new Response("Not Found", { status: 404 });
    }
    if (url.pathname.startsWith(PROJECT_ASSET_PREFIX)) {
      return projectAsset(decodeURIComponent(url.pathname));
    }
    const resolved = resolveAssetPath(buildDir, url.pathname);
    if (resolved === null) {
      return new Response("Not Found", { status: 404 });
    }
    try {
      const data = await readFile(resolved);
      return new Response(data, {
        headers: { "Content-Type": mimeTypeFor(resolved) },
      });
    } catch (e) {
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT" || code === "EISDIR") {
        if (looksLikeAssetRequest(url.pathname)) {
          return new Response("Not Found", { status: 404 });
        }
        // SPA fallback for a client-side route with no matching file on disk.
        try {
          const fallback = await readFile(path.join(path.resolve(buildDir), "index.html"));
          return new Response(fallback, {
            headers: { "Content-Type": "text/html; charset=utf-8" },
          });
        } catch (fallbackErr) {
          console.error("[app://] SPA fallback index.html unreadable:", fallbackErr);
          return new Response("Not Found", { status: 404 });
        }
      }
      console.error(`[app://] failed to read ${resolved}:`, e);
      return new Response("Internal Server Error", { status: 500 });
    }
  });
}

/**
 * Startup sanity check (replaces the old "SvelteKit server failed to start"
 * dialog): a missing `index.html` in the resolved build directory means a
 * corrupt install or a dev tree that was never built — surface it as a
 * plain-language native dialog immediately instead of a blank/erroring
 * window with no explanation.
 */
export function staticBuildLooksValid(buildDir: string): boolean {
  return existsSync(path.join(buildDir, "index.html"));
}
