import { defineCommand } from "citty";
import path from "node:path";
import {
  log,
  runBuild,
  splitOutPath,
  BuildError,
} from "../index.ts";
import {
  parseEngine,
  parseFormat,
  parsePdfxFlavor,
  rejectExtraPositionals,
  rejectUnknownFlags,
  UsageError,
} from "../lib/cli-args.ts";

const commandArgs = {
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
  "allow-shrink": { type: "boolean", description: "Build anyway when content is wider than the page content box, instead of failing. Chromium then scales the WHOLE book down to fit; each offender is reported as a warning." },
  engine: { type: "string", description: "Pagination engine. Paged.js has been removed; native is the only engine. This flag is accepted but ignored (a warning fires for --engine paged)." },
} as const;

export default defineCommand({
  meta: {
    name: "build",
    description:
      "Build the book to HTML (static-site desktop), PDF, or PDF/X. Use --format to select. Default: pdf.",
  },
  args: commandArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, commandArgs, "build");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "build");

      const format = parseFormat(args.format, { default: "pdf" });
      log.info(`Format: ${format}`);
      const pdfxFlavor = parsePdfxFlavor(args["pdfx-flavor"], format);
      const { outDir, pdfFileOverride } = splitOutPath(
        typeof args.out === "string" ? args.out : undefined,
        format
      );
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
        allowShrink: !!args["allow-shrink"],
        engine: parseEngine(args.engine),
        rawArgs: args as Record<string, unknown>,
      });
    } catch (error) {
      if (error instanceof UsageError || error instanceof BuildError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }
  },
});
