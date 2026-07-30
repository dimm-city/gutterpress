import { test, expect, afterEach } from "bun:test";
import http from "node:http";
import net from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  STATIC_MIME,
  hasDotSegment,
  resolveStaticPath,
  resolveWithinRoot,
  serveFile,
} from "./static-serve.ts";

// ── STATIC_MIME ──────────────────────────────────────────────────────────

test("STATIC_MIME covers the shared extension table", () => {
  const expected = [
    ".html",
    ".htm",
    ".css",
    ".js",
    ".mjs",
    ".json",
    ".png",
    ".jpg",
    ".jpeg",
    ".gif",
    ".svg",
    ".webp",
    ".avif",
    ".ico",
    ".woff",
    ".woff2",
    ".ttf",
    ".otf",
  ];
  for (const ext of expected) {
    expect(STATIC_MIME[ext]).toBeTruthy();
  }
  expect(STATIC_MIME[".html"]).toBe("text/html; charset=utf-8");
  expect(STATIC_MIME[".css"]).toBe("text/css");
  expect(STATIC_MIME[".js"]).toBe("application/javascript");
  expect(STATIC_MIME[".woff2"]).toBe("font/woff2");
  // 2026-07-28 duplication audit: added to close the divergence with
  // asset-inline.ts's MIME_BY_EXT, which already had both (see static-serve.ts's
  // header comment).
  expect(STATIC_MIME[".webp"]).toBe("image/webp");
  expect(STATIC_MIME[".avif"]).toBe("image/avif");
});

// ── resolveStaticPath ────────────────────────────────────────────────────

test("resolveStaticPath resolves a plain relative path inside root", () => {
  const root = "/srv/book";
  expect(resolveStaticPath("/book.html", root)).toBe(join(root, "book.html"));
  expect(resolveStaticPath("/sub/data.json", root)).toBe(
    join(root, "sub", "data.json")
  );
});

test("resolveStaticPath returns null for traversal outside root", () => {
  const root = "/srv/book";
  expect(resolveStaticPath("/../../etc/passwd", root)).toBeNull();
  expect(resolveStaticPath("/../secrets.txt", root)).toBeNull();
});

test("resolveStaticPath returns null for a malformed URI-encoded path", () => {
  const root = "/srv/book";
  // Lone "%" is not valid percent-encoding — decodeURIComponent throws.
  expect(resolveStaticPath("/%E0%A4%A", root)).toBeNull();
});

test("resolveStaticPath allows the root itself", () => {
  const root = "/srv/book";
  expect(resolveStaticPath("/", root)).toBe(root);
});

// ── resolveWithinRoot ────────────────────────────────────────────────────
//
// Shared containment guard for callers that already hold a decoded,
// filesystem-relative string with no pathname to strip — e.g. a raw HTTP
// query-string value. Query params are NOT dot-segment-normalized by the
// WHATWG URL parser the way `url.pathname` is (see the end-to-end block
// below), so a route reading `..` straight out of `url.searchParams` needs
// this guard directly; it cannot rely on resolveStaticPath's URL-pathname
// framing.

test("resolveWithinRoot resolves a plain relative path inside root", () => {
  const root = "/srv/book";
  expect(resolveWithinRoot("chapter1.md", root)).toBe(join(root, "chapter1.md"));
  expect(resolveWithinRoot("sub/data.json", root)).toBe(join(root, "sub", "data.json"));
});

test("resolveWithinRoot returns null for a raw (unnormalized) '..' escape", () => {
  const root = "/srv/book";
  // This is exactly the shape a query param delivers verbatim — unlike a URL
  // pathname, nothing upstream has collapsed the dot-segments yet.
  expect(resolveWithinRoot("../outside/secret.md", root)).toBeNull();
  expect(resolveWithinRoot("../../etc/passwd", root)).toBeNull();
});

test("resolveWithinRoot confines an absolute-looking path under root", () => {
  const root = "/srv/book";
  // No ".." segment, so it's contained under root rather than treated as a
  // real filesystem-root path — same behavior resolveStaticPath gives a URL
  // pathname.
  expect(resolveWithinRoot("/etc/passwd", root)).toBe(join(root, "etc", "passwd"));
});

// ── hasDotSegment ────────────────────────────────────────────────────────
//
// The dotfile guard for any server that resolves request paths against a REAL
// project tree (preview serve-in-place). Containment alone is not enough
// there: `.env`/`.git/config` live INSIDE the root, so only this guard keeps
// them unreachable.

test("hasDotSegment flags a dotfile or dot-directory segment", () => {
  expect(hasDotSegment("/.env")).toBe(true);
  expect(hasDotSegment("/.git/config")).toBe(true);
  expect(hasDotSegment("/sub/.hidden/bar.png")).toBe(true);
  expect(hasDotSegment("/..")).toBe(true);
});

test("hasDotSegment passes ordinary paths, including dots inside a name", () => {
  expect(hasDotSegment("/book.html")).toBe(false);
  expect(hasDotSegment("/styles/book.css")).toBe(false);
  expect(hasDotSegment("/chapter-01.md")).toBe(false);
  expect(hasDotSegment("/")).toBe(false);
});

test("hasDotSegment decodes percent-encoded dot segments", () => {
  // A naive check on the RAW pathname would miss these.
  expect(hasDotSegment("/%2Eenv")).toBe(true);
  expect(hasDotSegment("/%2e%2e/outside")).toBe(true);
  expect(hasDotSegment("/%2Egit/config")).toBe(true);
});

test("hasDotSegment refuses an undecodable path rather than guessing", () => {
  expect(hasDotSegment("/%E0%A4%A")).toBe(true);
});

test("hasDotSegment treats a BACKSLASH as a segment separator (Windows bypass)", () => {
  // The WHATWG URL parser normalizes a RAW backslash in a special-scheme path
  // to "/", so the only way one survives into `url.pathname` is
  // percent-encoded: `new URL("/%5C.env", "http://x").pathname` stays
  // "/%5C.env", which decodes to "/\.env".
  //
  // Splitting on "/" alone yields the single segment "\.env", which does not
  // START with "." — so the guard used to pass it. `path.win32.resolve` DOES
  // treat "\" as a separator, so the request then resolved to
  // `<root>\.env` — inside the root, so containment passed too — and the
  // preview served the project's real `.env` on Windows. Verified:
  //   path.win32.resolve("C:\\repo\\book", "./\\.env") === "C:\\repo\\book\\.env"
  //   path.win32.resolve("C:\\repo\\book", ".//sub\\.git\\config")
  //     === "C:\\repo\\book\\sub\\.git\\config"
  //
  // The guard is platform-INDEPENDENT on purpose: it must reject these
  // spellings when the tests run on POSIX too, since that is the only place
  // the Windows outcome can be pinned.
  expect(hasDotSegment("/%5C.env")).toBe(true);
  expect(hasDotSegment("/%5c.env")).toBe(true);
  expect(hasDotSegment("/sub%5C.git%5Cconfig")).toBe(true);
  expect(hasDotSegment("/%5C.git/config")).toBe(true);
  // Mixed separators, and a dot segment reached only via a backslash hop.
  expect(hasDotSegment("/sub/%5C.env")).toBe(true);
  expect(hasDotSegment("/sub%5C..%5Csecret")).toBe(true);
});

test("hasDotSegment still passes a backslash that is not a dot segment", () => {
  // A backslash alone is not a secret-leak signal — only a dot segment is.
  // (Such a path is unreachable from a browser anyway: the URL parser rewrites
  // raw backslashes, so only a hand-encoded %5C gets here.)
  expect(hasDotSegment("/sub%5Cchapter.md")).toBe(false);
});

// ── serveFile (real HTTP round-trip) ────────────────────────────────────

let tempDir: string;
let server: http.Server | null = null;

afterEach(async () => {
  if (server) {
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    server = null;
  }
  if (tempDir) await rm(tempDir, { recursive: true, force: true });
});

async function startServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse) => void
): Promise<number> {
  server = http.createServer(handler);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  return (server!.address() as net.AddressInfo).port;
}

test("serveFile writes the file with the correct content-type", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gutterpress-static-serve-"));
  const filePath = join(tempDir, "styles.css");
  await writeFile(filePath, "body{color:red}");

  const port = await startServer((_req, res) => {
    serveFile(filePath, res);
  });

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("text/css");
  expect(await res.text()).toBe("body{color:red}");
});

test("serveFile falls back to application/octet-stream for an unknown extension", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gutterpress-static-serve-"));
  const filePath = join(tempDir, "data.bin");
  await writeFile(filePath, "raw-bytes");

  const port = await startServer((_req, res) => {
    serveFile(filePath, res);
  });

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toBe("application/octet-stream");
});

test("serveFile returns 404 for a missing file", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gutterpress-static-serve-"));
  const missing = join(tempDir, "nope.txt");

  const port = await startServer((_req, res) => {
    serveFile(missing, res);
  });

  const res = await fetch(`http://127.0.0.1:${port}/`);
  expect(res.status).toBe(404);
});

// ── End-to-end: resolveStaticPath + serveFile wired together, mirroring how
// both build-runner.ts and preview/http-server.ts use the pair. ─────────────
//
// Both call sites feed resolveStaticPath a pathname already run through
// `new URL(req.url, base).pathname` — and the WHATWG URL parser collapses
// literal AND percent-encoded ".." dot-segments as part of normal path
// parsing (spec-mandated, not fetch()-specific), so a request already
// arrives with any ".." resolved away by the time either server sees it.
// That makes the HTTP layer the wrong place to prove the traversal guard —
// it is unreachable there by construction. The guard's own defensive logic
// (decodeURIComponent + root-prefix check) is what's under test, and it is
// exercised directly against `resolveStaticPath` above with a raw,
// un-normalized "../.." string. This block only proves the HTTP wiring
// (resolveStaticPath -> serveFile inside a real request handler) serves a
// legitimate file correctly.

test("resolveStaticPath + serveFile compose to serve a real request end-to-end", async () => {
  tempDir = await mkdtemp(join(tmpdir(), "gutterpress-static-serve-"));
  await writeFile(join(tempDir, "book.html"), "<h1>hi</h1>");

  const port = await startServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    const filePath = resolveStaticPath(url.pathname, tempDir);
    if (!filePath) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    await serveFile(filePath, res);
  });

  const okRes = await fetch(`http://127.0.0.1:${port}/book.html`);
  expect(okRes.status).toBe(200);
  expect(okRes.headers.get("content-type")).toBe("text/html; charset=utf-8");
  expect(await okRes.text()).toBe("<h1>hi</h1>");

  const missingRes = await fetch(`http://127.0.0.1:${port}/nope.html`);
  expect(missingRes.status).toBe(404);
});
