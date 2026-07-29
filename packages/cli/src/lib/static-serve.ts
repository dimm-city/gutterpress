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
 *
 * That same divergence class recurred once more (2026-07-28 duplication
 * audit): this table and `asset-inline.ts`'s `MIME_BY_EXT` — a separate table
 * answering a separate question, "what Content-Type does a data: URI need
 * when embedding this file inline," vs. this table's "what Content-Type does
 * an HTTP response need" — had drifted again, missing `.webp`/`.avif` here.
 * A large (>512KB, over the inliner's threshold) WebP/AVIF image was copied
 * as a real file and then served as `application/octet-stream` by both
 * servers above. Added below; if a third image format shows up, add it to
 * BOTH tables in the same commit (asset-inline.ts is out of scope for this
 * PR — see docs/reviews/duplication-audit-2026-07-28.md).
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
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
};

/**
 * Confine an already-decoded relative path to `root`, guarding against path
 * traversal (`..` segments, absolute-looking paths escaping via `..`).
 * Returns `null` if the resolved path escapes `root`.
 *
 * Shared by {@link resolveStaticPath} (which decodes a URL pathname first)
 * AND by callers that already hold a decoded string with no pathname
 * semantics to strip. Query-string values are NOT dot-segment-normalized by
 * the WHATWG URL parser the way `url.pathname` is, so any route reading a raw
 * query value as a filesystem-relative path must run it through this guard.
 */
export function resolveWithinRoot(relPath: string, root: string): string | null {
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(
    resolvedRoot,
    "." + (relPath.startsWith("/") ? relPath : "/" + relPath)
  );
  if (candidate !== resolvedRoot && !candidate.startsWith(resolvedRoot + path.sep)) {
    return null;
  }
  return candidate;
}

/**
 * True if any path segment of `urlPathname` is a dotfile/dot-directory (e.g.
 * `/.env`, `/.git/config`, `/foo/.hidden/bar`).
 *
 * This is the guard any server needs when it resolves request paths against a
 * REAL project tree rather than a staged copy of generated output (the preview
 * server's serve-in-place model). Containment alone is not sufficient there:
 * `.env` and `.git/config` live INSIDE the served root, so
 * {@link resolveWithinRoot} happily returns them — this is the one thing
 * standing between a request and the project's actual secrets.
 *
 * It runs on the DECODED path so a percent-encoded segment (`%2e%2e`) can't
 * spell a dot past a naive string check, and an encoding that fails to decode
 * is refused rather than guessed at.
 *
 * BOTH `/` and `\` count as separators, on every platform. A raw backslash
 * never survives the WHATWG URL parser (it normalizes to `/` for special
 * schemes), but a percent-encoded one does: `/%5C.env` decodes to `/\.env`,
 * whose only `/`-delimited segment is `\.env` — which does not START with a
 * dot. `path.win32.resolve` DOES treat `\` as a separator, so on Windows that
 * request resolved to `<root>\.env`, inside the root, and the preview served
 * the project's real `.env`. Splitting on both separators closes that hole,
 * and doing it platform-independently is what lets a POSIX test run pin the
 * Windows behavior.
 */
export function hasDotSegment(urlPathname: string): boolean {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return true;
  }
  return decoded.split(/[/\\]/).some((segment) => segment.startsWith("."));
}

/**
 * Resolve a request URL pathname to an absolute path inside `root`, guarding
 * against path traversal (`..`, encoded separators, absolute-looking paths).
 * Returns `null` if the pathname cannot be decoded or the resolved path
 * escapes `root` — callers turn that into a 403/404 as fits their route.
 *
 * Containment only — a caller serving a real project tree must ALSO run
 * {@link hasDotSegment}, since dotfiles are contained but must stay unreachable.
 */
export function resolveStaticPath(urlPathname: string, root: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  return resolveWithinRoot(decoded, root);
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
