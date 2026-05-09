import { defineCommand } from "citty";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { chromium } from "playwright";
import { loadManifestWithPath, resolveConfig } from "../lib/manifest";
import { renderChaptersToFile } from "../lib/markdown/index";
import { loadPlugins, collectPluginCss } from "../lib/markdown/plugins";
import { copyAssets, resolveAssetDestName } from "../lib/assets";
import { resolveChromiumExecutable } from "../lib/chromium";
import { patchHtmlForPagedjs } from "../lib/pagedjs";
import {
  convertToPdfxCmyk,
  stampCreator,
  stripAnnotations,
} from "../lib/ghostscript";
import { writeBuildFingerprint } from "../lib/build-fingerprint";
import { emitViewer, BOOK_HTML_FILENAME } from "../lib/viewer";
import { log } from "../lib/logger";

async function renderHtmlToPdf(inputHtml: string, outPdf: string) {
  const executablePath = resolveChromiumExecutable();
  const stageDir = path.dirname(path.resolve(inputHtml));
  const port = 9222 + Math.floor(Math.random() * 1000);
  const htmlFilename = path.basename(inputHtml);

  const server = Bun.serve({
    port,
    async fetch(req) {
      const url = new URL(req.url);
      const filePath = path.join(
        stageDir,
        url.pathname === "/" ? htmlFilename : url.pathname
      );
      const file = Bun.file(filePath);
      if (await file.exists()) {
        return new Response(file);
      }
      return new Response("Not found", { status: 404 });
    },
  });

  try {
    const browser = await chromium.launch({ headless: true, executablePath });
    const page = await browser.newPage({
      // Match a wide viewport so Paged.js has room for spread layout
      viewport: { width: 1920, height: 1080 },
    });

    await page.goto(`http://localhost:${port}/${htmlFilename}`, {
      waitUntil: "networkidle",
    });

    // Ensure all web fonts are fully loaded before Paged.js paginates.
    // The callbacks below execute in the Chromium page context, not Node,
    // so DOM globals (document/window/getComputedStyle) are available there
    // even though the Node tsconfig doesn't include the DOM lib.
    /* eslint-disable @typescript-eslint/no-explicit-any */
    await page.evaluate(() => (globalThis as any).document.fonts.ready);

    await page
      .waitForFunction(
        () => (globalThis as any).__PAGED_RENDERED__ === true,
        { timeout: 180_000 }
      )
      .catch(() => {});

    // Log Paged.js page count for diagnostics
    const pagedInfo = await page.evaluate(() => {
      const g = globalThis as any;
      const pages = g.document.querySelectorAll('.pagedjs_page');
      const el = pages[0] ?? null;
      const s = el ? g.getComputedStyle(el) : null;
      return {
        pageCount: pages.length as number,
        width: s?.width as string | undefined,
        height: s?.height as string | undefined,
      };
    });
    /* eslint-enable @typescript-eslint/no-explicit-any */
    log.info(`Paged.js rendered ${pagedInfo.pageCount} pages (${pagedInfo.width} × ${pagedInfo.height})`);

    // Paged.js already handles @page size and margins internally — each
    // .pagedjs_page div is the full page size with content positioned inside
    // the margin area.  Using preferCSSPageSize would re-apply the @page
    // margins, shrinking the PDF content area and causing page-count drift.
    // Set explicit dimensions matching @page size with zero margins so each
    // Paged.js page maps 1:1 to a PDF page.
    await page.pdf({
      path: outPdf,
      printBackground: true,
      width: pagedInfo.width ?? '8.625in',
      height: pagedInfo.height ?? '11.25in',
      margin: { top: '0', right: '0', bottom: '0', left: '0' },
    });

    await browser.close();
  } finally {
    server.stop();
  }
}

export default defineCommand({
  meta: {
    name: "build",
    description:
      "Build the book to HTML (static-site viewer) or PDF. Use --format to select. Default: pdf.",
  },
  args: {
    input: {
      type: "positional",
      description: "Input directory containing markdown files (default: cwd)",
      required: false,
    },
    format: {
      type: "string",
      description: "Output format: html or pdf (default: pdf)",
    },
    out: {
      type: "string",
      description:
        "Output directory. For --format pdf, --out may also be a .pdf file path.",
    },
    title: {
      type: "string",
      description: "Document title (overrides manifest)",
    },
    pdfx: {
      type: "string",
      description: "PDF/X flavor (x1a or x3). --format pdf only.",
    },
    icc: {
      type: "string",
      description: "Path to ICC profile (required for --pdfx)",
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
    "strip-annotations": {
      type: "boolean",
      description:
        "Strip PDF annotations for PDF/X compliance (default: true when --pdfx is set)",
    },
  },
  async run({ args }) {
    // Validate --format explicitly so a typo (e.g. `--format html5`) fails
    // loud instead of silently falling back to `pdf` and surprising the user.
    const formatArg = args.format;
    let format: "html" | "pdf";
    if (formatArg === undefined || formatArg === "") {
      format = "pdf";
    } else if (formatArg === "html" || formatArg === "pdf") {
      format = formatArg;
    } else {
      log.error(
        `Invalid --format value: "${formatArg}". Expected "html" or "pdf".`
      );
      process.exit(2);
    }

    const { manifest, manifestDir } = await loadManifestWithPath(
      args.manifest ?? args.input
    );

    // Resolve --out: for pdf format, the legacy form `--out path/book.pdf`
    // is still accepted (back-compat with run.ts callers and external scripts).
    // We split it into outDir + pdfFileOverride. For html format, --out is
    // always a directory.
    let outDirArg: string | undefined;
    let pdfFileOverride: string | null = null;
    if (typeof args.out === "string" && args.out.length > 0) {
      const resolved = path.resolve(args.out);
      if (format === "pdf" && resolved.toLowerCase().endsWith(".pdf")) {
        outDirArg = path.dirname(resolved);
        pdfFileOverride = resolved;
      } else {
        outDirArg = resolved;
      }
    }

    const config = resolveConfig(
      {
        title: typeof args.title === "string" ? args.title : undefined,
        output: outDirArg ? { dir: outDirArg } : undefined,
        pdfx: {
          flavor: (args.pdfx as "x1a" | "x3") ?? undefined,
          icc: args.icc ?? undefined,
          stripAnnotations: args["strip-annotations"] ?? undefined,
        },
      },
      manifest
    );

    const inputDir = path.resolve(args.input ?? ".");
    const outDir = outDirArg ?? path.resolve(config.output.dir);

    log.info(`Build (${format}): ${inputDir} -> ${outDir}`);
    await fsp.mkdir(outDir, { recursive: true });

    // 1. Markdown → book.html
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

    // 2. Copy user assets (css, fonts, images, etc.) into outDir.
    //    Use a single resolved list for both this step and the PDF staging
    //    copy below so they stay consistent. If the manifest explicitly
    //    sets `source.assets: []` we honor that and skip the copy entirely
    //    rather than falling back to DEFAULT_ASSETS.
    const assetDirs = config.source.assets;
    if (assetDirs.length > 0) {
      log.info("Copying assets");
      await copyAssets(inputDir, outDir, assetDirs, {
        onCopy: (assetPath) => log.info(`  Copied ${assetPath}/`),
        onSkip: (assetPath, srcPath) =>
          log.warn(`  ${assetPath}/ not found at ${srcPath} (skipping)`),
      });
    }

    // 3. Always emit the print-md viewer chrome alongside the book HTML.
    //    Result: every output dir is a self-hostable static site whose
    //    landing page (index.html) is the same UI shown by `print-md preview`.
    await emitViewer(outDir);
    log.info(`Emitted viewer chrome (${path.join(outDir, "index.html")})`);

    if (format === "html") {
      const fingerprintPath = await writeBuildFingerprint({
        command: "build",
        outputDir: outDir,
        sourceDir: inputDir,
        args,
        pdfx: {
          requestedFlavor: null,
          resolvedFlavor: config.pdfx.flavor,
          iccPath: null,
          stripAnnotations: null,
        },
      });
      log.success(`Wrote: ${path.join(outDir, "index.html")}`);
      log.info(`Fingerprint: ${fingerprintPath}`);
      return;
    }

    // === format === "pdf" =============================================
    const pdfxMode =
      typeof args.pdfx === "string"
        ? (args.pdfx as "x1a" | "x3")
        : args.pdfx
          ? config.pdfx.flavor
          : undefined;

    const pdfFile = pdfFileOverride ?? path.join(outDir, config.output.filename);

    // Stage build directory (use unique name to avoid conflicting with output under .build/)
    const stage = path.resolve(".print-md-stage");
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(stage, { recursive: true });

    const stagedHtml = path.join(stage, BOOK_HTML_FILENAME);
    await fsp.copyFile(htmlFile, stagedHtml);

    // Re-stage assets next to the book HTML so its relative paths resolve
    // when Chromium navigates the staged file. Source from outDir (where
    // step 2 just placed them with already-flattened destination names).
    // Same resolved list as step 2 — if the manifest says `assets: []` we
    // copy nothing here either. No silent DEFAULT_ASSETS fallback that
    // would mismatch what's actually in outDir.
    if (assetDirs.length > 0) {
      const flattenedAssetDirs = Array.from(
        new Set(assetDirs.map(resolveAssetDestName))
      );
      await copyAssets(outDir, stage, flattenedAssetDirs);
    }

    // Vendor paged.js
    const pagedSrc = path.resolve(
      "node_modules/pagedjs/dist/paged.polyfill.js"
    );
    if (!fs.existsSync(pagedSrc)) {
      log.error("pagedjs not installed. Run: bun install");
      process.exit(2);
    }
    await fsp.mkdir(path.join(stage, "vendor"), { recursive: true });
    await fsp.copyFile(
      pagedSrc,
      path.join(stage, "vendor/paged.polyfill.js")
    );

    await patchHtmlForPagedjs(stagedHtml, "./vendor/paged.polyfill.js");

    // Render HTML to PDF via Chromium
    const rawPdf = pdfxMode ? path.join(stage, "raw.pdf") : path.resolve(pdfFile);
    log.info("Rendering HTML to PDF via Chromium+Paged.js");
    await fsp.mkdir(path.dirname(path.resolve(pdfFile)), { recursive: true });
    await renderHtmlToPdf(stagedHtml, rawPdf);

    // Stamp Creator metadata on the plain Chromium PDF (PDF/X path sets it via pdfmark)
    if (!pdfxMode) {
      await stampCreator(rawPdf);
    }

    let effectiveIccPath: string | null = null;
    let shouldStripAnnotations: boolean | null = null;

    // If --pdfx is specified, run full Ghostscript CMYK pipeline
    if (pdfxMode) {
      const icc = args.icc ?? config.pdfx.icc;
      effectiveIccPath = path.resolve(icc);

      if (!fs.existsSync(icc)) {
        log.error(`Missing ICC profile at ${icc}`);
        log.error("Place the ICC profile or specify --icc path");
        process.exit(2);
      }

      // Strip Chromium-generated link annotations (not permitted in PDF/X)
      const shouldStrip = args["strip-annotations"] ?? config.pdfx.stripAnnotations;
      shouldStripAnnotations = shouldStrip;
      if (shouldStrip) {
        log.info("Stripping annotations for PDF/X compliance");
        await stripAnnotations(rawPdf);
      }

      // Convert to CMYK + PDF/X
      log.info(`Converting to CMYK PDF/X (${pdfxMode})`);
      await convertToPdfxCmyk(rawPdf, path.resolve(pdfFile), {
        iccPath: path.resolve(icc),
        pdfx: pdfxMode,
        title: config.title,
        maxTac: config.ink.maxTac,
      });
    }

    const fingerprintPath = await writeBuildFingerprint({
      command: "build",
      outputDir: outDir,
      sourceDir: inputDir,
      args,
      pdfx: {
        requestedFlavor: pdfxMode ?? null,
        resolvedFlavor: config.pdfx.flavor,
        iccPath: effectiveIccPath,
        stripAnnotations: shouldStripAnnotations,
      },
    });

    log.success(`Wrote: ${pdfFile}`);
    log.info(`Fingerprint: ${fingerprintPath}`);
    if (pdfxMode) {
      log.info(`Next: print-md validate --pdf ${pdfFile}`);
    }
  },
});
