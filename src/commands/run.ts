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
    description: "Run the full pipeline: lint -> validate:pre -> convert -> assets -> build -> validate:post",
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
    icc: {
      type: "string",
      description: "Path to ICC profile (required for --pdfx)",
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
      description: "Skip PDF validation (post-build)",
    },
    "skip-pre-validate": {
      type: "boolean",
      description: "Skip pre-build validation",
    },
  },
  async run({ args }) {
    const inputDir = resolve(args.input!);
    const manifestPath = typeof args.manifest === "string" ? args.manifest : undefined;
    const manifest = await loadManifest(manifestPath ?? inputDir);
    const config = resolveConfig(
      {
        output: args.out ? { dir: args.out } : undefined,
      },
      manifest
    );

    // Resolve pdfx: accept --pdfx <flavor> or bare --pdfx (falls back to manifest/preset default)
    const pdfxFlavor = typeof args.pdfx === "string"
      ? args.pdfx
      : args.pdfx
        ? config.pdfx.flavor
        : undefined;

    const outDir = resolve(args.out ?? config.output.dir);
    const htmlFile = join(outDir, config.output.html);
    const pdfFile = join(outDir, config.output.filename);

    log.info(`Pipeline: ${inputDir} -> ${outDir}`);

    // 1. Lint
    if (!args["skip-lint"] && config.lint.enabled) {
      log.info("Step 1/6: Linting CSS");
      await runCommand(lintCmd, { rawArgs: ["--manifest", manifestPath ?? inputDir] });
    } else {
      log.info("Step 1/6: Lint (skipped)");
    }

    // 2. Pre-build validation
    if (!args["skip-pre-validate"] && config.validate.enabled) {
      log.info("Step 2/6: Pre-build validation");
      await runCommand(validateCmd, {
        rawArgs: [
          "--input", inputDir,
          "--phase", "pre-build",
          ...(manifestPath ? ["--manifest", manifestPath] : []),
        ],
      });
    } else {
      log.info("Step 2/6: Pre-build validation (skipped)");
    }

    // 3. Convert
    log.info("Step 3/6: Converting Markdown to HTML");
    await runCommand(convertCmd, {
      rawArgs: [
        "--input", inputDir,
        "--out", outDir,
        "--title", String(config.title),
        "--styles", config.styles.join(","),
        ...(manifestPath ? ["--manifest", manifestPath] : []),
      ],
    });

    // 4. Assets
    log.info("Step 4/6: Copying assets");
    await runCommand(assetsCmd, {
      rawArgs: [
        "--input", inputDir,
        "--out", outDir,
        ...(manifestPath ? ["--manifest", manifestPath] : []),
      ],
    });

    // 5. Build
    log.info("Step 5/6: Building PDF");
    await runCommand(buildCmd, {
      rawArgs: [
        "--input", htmlFile,
        "--out", pdfFile,
        ...(pdfxFlavor ? ["--pdfx", pdfxFlavor] : []),
        ...(typeof args.icc === "string" ? ["--icc", args.icc] : []),
        ...(manifestPath ? ["--manifest", manifestPath] : []),
      ],
    });

    // 6. Post-build validation (only if pdfx mode)
    if (!args["skip-validate"] && pdfxFlavor) {
      log.info("Step 6/6: Validating PDF");
      await runCommand(validateCmd, {
        rawArgs: [
          "--pdf", pdfFile,
          "--phase", "post-build",
          ...(manifestPath ? ["--manifest", manifestPath] : []),
        ],
      });
    } else {
      log.info("Step 6/6: Validation (skipped)");
    }

    log.success(`Pipeline complete: ${pdfFile}`);
  },
});
