import { defineCommand } from "citty";
import { resolve } from "node:path";
import { log, executeAndReport, type OutputFormat } from "../index.ts";
import {
  EXIT_CODES,
  UsageError,
  rejectExtraPositionals,
  rejectUnknownFlags,
} from "../lib/cli-args.ts";

const commandArgs = {
  // M46: a real citty positional, not a hand-rolled `args._` read — was the
  // one command bypassing citty's own positional-argument support.
  dir: {
    type: "positional",
    description: "Asset directory (default: cwd)",
    required: false,
  },
  input: {
    type: "string",
    description: "Asset directory (overrides the positional directory)",
  },
  manifest: { type: "string", description: "Path to manifest.yaml" },
  only: { type: "string", description: "Run only these check IDs/selectors (comma-separated)" },
  skip: { type: "string", description: "Skip these check IDs/selectors (comma-separated)" },
  format: { type: "string", description: "Output format: text (default) or json" },
} as const;

export default defineCommand({
  meta: { name: "audit", description: "Run asset-only validation checks" },
  args: commandArgs,
  async run({ args, rawArgs }) {
    const positionalDir = typeof args.dir === "string" ? args.dir : undefined;
    const inputFlag = typeof args.input === "string" ? args.input : undefined;
    const inputDir = resolve(inputFlag ?? positionalDir ?? ".");
    const format: OutputFormat = args.format === "json" ? "json" : "text";

    let result;
    try {
      rejectUnknownFlags(rawArgs, commandArgs, "audit");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "audit");

      result = await executeAndReport(
        {
          input: inputDir,
          manifest: typeof args.manifest === "string" ? args.manifest : undefined,
          category: "asset",
          phase: "pre-build",
          only: typeof args.only === "string" ? args.only : undefined,
          skip: typeof args.skip === "string" ? args.skip : undefined,
        },
        format
      );
    } catch (error) {
      log.error(error instanceof Error ? error.message : String(error));
      process.exit(error instanceof UsageError ? error.exitCode : EXIT_CODES.USAGE);
    }

    if (!result.ok) process.exit(EXIT_CODES.FINDINGS);
  },
});
