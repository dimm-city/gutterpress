import { defineCommand } from "citty";
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { log, runLint } from "../index.ts";
import {
  EXIT_CODES,
  UsageError,
  rejectExtraPositionals,
  rejectUnknownFlags,
} from "../lib/cli-args.ts";
import { MANIFEST_FILENAMES } from "../lib/manifest.ts";

const commandArgs = {
  files: {
    type: "positional",
    description: "Project directory with manifest.yaml, or glob pattern for CSS files to lint",
    required: false,
  },
  manifest: {
    type: "string",
    description: "Path to manifest.yaml",
  },
} as const;

export default defineCommand({
  meta: {
    name: "lint",
    description: "Lint CSS for print-safety issues",
  },
  args: commandArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, commandArgs, "lint");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "lint");

      const filesArg = typeof args.files === "string" ? args.files : undefined;
      const manifestArg = typeof args.manifest === "string" ? args.manifest : undefined;
      const filesArgIsManifestDir =
        filesArg &&
        existsSync(filesArg) &&
        statSync(filesArg).isDirectory() &&
        MANIFEST_FILENAMES.some((name) => existsSync(join(filesArg, name)));

      const result = await runLint({
        files: filesArgIsManifestDir ? undefined : filesArg,
        manifest: manifestArg ?? (filesArgIsManifestDir ? filesArg : undefined),
      });
      if (!result.ok) {
        // M47: findings, not usage — exit 1 (was 2, which collided with the
        // usage-error code and made "you typo'd a flag" indistinguishable
        // from "your CSS has findings").
        process.exit(EXIT_CODES.FINDINGS);
      }
    } catch (error) {
      if (error instanceof UsageError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }
  },
});
