import { defineCommand } from "citty";
import path from "node:path";
import fs from "node:fs";
import { startPreviewServer } from "../server";
import {
  runBuild,
  splitOutPath,
  BuildError,
  type BuildFormat,
  type PdfxFlavor,
} from "../lib/build-runner";
import { openPath } from "../lib/open-path";
import { log } from "../lib/logger";

function parseFormat(raw: unknown): BuildFormat {
  if (raw === undefined || raw === "") return "html";
  if (raw === "html" || raw === "pdf" || raw === "pdfx") return raw;
  log.error(
    `Invalid --format value: "${raw}". Expected "html", "pdf", or "pdfx".`
  );
  process.exit(2);
}

function parsePdfxFlavor(
  raw: unknown,
  format: BuildFormat
): PdfxFlavor | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (format !== "pdfx") {
    log.error(
      `--pdfx-flavor is only valid with --format pdfx (got --format ${format}).`
    );
    process.exit(2);
  }
  if (raw === "x1a" || raw === "x3") return raw;
  log.error(
    `Invalid --pdfx-flavor value: "${raw}". Expected "x1a" or "x3".`
  );
  process.exit(2);
}

export default defineCommand({
  meta: {
    name: "preview",
    description:
      "Live HTML preview with HMR (default), or one-shot build + open for --format pdf|pdfx",
  },
  args: {
    input: {
      type: "positional",
      description: "Input markdown directory (defaults to current directory)",
      required: false,
    },
    format: {
      type: "string",
      description: "Output format: html (default, live HMR) | pdf | pdfx",
    },
    port: {
      type: "string",
      description: "Port number (default: 3579, html only)",
    },
    host: {
      type: "string",
      description:
        "Bind host (default: 127.0.0.1). Pass 0.0.0.0 to expose on the LAN.",
    },
    "no-watch": {
      type: "boolean",
      description: "Disable file watching (html only)",
    },
    open: {
      type: "string",
      description: "Automatically open browser/viewer (default: true)",
    },
    verbose: {
      type: "boolean",
      description: "Enable verbose output",
    },
    debug: {
      type: "boolean",
      description: "Debug mode (preserve temporary files)",
    },
    // Build passthrough (only used for format=pdf|pdfx)
    out: {
      type: "string",
      description: "Output directory (pdf|pdfx only)",
    },
    "pdfx-flavor": {
      type: "string",
      description: "PDF/X flavor (x1a or x3); only with --format pdfx",
    },
    icc: {
      type: "string",
      description: "Path to ICC profile (required for --format pdfx)",
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
    "strip-annotations": {
      type: "boolean",
      description: "Strip PDF annotations for PDF/X compliance (pdfx only)",
    },
    "skip-lint": {
      type: "boolean",
      description: "Skip CSS linting (pdf|pdfx only)",
    },
    "skip-pre-validate": {
      type: "boolean",
      description: "Skip pre-build validation (pdf|pdfx only)",
    },
    "skip-post-validate": {
      type: "boolean",
      description: "Skip post-build PDF/X validation (pdfx only)",
    },
  },
  async run({ args }) {
    // For html (live preview), input is optional: no path → the server boots
    // empty and the viewer opens its folder picker so the user can choose one.
    // For pdf|pdfx, a directory is required (there's nothing to build without
    // source markdown).
    const inputPath = args.input
      ? path.resolve(args.input as string)
      : undefined;

    if (inputPath !== undefined) {
      if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isDirectory()) {
        log.error(`Input directory does not exist: ${inputPath}`);
        process.exit(1);
      }
    }

    const format = parseFormat(args.format);
    const openFlag = args.open !== "false";

    if (format === "html") {
      const port = Number(args.port) || 3579;
      const host = (args.host as string | undefined) || "127.0.0.1";
      await startPreviewServer({
        input: inputPath,
        port,
        host,
        noWatch: !!args["no-watch"],
        verbose: !!args.verbose,
        openBrowser: openFlag,
        debug: !!args.debug,
      });
      return;
    }

    // pdf | pdfx: one-shot build, then open the artifact. Requires a source dir.
    if (inputPath === undefined) {
      log.error(
        `--format ${format} requires an input directory. Pass a path: print-md preview <dir> --format ${format}`
      );
      process.exit(2);
    }

    const pdfxFlavor = parsePdfxFlavor(args["pdfx-flavor"], format);
    const { outDir, pdfFileOverride } = splitOutPath(
      typeof args.out === "string" ? args.out : undefined,
      format
    );

    try {
      const result = await runBuild({
        inputDir: inputPath,
        format,
        outDir,
        pdfFileOverride,
        pdfxFlavor,
        iccPath: typeof args.icc === "string" ? args.icc : undefined,
        manifestPath:
          typeof args.manifest === "string" ? args.manifest : undefined,
        stripAnnotations:
          typeof args["strip-annotations"] === "boolean"
            ? args["strip-annotations"]
            : undefined,
        skipLint: !!args["skip-lint"],
        skipPreValidate: !!args["skip-pre-validate"],
        skipPostValidate: !!args["skip-post-validate"],
        rawArgs: args as Record<string, unknown>,
      });

      if (openFlag && result.pdfPath) {
        log.info(`Opening ${result.pdfPath}`);
        await openPath(result.pdfPath);
      }
    } catch (error) {
      if (error instanceof BuildError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }
  },
});
