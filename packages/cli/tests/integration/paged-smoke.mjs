/**
 * Paged.js render smoke test.
 *
 * Usage: node paged-smoke.mjs <output-dir> [--chrome-path <path>]
 *
 * Starts a minimal local HTTP server serving <output-dir>, loads book.html in
 * a headless Chromium/Chrome instance, and waits for Paged.js to produce at
 * least one .pagedjs_page element. Exits 0 on success, 1 on failure.
 *
 * Browser resolution order:
 *   1. --chrome-path flag
 *   2. CHROME_PATH env var
 *   3. Common Windows paths
 *   4. Common Linux/macOS paths
 */

import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { join, extname, resolve } from "node:path";
import { chromium } from "playwright";

const TIMEOUT_MS = 60_000;

const MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".ico": "image/x-icon",
  ".png": "image/png",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};

const WINDOWS_CHROME_PATHS = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  process.env.LOCALAPPDATA
    ? `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`
    : null,
].filter(Boolean);

const UNIX_CHROME_PATHS = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium-browser",
  "/usr/bin/chromium",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
];

function findChrome(flagPath) {
  const candidates = [
    flagPath,
    process.env.CHROME_PATH,
    ...WINDOWS_CHROME_PATHS,
    ...UNIX_CHROME_PATHS,
  ].filter(Boolean);

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }
  return null;
}

function startServer(outDir) {
  return new Promise((resolveServer) => {
    const server = createServer((req, res) => {
      let urlPath = req.url.split("?")[0];
      if (urlPath === "/") urlPath = "/book.html";
      const filePath = resolve(join(outDir, urlPath));
      if (!filePath.startsWith(resolve(outDir))) {
        res.writeHead(403);
        res.end();
        return;
      }
      try {
        const data = readFileSync(filePath);
        const mime = MIME[extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolveServer(server));
  });
}

async function main() {
  const args = process.argv.slice(2);
  const outDir = args[0];
  const chromeFlag = args.indexOf("--chrome-path") !== -1
    ? args[args.indexOf("--chrome-path") + 1]
    : null;

  if (!outDir) {
    console.error("Usage: node paged-smoke.mjs <output-dir> [--chrome-path <path>]");
    process.exit(1);
  }

  const bookHtml = join(outDir, "book.html");
  if (!existsSync(bookHtml)) {
    console.error(`FAIL: ${bookHtml} does not exist`);
    process.exit(1);
  }

  const chromePath = findChrome(chromeFlag);
  if (!chromePath) {
    console.error("FAIL: No Chrome/Chromium executable found. Set CHROME_PATH or pass --chrome-path.");
    process.exit(1);
  }
  console.log(`Chrome: ${chromePath}`);

  const server = await startServer(outDir);
  const port = server.address().port;
  console.log(`Serving ${outDir} on http://127.0.0.1:${port}`);

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      executablePath: chromePath,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    const failed404s = [];

    // Fail on any 404 — every resource book.html references must be present in
    // the output directory. A missing vendor/paged.polyfill.js or
    // pagedjs-interface.js would 404 here and must not be silently swallowed.
    page.on("response", (response) => {
      if (response.status() === 404) {
        const url = response.url();
        console.error(`[404] ${url}`);
        failed404s.push(url);
      }
    });

    page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error" || type === "warning") {
        console.log(`[browser ${type}] ${msg.text()}`);
      }
    });

    const url = `http://127.0.0.1:${port}/book.html`;
    console.log(`Loading ${url}`);
    await page.goto(url, { waitUntil: "networkidle", timeout: TIMEOUT_MS });

    if (failed404s.length > 0) {
      throw new Error(
        `${failed404s.length} resource(s) returned 404 — the binary output is missing files:\n` +
        failed404s.map((u) => `  ${u}`).join("\n")
      );
    }

    console.log("Waiting for .pagedjs_page elements...");
    await page.waitForSelector(".pagedjs_page", { timeout: TIMEOUT_MS });

    const pageCount = await page.locator(".pagedjs_page").count();
    console.log(`Paged.js rendered ${pageCount} page(s)`);

    if (pageCount === 0) {
      throw new Error("No .pagedjs_page elements found — Paged.js did not render");
    }

    console.log("PASS: Paged.js render smoke test");
  } finally {
    await browser?.close();
    server.close();
  }
}

main().catch((err) => {
  console.error("FAIL:", err.message);
  process.exit(1);
});
