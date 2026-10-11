import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import { EDITOR_PROTOCOL_VERSION } from "@dimm-city/gutterpress-editor/core";
import { launchHarnessBrowser } from "@dimm-city/gutterpress-editor/test-harness";
import type { Browser, Page } from "playwright-core";
import { vscodeMock } from "../support/vscode-mock.ts";

/**
 * Repair round 1 — real-Chromium proof for finding "the webview bundle is
 * ESM served through a classic <script> tag — it cannot parse". No prior
 * suite pairs the REAL `renderWebviewHtml` output (`../../src/provider.ts`)
 * with the REAL built `dist/webview.js` equivalent inside one page and
 * loads it in a browser:
 *
 *   - `tests/provider.test.ts` string-pins `renderWebviewHtml`'s output but
 *     never loads it anywhere.
 *   - `tests/webview/mount.btest.ts` (and every other `*.btest.ts` in this
 *     directory) drives `mountGutterpressWebview` through
 *     `support/entry.ts`, bundled and served through
 *     `packages/editor`'s shared harness's OWN fixed HTML shell
 *     (`<script type="module" src="/bundle.js">`, unconditionally
 *     `type="module"`, no CSP) — never `renderWebviewHtml`'s actual output
 *     or its actual nonce/CSP-scoped `<script>` tag.
 *
 * This file closes exactly that gap: it bundles `src/webview/index.ts` the
 * SAME way `scripts/build.mjs` does (`target: "browser", format: "esm"`),
 * serves it at a real URL, calls the REAL `renderWebviewHtml` to produce the
 * REAL top-level HTML (CSP meta, nonce, `<script type="module" nonce="..."
 * src="...">`) pointed at that URL, and navigates real Chromium to it. A
 * `type="module"`-less version of this exact tag (the pre-repair shape) is
 * a hard `SyntaxError` under this document's real CSP/script pairing — this
 * test would time out waiting for the "ready" handshake and fail on that
 * code, and passes once the tag carries `type="module"`.
 *
 * `acquireVsCodeApi` (a real VS Code webview global, never present in a
 * plain browser) is injected via Playwright's `page.addInitScript` — CDP-
 * injected, so it runs before any page script and is NOT subject to the
 * page's own CSP (unlike a `<script>` element the page's `script-src` would
 * police) — exactly mirroring how a REAL VS Code host makes this global
 * available once `webviewPanel.webview.options.enableScripts` is `true`
 * (`../../src/provider.ts`). The simulated host's own replies are delivered
 * the SAME way a real VS Code webview channel delivers them: same-window
 * `window.postMessage(...)`, which the production code's own
 * `window.addEventListener("message", ...)` subscription (`../../src/
 * webview/index.ts`) receives identically to a cross-process message.
 *
 * AP-21: the FIRST assertion is that the "ready" handshake message was
 * actually posted — proof the module script executed at all — before any
 * assertion about the mount rendering; a page that failed to parse the
 * script would never post anything, so `waitForFunction` below would time
 * out rather than pass vacuously.
 */

mock.module("vscode", () => vscodeMock());
const { renderWebviewHtml } = await import("../../src/provider.ts");

declare global {
  interface Window {
    __gpProductionShellMessages?: unknown[];
    acquireVsCodeApi?: () => { postMessage(message: unknown): void };
  }
}

let server: Server;
let port: number;
let browser: Browser;
let page: Page;
const consoleErrors: string[] = [];
const pageErrors: string[] = [];

beforeAll(async () => {
  const webviewEntryPath = resolve(import.meta.dir, "../../src/webview/index.ts");
  // Mirrors scripts/build.mjs's own webview build config exactly (target
  // browser, format esm) — see that script's own header.
  const buildResult = await Bun.build({
    entrypoints: [webviewEntryPath],
    target: "browser",
    format: "esm",
  });
  if (!buildResult.success) {
    throw new Error(
      `production-shell.btest.ts: bundling src/webview/index.ts failed:\n${buildResult.logs.map(String).join("\n")}`,
    );
  }
  const webviewCode = await buildResult.outputs[0]!.text();

  server = createServer((req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    if (path === "/webview.js") {
      res.writeHead(200, { "content-type": "text/javascript; charset=utf-8" });
      res.end(webviewCode);
      return;
    }
    if (path === "/" || path === "/index.html") {
      const origin = `http://127.0.0.1:${port}`;
      // The REAL production function, called with real URLs pointed at
      // THIS server — the exact same call shape provider.ts's
      // resolveCustomTextEditor makes with webviewPanel.webview's own
      // asWebviewUri-resolved URLs.
      const html = renderWebviewHtml({ cspSource: origin, baseUri: origin, scriptUri: `${origin}/webview.js` });
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(html);
      return;
    }
    if (path === "/favicon.ico") {
      res.writeHead(200, { "content-type": "image/x-icon" });
      res.end("");
      return;
    }
    res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    res.end(`production-shell.btest.ts: no route for ${path}`);
  });

  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(`production-shell.btest.ts: server.address() returned an unusable value (${JSON.stringify(address)})`);
  }
  port = address.port;

  browser = await launchHarnessBrowser();
  page = await browser.newPage();
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  // Injected before any page script runs, and NOT subject to the page's own
  // CSP — see this file's own header.
  await page.addInitScript(() => {
    window.__gpProductionShellMessages = [];
    window.acquireVsCodeApi = () => ({
      postMessage: (message: unknown) => {
        window.__gpProductionShellMessages!.push(message);
      },
    });
  });

  await page.goto(`http://127.0.0.1:${port}/`);
}, 30_000);

afterAll(async () => {
  await browser?.close().catch(() => {});
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
});

describe("the REAL renderWebviewHtml output, loading the REAL built dist/webview.js via its own <script> tag, mounts in a real browser", () => {
  test("the module script executes and posts the production 'ready' handshake message (proves the tag parses/runs at all)", async () => {
    await page.waitForFunction(
      () => (window.__gpProductionShellMessages?.length ?? 0) > 0,
      undefined,
      { timeout: 5_000 },
    );
    const messages = await page.evaluate(() => window.__gpProductionShellMessages);
    expect(messages?.[0]).toEqual({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });
  });

  test("replying with the same handshake a real provider.ts sends mounts a real .md-editor with the seeded text", async () => {
    await page.evaluate((protocolVersion: number) => {
      window.postMessage({ type: "presentation-input", protocolVersion, mode: "rich" }, "*");
      window.postMessage({ type: "trust-state", protocolVersion, trusted: true }, "*");
      window.postMessage(
        { type: "snapshot", protocolVersion, snapshot: { text: "hello real shell", version: 0 }, baseStamp: 0 },
        "*",
      );
    }, EDITOR_PROTOCOL_VERSION);

    await page.waitForFunction(
      () => document.querySelector("#gp-editor-root .md-document")?.textContent === "hello real shell",
      undefined,
      { timeout: 5_000 },
    );
    expect(await page.evaluate(() => document.querySelectorAll("#gp-editor-root .md-editor").length)).toBe(1);
  });
});

describe("harness liveness", () => {
  test("no console or page errors were produced", () => {
    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
  });
});
