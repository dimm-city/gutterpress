import { createServer, type Server } from "node:http";
import type { HarnessCssAssets } from "./package-assets.ts";

/**
 * SFE-P1b Lane A — serves a bundled browser test entry plus
 * `@vscode/markdown-editor`'s CSS assets over `node:http` on an
 * OS-assigned loopback port (harness requirement 2: "serves it via
 * node:http on 127.0.0.1:0").
 */
export interface HarnessServer {
  readonly url: string;
  close(): Promise<void>;
}

const HTML_PAGE = (): string => `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>gutterpress editor browser harness</title>
<link rel="stylesheet" href="/assets/editor.css" />
<link rel="stylesheet" href="/assets/theme-default.css" />
<style>html,body{margin:0;padding:0;}</style>
</head>
<body>
<script type="module" src="/bundle.js"></script>
</body>
</html>
`;

interface Route {
  readonly contentType: string;
  readonly body: string | Buffer;
}

function buildRoutes(bundleCode: string, css: HarnessCssAssets): ReadonlyMap<string, Route> {
  const routes = new Map<string, Route>();
  routes.set("/", { contentType: "text/html; charset=utf-8", body: HTML_PAGE() });
  routes.set("/bundle.js", { contentType: "text/javascript; charset=utf-8", body: bundleCode });
  routes.set("/assets/editor.css", { contentType: "text/css; charset=utf-8", body: css.editorCss });
  routes.set("/assets/theme-default.css", {
    contentType: "text/css; charset=utf-8",
    body: css.defaultThemeCss,
  });
  // Mirrors editor.css's own `@import` targets exactly (see
  // package-assets.ts's header comment for why each is resolved the way it
  // is) so the browser's CSS `@import` requests for them succeed instead of
  // 404ing:
  //   editor.css's `@import '../contrib/find/find.css'`, served at
  //   `/assets/editor.css`, resolves per standard URL rules against editor
  //   .css's OWN base (`/assets/`): `../` steps up to `/`, landing on
  //   `/contrib/find/find.css` (verified live — NOT `/assets/contrib/...`,
  //   which a naive "nested under /assets/" guess would produce).
  routes.set("/contrib/find/find.css", {
    contentType: "text/css; charset=utf-8",
    body: css.findCss,
  });
  //   editor.css's `@import '@vscode/codicons/dist/codicon.css'` resolves
  //   (bare specifier, relative to editor.css's own directory) to
  //   `/assets/@vscode/codicons/dist/codicon.css`.
  routes.set("/assets/@vscode/codicons/dist/codicon.css", {
    contentType: "text/css; charset=utf-8",
    body: css.codiconCss,
  });
  //   codicon.css's own `url("./codicon.ttf?...")` resolves relative to
  //   ITS directory, i.e. `/assets/@vscode/codicons/dist/codicon.ttf`
  //   (the query string is stripped by `stripQuery` in the request handler
  //   below before the path is looked up in this map).
  routes.set("/assets/@vscode/codicons/dist/codicon.ttf", {
    contentType: "font/ttf",
    body: css.codiconFont,
  });
  // Chromium requests this automatically on every navigation; without a
  // route it 404s and surfaces as a spurious `console.error`, which would
  // otherwise pollute every test's `consoleErrors` capture for a request
  // no test cares about.
  routes.set("/favicon.ico", { contentType: "image/x-icon", body: "" });
  return routes;
}

function stripQuery(url: string): string {
  const questionMark = url.indexOf("?");
  return questionMark === -1 ? url : url.slice(0, questionMark);
}

/**
 * Starts the harness HTTP server. Resolves once listening; `close()` shuts
 * the server down and resolves once every connection is released.
 */
export async function startHarnessServer(
  bundleCode: string,
  css: HarnessCssAssets,
): Promise<HarnessServer> {
  const routes = buildRoutes(bundleCode, css);

  const server: Server = createServer((req, res) => {
    const path = stripQuery(req.url ?? "/");
    const route = routes.get(path);
    if (!route) {
      res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      res.end(`browser harness: no route for ${path}`);
      return;
    }
    res.writeHead(200, { "content-type": route.contentType });
    res.end(route.body);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error(
      `browser harness: server.address() returned an unusable value (${JSON.stringify(address)})`,
    );
  }

  return {
    url: `http://127.0.0.1:${address.port}/`,
    close(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      });
    },
  };
}
