import { defineCommand } from "citty";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { chromium } from "playwright";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { copyDir } from "../lib/exec";
import { copyAssets, DEFAULT_ASSETS } from "../lib/assets";
import { resolveChromiumExecutable } from "../lib/chromium";
import { patchHtmlForPagedjs } from "../lib/pagedjs";
import { convertToPdfxCmyk, stripAnnotations } from "../lib/ghostscript";
import { writeBuildFingerprint } from "../lib/build-fingerprint";
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

    // Ensure all web fonts are fully loaded before Paged.js paginates
    await page.evaluate(() => document.fonts.ready);

    await page
      .waitForFunction(
        () => (window as any).__PAGED_RENDERED__ === true,
        { timeout: 180_000 }
      )
      .catch(() => {});

    // Log Paged.js page count for diagnostics
    const pagedInfo = await page.evaluate(() => {
      const pages = document.querySelectorAll('.pagedjs_page');
      const el = pages[0] as HTMLElement | null;
      const s = el ? getComputedStyle(el) : null;
      return {
        pageCount: pages.length,
        width: s?.width,
        height: s?.height,
      };
    });
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
    description: "Build HTML into PDF via Chromium+Paged.js (optionally PDF/X with --pdfx)",
  },
  args: {
    input: {
      type: "string",
      description: "Path to the source HTML file",
      required: true,
    },
    out: {
      type: "string",
      description: "Output PDF path",
      required: true,
    },
    pdfx: {
      type: "string",
      description: "PDF/X flavor (x1a or x3). Omit for plain Chromium PDF.",
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
    const manifest = await loadManifest(args.manifest);
    const config = resolveConfig(
      {
        pdfx: {
          flavor: (args.pdfx as "x1a" | "x3") ?? undefined,
          icc: args.icc ?? undefined,
          stripAnnotations: args["strip-annotations"] ?? undefined,
        },
      },
      manifest
    );

    const input = args.input!;
    const out = args.out!;
    const pdfxMode = args.pdfx as "x1a" | "x3" | undefined;

    // Stage build directory (use unique name to avoid conflicting with output under .build/)
    const stage = path.resolve(".print-md-stage");
    await fsp.rm(stage, { recursive: true, force: true });
    await fsp.mkdir(stage, { recursive: true });

    const inputHtml = path.resolve(input);
    const inputRoot = path.dirname(inputHtml);
    const htmlFilename = path.basename(inputHtml);

    await fsp.copyFile(inputHtml, path.join(stage, htmlFilename));
    // Copy assets from manifest (with fallback to default dirs)
    const assetDirs = config.source?.assets ?? DEFAULT_ASSETS;
    await copyAssets(inputRoot, stage, assetDirs);

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

    await patchHtmlForPagedjs(
      path.join(stage, htmlFilename),
      "./vendor/paged.polyfill.js"
    );

    // Render HTML to PDF via Chromium
    const rawPdf = pdfxMode ? path.join(stage, "raw.pdf") : path.resolve(out);
    log.info("Rendering HTML to PDF via Chromium+Paged.js");
    await fsp.mkdir(path.dirname(path.resolve(out)), { recursive: true });
    await renderHtmlToPdf(path.join(stage, htmlFilename), rawPdf);

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
      await convertToPdfxCmyk(rawPdf, path.resolve(out), {
        iccPath: path.resolve(icc),
        pdfx: pdfxMode,
        title: config.title,
        maxTac: config.ink.maxTac,
      });
    }

    const fingerprintPath = await writeBuildFingerprint({
      command: "build",
      outputDir: path.dirname(path.resolve(out)),
      sourceDir: path.dirname(path.resolve(input)),
      args,
      pdfx: {
        requestedFlavor: pdfxMode ?? null,
        resolvedFlavor: config.pdfx.flavor,
        iccPath: effectiveIccPath,
        stripAnnotations: shouldStripAnnotations,
      },
    });

    log.success(`Wrote: ${out}`);
    log.info(`Fingerprint: ${fingerprintPath}`);
    if (pdfxMode) {
      log.info(`Next: print-md validate --pdf ${out}`);
    }
  },
});
