import { defineCommand } from "citty";
import { log, executeAndReport, type OutputFormat } from "../index.ts";

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
      description:
        'Run checks for phase: pre | post | all | pre-build | post-build (default: all)',
    },
    profile: {
      type: "string",
      description: "Validation profile lock (currently: dtrpg)",
    },
  },
  async run({ args }) {
    const format: OutputFormat =
      args.format === "json" ? "json" : "text";

    let result;
    try {
      result = await executeAndReport(
        {
          manifest: typeof args.manifest === "string" ? args.manifest : undefined,
          pdf: typeof args.pdf === "string" ? args.pdf : undefined,
          input: typeof args.input === "string" ? args.input : undefined,
          category: typeof args.category === "string" ? args.category : undefined,
          only: typeof args.only === "string" ? args.only : undefined,
          skip: typeof args.skip === "string" ? args.skip : undefined,
          phase: typeof args.phase === "string" ? args.phase : undefined,
          profile: typeof args.profile === "string" ? args.profile : undefined,
        },
        format
      );
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(2);
    }

    if (!result.ok) {
      process.exit(1);
    }
  },
});
