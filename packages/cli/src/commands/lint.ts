import { defineCommand } from "citty";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { runLint } from "../index.ts";

export default defineCommand({
  meta: {
    name: "lint",
    description: "Lint CSS for print-safety issues",
  },
  args: {
    files: {
      type: "positional",
      description: "Project directory with manifest.yaml, or glob pattern for CSS files to lint",
      required: false,
    },
    manifest: {
      type: "string",
      description: "Path to manifest.yaml",
    },
  },
  async run({ args }) {
    const filesArg = typeof args.files === "string" ? args.files : undefined;
    const manifestArg = typeof args.manifest === "string" ? args.manifest : undefined;
    const filesArgIsManifestDir =
      filesArg &&
      existsSync(filesArg) &&
      statSync(filesArg).isDirectory() &&
      (existsSync(join(filesArg, "manifest.yaml")) ||
        existsSync(join(filesArg, "manifest.yml")));

    const result = await runLint({
      files: filesArgIsManifestDir ? undefined : filesArg,
      manifest: manifestArg ?? (filesArgIsManifestDir ? filesArg : undefined),
    });
    if (!result.ok) {
      process.exit(2);
    }
  },
});
