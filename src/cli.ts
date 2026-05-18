#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";

// Subcommands are loaded lazily so `--version` and `--help` (and any single
// subcommand) only pay the import cost of what they actually use. Notably
// keeps stylelint and other heavy deps out of the startup path, which
// matters for `bun build --compile` standalone binaries — some of those
// deps use createRequire/readFileSync patterns that bun --compile can't
// statically resolve.
const SUBCOMMANDS = {
  // Primary author commands:
  preview: () => import("./commands/preview").then((m) => m.default),
  build: () => import("./commands/build").then((m) => m.default),
  // CI / advanced:
  lint: () => import("./commands/lint").then((m) => m.default),
  validate: () => import("./commands/validate").then((m) => m.default),
  audit: () => import("./commands/audit").then((m) => m.default),
  preflight: () => import("./commands/preflight").then((m) => m.default),
} as const;

const main = defineCommand({
  meta: {
    name: "print-md",
    version: "2.0.0",
    description:
      "Markdown to print-ready PDF (and static-site HTML) using Chromium + Paged.js",
  },
  subCommands: SUBCOMMANDS,
});

// If the user invokes `print-md` with no subcommand (or with a non-subcommand
// positional like a directory path), default to `preview`. This launches the
// live HTML server, opens the browser, and the in-browser folder picker lets
// the user choose which directory to render.
const rawArgs = process.argv.slice(2);
const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
const wantsVersion = rawArgs.length === 1 && rawArgs[0] === "--version";
const firstPositional = rawArgs.find((a) => !a.startsWith("-"));
const isKnownSubcommand =
  firstPositional !== undefined && firstPositional in SUBCOMMANDS;

if (!wantsHelp && !wantsVersion && !isKnownSubcommand) {
  rawArgs.unshift("preview");
}

runMain(main, { rawArgs });
