import { defineCommand } from "citty";
import { stat } from "node:fs/promises";
import path from "node:path";

import { addNpmPlugin } from "../index.ts";
import {
  EXIT_CODES,
  rejectExtraPositionals,
  rejectUnknownFlags,
  UsageError,
} from "../lib/cli-args.ts";
import { parseNpmPluginSpec } from "../lib/plugin-vendor.ts";

export const pluginAddArgs = {
  package: {
    type: "positional",
    description: "npm package name, optionally followed by @version or @dist-tag",
    required: true,
  },
  dir: {
    type: "positional",
    description: "Project directory (defaults to the current directory)",
    required: false,
  },
  export: {
    type: "string",
    description: "Named module export to use as the plugin function",
    required: false,
  },
} as const;

const parentArgs = {} as const;

function exitForUsage(error: unknown): never {
  if (error instanceof UsageError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  throw error;
}

function rejectParentFlags(rawArgs: string[]): void {
  if (rawArgs[0] === "add" || rawArgs[0] === undefined || !rawArgs[0].startsWith("-")) {
    return;
  }
  try {
    rejectUnknownFlags(rawArgs, parentArgs, "plugin");
  } catch (error) {
    exitForUsage(error);
  }
}

const add = defineCommand({
  meta: {
    name: "add",
    description: "Download, verify, and vendor an npm markdown-it plugin",
  },
  args: pluginAddArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, pluginAddArgs, "plugin add");
      rejectExtraPositionals(args._, 2, "plugin add");
    } catch (error) {
      exitForUsage(error);
    }

    const projectDir = path.resolve(
      typeof args.dir === "string" && args.dir ? args.dir : process.cwd(),
    );
    const packageSpec = String(args.package);
    const exportName = typeof args.export === "string" ? args.export.trim() : undefined;
    try {
      try {
        parseNpmPluginSpec(packageSpec);
      } catch (error) {
        throw new UsageError(error instanceof Error ? error.message : String(error));
      }
      if (typeof args.export === "string" && !exportName) {
        throw new UsageError("print-md plugin add: --export requires a non-empty name");
      }
      let projectInfo;
      try {
        projectInfo = await stat(projectDir);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new UsageError(`Project directory does not exist: ${projectDir}`);
        }
        throw error;
      }
      if (!projectInfo.isDirectory()) {
        throw new UsageError(`Project path is not a directory: ${projectDir}`);
      }
    } catch (error) {
      exitForUsage(error);
    }
    try {
      const installed = await addNpmPlugin(projectDir, packageSpec, exportName);
      if (installed.version) {
        console.log(`Installed ${installed.ref}@${installed.version}`);
        console.log(`  project: ${projectDir}`);
        console.log("  vendored under: plugins/npm");
        console.log("  manifest: exact version pinned");
        for (const warning of installed.warnings ?? []) console.warn(`Warning: ${warning}`);
      } else {
        console.log(`Enabled bundled plugin ${installed.ref}`);
        console.log(`  project: ${projectDir}`);
      }
    } catch (error) {
      console.error(
        `Could not install plugin: ${error instanceof Error ? error.message : String(error)}`,
      );
      process.exit(EXIT_CODES.PIPELINE);
    }
  },
});

export default defineCommand({
  meta: {
    name: "plugin",
    description: "Manage project markdown-it plugins",
  },
  args: parentArgs,
  setup({ rawArgs }) {
    rejectParentFlags(rawArgs);
  },
  subCommands: { add },
});
