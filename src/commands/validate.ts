import { defineCommand } from "citty";
import { log } from "../lib/logger";
import { formatReport } from "../checks/formatter";
import type { OutputFormat } from "../checks/formatter";
import { reportMissingTools } from "../checks/tool-check";
import { executeValidation } from "../lib/validation-exec";

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
      description: "Run only these check IDs/selectors (comma-separated)",
    },
    skip: {
      type: "string",
      description: "Skip these check IDs/selectors (comma-separated)",
    },
    format: {
      type: "string",
      description: "Output format: text (default) or json",
    },
    phase: {
      type: "string",
      description: "Run checks for phase: pre-build or post-build",
    },
    profile: {
      type: "string",
      description: "Validation profile lock (currently: dtrpg)",
    },
  },
  async run({ args }) {
    // Determine output format
    const format: OutputFormat =
      args.format === "json" ? "json" : "text";

    let execution;
    try {
      execution = await executeValidation({
        manifest: typeof args.manifest === "string" ? args.manifest : undefined,
        pdf: typeof args.pdf === "string" ? args.pdf : undefined,
        input: typeof args.input === "string" ? args.input : undefined,
        category: typeof args.category === "string" ? args.category : undefined,
        only: typeof args.only === "string" ? args.only : undefined,
        skip: typeof args.skip === "string" ? args.skip : undefined,
        phase: typeof args.phase === "string" ? args.phase : undefined,
        profile: typeof args.profile === "string" ? args.profile : undefined,
      });
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }

    if (!execution) return;

    const { report, tools, context } = execution;

    if (format === "text") {
      reportMissingTools(tools);
    }

    formatReport(report, format);

    // Extra summary info for text format (backward compat with old output)
    if (format === "text" && context.pdfPath) {
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
