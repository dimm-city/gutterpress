import { defineCommand } from "citty";
import { resolve } from "node:path";
import { loadManifest, resolveConfig } from "../lib/manifest";
import { runChecks } from "../checks/runner";
import { formatReport } from "../checks/formatter";
import { checkToolAvailability, reportMissingTools } from "../checks/tool-check";
import type { CheckContext } from "../checks/types";
import type { OutputFormat } from "../checks/formatter";

// Import check modules to trigger self-registration
import "../checks/asset/index";

export default defineCommand({
  meta: {
    name: "audit",
    description: "Run asset-only validation checks",
  },
  args: {
    input: {
      type: "string",
      description: "Asset directory (if omitted, first positional arg is used)",
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
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
  },
  async run({ args }) {
    const positional = Array.isArray((args as { _: unknown[] })._)
      ? (args as { _: unknown[] })._
      : [];
    const positionalInput =
      typeof positional[0] === "string" ? positional[0] : undefined;

    const input = typeof args.input === "string" ? args.input : positionalInput;
    const inputDir = resolve(input ?? ".");

    const manifestPath = typeof args.manifest === "string" ? args.manifest : undefined;
    const manifest = await loadManifest(manifestPath ?? inputDir);
    const config = resolveConfig({}, manifest);

    const { glob } = await import("glob");
    const cssFiles = await glob("**/*.css", {
      cwd: inputDir,
      absolute: true,
      ignore: ["**/node_modules/**"],
    });
    cssFiles.sort();

    const ctx: CheckContext = {
      config,
      inputDir,
      outputDir: resolve(config.output.dir),
      cssFiles,
      assetDirs: [inputDir],
    };

    const only =
      typeof args.only === "string"
        ? args.only.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const skip =
      typeof args.skip === "string"
        ? args.skip.split(",").map((s) => s.trim()).filter(Boolean)
        : undefined;
    const format: OutputFormat = args.format === "json" ? "json" : "text";

    const runnerOpts = {
      category: ["asset"] as const,
      phase: "pre-build" as const,
      only,
      skip,
    };

    const toolResult = await checkToolAvailability(config, runnerOpts);
    if (format === "text") {
      reportMissingTools(toolResult);
    }

    const report = await runChecks(ctx, {
      ...runnerOpts,
      skipMissingTools: toolResult.skippedChecks,
    });

    formatReport(report, format);

    if (report.summary.errors > 0) {
      process.exit(1);
    }
  },
});
