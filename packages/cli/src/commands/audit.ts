import { defineCommand } from "citty";
import { resolve } from "node:path";
import { log, executeAndReport, type OutputFormat } from "@dimm-city/print-md-lib";

export default defineCommand({
  meta: { name: "audit", description: "Run asset-only validation checks" },
  args: {
    input: { type: "string", description: "Asset directory (if omitted, first positional arg is used)" },
    manifest: { type: "string", description: "Path to manifest.yaml" },
    only: { type: "string", description: "Run only these check IDs/selectors (comma-separated)" },
    skip: { type: "string", description: "Skip these check IDs/selectors (comma-separated)" },
    format: { type: "string", description: "Output format: text (default) or json" },
  },
  async run({ args }) {
    const positional = Array.isArray((args as { _: unknown[] })._)
      ? (args as { _: unknown[] })._
      : [];
    const positionalInput = typeof positional[0] === "string" ? positional[0] : undefined;
    const input = typeof args.input === "string" ? args.input : positionalInput;
    const inputDir = resolve(input ?? ".");
    const format: OutputFormat = args.format === "json" ? "json" : "text";

    let result;
    try {
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
      process.exit(2);
    }

    if (!result.ok) process.exit(1);
  },
});
