import { defineCommand, runCommand } from "citty";
import { resolve, join } from "node:path";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { log } from "../lib/logger";
import lintCmd from "./lint";
import convertCmd from "./convert";
import assetsCmd from "./assets";
import buildCmd from "./build";
import validateCmd from "./validate";

export default defineCommand({
  meta: {
    name: "run",
    description: "Run the full pipeline: lint -> convert -> assets -> build -> validate",
  },
  args: {
    input: {
      type: "string",
      description: "Input directory containing source files",
      required: true,
    },
    out: {
      type: "string",
      description: "Output directory",
    },
    pdfx: {
      type: "string",
      description: "PDF/X flavor (x1a or x3). Omit for plain Chromium PDF.",
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
    "skip-lint": {
      type: "boolean",
      description: "Skip CSS linting",
    },
    "skip-validate": {
      type: "boolean",
      description: "Skip PDF validation",
    },
  },
  async run({ args }) {
    const inputDir = resolve(args.input!);
    const manifest = await loadManifest(args.manifest ?? inputDir);
    const config = resolveConfig(
      {
        output: args.out ? { dir: args.out } : undefined,
      },
      manifest
    );

    const outDir = resolve(args.out ?? config.output.dir);
    const htmlFile = join(outDir, config.output.html);
    const pdfFile = join(outDir, config.output.filename);

    log.info(`Pipeline: ${inputDir} -> ${outDir}`);

    // 1. Lint
    if (!args["skip-lint"] && config.lint.enabled) {
      log.info("Step 1/5: Linting CSS");
      await runCommand(lintCmd, { rawArgs: ["--manifest", args.manifest ?? inputDir] });
    } else {
      log.info("Step 1/5: Lint (skipped)");
    }

    // 2. Convert
    log.info("Step 2/5: Converting Markdown to HTML");
    await runCommand(convertCmd, {
      rawArgs: [
        "--input", inputDir,
        "--out", outDir,
        "--title", config.title,
        "--css-path", config.source.css,
        ...(args.manifest ? ["--manifest", args.manifest] : []),
      ],
    });

    // 3. Assets
    log.info("Step 3/5: Copying assets");
    await runCommand(assetsCmd, {
      rawArgs: [
        "--input", inputDir,
        "--out", outDir,
        ...(args.manifest ? ["--manifest", args.manifest] : []),
      ],
    });

    // 4. Build
    log.info("Step 4/5: Building PDF");
    await runCommand(buildCmd, {
      rawArgs: [
        "--input", htmlFile,
        "--out", pdfFile,
        ...(args.pdfx ? ["--pdfx", args.pdfx] : []),
        ...(args.manifest ? ["--manifest", args.manifest] : []),
      ],
    });

    // 5. Validate (only if pdfx mode)
    if (!args["skip-validate"] && args.pdfx) {
      log.info("Step 5/5: Validating PDF");
      await runCommand(validateCmd, {
        rawArgs: [
          "--pdf", pdfFile,
          ...(args.manifest ? ["--manifest", args.manifest] : []),
        ],
      });
    } else {
      log.info("Step 5/5: Validation (skipped)");
    }

    log.success(`Pipeline complete: ${pdfFile}`);
  },
});
