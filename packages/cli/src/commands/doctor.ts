import { defineCommand } from "citty";
import { getSystemDiagnostics } from "../lib/diagnostics.ts";
import {
  rejectExtraPositionals,
  rejectUnknownFlags,
  UsageError,
} from "../lib/cli-args.ts";
import { log } from "../utils/logger.ts";

const commandArgs = {} as const;

export default defineCommand({
  meta: {
    name: "doctor",
    description: "Check system tools used by Gutterpress",
  },
  args: commandArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, commandArgs, "doctor");
      rejectExtraPositionals(args._, 0, "doctor");

      const diagnostics = await getSystemDiagnostics();
      console.log(`gutterpress ${diagnostics.libVersion}`);
      console.log(
        `System: ${diagnostics.platform.os} ${diagnostics.platform.arch} ` +
          `(${diagnostics.platform.release}), Node ${diagnostics.platform.node}`
      );
      console.log(`Config: ${diagnostics.configDir}`);
      console.log("");
      console.log("Tools:");

      for (const tool of diagnostics.tools) {
        const version = tool.version ? `, ${tool.version}` : "";
        console.log(
          `  [${tool.found ? "ok" : "missing"}] ${tool.name} (${tool.bin}${version})`
        );
        if (tool.path) console.log(`    Path: ${tool.path}`);
        console.log(
          `    Used by: ${tool.usedBy.map((use) => use.feature).join(", ")}`
        );
        if (!tool.found) {
          console.log("    Install:");
          for (const line of tool.installHint.split(/\r?\n/)) {
            console.log(`      ${line}`);
          }
        }
      }

      console.log("");
      console.log(`Setup guide: ${diagnostics.docsUrl}`);
    } catch (error) {
      if (error instanceof UsageError) {
        log.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }
  },
});
