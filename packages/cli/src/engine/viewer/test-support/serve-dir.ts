import http from "node:http";
import fs from "node:fs";
import path from "node:path";

/**
 * Minimal static file server for viewer tests. ONE definition — this was
 * copy-pasted byte-identically into four sibling test files before being
 * extracted, and a fix to it (a MIME gap, traversal hardening) had to be
 * made four times or drift.
 */
export function serveDir(
  dir: string,
  entry: string
): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer((req, res) => {
    const rel = decodeURIComponent((req.url ?? "/").split("?")[0]!).replace(/^\/+/, "");
    const filePath = path.join(dir, rel || entry);
    if (!filePath.startsWith(dir) || !fs.existsSync(filePath)) {
      res.writeHead(404);
      res.end("not found");
      return;
    }
    const ext = path.extname(filePath);
    const type =
      ext === ".html" ? "text/html; charset=utf-8"
      : ext === ".js" ? "text/javascript"
      : ext === ".css" ? "text/css"
      : ext === ".png" ? "image/png"
      : "application/octet-stream";
    res.writeHead(200, { "content-type": type });
    res.end(fs.readFileSync(filePath));
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address() as { port: number };
      resolve({
        url: `http://127.0.0.1:${addr.port}/`,
        close: () => new Promise((r) => server.close(() => r())),
      });
    });
  });
}
