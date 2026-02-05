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
    const page = await browser.newPage();

    await page.goto(`http://localhost:${port}/${htmlFilename}`, {
      waitUntil: "networkidle",
    });

    await page
      .waitForFunction(
        () => (window as any).__PAGED_RENDERED__ === true,
        { timeout: 180_000 }
      )
      .catch(() => {});

    await page.pdf({
      path: outPdf,
      printBackground: true,
      preferCSSPageSize: true,
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

    // If --pdfx is specified, run full Ghostscript CMYK pipeline
    if (pdfxMode) {
      const icc = args.icc ?? config.pdfx.icc;

      if (!fs.existsSync(icc)) {
        log.error(`Missing ICC profile at ${icc}`);
        log.error("Place the ICC profile or specify --icc path");
        process.exit(2);
      }

      // Strip Chromium-generated link annotations (not permitted in PDF/X)
      const shouldStrip = args["strip-annotations"] ?? config.pdfx.stripAnnotations;
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

    log.success(`Wrote: ${out}`);
    if (pdfxMode) {
      log.info(`Next: print-md validate --pdf ${out}`);
    }
  },
});
