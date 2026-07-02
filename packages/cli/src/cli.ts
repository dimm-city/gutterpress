#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import pkg from "../package.json" with { type: "json" };

// Subcommands are loaded lazily so `--version` and `--help` (and any single
// subcommand) only pay the import cost of what they actually use — e.g.
// puppeteer-core (the biggest dep) stays out of the startup path and only
// loads on `build`/`preview`.
const SUBCOMMANDS = {
  // Primary author commands:
  new: () => import("./commands/new").then((m) => m.default),
  preview: () => import("./commands/preview").then((m) => m.default),
  build: () => import("./commands/build").then((m) => m.default),
  // CI / advanced:
  lint: () => import("./commands/lint").then((m) => m.default),
  validate: () => import("./commands/validate").then((m) => m.default),
  audit: () => import("./commands/audit").then((m) => m.default),
  preflight: () => import("./commands/preflight").then((m) => m.default),
  repair: () => import("./commands/repair").then((m) => m.default),
} as const;

// The package.json version is inlined by the bundler at build time (a JSON
// import, not a runtime read), so the standalone binary — which can't read
// package.json at runtime (CLAUDE.md §3) — still reports the right version.
const VERSION = pkg.version;

const main = defineCommand({
  meta: {
    name: "print-md",
    version: VERSION,
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
