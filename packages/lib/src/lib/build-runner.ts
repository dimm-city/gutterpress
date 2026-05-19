import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { renderChaptersToFile } from "./markdown/index";
import { loadPlugins, collectPluginCss } from "./markdown/plugins";
import { copyAssets, resolveAssetDestName } from "./assets";
import { requireChromiumExecutable } from "./chromium";
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

async function renderHtmlToPdf(inputHtml: string, outPdf: string) {
  const executablePath = requireChromiumExecutable();
  const stageDir = path.dirname(path.resolve(inputHtml));
  const htmlFilename = path.basename(inputHtml);

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url!, "http://127.0.0.1");
    const relative =
      url.pathname === "/"
        ? htmlFilename
        : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
    const filePath = path.resolve(stageDir, relative);
    if (filePath !== stageDir && !filePath.startsWith(stageDir + path.sep)) {
      res.writeHead(403);
      res.end("Forbidden");
      return;
    }
    try {
      const data = await fsp.readFile(filePath);
      const ct = STATIC_MIME[path.extname(filePath).toLowerCase()] ?? "application/octet-stream";
      res.writeHead(200, { "Content-Type": ct });
      res.end(data);
    } catch {
      res.writeHead(404);
      res.end("Not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as net.AddressInfo).port;

  try {
    // Lazy-load puppeteer-core. It is the single biggest dep in the lib graph
    // (~13MB plus transitive parse cost) and is only needed for PDF generation.
    // Loading it here keeps preview-only paths — including the viewer's
    // startPreviewServer — fast on cold start.
    const puppeteer = (await import("puppeteer-core")).default;
    const browser = await puppeteer.launch({ headless: true, executablePath });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      // Large books (108+ pages, many fonts, heavy custom CSS) need a long
      // budget for both navigation (resource load) and pagination.
      // Allow up to 60 minutes for the full pipeline before giving up.
      const RENDER_TIMEOUT_MS = 60 * 60 * 1000;
      page.setDefaultNavigationTimeout(RENDER_TIMEOUT_MS);
      page.setDefaultTimeout(RENDER_TIMEOUT_MS);

      await page.goto(`http://127.0.0.1:${port}/${htmlFilename}`, {
        waitUntil: "networkidle0",
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      await page.evaluate(() => (globalThis as any).document.fonts.ready);

      await page
        .waitForFunction(
          () => (globalThis as any).__PAGED_RENDERED__ === true,
          { timeout: RENDER_TIMEOUT_MS }
        )
        .catch(() => {});

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
    } finally {
      await browser.close();
    }
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
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

  // 3. Lint
  if (gates.lint) {
    log.info("Lint: stylelint");
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
    });
  }

  // === HTML format: stop here ============================================
  if (format === "html") {
    // Vendor Paged.js + interface + bridge locally so the HTML output works offline.
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
  await renderHtmlToPdf(stagedHtml, rawPdf);

  if (!pdfxMode) {
    // stampCreator writes /Creator (print-md) into the PDF's DOCINFO via
    // Ghostscript. The information is cosmetic — losing it doesn't affect
    // print fitness or any downstream tooling. If `gs` isn't installed,
    // continue with the raw Chromium output as the final PDF rather than
    // failing the entire build. The user's PDF is already at `rawPdf`
    // (which equals the final `pdfFile` when !pdfxMode) before this call.
    try {
      await stampCreator(rawPdf);
    } catch (err) {
      const code = (err as { code?: string } | undefined)?.code;
      if (code === "ENOENT") {
        log.warn(
          "Ghostscript (gs) not found — PDF saved without /Creator metadata. " +
          "Install Ghostscript (https://www.ghostscript.com/, brew install ghostscript, apt install ghostscript) to silence this warning."
        );
      } else {
        log.warn(
          `Skipping /Creator stamp: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  let effectiveIccPath: string | null = null;
  let shouldStripAnnotations: boolean | null = null;

  if (pdfxMode) {
    const icc = opts.iccPath ?? config.pdfx.icc;
    effectiveIccPath = path.resolve(icc);

    if (!fs.existsSync(icc)) {
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
      iccPath: path.resolve(icc),
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

  return {
    outDir,
    htmlPath: htmlFile,
    pdfPath: pdfFile,
    fingerprintPath,
  };
}
