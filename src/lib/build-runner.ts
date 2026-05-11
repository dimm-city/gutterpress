import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import puppeteer from "puppeteer-core";
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
import { emitViewer, BOOK_HTML_FILENAME } from "./viewer";
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

async function renderHtmlToPdf(inputHtml: string, outPdf: string) {
  const executablePath = requireChromiumExecutable();
  const stageDir = path.dirname(path.resolve(inputHtml));
  const htmlFilename = path.basename(inputHtml);

  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    async fetch(req) {
      const url = new URL(req.url);
      // Strip leading slashes so url.pathname doesn't escape stageDir,
      // then enforce the resolved path stays inside it (block ../ traversal).
      const relative =
        url.pathname === "/"
          ? htmlFilename
          : decodeURIComponent(url.pathname.replace(/^\/+/, ""));
      const filePath = path.resolve(stageDir, relative);
      if (filePath !== stageDir && !filePath.startsWith(stageDir + path.sep)) {
        return new Response("Forbidden", { status: 403 });
      }
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Not found", { status: 404 });
    },
  });
  const port = server.port;

  try {
    const browser = await puppeteer.launch({ headless: true, executablePath });
    try {
      const page = await browser.newPage();
      await page.setViewport({ width: 1920, height: 1080 });

      await page.goto(`http://127.0.0.1:${port}/${htmlFilename}`, {
        waitUntil: "networkidle0",
      });

      /* eslint-disable @typescript-eslint/no-explicit-any */
      await page.evaluate(() => (globalThis as any).document.fonts.ready);

      await page
        .waitForFunction(
          () => (globalThis as any).__PAGED_RENDERED__ === true,
          { timeout: 180_000 }
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
    server.stop();
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

  // 7. Emit viewer chrome
  await emitViewer(outDir);
  log.info(`Emitted viewer chrome (${path.join(outDir, "index.html")})`);

  // === HTML format: stop here ============================================
  if (format === "html") {
    // Inject pagedjs-interface.js so the viewer toolbar can communicate with
    // the iframe (sets window.previewAPI and dispatches renderingComplete).
    // Must run after emitViewer so preview/scripts/pagedjs-interface.js exists.
    const bookSource = await fsp.readFile(htmlFile, "utf-8");
    const bookWithInterface = bookSource.replace(
      '<script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>',
      '<script src="preview/scripts/pagedjs-interface.js"></script>\n  <script src="https://unpkg.com/pagedjs/dist/paged.polyfill.js"></script>'
    );
    await fsp.writeFile(htmlFile, bookWithInterface, "utf-8");

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
    log.success(`Wrote: ${path.join(outDir, "index.html")}`);
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

  // Vendor paged.js
  const pagedSrc = path.resolve("node_modules/pagedjs/dist/paged.polyfill.js");
  if (!fs.existsSync(pagedSrc)) {
    throw new BuildError(
      "pagedjs not installed. Run: bun install",
      2
    );
  }
  await fsp.mkdir(path.join(stage, "vendor"), { recursive: true });
  await fsp.copyFile(pagedSrc, path.join(stage, "vendor/paged.polyfill.js"));

  await patchHtmlForPagedjs(stagedHtml, "./vendor/paged.polyfill.js");

  const rawPdf = pdfxMode ? path.join(stage, "raw.pdf") : path.resolve(pdfFile);
  log.info("Rendering HTML to PDF via Chromium+Paged.js");
  await fsp.mkdir(path.dirname(path.resolve(pdfFile)), { recursive: true });
  await renderHtmlToPdf(stagedHtml, rawPdf);

  if (!pdfxMode) {
    await stampCreator(rawPdf);
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
