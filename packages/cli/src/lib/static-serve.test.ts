import { test, expect, afterEach } from "bun:test";
import http from "node:http";
import net from "node:net";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { STATIC_MIME, resolveStaticPath, serveFile } from "./static-serve.ts";

// ── STATIC_MIME ──────────────────────────────────────────────────────────

test("STATIC_MIME covers the shared 17-extension table", () => {
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
  tempDir = await mkdtemp(join(tmpdir(), "pmd-static-serve-"));
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
  tempDir = await mkdtemp(join(tmpdir(), "pmd-static-serve-"));
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
  tempDir = await mkdtemp(join(tmpdir(), "pmd-static-serve-"));
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
  tempDir = await mkdtemp(join(tmpdir(), "pmd-static-serve-"));
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
