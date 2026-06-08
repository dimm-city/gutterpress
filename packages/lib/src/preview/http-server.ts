/**
 * Node.js-compatible preview HTTP server with WebSocket-based live reload.
 *
 * Uses node:http + the `ws` package in place of Bun.serve so this module
 * runs under both Bun (dev / compiled binary) and Node.js (Electron in-process).
 *
 * This module deliberately avoids any bundler runtime (vite/rollup/esbuild)
 * — see ADR `docs/adr/0001-no-bundlers-at-runtime.md`.
 */

import http from 'node:http';
import net from 'node:net';
import { readFile, stat } from 'node:fs/promises';
import path from 'path';
import { WebSocket, WebSocketServer } from 'ws';
import { info } from '../utils/logger.ts';
import { openPath } from '../lib/open-path.ts';
import { getAssetPath } from '../lib/embedded-assets.ts';
import type { ServerState } from './server-context.ts';
import { handleApiRequest } from './api-middleware.ts';
import { renderChapterPreviewHtml } from './file-watcher.ts';

/**
 * URL path that upgrades to a WebSocket subscribed to the reload topic.
 */
const HMR_PATH = '/__print-md-hmr';

/**
 * Tiny client snippet injected into served HTML. Listens for `full-reload`
 * messages on the HMR WebSocket and reloads the page.
 */
const HMR_CLIENT_SNIPPET = `
<script>
  (function () {
    // When embedded in the preview shell (iframe double-buffer), the shell owns
    // HMR — it swaps frames and syncs scroll. Stay inert so we don't open a
    // second WebSocket or self-reload inside the frame.
    if (window.self !== window.top) return;
    var ANCHOR_KEY = 'pmd-scroll-anchor';

    // Find the element nearest the top of the viewport that carries a source
    // line (markdown-it-source-map emits data-source-line on block elements).
    // We anchor on SOURCE position, not pixels, because page breaks move when
    // content re-paginates.
    function captureAnchor() {
      var els = document.querySelectorAll('[data-source-line]');
      var best = null, bestTop = -Infinity;
      for (var i = 0; i < els.length; i++) {
        var r = els[i].getBoundingClientRect();
        if (r.bottom < 0 || r.height === 0) continue;
        if (r.top <= 80 && r.top > bestTop) { bestTop = r.top; best = els[i]; }
      }
      if (!best) {
        for (var j = 0; j < els.length; j++) {
          var rr = els[j].getBoundingClientRect();
          if (rr.bottom > 0 && rr.height > 0) { best = els[j]; break; }
        }
      }
      if (!best) return null;
      return { line: best.getAttribute('data-source-line'), offset: best.getBoundingClientRect().top };
    }

    // After a content reload, put the same source line back at the same viewport
    // offset so the author keeps their place (no jump to the top).
    function restoreAnchor() {
      var raw;
      try { raw = sessionStorage.getItem(ANCHOR_KEY); } catch (_) { return; }
      if (!raw) return;
      try { sessionStorage.removeItem(ANCHOR_KEY); } catch (_) {}
      var a; try { a = JSON.parse(raw); } catch (_) { return; }
      var tries = 0;
      (function attempt() {
        var el = document.querySelector('[data-source-line="' + a.line + '"]');
        if (el) {
          window.scrollBy(0, el.getBoundingClientRect().top - a.offset);
          return;
        }
        if (tries++ < 240) setTimeout(attempt, 25); // wait for pagination
      })();
    }
    var restored = false;
    function restoreOnce() { if (restored) return; restored = true; restoreAnchor(); }
    // CRITICAL ordering: when the Paged.js polyfill is present it re-paginates on
    // load and its PagedConfig.after calls scrollTo(0,0) THEN fires
    // 'renderingComplete'. So in engine mode we MUST wait for that event —
    // restoring earlier would be wiped by the scrollTo(0,0). In static mode (no
    // engine) the content is final immediately, so restore right after load.
    var hasEngine = !!document.querySelector('script[src*="paged.polyfill"], script[src*="pagedjs"]');
    window.addEventListener('renderingComplete', restoreOnce);
    if (!hasEngine) {
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function () { setTimeout(restoreOnce, 50); });
      } else {
        setTimeout(restoreOnce, 50);
      }
    }
    setTimeout(restoreOnce, 10000); // safety net if renderingComplete never fires

    var ws = new WebSocket(location.origin.replace(/^http/, 'ws') + '${HMR_PATH}');
    ws.onmessage = function (e) {
      var msg;
      try { msg = JSON.parse(e.data); } catch (_) { return; }
      if (msg.type === 'full-reload') {
        try { var a = captureAnchor(); if (a) sessionStorage.setItem(ANCHOR_KEY, JSON.stringify(a)); } catch (_) {}
        location.reload();
        return;
      }
      // CSS hot-swap: Paged.js inlines the user CSS and REMOVES the original
      // <link> during pagination, so there is usually no <link> left to bump.
      // Instead we (re)inject a fresh <link> for the edited stylesheet, appended
      // LAST so its rules win the cascade over Paged.js's stale inlined copy.
      // No reload, no re-pagination — scroll position is preserved and the new
      // styles apply on the next frame. (Geometry/@page changes won't re-flow
      // page boxes until a content edit triggers a full rebuild.)
      if (msg.type === 'css-update' && msg.path) {
        var id = 'pmd-hot-' + msg.path.replace(/[^a-z0-9]/gi, '_');
        var prev = document.getElementById(id);
        if (prev && prev.parentNode) prev.parentNode.removeChild(prev);
        var link = document.createElement('link');
        link.rel = 'stylesheet';
        link.id = id;
        link.href = msg.path + '?t=' + Date.now();
        (document.head || document.documentElement).appendChild(link);
        window.dispatchEvent(new CustomEvent('pmd:css-updated', { detail: { path: msg.path } }));
        return;
      }
    };
  })();
</script>
`;

const MIME: Record<string, string> = {
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
 * Preview shell (opt-in via PRINTMD_PREVIEW_SHELL=1). Hosts book.html in an
 * iframe and double-buffers content reloads: on a markdown edit it paginates a
 * SECOND hidden iframe, waits for it to finish, then swaps it in atomically and
 * restores the scroll anchor — so the visible page never flickers or rebuilds in
 * view. CSS edits are forwarded into the active frame (instant hot-swap). This is
 * the same iframe pattern the Electron viewer uses, converging the two.
 */
const SHELL_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>print-md preview</title>
<style>html,body{margin:0;height:100%;background:#fff;overflow:hidden}
iframe{position:absolute;inset:0;width:100%;height:100%;border:0;display:block}</style>
</head><body>
<iframe id="pmd-active" src="/book.html" title="preview"></iframe>
<script>
(function(){
  var HMR='${HMR_PATH}';
  var active=document.getElementById('pmd-active');
  var building=null;
  function fdoc(f){try{return f.contentDocument;}catch(_){return null;}}
  function fwin(f){try{return f.contentWindow;}catch(_){return null;}}
  function hotCss(p){
    var d=fdoc(active); if(!d)return;
    var id='pmd-hot-'+p.replace(/[^a-z0-9]/gi,'_');
    var prev=d.getElementById(id); if(prev&&prev.parentNode)prev.parentNode.removeChild(prev);
    var l=d.createElement('link'); l.rel='stylesheet'; l.id=id; l.href=p+'?t='+Date.now();
    (d.head||d.documentElement).appendChild(l);
  }
  function capture(f){
    var d=fdoc(f); if(!d)return null;
    var els=d.querySelectorAll('[data-source-line]'),best=null,bestTop=-Infinity;
    for(var i=0;i<els.length;i++){var r=els[i].getBoundingClientRect(); if(r.bottom<0||r.height===0)continue; if(r.top<=80&&r.top>bestTop){bestTop=r.top;best=els[i];}}
    if(!best){for(var j=0;j<els.length;j++){var rr=els[j].getBoundingClientRect(); if(rr.bottom>0&&rr.height>0){best=els[j];break;}}}
    if(!best)return null; return {line:best.getAttribute('data-source-line'),offset:best.getBoundingClientRect().top};
  }
  function restore(f,a){
    if(!a)return; var w=fwin(f),d=fdoc(f); if(!w||!d)return;
    var el=d.querySelector('[data-source-line="'+a.line+'"]'); if(!el)return;
    w.scrollBy(0, el.getBoundingClientRect().top - a.offset);
  }
  function swap(){
    if(building&&building.parentNode)building.parentNode.removeChild(building); building=null;
    var anchor=capture(active);
    var f=document.createElement('iframe');
    f.style.visibility='hidden'; f.setAttribute('aria-hidden','true');
    f.src='/book.html?bust='+Date.now(); building=f;
    var finished=false;
    function finish(){
      if(finished||building!==f)return; finished=true;
      restore(f,anchor);
      f.style.visibility='visible'; f.removeAttribute('aria-hidden');
      var old=active; active=f; building=null; tagPages(active);
      requestAnimationFrame(function(){requestAnimationFrame(function(){ if(old&&old.parentNode)old.parentNode.removeChild(old); });});
    }
    f.addEventListener('load',function(){
      var w=fwin(f),d=fdoc(f); if(!w||!d){finish();return;}
      var hasEngine=!!d.querySelector('script[src*="paged.polyfill"], script[src*="pagedjs"]');
      if(hasEngine){ w.addEventListener('renderingComplete',finish,{once:true}); setTimeout(finish,180000); }
      else { var t=0; (function p(){var dd=fdoc(f); if(dd&&dd.querySelectorAll('.pagedjs_page').length>0){finish();return;} if(t++<600)setTimeout(p,25); else finish();})(); }
    });
    document.body.appendChild(f);
  }
  // Tag each rendered page with the chapter (data-chapter-src) it contains, so a
  // single edited chapter's pages can be located and replaced.
  function tagPages(f){
    var d=fdoc(f); if(!d)return;
    var pages=d.querySelectorAll('.pagedjs_page');
    for(var i=0;i<pages.length;i++){
      if(pages[i].getAttribute('data-chapter-src'))continue;
      var ch=pages[i].querySelector('.pmd-chapter[data-chapter-src]');
      if(ch)pages[i].setAttribute('data-chapter-src',ch.getAttribute('data-chapter-src'));
    }
  }
  function onReady(f,cb){
    var w=fwin(f),d=fdoc(f); if(!w||!d){cb();return;}
    var has=!!d.querySelector('script[src*="paged.polyfill"], script[src*="pagedjs"]');
    if(has){ var done=false; var g=function(){if(done)return;done=true;cb();}; w.addEventListener('renderingComplete',g,{once:true}); setTimeout(g,180000); }
    else { var t=0;(function p(){var dd=fdoc(f); if(dd&&dd.querySelectorAll('.pagedjs_page').length>0){cb();return;} if(t++<800)setTimeout(p,25); else cb();})(); }
  }
  // INCREMENTAL: re-paginate ONLY the edited chapter in a hidden iframe, then
  // replace that chapter's pages in the live view. Page numbers are a live CSS
  // counter, so they re-flow automatically. Falls back to a full double-buffer
  // swap if the splice can't be applied.
  function spliceChapter(file){
    var anchor=capture(active);
    tagPages(active);
    var f=document.createElement('iframe'); f.style.visibility='hidden'; f.setAttribute('aria-hidden','true');
    f.src='/__chapter?file='+encodeURIComponent(file)+'&t='+Date.now();
    f.addEventListener('load',function(){
      onReady(f,function(){
        try{
          var ad=fdoc(active), sd=fdoc(f);
          var container=ad.querySelector('.pagedjs_pages')||ad.body;
          var oldPages=[].slice.call(ad.querySelectorAll('.pagedjs_page[data-chapter-src="'+file+'"]'));
          var newPages=[].slice.call(sd.querySelectorAll('.pagedjs_page'));
          if(!oldPages.length||!newPages.length) throw new Error('no pages '+oldPages.length+'/'+newPages.length);
          var at=oldPages[0];
          for(var i=0;i<newPages.length;i++){
            var imp=ad.importNode(newPages[i],true);
            imp.setAttribute('data-chapter-src',file);
            container.insertBefore(imp,at);
          }
          for(var j=0;j<oldPages.length;j++) oldPages[j].parentNode.removeChild(oldPages[j]);
          restore(active,anchor);
        }catch(err){ if(window.console)console.warn('[pmd] incremental splice failed, full swap:',err); swap(); }
        if(f.parentNode)f.parentNode.removeChild(f);
      });
    });
    document.body.appendChild(f);
  }
  // Tag the initial frame once it has paginated.
  function tagInitial(){ onReady(active,function(){ tagPages(active); }); }
  if(active.contentDocument && active.contentDocument.readyState==='complete') tagInitial();
  active.addEventListener('load',tagInitial);

  var ws=new WebSocket(location.origin.replace(/^http/,'ws')+HMR);
  ws.onmessage=function(e){ var m; try{m=JSON.parse(e.data);}catch(_){return;}
    if(m.type==='css-update'&&m.path){hotCss(m.path);return;}
    if(m.type==='content-update'&&m.file){spliceChapter(m.file);return;}
    if(m.type==='full-reload'){swap();return;}
  };
})();
</script>
</body></html>`;

/**
 * Public handle for the running preview server.
 */
export interface PreviewServer {
  /** Port the server is listening on. */
  port: number;
  /** Stop the server and close all connections. */
  close(): Promise<void>;
  /**
   * Broadcast a `{ type: "full-reload" }` message to every connected HMR
   * client. Safe to call after `close()` (no-op).
   */
  broadcastReload(): void;
  /**
   * Broadcast a `{ type: "css-update", path }` message so clients re-fetch just
   * that stylesheet (no reload / re-pagination). `path` is the stylesheet's
   * served path relative to the temp dir (e.g. "styles/guide.css").
   */
  broadcastCssUpdate(stylesheetPath: string): void;
  /**
   * Broadcast a `{ type: "content-update", file }` message so the incremental
   * shell re-paginates and splices just that chapter (instead of reloading the
   * whole document). `file` matches the `data-chapter-src` wrapper attribute.
   */
  broadcastContentUpdate(file: string): void;
}

/**
 * Check if a TCP port is available for binding.
 */
export async function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const srv = net.createServer();
    srv.unref();
    // @types/bun's node:net shim omits EventEmitter methods from Server; cast to use .on().
    (srv as unknown as { on(e: 'error', fn: () => void): void }).on('error', () => resolve(false));
    srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
  });
}

/**
 * Find the next available port starting from `startPort`.
 *
 * @throws {Error} If no available port found after 10 attempts.
 */
export async function findAvailablePort(startPort: number): Promise<number> {
  let port = startPort;
  const maxAttempts = 10;
  for (let i = 0; i < maxAttempts; i++) {
    if (await isPortAvailable(port)) return port;
    port++;
  }
  throw new Error(`Could not find an available port after ${maxAttempts} attempts`);
}

/**
 * Resolve a request URL pathname to an absolute path inside `tempDir`.
 * Returns `null` if the resolved path escapes the temp dir root.
 */
function resolveStaticPath(urlPathname: string, tempDir: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPathname);
  } catch {
    return null;
  }
  const resolvedTemp = path.resolve(tempDir);
  const candidate = path.resolve(resolvedTemp, '.' + decoded);
  if (candidate !== resolvedTemp && !candidate.startsWith(resolvedTemp + path.sep)) {
    return null;
  }
  return candidate;
}

/**
 * Inject the HMR client snippet just before the closing `</body>` tag.
 */
function injectHmrClient(html: string): string {
  const closingBody = html.lastIndexOf('</body>');
  if (closingBody === -1) return html + HMR_CLIENT_SNIPPET;
  return html.slice(0, closingBody) + HMR_CLIENT_SNIPPET + html.slice(closingBody);
}

/**
 * Serve a static file (or directory's `index.html`) with HMR injection for
 * HTML responses. Writes 404 if the path doesn't resolve to a real file.
 *
 * `cacheControl` is the value sent in the Cache-Control header. Defaults to
 * 'no-cache' (HMR-friendly). Vendor assets that never change content within
 * a process pass 'public, max-age=31536000, immutable' so Chrome's HTTP
 * cache reuses them across page reloads within the same session.
 */
async function serveStatic(
  absPath: string,
  res: http.ServerResponse,
  cacheControl: string = 'no-cache',
): Promise<void> {
  let filePath = absPath;

  // Directory hit → try index.html inside it.
  try {
    const s = await stat(filePath);
    if (s.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  let data: Buffer;
  try {
    data = await readFile(filePath);
  } catch {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }

  const isHtml = filePath.endsWith('.html') || filePath.endsWith('.htm');
  if (isHtml) {
    const withHmr = injectHmrClient(data.toString('utf-8'));
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
    res.end(withHmr);
    return;
  }

  const ct = MIME[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
  // Empty files: force 200 with empty body so placeholders (e.g. empty CSS)
  // load without error in some clients.
  res.writeHead(200, { 'Content-Type': ct, 'Cache-Control': cacheControl });
  res.end(data);
}

/**
 * URL paths that resolve to the process-wide embedded assets dir, NOT the
 * per-project tempDir. These never change within a process lifetime so we
 * serve them from a stable disk location (avoids per-open copies, lets
 * Defender hash-cache stay warm, and lets Chrome's HTTP cache reuse the
 * response across reloads in the same session).
 */
const EMBEDDED_PREFIXES = ['/vendor/', '/preview/scripts/'];
const EMBEDDED_EXACT = new Set(['/favicon.ico']);

function matchesEmbedded(urlPathname: string): boolean {
  if (EMBEDDED_EXACT.has(urlPathname)) return true;
  return EMBEDDED_PREFIXES.some((p) => urlPathname.startsWith(p));
}

/**
 * Pipe a Web API `Response` object into a Node.js `http.ServerResponse`.
 */
async function pipeWebResponse(webRes: Response, res: http.ServerResponse): Promise<void> {
  const headers: Record<string, string> = {};
  webRes.headers.forEach((v, k) => { headers[k] = v; });
  res.writeHead(webRes.status, headers);
  res.end(Buffer.from(await webRes.arrayBuffer()));
}

/**
 * Create and start a preview HTTP+WebSocket server bound to `state.tempDir`.
 */
export async function createPreviewServer(
  state: ServerState,
  port: number,
  restartPreviewFn: (newPath: string) => Promise<void>
): Promise<PreviewServer> {
  const clients = new Set<WebSocket>();

  const wss = new WebSocketServer({ noServer: true });
  wss.on('connection', (ws) => {
    clients.add(ws);
    ws.on('close', () => clients.delete(ws));
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, 'http://127.0.0.1');

    // 1. WebSocket HMR path — non-upgrade hits get 426.
    if (url.pathname === HMR_PATH) {
      res.writeHead(426, { 'Content-Type': 'text/plain', Upgrade: 'websocket' });
      res.end('Expected WebSocket upgrade');
      return;
    }

    // 2. API routes.
    if (url.pathname.startsWith('/api/')) {
      const webReq = new Request(`http://127.0.0.1${req.url!}`, {
        method: req.method,
        headers: Object.fromEntries(
          Object.entries(req.headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : v ?? ''])
        ),
      });
      const webRes = await handleApiRequest(webReq, state, restartPreviewFn);
      if (webRes) {
        await pipeWebResponse(webRes, res);
        return;
      }
      res.writeHead(404);
      res.end('Not Found');
      return;
    }

    // 3. Embedded assets (vendor + viewer scripts) — served from the
    // process-wide extracted assets dir, with long cache headers. These
    // never change within a process lifetime, so we never copy them into
    // per-project tempDirs (avoids redundant disk writes that Windows
    // Defender re-scans on every folder open).
    if (matchesEmbedded(url.pathname)) {
      const rel = url.pathname.slice(1); // strip leading '/'
      try {
        const absPath = await getAssetPath(rel);
        await serveStatic(
          absPath,
          res,
          'public, max-age=31536000, immutable',
        );
      } catch {
        res.writeHead(404);
        res.end('Not Found');
      }
      return;
    }

    // 3a. Incremental: render a single chapter for the shell to splice.
    if (url.pathname === '/__chapter') {
      const file = url.searchParams.get('file');
      if (!file || !state.currentInputPath) {
        res.writeHead(400); res.end('Bad Request'); return;
      }
      try {
        const chapterHtml = await renderChapterPreviewHtml(
          state.currentInputPath,
          file,
          (state.config as { title?: string; styles?: string[]; plugins?: unknown[] }) || {}
        );
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
        res.end(chapterHtml);
      } catch (e) {
        res.writeHead(500); res.end(String(e));
      }
      return;
    }

    // 3b. Preview shell (opt-in): serve the double-buffering shell at "/".
    // Incremental mode implies the shell.
    if (url.pathname === '/' &&
        (process.env.PRINTMD_PREVIEW_SHELL === '1' || process.env.PRINTMD_PREVIEW_INCREMENTAL === '1')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-cache' });
      res.end(SHELL_HTML);
      return;
    }

    // 4. Static file fallback.
    // Treat bare "/" as book.html — the desktop app (packages/viewer) wraps
    // book.html in its own iframe-based toolbar.
    const pathname = url.pathname === '/' ? '/book.html' : url.pathname;
    const absPath = resolveStaticPath(pathname, state.tempDir);
    if (!absPath) {
      res.writeHead(404);
      res.end('Not Found');
      return;
    }
    await serveStatic(absPath, res).catch((err: Error) => {
      if (!res.headersSent) {
        res.writeHead(500);
        res.end(`Internal Server Error: ${err.message}`);
      }
    });
  });

  // Handle WebSocket upgrade for the HMR path.
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url!, 'http://127.0.0.1');
    if (url.pathname === HMR_PATH) {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
    } else {
      socket.destroy();
    }
  });

  await new Promise<void>((resolve) => server.listen(port, state.options.host, resolve));

  const boundPort = (server.address() as net.AddressInfo).port;
  const serverUrl = `http://localhost:${boundPort}`;
  info(`Preview server running at ${serverUrl}`);
  if (state.options.host !== '127.0.0.1' && state.options.host !== 'localhost') {
    info(`Bound on ${state.options.host}:${boundPort} (reachable from the network)`);
  }
  info('Press Ctrl+C to stop');

  if (state.options.openBrowser) {
    openPath(serverUrl).catch(() => { /* no-op */ });
  }

  let stopped = false;

  return {
    port: boundPort,
    async close() {
      if (stopped) return;
      stopped = true;
      for (const ws of clients) ws.terminate();
      clients.clear();
      wss.close();
      await new Promise<void>((resolve) => {
        // closeAllConnections() available in Node 18.2+ / all Electron 33 builds
        if (typeof (server as any).closeAllConnections === 'function') {
          (server as any).closeAllConnections();
        }
        server.close(() => resolve());
      });
    },
    broadcastReload() {
      if (stopped) return;
      const message = JSON.stringify({ type: 'full-reload' });
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    },
    broadcastCssUpdate(stylesheetPath: string) {
      if (stopped) return;
      const message = JSON.stringify({ type: 'css-update', path: stylesheetPath });
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    },
    broadcastContentUpdate(file: string) {
      if (stopped) return;
      const message = JSON.stringify({ type: 'content-update', file });
      for (const ws of clients) {
        if (ws.readyState === WebSocket.OPEN) ws.send(message);
      }
    },
  };
}
