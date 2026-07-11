import path from "node:path";
import http from "node:http";
import { readFile } from "node:fs/promises";

/**
 * Extension -> Content-Type map shared by every localhost static file server
 * in this package: the build-time pagination server and PDF-render server
 * (build-runner.ts) and the live preview server (preview/http-server.ts).
 *
 * Previously two independent 17-entry tables that had to be edited in lockstep
 * (finding #17) — a new asset type added to only one would render differently
 * in preview vs build-time pagination with no error, a silent divergence
 * class. One table now; add a new extension once.
 */
export const STATIC_MIME: Record<string, string> = {
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
 * Resolve a request URL pathname to an absolute path inside `root`, guarding
 * against path traversal (`..`, encoded separators, absolute-looking paths).
 * Returns `null` if the pathname cannot be decoded or the resolved path
 * escapes `root` — callers turn that into a 403/404 as fits their route.
 */
export function resolveStaticPath(urlPathname: string, root: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, "." + decoded);
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return candidate;
}

/**
 * Minimal static file responder: read `filePath` and write it to `res` with
 * the `STATIC_MIME` content-type (falling back to `application/octet-stream`);
 * 404 on any read failure (missing file, directory, permission error).
 *
 * Deliberately minimal — no directory-index fallback, no HTML
 * post-processing, no cache-control shaping. Callers that need those (the
 * preview server's HMR-snippet injection + directory `index.html` fallback)
 * build on top of `resolveStaticPath` + `STATIC_MIME` directly instead of
 * this helper.
 */
export async function serveFile(
  filePath: string,
  res: http.ServerResponse
): Promise<void> {
  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    res.writeHead(404);
    res.end("Not found");
    return;
  }
  const ct =
    STATIC_MIME[path.extname(filePath).toLowerCase()] ??
    "application/octet-stream";
  res.writeHead(200, { "Content-Type": ct });
  res.end(data);
}
