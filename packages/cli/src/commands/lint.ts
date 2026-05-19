import { defineCommand } from "citty";
import { runLint } from "@dimm-city/print-md-lib";

export default defineCommand({
  meta: {
    name: "lint",
    description: "Lint CSS for print-safety issues",
  },
  args: {
    files: {
      type: "string",
      description: "Glob pattern for CSS files to lint",
    },
    config: {
      type: "string",
      description: "Path to stylelint config",
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
  },
  async run({ args }) {
    const result = await runLint({
      files: typeof args.files === "string" ? args.files : undefined,
      configPath: typeof args.config === "string" ? args.config : undefined,
      manifest: typeof args.manifest === "string" ? args.manifest : undefined,
    });
    if (!result.ok) {
      process.exit(2);
    }
  },
});
