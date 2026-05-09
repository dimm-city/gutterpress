import { defineCommand, runCommand } from "citty";
import { resolve, join } from "node:path";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { log } from "../lib/logger";
import { writeBuildFingerprint } from "../lib/build-fingerprint";
import { BOOK_HTML_FILENAME } from "../lib/viewer";
import lintCmd from "./lint";
import buildCmd from "./build";
import validateCmd from "./validate";

/**
 * `run` is the validated print-ready PDF pipeline:
 *
 *   lint -> validate(pre-build) -> build (PDF) -> validate(post-build)
 *
 * For HTML output (a static-site design guide preview), use `build --format
 * html` directly — the validation phases here check PDF/X conformance and
 * do not apply to HTML.
 */
export default defineCommand({
  meta: {
    name: "run",
    description:
      "Run the full validated PDF pipeline: lint -> validate:pre -> build -> validate:post",
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
    const pdfFile = join(outDir, config.output.filename);

    log.info(`Pipeline: ${inputDir} -> ${outDir}`);

    // 1. Lint
    if (!args["skip-lint"] && config.lint.enabled) {
      log.info("Step 1/4: Linting CSS");
      await runCommand(lintCmd, { rawArgs: ["--manifest", manifestPath ?? inputDir] });
    } else {
      log.info("Step 1/4: Lint (skipped)");
    }

    // 2. Pre-build validation
    if (!args["skip-pre-validate"] && config.validate.enabled) {
      log.info("Step 2/4: Pre-build validation");
      await runCommand(validateCmd, {
        rawArgs: [
          "--input", inputDir,
          "--phase", "pre-build",
          ...(manifestPath ? ["--manifest", manifestPath] : []),
        ],
      });
    } else {
      log.info("Step 2/4: Pre-build validation (skipped)");
    }

    // 3. Build (markdown -> book.html + assets + viewer chrome -> book.pdf).
    //    The unified build command does convert, asset copy, viewer emission,
    //    and Chromium/Ghostscript PDF rendering in one pass.
    log.info("Step 3/4: Building PDF");
    await runCommand(buildCmd, {
      rawArgs: [
        inputDir,
        "--out", outDir,
        "--format", "pdf",
        ...(pdfxFlavor ? ["--pdfx", pdfxFlavor] : []),
        ...(typeof args.icc === "string" ? ["--icc", args.icc] : []),
        ...(manifestPath ? ["--manifest", manifestPath] : []),
      ],
    });

    // 4. Post-build validation (only if pdfx mode)
    if (!args["skip-validate"] && pdfxFlavor) {
      log.info("Step 4/4: Validating PDF");
      await runCommand(validateCmd, {
        rawArgs: [
          "--pdf", pdfFile,
          "--phase", "post-build",
          ...(manifestPath ? ["--manifest", manifestPath] : []),
        ],
      });
    } else {
      log.info("Step 4/4: Validation (skipped)");
    }

    const fingerprintPath = await writeBuildFingerprint({
      command: "run",
      outputDir: outDir,
      sourceDir: inputDir,
      args,
      pdfx: {
        requestedFlavor: (pdfxFlavor as "x1a" | "x3" | undefined) ?? null,
        resolvedFlavor: config.pdfx.flavor,
        iccPath: pdfxFlavor ? resolve(args.icc ?? config.pdfx.icc) : null,
        stripAnnotations: pdfxFlavor ? config.pdfx.stripAnnotations : null,
      },
    });

    log.success(`Pipeline complete: ${pdfFile}`);
    log.info(`HTML viewer: ${join(outDir, "index.html")} (loads ${BOOK_HTML_FILENAME})`);
    log.info(`Fingerprint: ${fingerprintPath}`);
  },
});
