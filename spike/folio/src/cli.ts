#!/usr/bin/env bun
/**
 * `folio` CLI (§10).
 *
 *   folio build book.html -o book.pdf [--signature 4] [--marks] [--slug 0.25in]
 *   folio dev   book.html [--port 4321]     static serve + hot reload + warm /proof.pdf
 *   folio export book.html -o dist/         self-contained viewer bundle (iframe embed)
 *
 * No bundler at runtime: the dev server is `node:http` + `ws`, matching the
 * host repo's architectural rule §1.
 */
import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, statSync, watch, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, resolve } from "node:path";
import { WebSocketServer } from "ws";
import { launchChromium, type Browser } from "./shared/cdp.ts";
import { build } from "./compiler/build.ts";
import { toPt } from "./shared/gcpm-extract.ts";

const VIEWER_JS = join(import.meta.dir, "..", "dist", "folio.js");

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".woff2": "font/woff2",
};

function parseArgs(argv: string[]) {
  const out: Record<string, string | boolean> = {};
  const positional: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const [k, v] = a.slice(2).split("=");
      if (v !== undefined) out[k] = v;
      else if (argv[i + 1] && !argv[i + 1].startsWith("-")) out[k] = argv[++i];
      else out[k] = true;
    } else if (a === "-o") out.output = argv[++i];
    else positional.push(a);
  }
  return { positional, flags: out };
}

const HOT_RELOAD = `<script>
(() => {
  const ws = new WebSocket(\`ws://\${location.host}/__folio\`);
  ws.onmessage = (e) => { if (e.data === "reload") location.reload(); };
})();
</script>`;

const VIEWER_TAG = `<script src="/__folio/folio.js"></script>`;

/** Inject the viewer + hot reload without touching the author's file on disk. */
function instrumentHtml(html: string, opts: { hot: boolean; viewer: boolean }): string {
  let out = html;
  const inject = (opts.viewer ? VIEWER_TAG : "") + (opts.hot ? HOT_RELOAD : "");
  if (!inject) return out;
  if (/<\/body>/i.test(out)) out = out.replace(/<\/body>/i, `${inject}</body>`);
  else out += inject;
  return out;
}

async function cmdBuild(positional: string[], flags: Record<string, any>) {
  const input = positional[0];
  if (!input) die("usage: folio build <input.html> -o <output.pdf>");
  const output = String(flags.output ?? input.replace(/\.html?$/i, "") + ".pdf");
  const t0 = performance.now();
  const result = await build({
    input,
    signature: flags.signature ? Number(flags.signature) : undefined,
    marks: flags.marks === true || flags.marks === "crop",
    slugPt: flags.slug ? (toPt(String(flags.slug)) ?? undefined) : undefined,
    bleedPt: flags.bleed ? (toPt(String(flags.bleed)) ?? undefined) : undefined,
    title: flags.title ? String(flags.title) : undefined,
    author: flags.author ? String(flags.author) : undefined,
    onProgress: (m) => console.log(`  ${m}`),
  });
  writeFileSync(output, result.bytes);
  if (flags["emit-css"]) {
    const cssPath = output.replace(/\.pdf$/i, ".gen.css");
    writeFileSync(cssPath, result.genCss);
    console.log(`  wrote ${cssPath}`);
  }
  console.log(
    `${output}: ${result.pageCount} pages, tier ${result.tier}` +
      (result.tier === 3 ? ` (${result.passes} passes, converged=${result.converged})` : "") +
      `, ${((performance.now() - t0) / 1000).toFixed(2)}s`,
  );
  for (const n of result.notes) console.log(`  · ${n}`);
}

async function cmdDev(positional: string[], flags: Record<string, any>) {
  const input = resolve(positional[0] ?? "index.html");
  const root = statSync(input).isDirectory() ? input : dirname(input);
  const entry = statSync(input).isDirectory() ? "index.html" : basename(input);
  const port = Number(flags.port ?? 4321);

  // one warm headless Chromium, kept alive across edits (§10)
  let browser: Browser | undefined;
  const warm = async () => (browser ??= await launchChromium());

  const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    if (url.pathname === "/__folio/folio.js") {
      res.writeHead(200, { "content-type": MIME[".js"] });
      res.end(readFileSync(VIEWER_JS));
      return;
    }
    if (url.pathname === "/proof.pdf") {
      const t0 = performance.now();
      const result = await build({ input: join(root, entry), browser: await warm() });
      console.log(
        `  proof: ${result.pageCount} pages in ${((performance.now() - t0) / 1000).toFixed(2)}s (warm)`,
      );
      res.writeHead(200, { "content-type": MIME[".pdf"], "cache-control": "no-store" });
      res.end(Buffer.from(result.bytes));
      return;
    }
    const file = join(root, url.pathname === "/" ? entry : url.pathname.slice(1));
    if (!file.startsWith(root) || !existsSync(file)) {
      res.writeHead(404).end("not found");
      return;
    }
    const ext = extname(file);
    if (ext === ".html") {
      const html = instrumentHtml(readFileSync(file, "utf8"), { hot: true, viewer: true });
      res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-store" });
      res.end(html);
      return;
    }
    res.writeHead(200, { "content-type": MIME[ext] ?? "application/octet-stream" });
    res.end(readFileSync(file));
  });

  const wss = new WebSocketServer({ server, path: "/__folio" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  watch(root, { recursive: true }, (_e, name) => {
    if (name && /\.(html?|css|js|svg|png|jpe?g)$/i.test(name)) {
      clearTimeout(timer);
      timer = setTimeout(() => {
        for (const client of wss.clients) client.send("reload");
        console.log(`  reload (${name})`);
      }, 30);
    }
  });

  // The warm browser outlives every request, so the ONLY thing that can close
  // it is process shutdown. Without this, every `folio dev` session leaks a
  // headless Chromium and its profile dir for as long as the machine is up.
  let closing = false;
  const shutdown = async () => {
    if (closing) return;
    closing = true;
    server.close();
    const b = browser;
    browser = undefined;
    if (b) await b.close();
    process.exit(0);
  };
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"] as const)
    process.once(sig, shutdown);

  server.listen(port, () => {
    console.log(`folio dev → http://localhost:${port}/  (proof at /proof.pdf)`);
  });
}

function cmdExport(positional: string[], flags: Record<string, any>) {
  const input = resolve(positional[0] ?? "index.html");
  const outDir = resolve(String(flags.output ?? "dist"));
  mkdirSync(outDir, { recursive: true });
  const html = instrumentHtml(readFileSync(input, "utf8"), { hot: false, viewer: true }).replace(
    "/__folio/folio.js",
    "./folio.js",
  );
  writeFileSync(join(outDir, "index.html"), html);
  writeFileSync(join(outDir, "folio.js"), readFileSync(VIEWER_JS));
  console.log(`exported static viewer to ${outDir}/ — embed with <iframe src="${outDir}/index.html">`);
}

function die(msg: string): never {
  console.error(msg);
  process.exit(1);
}

const [cmd, ...rest] = process.argv.slice(2);
const { positional, flags } = parseArgs(rest);
switch (cmd) {
  case "build":
    await cmdBuild(positional, flags);
    break;
  case "dev":
    await cmdDev(positional, flags);
    break;
  case "export":
    cmdExport(positional, flags);
    break;
  default:
    console.log(`folio — standard CSS in, pages out

  folio build  <input.html> -o <out.pdf> [--signature N] [--marks] [--slug 0.25in]
                                         [--bleed 0.125in] [--title T] [--author A]
                                         [--emit-css]
  folio dev    <input.html|dir> [--port 4321]
  folio export <input.html> -o <dir>
`);
}
