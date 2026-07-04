import { defineCommand } from "citty";
import path from "node:path";
import fs from "node:fs";
import {
  log,
  startPreviewServer,
  runBuild,
  splitOutPath,
  BuildError,
  openPath,
} from "../index.ts";
import {
  parseFormat,
  parsePdfxFlavor,
  resolvePort,
  UsageError,
} from "../lib/cli-args.ts";

// Re-exported so existing importers (and preview.test.ts) can keep resolving it
// from this command module.
export { resolvePort };

export default defineCommand({
  meta: { name: "preview", description: "Live HTML preview with HMR (default), or one-shot build + open for --format pdf|pdfx" },
  args: {
    input: { type: "positional", description: "Input markdown directory (defaults to current directory)", required: false },
    format: { type: "string", description: "Output format: html (default, live HMR) | pdf | pdfx" },
    port: { type: "string", description: "Port number (default: 3579, html only)" },
    host: { type: "string", description: "Bind host (default: 127.0.0.1). Pass 0.0.0.0 to expose on the LAN." },
    "no-watch": { type: "boolean", description: "Disable file watching (html only)" },
    open: { type: "string", description: "Automatically open browser/viewer (default: true)" },
    verbose: { type: "boolean", description: "Enable verbose output" },
    debug: { type: "boolean", description: "Debug mode (preserve temporary files)" },
    out: { type: "string", description: "Output directory (pdf|pdfx only)" },
    "pdfx-flavor": { type: "string", description: "PDF/X flavor (x1a or x3); only with --format pdfx" },
    icc: { type: "string", description: "Path to ICC profile (required for --format pdfx)" },
    manifest: { type: "string", description: "Path to manifest.yaml" },
    "strip-annotations": { type: "boolean", description: "Strip PDF annotations for PDF/X compliance (pdfx only)" },
    "skip-lint": { type: "boolean", description: "Skip CSS linting (pdf|pdfx only)" },
    "skip-pre-validate": { type: "boolean", description: "Skip pre-build validation (pdf|pdfx only)" },
    "skip-post-validate": { type: "boolean", description: "Skip post-build PDF/X validation (pdfx only)" },
  },
  async run({ args }) {
    const inputPath = args.input ? path.resolve(args.input as string) : undefined;

    if (inputPath !== undefined) {
      if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isDirectory()) {
        log.error(`Input directory does not exist: ${inputPath}`);
        process.exit(1);
      }
    }

    const openFlag = args.open !== "false";

    try {
      const format = parseFormat(args.format, { default: "html" });

      if (format === "html") {
        await startPreviewServer({
          input: inputPath,
          port: resolvePort(args.port),
          host: (args.host as string | undefined) || "127.0.0.1",
          noWatch: !!args["no-watch"],
          verbose: !!args.verbose,
          openBrowser: openFlag,
          debug: !!args.debug,
        });
        return;
      }

      if (inputPath === undefined) {
        log.error(`--format ${format} requires an input directory.`);
        process.exit(2);
      }

      const pdfxFlavor = parsePdfxFlavor(args["pdfx-flavor"], format);
      const { outDir, pdfFileOverride } = splitOutPath(
        typeof args.out === "string" ? args.out : undefined,
        format
      );

      const result = await runBuild({
        inputDir: inputPath,
        format,
        outDir,
        pdfFileOverride,
        pdfxFlavor,
        iccPath: typeof args.icc === "string" ? args.icc : undefined,
        manifestPath: typeof args.manifest === "string" ? args.manifest : undefined,
        stripAnnotations: typeof args["strip-annotations"] === "boolean" ? args["strip-annotations"] : undefined,
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
      if (error instanceof UsageError || error instanceof BuildError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }
  },
});
