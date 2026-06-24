import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { renderChaptersToFile } from "./markdown/index";
import { loadPlugins, collectPluginCss } from "./markdown/plugins";
import { copyAssets, resolveAssetDestName } from "./assets";
import { requireChromiumExecutable, resolveChromiumExecutable } from "./chromium";
import { prewarmBrowser, getBrowser, closeBrowser } from "./browser-pool";
import { isToolAvailable } from "./tool-probe";
import { patchHtmlForPagedjs } from "./pagedjs";
import {
  convertToPdfxCmyk,
  stampCreator,
  stripAnnotations,
} from "./ghostscript";
import { writeBuildFingerprint } from "./build-fingerprint";
import { BOOK_HTML_FILENAME } from "./viewer";
import { getAssetPath } from "./embedded-assets";
import { runLint } from "./lint-runner";
import { executeAndReport } from "./validation-exec";
import { log } from "./logger";

export type BuildFormat = "html" | "pdf" | "pdfx";
export type PdfxFlavor = "x1a" | "x3";

export class BuildError extends Error {
  exitCode: number;
  constructor(message: string, exitCode = 2) {
    super(message);
    this.name = "BuildError";
    this.exitCode = exitCode;
  }
}

export interface BuildRunnerOptions {
  inputDir: string;
  format: BuildFormat;
  outDir?: string;
  pdfFileOverride?: string | null;
  title?: string;
  pdfxFlavor?: PdfxFlavor;
  iccPath?: string;
  manifestPath?: string;
  stripAnnotations?: boolean;
  skipLint?: boolean;
  skipPreValidate?: boolean;
  skipPostValidate?: boolean;
  /**
   * Optional PDF renderer override. When provided, the build uses it instead of
   * launching Chromium via puppeteer, and the Chromium preflight is skipped.
   * The Electron viewer injects one backed by `webContents.printToPDF`.
   */
  pdfRenderer?: PdfRenderer;
  /**
   * Keep the pooled headless browser alive after the build returns. A one-shot
   * CLI build leaves this false so the process can exit; a long-lived
   * preview/watch server sets it true so the browser stays warm across rebuilds
   * (every rebuild then skips the ~1–2s Chromium launch). The server owns
   * `closeBrowser()` on shutdown.
   */
  keepBrowserAlive?: boolean;
  rawArgs: Record<string, unknown>;
}

export interface BuildRunnerResult {
  outDir: string;
  htmlPath: string;
  pdfPath: string | null;
  fingerprintPath: string;
}

export interface SplitOutPath {
  outDir?: string;
  pdfFileOverride: string | null;
}

/**
 * Split --out into outDir + optional pdfFileOverride.
 *  - For pdf/pdfx, accept "*.pdf" forms (file path) and split into dirname + path.
 *  - For html or any non-.pdf string, treat as a directory.
 */
export function splitOutPath(
  outArg: string | undefined,
  format: BuildFormat
): SplitOutPath {
  if (typeof outArg !== "string" || outArg.length === 0) {
    return { outDir: undefined, pdfFileOverride: null };
  }
  const resolved = path.resolve(outArg);
  if (
    (format === "pdf" || format === "pdfx") &&
    resolved.toLowerCase().endsWith(".pdf")
  ) {
    return { outDir: path.dirname(resolved), pdfFileOverride: resolved };
  }
  return { outDir: resolved, pdfFileOverride: null };
}

interface Gates {
  lint: boolean;
  preValidate: boolean;
  postValidate: boolean;
}

interface MissingTool {
  name: string;
  installHint: string;
}

const INSTALL_HINTS: Record<string, string> = {
  gs: "  macOS:   brew install ghostscript\n  Ubuntu:  sudo apt install -y ghostscript\n  Windows: https://www.ghostscript.com/releases/gsdnld.html  (or: choco install ghostscript)",
  qpdf: "  macOS:   brew install qpdf\n  Ubuntu:  sudo apt install -y qpdf\n  Windows: choco install qpdf  (or: https://github.com/qpdf/qpdf/releases)",
};

/**
 * Probe for every tool this build will actually spawn, BEFORE the pipeline
 * starts running for real. Fails fast with one error that lists every
 * missing tool plus per-platform install commands.
 *
 * Without this, the user waits for lint + render (30-90s) before hitting
 * `spawn gs ENOENT` from deep inside the post-processing. 50ms preflight
 * makes the failure actionable and immediate.
 *
 * Chromium is REQUIRED for any non-html format and surfaces the same
 * install-instructions error from requireChromiumExecutable() if missing.
 * Ghostscript is REQUIRED for pdfx (CMYK conversion); for plain pdf it
 * only adds /Creator metadata — best-effort downstream — so we warn but
 * don't block.
 * qpdf is REQUIRED for pdfx + stripAnnotations (default true).
 */
async function preflightBuildTools(
  format: BuildFormat,
  opts: { stripAnnotations?: boolean; pdfRenderer?: PdfRenderer },
  config: { pdfx: { stripAnnotations: boolean } }
): Promise<void> {
  const missing: MissingTool[] = [];

  // Chromium — required for any rendered output, UNLESS an external PDF renderer
  // is injected (the Electron viewer renders with its own bundled Chromium).
  if (!opts.pdfRenderer && !(await resolveChromiumExecutable())) {
    // requireChromiumExecutable() throws with multi-line install instructions
    // that include all three platforms. Defer to it for the canonical message.
    await requireChromiumExecutable();
  }

  // Ghostscript:
  //   - plain pdf  -> none (the /Creator stamp now uses pdf-lib, in-process)
  //   - pdfx       -> CMYK conversion, REQUIRED
  if (format === "pdfx" && !(await isToolAvailable("gs"))) {
    missing.push({ name: "gs (Ghostscript)", installHint: INSTALL_HINTS.gs! });
  }

  // qpdf — only when pdfx with stripAnnotations enabled (default true).
  if (format === "pdfx") {
    const stripAnnotations = opts.stripAnnotations ?? config.pdfx.stripAnnotations;
    if (stripAnnotations && !(await isToolAvailable("qpdf"))) {
      missing.push({ name: "qpdf", installHint: INSTALL_HINTS.qpdf! });
    }
  }

  if (missing.length === 0) return;

  const list = missing
    .map((m) => `  • ${m.name}\n${m.installHint}`)
    .join("\n\n");
  throw new BuildError(
    `Required system tools not found:\n\n${list}\n\nInstall the missing tools and re-run, or set CHROMIUM_PATH / system PATH so print-md can find them. See the User Guide Chapter 8 (System Setup) at examples/print-md-user-guide/08-system-setup.md for the full per-feature matrix.`,
    2
  );
}

function computeGates(
  format: BuildFormat,
  opts: { skipLint?: boolean; skipPreValidate?: boolean; skipPostValidate?: boolean },
  config: { lint: { enabled: boolean }; validate: { enabled: boolean } }
): Gates {
  if (format === "html") {
    if (opts.skipLint || opts.skipPreValidate || opts.skipPostValidate) {
      log.info(
        "Validation/lint flags ignored for --format html (no validation phases apply)"
      );
    }
    return { lint: false, preValidate: false, postValidate: false };
  }

  const lint = !opts.skipLint && config.lint.enabled !== false;
  const preValidate = !opts.skipPreValidate && config.validate.enabled !== false;
  const postValidate =
    format === "pdfx" &&
    !opts.skipPostValidate &&
    config.validate.enabled !== false;

  return { lint, preValidate, postValidate };
}

const STATIC_MIME: Record<string, string> = {
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
 * Start a localhost static file server rooted at `dir`, serving `defaultFile`
 * for the `/` path. Returns the chosen port and a `close()` that resolves once
 * the server has shut down.
 *
 * Path-traversal protection: any request that resolves outside `dir` gets 403;
 * a missing file gets 404; `STATIC_MIME` maps the extension (falling back to
 * application/octet-stream). Shared by the static-HTML pagination pass and the
 * PDF render pass — both stage HTML + assets into a temp dir and need a real
 * HTTP origin so relative asset URLs resolve.
 */
function createStaticFileServer(
  dir: string,
  defaultFile: string
): Promise<{ port: number; close: () => Promise<void> }> {
  const root = path.resolve(dir);
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    // Both current callers navigate straight to `/${filename}`, so the `"/"`
    // → defaultFile branch is a convenience fallback (e.g. a future caller
    // hitting the bare origin); it is not exercised on the render path today.
    const relative =
      url.pathname === "/"
        ? defaultFile
        : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const filePath = path.resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(root + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const data = await fsp.readFile(filePath);
      const ct =
        STATIC_MIME[path.extname(filePath).toLowerCase()] ??
        "application/octet-stream";
      res.writeHead(200, { "Content-Type": ct });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const port = (server.address() as net.AddressInfo).port;
      resolve({
        port,
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}

/** Input handed to a PDF renderer: a URL serving the staged HTML + assets. */
export interface PdfRenderInput {
  /** URL of the staged HTML on a local HTTP server (assets resolve relative). */
  url: string;
  /** Absolute path the renderer must write the finished PDF to. */
  outPdf: string;
  /** Hard ceiling for navigation + pagination + PDF generation. */
  timeoutMs: number;
  /**
   * When set, after printing the PDF the renderer also serializes the
   * already-paginated DOM (the same DOM it just printed) and writes it to this
   * path as raw static HTML. Lets ONE pagination pass emit BOTH the PDF and the
   * static viewer HTML, so screen and PDF come from the same artifact. The
   * serialize is read-only and runs AFTER `page.pdf()`, so it cannot affect the
   * PDF. Optional; injected renderers that cannot serialize may ignore it.
   */
  captureStaticHtmlTo?: string;
}

/**
 * A PDF renderer drives a browser engine to load `url`, wait for fonts +
 * Paged.js (`window.__PAGED_RENDERED__ === true`), measure the first
 * `.pagedjs_page`, and write a borderless PDF at that exact page size to
 * `outPdf` with backgrounds printed.
 *
 * The default ({@link puppeteerPdfRenderer}) drives a system/bundled Chromium.
 * The Electron viewer injects one backed by its own `webContents.printToPDF`,
 * so the packaged app needs no external browser (ADR 0002, Phase 4).
 */
export type PdfRenderer = (input: PdfRenderInput) => Promise<void>;

/** Hard ceiling for navigation + pagination + PDF generation. Large books need
 *  this budget; it is also the puppeteer protocolTimeout for the pooled browser. */
const RENDER_TIMEOUT_MS = 60 * 60 * 1000;

/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Drive a puppeteer `page` to fully paginate the document at `url`: set the
 * viewport + timeouts, navigate (waiting for network idle so vendored assets +
 * the polyfill load), wait for web fonts, then block until Paged.js signals
 * `window.__PAGED_RENDERED__ === true` (best-effort — falls through on timeout
 * exactly as the original callers did).
 *
 * Shared navigate+wait sequence for BOTH render paths. Callers keep their own
 * tails: the PDF path calls `page.pdf()`; the static-HTML path serializes the
 * DOM. Per-caller knobs (viewport, timeout) are passed in so behavior is never
 * silently changed.
 */
async function paginateAndCapture(
  // puppeteer-core Page; typed `any` to avoid a top-level value import of the
  // heavy lazy-loaded dep (the lib only imports puppeteer-core dynamically).
  page: any,
  url: string,
  timeoutMs: number,
  viewport: { width: number; height: number } = { width: 1920, height: 1080 }
): Promise<void> {
  await page.setViewport(viewport);
  page.setDefaultNavigationTimeout(timeoutMs);
  page.setDefaultTimeout(timeoutMs);

  await page.goto(url, { waitUntil: "networkidle0" });

  await page.evaluate(() => (globalThis as any).document.fonts.ready);

  await page
    .waitForFunction(() => (globalThis as any).__PAGED_RENDERED__ === true, {
      timeout: timeoutMs,
    })
    .catch(() => {});
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Default renderer: system Chromium via puppeteer-core (pooled + pre-warmable). */
const puppeteerPdfRenderer: PdfRenderer = async ({
  url,
  outPdf,
  timeoutMs,
  captureStaticHtmlTo,
}) => {
  // Reuse the pre-warmed pooled browser; open a fresh page and close the PAGE
  // (not the browser) so the browser stays warm for the next render.
  const browser = await getBrowser(timeoutMs);
  const page = await browser.newPage();
  try {
    await paginateAndCapture(page, url, timeoutMs);

    /* eslint-disable @typescript-eslint/no-explicit-any */
    const pagedInfo = await page.evaluate(() => {
      const g = globalThis as any;
      const pages = g.document.querySelectorAll(".pagedjs_page");
      const el = pages[0] ?? null;
      const s = el ? g.getComputedStyle(el) : null;
      return {
        pageCount: pages.length as number,
        width: s?.width as string | undefined,
        height: s?.height as string | undefined,
      };
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    log.info(
      `Paged.js rendered ${pagedInfo.pageCount} pages (${pagedInfo.width} × ${pagedInfo.height})`
    );

    await page.pdf({
      path: outPdf,
      printBackground: true,
      width: pagedInfo.width ?? "8.625in",
      height: pagedInfo.height ?? "11.25in",
      margin: { top: "0", right: "0", bottom: "0", left: "0" },
    });

    // Unification: serialize the SAME printed DOM to static HTML so the on-screen
    // viewer renders the identical artifact the PDF was printed from. Read-only,
    // after page.pdf() — does not perturb the PDF.
    if (captureStaticHtmlTo) {
      /* eslint-disable @typescript-eslint/no-explicit-any */
      const staticHtml = await page.evaluate(
        () =>
          "<!DOCTYPE html>\n" +
          (globalThis as any).document.documentElement.outerHTML
      );
      /* eslint-enable @typescript-eslint/no-explicit-any */
      await fsp.writeFile(captureStaticHtmlTo, staticHtml, "utf-8");
    }
  } finally {
    await page.close();
  }
};

/**
 * Build-time pagination (SSG model): drive headless Chromium to fully paginate
 * the staged HTML with Paged.js, then serialize the resulting already-fragmented
 * DOM to a static HTML string. Paged.js's polisher injects its layout CSS as
 * `<style>` elements INTO the DOM, so the serialized markup carries everything
 * needed to render the pages with NO runtime pagination engine.
 *
 * This is the same headless engine the PDF path uses — the only difference is we
 * capture `document.documentElement.outerHTML` instead of (or before) printing.
 */
export async function paginateToStaticHtml(stagedHtml: string): Promise<string> {
  const stageDir = path.dirname(path.resolve(stagedHtml));
  const htmlFilename = path.basename(stagedHtml);

  const server = await createStaticFileServer(stageDir, htmlFilename);

  try {
    // Reuse the pre-warmed pooled browser; open a fresh page, close the PAGE.
    const browser = await getBrowser(RENDER_TIMEOUT_MS);
    const page = await browser.newPage();
    try {
      await paginateAndCapture(
        page,
        `http://127.0.0.1:${server.port}/${htmlFilename}`,
        RENDER_TIMEOUT_MS
      );

      /* eslint-disable @typescript-eslint/no-explicit-any */
      const result = await page.evaluate(() => {
        const g = globalThis as any;
        const count = g.document.querySelectorAll(".pagedjs_page").length;
        return {
          count: count as number,
          html:
            "<!DOCTYPE html>\n" + g.document.documentElement.outerHTML,
        };
      });
      /* eslint-enable @typescript-eslint/no-explicit-any */
      log.info(
        `Paged.js paginated ${result.count} pages → serialized to static HTML`
      );
      return result.html;
    } finally {
      await page.close();
    }
  } finally {
    await server.close();
  }
}

/**
 * Remove the Paged.js pagination ENGINE from an already-paginated, serialized
 * document so the browser renders the static pages as-is and never re-paginates.
 * Strips (a) the polyfill `<script src>` and (b) the inline break-inside handler.
 * Navigation toolbar scripts are NOT touched — they only scroll between pages
 * that already exist, which is not DOM-pagination.
 */
export function stripPaginationRuntime(html: string): string {
  let out = html;
  // (a) Paged.js polyfill <script src=....paged.polyfill.js> (CDN or vendored).
  //     Match the polyfill FILENAME specifically — a bare "paged" substring also
  //     matches the navigation scripts (pagedjs-interface.js / pagedjs-bridge.js),
  //     which must survive.
  out = out.replace(
    /<script\b[^>]*\bsrc=["'][^"']*paged\.polyfill[^"']*["'][^>]*>\s*<\/script>/gi,
    ""
  );
  // (b) The inline BreakInsideAvoidHandler block (identified by its class name);
  //     it sets window.PagedConfig.* which is dead without the engine.
  out = out.replace(
    /<script\b(?![^>]*\bsrc=)[^>]*>(?:(?!<\/script>)[\s\S])*?BreakInsideAvoidHandler(?:(?!<\/script>)[\s\S])*?<\/script>/gi,
    ""
  );
  return out;
}

/**
 * Inject the navigation-only toolbar scripts (page nav, zoom, view modes) into
 * the static document head. These read the pre-rendered `.pagedjs_page`
 * elements; they do not paginate.
 */
export function injectNavigationScripts(html: string): string {
  const tags =
    '  <script src="preview/scripts/pagedjs-interface.js"></script>\n' +
    '  <script src="preview/scripts/pagedjs-bridge.js"></script>\n';
  if (/<\/head>/i.test(html)) return html.replace(/<\/head>/i, tags + "</head>");
  return tags + html;
}

/**
 * Turn a raw serialized paginated document into the shippable static viewer
 * `book.html`: copy the navigation toolbar scripts into outDir, strip the
 * pagination engine, wire the nav scripts, and write the file. Shared by the
 * HTML format and the PDF unification path.
 */
async function finalizeStaticBook(
  rawSerializedHtml: string,
  htmlFile: string,
  outDir: string
): Promise<void> {
  await fsp.mkdir(path.join(outDir, "preview/scripts"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("preview/scripts/pagedjs-interface.js"),
    path.join(outDir, "preview/scripts/pagedjs-interface.js")
  );
  await fsp.copyFile(
    await getAssetPath("preview/scripts/pagedjs-bridge.js"),
    path.join(outDir, "preview/scripts/pagedjs-bridge.js")
  );
  await fsp.writeFile(
    htmlFile,
    injectNavigationScripts(stripPaginationRuntime(rawSerializedHtml)),
    "utf-8"
  );
}

/**
 * Fallback for `--format html` when no headless browser is available: ship the
 * Paged.js polyfill + nav scripts so the BROWSER paginates at load time (the
 * pre-SSG behavior). Slower at runtime and not pre-paginated, but it works with
 * no Chromium at build. Mirrors the historic HTML output exactly.
 */
export async function shipRuntimePaginatedHtml(
  htmlFile: string,
  outDir: string
): Promise<void> {
  await fsp.mkdir(path.join(outDir, "vendor"), { recursive: true });
  await fsp.mkdir(path.join(outDir, "preview/scripts"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("vendor/paged.polyfill.js"),
    path.join(outDir, "vendor/paged.polyfill.js")
  );
  await fsp.copyFile(
    await getAssetPath("preview/scripts/pagedjs-interface.js"),
    path.join(outDir, "preview/scripts/pagedjs-interface.js")
  );
  await fsp.copyFile(
    await getAssetPath("preview/scripts/pagedjs-bridge.js"),
    path.join(outDir, "preview/scripts/pagedjs-bridge.js")
  );
  const bookSource = await fsp.readFile(htmlFile, "utf-8");
  const bookWithInterface = bookSource.replace(
    /<script[^>]*src="[^"]*pagedjs[^"]*"[^>]*><\/script>/i,
    '<script src="preview/scripts/pagedjs-interface.js"></script>\n  <script src="preview/scripts/pagedjs-bridge.js"></script>\n  <script src="vendor/paged.polyfill.js"></script>'
  );
  await fsp.writeFile(htmlFile, bookWithInterface, "utf-8");
}

export async function renderHtmlToPdf(
  inputHtml: string,
  outPdf: string,
  renderer: PdfRenderer = puppeteerPdfRenderer,
  captureStaticHtmlTo?: string
) {
  const stageDir = path.dirname(path.resolve(inputHtml));
  const htmlFilename = path.basename(inputHtml);

  const server = await createStaticFileServer(stageDir, htmlFilename);

  try {
    await renderer({
      url: `http://127.0.0.1:${server.port}/${htmlFilename}`,
      outPdf,
      timeoutMs: RENDER_TIMEOUT_MS,
      captureStaticHtmlTo,
    });
  } finally {
    await server.close();
  }
}

export async function runBuild(opts: BuildRunnerOptions): Promise<BuildRunnerResult> {
  const { format } = opts;
  const inputDir = path.resolve(opts.inputDir);

  // 1. Load manifest + resolve config
  const { manifest, manifestDir } = await loadManifestWithPath(
    opts.manifestPath ?? inputDir
  );

  const pdfxConfigOverride =
    format === "pdfx"
      ? {
          flavor: opts.pdfxFlavor,
          icc: opts.iccPath,
          stripAnnotations: opts.stripAnnotations,
        }
      : undefined;

  const config = resolveConfig(
    {
      title: opts.title,
      output: opts.outDir ? { dir: opts.outDir } : undefined,
      pdfx: pdfxConfigOverride,
    },
    manifest
  );

  const outDir = opts.outDir ?? path.resolve(config.output.dir);

  // 2. Compute lint/validate gates
  const gates = computeGates(format, opts, config);

  log.info(`Build (${format}): ${inputDir} -> ${outDir}`);
  await fsp.mkdir(outDir, { recursive: true });

  // 2.5. Pre-flight tool check.
  //
  // Without this we'd discover missing tools deep in the pipeline (30-90s in
  // for a real book) when ENOENT bubbles up from a child_process spawn. A 50ms
  // probe at the top gives an actionable error immediately. The stamp-PDF case
  // (gs for !pdfxMode) is best-effort downstream — we only WARN here so the
  // missing-gs user can still save a plain PDF.
  if (format !== "html") {
    await preflightBuildTools(format, opts, config);
  }

  // 2.6. Pre-warm the headless browser NOW (fire-and-forget) so the ~1–2s
  // Chromium cold start overlaps with lint + validation + markdown render +
  // asset staging below, instead of sitting on the critical path at pagination
  // time. Only when this build will actually paginate in Chromium: a PDF/PDFX
  // build with no injected renderer, or an HTML build with a browser available.
  const willPaginateInChromium =
    (format !== "html" && !opts.pdfRenderer) ||
    (format === "html" && !!(await resolveChromiumExecutable()));
  if (willPaginateInChromium) prewarmBrowser(RENDER_TIMEOUT_MS);

  // 3. Lint
  if (gates.lint) {
    log.info("Lint: CSS print-safety");
    const lintResult = await runLint({
      manifest: opts.manifestPath ?? inputDir,
    });
    if (!lintResult.ok) {
      throw new BuildError("CSS lint failed", 2);
    }
  }

  // 4. Pre-build validation
  if (gates.preValidate) {
    log.info("Pre-build validation");
    const result = await executeAndReport(
      {
        input: inputDir,
        phase: "pre-build",
        manifest: opts.manifestPath,
      },
      "text"
    );
    if (!result.ok) {
      throw new BuildError("Pre-build validation failed", 1);
    }
  }

  // 5. Markdown -> book.html
  if (config.source.files && config.source.files.length > 0) {
    log.info(`Using specified files (${config.source.files.length} total)`);
  } else {
    log.info("Using all .md files in alphabetical order");
  }

  let plugins;
  let pluginCss = "";
  if (config.plugins.length > 0) {
    log.info(`Loading ${config.plugins.length} plugin(s)...`);
    plugins = await loadPlugins(config.plugins, manifestDir);
    pluginCss = collectPluginCss(plugins);
    if (plugins.length > 0) {
      log.success(`Loaded ${plugins.length} plugin(s)`);
    }
  }

  const htmlFile = await renderChaptersToFile(inputDir, outDir, {
    title: config.title,
    styles: config.styles,
    files: config.source.files,
    plugins,
    pluginCss,
  });
  log.success(`Wrote ${htmlFile}`);

  // 6. Copy user assets
  const assetDirs = config.source.assets;
  if (assetDirs.length > 0) {
    log.info("Copying assets");
    await copyAssets(inputDir, outDir, assetDirs, {
      onCopy: (assetPath) => log.info(`  Copied ${assetPath}/`),
      onSkip: (assetPath, srcPath) =>
        log.warn(`  ${assetPath}/ not found at ${srcPath} (skipping)`),
      onCollision: ({ destName, fileName, winnerAsset, loserAsset }) =>
        log.warn(
          `  Asset collision: "${winnerAsset}/${fileName}" overwrites "${loserAsset}/${fileName}" ` +
            `(both flatten to ${destName}/${fileName}). Last entry wins — rename the file or reorder ` +
            `manifest assets if this is not intended.`
        ),
    });
  }

  // === HTML format =======================================================
  // Pre-paginate at BUILD time (static-site-generator model): run Paged.js once
  // in headless Chromium, serialize the fully-fragmented DOM, and ship that
  // static HTML so the browser renders pages with NO runtime pagination JS. This
  // inverts today's model (shipping the polyfill so the browser re-paginates on
  // every load). The navigation toolbar scripts are kept — they only scroll
  // between already-laid-out pages; they do not modify the DOM to render pages.
  if (format === "html") {
    const chromium = await resolveChromiumExecutable();
    if (!chromium) {
      // No headless browser at build → fall back to runtime pagination so the
      // build still succeeds (the browser paginates on load — pre-SSG behavior).
      log.warn(
        "Chromium not found — shipping runtime-paginated HTML (the browser will " +
          "paginate on load). Install Chromium or set CHROMIUM_PATH for " +
          "pre-paginated static output."
      );
      await shipRuntimePaginatedHtml(htmlFile, outDir);
    } else {
      // Stage a working copy for the build-time pagination pass (assets + polyfill).
      const htmlStage = path.resolve(".print-md-stage-html");
      await fsp.rm(htmlStage, { recursive: true, force: true });
      await fsp.mkdir(htmlStage, { recursive: true });
      const stagedBook = path.join(htmlStage, BOOK_HTML_FILENAME);
      await fsp.copyFile(htmlFile, stagedBook);
      if (assetDirs.length > 0) {
        const flattenedAssetDirs = Array.from(
          new Set(assetDirs.map(resolveAssetDestName))
        );
        await copyAssets(outDir, htmlStage, flattenedAssetDirs);
      }
      await fsp.mkdir(path.join(htmlStage, "vendor"), { recursive: true });
      await fsp.copyFile(
        await getAssetPath("vendor/paged.polyfill.js"),
        path.join(htmlStage, "vendor/paged.polyfill.js")
      );
      // Inject the break-inside handler + polyfill so pagination AND its cleanup
      // (ghost-card dedupe, orphan-page hide) run during the build pass.
      await patchHtmlForPagedjs(stagedBook, "./vendor/paged.polyfill.js");

      log.info("Pre-paginating HTML via Chromium + Paged.js (build-time)");
      const paginated = await paginateToStaticHtml(stagedBook);
      await finalizeStaticBook(paginated, htmlFile, outDir);
      await fsp.rm(htmlStage, { recursive: true, force: true });
    }

    // Write a minimal index.html that redirects to book.html so static hosts
    // (Azure SWA, GitHub Pages, etc.) have a default entry point. This is not
    // the viewer chrome — the Electron viewer loads book.html directly by name.
    const indexPath = path.join(outDir, "index.html");
    if (!fs.existsSync(indexPath)) {
      await fsp.writeFile(
        indexPath,
        `<!DOCTYPE html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=book.html"><title>print-md</title></head><body></body></html>\n`,
        "utf-8"
      );
    }

    const fingerprintPath = await writeBuildFingerprint({
      command: "build",
      outputDir: outDir,
      sourceDir: inputDir,
      args: opts.rawArgs,
      pdfx: {
        requestedFlavor: null,
        resolvedFlavor: config.pdfx.flavor,
        iccPath: null,
        stripAnnotations: null,
      },
    });
    log.success(`Wrote: ${path.join(outDir, "book.html")}`);
    log.info(`Fingerprint: ${fingerprintPath}`);
    // Close the pooled browser unless the caller (e.g. a preview server) wants
    // it kept warm for the next rebuild. No-op if nothing was launched.
    if (!opts.keepBrowserAlive) await closeBrowser();
    return {
      outDir,
      htmlPath: htmlFile,
      pdfPath: null,
      fingerprintPath,
    };
  }

  // === PDF / PDFX format =================================================
  const pdfxMode: PdfxFlavor | undefined =
    format === "pdfx" ? (opts.pdfxFlavor ?? config.pdfx.flavor) : undefined;

  const pdfFile = opts.pdfFileOverride ?? path.join(outDir, config.output.filename);

  // Stage build directory
  const stage = path.resolve(".print-md-stage");
  await fsp.rm(stage, { recursive: true, force: true });
  await fsp.mkdir(stage, { recursive: true });

  const stagedHtml = path.join(stage, BOOK_HTML_FILENAME);
  await fsp.copyFile(htmlFile, stagedHtml);

  if (assetDirs.length > 0) {
    const flattenedAssetDirs = Array.from(
      new Set(assetDirs.map(resolveAssetDestName))
    );
    await copyAssets(outDir, stage, flattenedAssetDirs);
  }

  // Vendor paged.js from embedded assets (works in compiled binary without node_modules)
  await fsp.mkdir(path.join(stage, "vendor"), { recursive: true });
  await fsp.copyFile(
    await getAssetPath("vendor/paged.polyfill.js"),
    path.join(stage, "vendor/paged.polyfill.js")
  );

  await patchHtmlForPagedjs(stagedHtml, "./vendor/paged.polyfill.js");

  const rawPdf = pdfxMode ? path.join(stage, "raw.pdf") : path.resolve(pdfFile);
  log.info("Rendering HTML to PDF via Chromium+Paged.js");
  await fsp.mkdir(path.dirname(path.resolve(pdfFile)), { recursive: true });
  // PDF unification: the default renderer prints the PDF and, from the SAME
  // pagination pass, serializes the static viewer book.html — so the on-screen
  // pages and the PDF come from one paginated artifact. The PDF call itself is
  // unchanged, so the PDF is pixel-identical to the pre-SSG pipeline. Injected
  // renderers (e.g. the Electron viewer) print only.
  const staticHtmlRaw = opts.pdfRenderer
    ? undefined
    : path.join(stage, "book-static-raw.html");
  await renderHtmlToPdf(stagedHtml, rawPdf, opts.pdfRenderer, staticHtmlRaw);
  if (staticHtmlRaw && fs.existsSync(staticHtmlRaw)) {
    await finalizeStaticBook(
      await fsp.readFile(staticHtmlRaw, "utf-8"),
      htmlFile,
      outDir
    );
    log.success(`Wrote static viewer: ${path.join(outDir, "book.html")}`);
  }

  if (!pdfxMode) {
    // stampCreator writes /Creator (print-md) into the PDF's Info dict using
    // pdf-lib (in-process, no system tool). The information is cosmetic — if it
    // fails for any reason, keep the raw Chromium output as the final PDF rather
    // than failing the build. `rawPdf` equals the final `pdfFile` when !pdfxMode.
    try {
      await stampCreator(rawPdf);
    } catch (err) {
      log.warn(
        `Skipping /Creator stamp: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  let effectiveIccPath: string | null = null;
  let shouldStripAnnotations: boolean | null = null;

  if (pdfxMode) {
    const icc = opts.iccPath ?? config.pdfx.icc;
    const iccCandidates = path.isAbsolute(icc)
      ? [icc]
      : [path.resolve(manifestDir, icc), path.resolve(icc)];
    effectiveIccPath = iccCandidates.find((candidate) => fs.existsSync(candidate)) ?? null;

    if (!effectiveIccPath && !opts.iccPath && path.basename(icc) === "CGATS21_CRPC1.icc") {
      effectiveIccPath = await getAssetPath("profiles/CGATS21_CRPC1.icc");
    }

    if (!effectiveIccPath) {
      throw new BuildError(
        `Missing ICC profile at ${icc}. Place the ICC profile or specify --icc <path>`,
        2
      );
    }

    const shouldStrip = opts.stripAnnotations ?? config.pdfx.stripAnnotations;
    shouldStripAnnotations = shouldStrip;
    if (shouldStrip) {
      log.info("Stripping annotations for PDF/X compliance");
      await stripAnnotations(rawPdf);
    }

    log.info(`Converting to CMYK PDF/X (${pdfxMode})`);
    await convertToPdfxCmyk(rawPdf, path.resolve(pdfFile), {
      iccPath: effectiveIccPath,
      pdfx: pdfxMode,
      title: config.title,
      maxTac: config.ink.maxTac,
    });
  }

  // 8. Post-build validation (pdfx only)
  if (gates.postValidate) {
    log.info("Post-build validation");
    const result = await executeAndReport(
      {
        pdf: pdfFile,
        phase: "post-build",
        manifest: opts.manifestPath,
      },
      "text"
    );
    if (!result.ok) {
      throw new BuildError("Post-build validation failed", 1);
    }
  }

  const fingerprintPath = await writeBuildFingerprint({
    command: "build",
    outputDir: outDir,
    sourceDir: inputDir,
    args: opts.rawArgs,
    pdfx: {
      requestedFlavor: pdfxMode ?? null,
      resolvedFlavor: config.pdfx.flavor,
      iccPath: effectiveIccPath,
      stripAnnotations: shouldStripAnnotations,
    },
  });

  log.success(`Wrote: ${pdfFile}`);
  log.info(`Fingerprint: ${fingerprintPath}`);

  // Close the pooled browser unless the caller wants it kept warm. No-op for the
  // injected-renderer (Electron) path, which never used the pool.
  if (!opts.keepBrowserAlive) await closeBrowser();

  return {
    outDir,
    htmlPath: htmlFile,
    pdfPath: pdfFile,
    fingerprintPath,
  };
}
