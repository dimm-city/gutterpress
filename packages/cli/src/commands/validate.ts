import { defineCommand } from "citty";
import { log, executeAndReport, type OutputFormat } from "../index.ts";
import { EXIT_CODES, UsageError, rejectExtraPositionals } from "../lib/cli-args.ts";

export default defineCommand({
  meta: {
    name: "validate",
    description: "Validate source files and/or PDF for print compliance",
  },
  args: {
    dir: {
      type: "positional",
      description:
        "Project directory (default: cwd). Sets the pre-build source directory unless --input is also given.",
      required: false,
    },
    pdf: {
      type: "string",
      description: "Path to the PDF file to validate (post-build checks)",
    },
    input: {
      type: "string",
      description: "Source directory for pre-build checks (overrides the positional directory)",
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

    // M46: `dir` (positional) sets the same source directory `--input` does —
    // an explicit --input still wins, but `print-md validate ./my-book` now
    // actually validates ./my-book instead of silently validating cwd.
    const positionalDir = typeof args.dir === "string" ? args.dir : undefined;
    const inputFlag = typeof args.input === "string" ? args.input : undefined;
    const input = inputFlag ?? positionalDir;

    let result;
    try {
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "validate");

      result = await executeAndReport(
        {
          manifest: typeof args.manifest === "string" ? args.manifest : undefined,
          pdf: typeof args.pdf === "string" ? args.pdf : undefined,
          input,
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
      process.exit(error instanceof UsageError ? error.exitCode : EXIT_CODES.USAGE);
    }

    if (!result.ok) {
      process.exit(EXIT_CODES.FINDINGS);
    }
  },
});
