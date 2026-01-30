import { defineCommand } from "citty";
import path from "node:path";
import fs from "node:fs";
import { startPreviewServer } from "../server";
import { log } from "../lib/logger";

export default defineCommand({
  meta: {
    name: "preview",
    description: "Start live preview server with automatic rebuild on file changes",
  },
  args: {
    input: {
      type: "positional",
      description: "Input markdown directory (defaults to current directory)",
      required: false,
    },
    port: {
      type: "string",
      description: "Port number (default: 3579)",
    },
    "no-watch": {
      type: "boolean",
      description: "Disable file watching",
    },
    open: {
      type: "string",
      description: "Automatically open browser (default: true)",
    },
    verbose: {
      type: "boolean",
      description: "Enable verbose output",
    },
    debug: {
      type: "boolean",
      description: "Debug mode (preserve temporary files)",
    },
  },
  async run({ args }) {
    const inputPath = args.input
      ? path.resolve(args.input as string)
      : process.cwd();

    if (!fs.existsSync(inputPath) || !fs.statSync(inputPath).isDirectory()) {
      log.error(`Input directory does not exist: ${inputPath}`);
      process.exit(1);
    }

    const port = Number(args.port) || 3579;
    const openBrowser = args.open !== "false";

    await startPreviewServer({
      input: inputPath,
      port,
      noWatch: !!args["no-watch"],
      verbose: !!args.verbose,
      openBrowser,
      debug: !!args.debug,
    });
  },
});
