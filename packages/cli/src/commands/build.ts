import { defineCommand } from "citty";
import path from "node:path";
import {
  log,
  runBuild,
  splitOutPath,
  BuildError,
  type BuildFormat,
  type PdfxFlavor,
} from "@dimm-city/print-md-lib";

function parseFormat(raw: unknown): BuildFormat {
  if (raw === undefined || raw === "") return "pdf";
  if (raw === "html" || raw === "pdf" || raw === "pdfx") return raw;
  log.error(`Invalid --format value: "${raw}". Expected "html", "pdf", or "pdfx".`);
  process.exit(2);
}

function parsePdfxFlavor(raw: unknown, format: BuildFormat): PdfxFlavor | undefined {
  if (raw === undefined || raw === "") return undefined;
  if (format !== "pdfx") {
    log.error(`--pdfx-flavor is only valid with --format pdfx (got --format ${format}).`);
    process.exit(2);
  }
  if (raw === "x1a" || raw === "x3") return raw;
  log.error(`Invalid --pdfx-flavor value: "${raw}". Expected "x1a" or "x3".`);
  process.exit(2);
}

export default defineCommand({
  meta: {
    name: "build",
    description:
      "Build the book to HTML (static-site viewer), PDF, or PDF/X. Use --format to select. Default: pdf.",
  },
  args: {
    input: { type: "positional", description: "Input directory containing markdown files (default: cwd)", required: false },
    format: { type: "string", description: "Output format: html | pdf | pdfx (default: pdf)" },
    out: { type: "string", description: "Output directory. For --format pdf|pdfx, --out may also be a .pdf file path." },
    title: { type: "string", description: "Document title (overrides manifest)" },
    "pdfx-flavor": { type: "string", description: "PDF/X flavor (x1a or x3). --format pdfx only." },
    icc: { type: "string", description: "Path to ICC profile (required for --format pdfx)" },
    manifest: { type: "string", description: "Path to manifest.yaml" },
    "strip-annotations": { type: "boolean", description: "Strip PDF annotations for PDF/X compliance" },
    "skip-lint": { type: "boolean", description: "Skip CSS linting (default: lint runs for pdf/pdfx)" },
    "skip-pre-validate": { type: "boolean", description: "Skip pre-build validation" },
    "skip-post-validate": { type: "boolean", description: "Skip post-build PDF/X validation" },
  },
  async run({ args }) {
    const format = parseFormat(args.format);
    const pdfxFlavor = parsePdfxFlavor(args["pdfx-flavor"], format);
    const { outDir, pdfFileOverride } = splitOutPath(
      typeof args.out === "string" ? args.out : undefined,
      format
    );
    try {
      await runBuild({
        inputDir: path.resolve((args.input as string | undefined) ?? "."),
        format,
        outDir,
        pdfFileOverride,
        title: typeof args.title === "string" ? args.title : undefined,
        pdfxFlavor,
        iccPath: typeof args.icc === "string" ? args.icc : undefined,
        manifestPath: typeof args.manifest === "string" ? args.manifest : undefined,
        stripAnnotations: typeof args["strip-annotations"] === "boolean" ? args["strip-annotations"] : undefined,
        skipLint: !!args["skip-lint"],
        skipPreValidate: !!args["skip-pre-validate"],
        skipPostValidate: !!args["skip-post-validate"],
        rawArgs: args as Record<string, unknown>,
      });
    } catch (error) {
      if (error instanceof BuildError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }
  },
});
