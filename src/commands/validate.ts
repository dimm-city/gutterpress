import { defineCommand } from "citty";
import { existsSync } from "node:fs";
import { resolve, join } from "node:path";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { log } from "../lib/logger";
import { runChecks } from "../checks/runner";
import { formatReport } from "../checks/formatter";
import type { CheckCategory, CheckPhase, CheckContext } from "../checks/types";
import type { OutputFormat } from "../checks/formatter";

// Import check modules to trigger self-registration
import "../checks/pdf/index";
import "../checks/source/index";
import "../checks/asset/index";
import "../checks/heuristic/index";

export default defineCommand({
  meta: {
    name: "validate",
    description: "Validate source files and/or PDF for print compliance",
  },
  args: {
    pdf: {
      type: "string",
      description: "Path to the PDF file to validate (post-build checks)",
    },
    input: {
      type: "string",
      description: "Source directory for pre-build checks",
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
    category: {
      type: "string",
      description:
        "Comma-separated categories: source, pdf, asset, heuristic",
    },
    only: {
      type: "string",
      description: "Run only these check IDs (comma-separated)",
    },
    skip: {
      type: "string",
      description: "Skip these check IDs (comma-separated)",
    },
    format: {
      type: "string",
      description: "Output format: text (default) or json",
    },
    phase: {
      type: "string",
      description: "Run checks for phase: pre-build or post-build",
    },
  },
  async run({ args }) {
    const manifestPath =
      typeof args.manifest === "string" ? args.manifest : undefined;
    const manifest = await loadManifest(
      manifestPath ?? args.input ?? undefined
    );
    const config = resolveConfig({}, manifest);

    const pdfPath = typeof args.pdf === "string" ? args.pdf : undefined;
    const inputDir = typeof args.input === "string"
      ? resolve(args.input)
      : undefined;

    // Backward compat: --pdf alone = post-build only
    // --input alone = pre-build only
    // both = all phases
    if (pdfPath && !existsSync(pdfPath)) {
      log.error(`File not found: ${pdfPath}`);
      process.exit(2);
    }

    // Determine output format
    const format: OutputFormat =
      args.format === "json" ? "json" : "text";

    // Parse categories
    let categories: CheckCategory[] | undefined;
    if (typeof args.category === "string") {
      categories = args.category
        .split(",")
        .map((s) => s.trim()) as CheckCategory[];
    }

    // Parse only/skip
    const only =
      typeof args.only === "string"
        ? args.only.split(",").map((s) => s.trim())
        : undefined;
    const skip =
      typeof args.skip === "string"
        ? args.skip.split(",").map((s) => s.trim())
        : undefined;

    // Determine phase
    let phase: CheckPhase | undefined;
    if (typeof args.phase === "string") {
      phase = args.phase as CheckPhase;
    } else if (pdfPath && !inputDir) {
      phase = "post-build";
    } else if (inputDir && !pdfPath) {
      phase = "pre-build";
    }

    // Collect markdown and CSS files for source/asset checks
    let markdownFiles: string[] | undefined;
    let cssFiles: string[] | undefined;
    let assetDirs: string[] | undefined;
    let htmlPath: string | undefined;

    if (inputDir) {
      const { glob } = await import("glob");
      markdownFiles = await glob("**/*.md", {
        cwd: inputDir,
        absolute: true,
      });
      cssFiles = await glob("**/*.css", {
        cwd: inputDir,
        absolute: true,
      });
      assetDirs = config.source.assets.map((a) =>
        resolve(inputDir, a)
      );
      // Check for generated HTML
      const outDir = resolve(config.output.dir);
      const possibleHtml = join(outDir, config.output.html);
      if (existsSync(possibleHtml)) {
        htmlPath = possibleHtml;
      }
    }

    const ctx: CheckContext = {
      config,
      inputDir: inputDir ?? process.cwd(),
      outputDir: resolve(config.output.dir),
      pdfPath,
      htmlPath,
      markdownFiles,
      cssFiles,
      assetDirs,
    };

    const report = await runChecks(ctx, {
      category: categories,
      phase,
      only,
      skip,
    });

    formatReport(report, format);

    // Extra summary info for text format (backward compat with old output)
    if (format === "text" && pdfPath) {
      // Show TAC and font info from individual check results
      const tacResults = report.results.filter(
        (r) => r.checkId === "pdf.print.ink-coverage"
      );
      const fontResults = report.results.filter(
        (r) => r.checkId === "pdf.print.embedded-fonts"
      );
      const rasterResults = report.results.filter(
        (r) => r.checkId === "pdf.print.rasterized-pages"
      );

      // Parse TAC from results
      const tacMsg = tacResults.find((r) =>
        r.message.startsWith("Total ink coverage")
      );
      if (tacMsg) {
        const tacMatch = tacMsg.message.match(/max\s+([\d.]+)%/);
        if (tacMatch) {
          log.info(`Max TAC: ${tacMatch[1]}% (high!)`);
        }
      } else {
        log.info("Max TAC: within limits");
      }

      // Font count from passed/results
      const fontWarning = fontResults.find((r) =>
        r.message.includes("No fonts detected")
      );
      const fontError = fontResults.find((r) =>
        r.message.includes("Not all fonts")
      );
      if (!fontWarning && !fontError) {
        log.info("Fonts: all embedded");
      }

      // Rasterized pages
      const rasterMsg = rasterResults.find((r) =>
        r.message.startsWith("Possible rasterized")
      );
      log.info(
        `Rasterized pages: ${rasterMsg ? rasterMsg.message.replace("Possible rasterized pages detected: ", "") : "none"}`
      );
    }

    if (report.summary.errors > 0) {
      process.exit(1);
    }
  },
});
