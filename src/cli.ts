#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";

// Subcommands are loaded lazily so `--version` and `--help` (and any single
// subcommand) only pay the import cost of what they actually use. Notably
// keeps stylelint, vite, and other heavy deps out of the startup path,
// which matters for `bun build --compile` standalone binaries — some of
// those deps use createRequire/readFileSync patterns that bun --compile
// can't statically resolve.
const main = defineCommand({
  meta: {
    name: "print-md",
    version: "2.0.0",
    description:
      "Markdown to print-ready PDF (and static-site HTML) using Chromium + Paged.js",
  },
  subCommands: {
    // Primary author commands:
    preview: () => import("./commands/preview").then((m) => m.default),
    build: () => import("./commands/build").then((m) => m.default),
    // CI / advanced:
    lint: () => import("./commands/lint").then((m) => m.default),
    validate: () => import("./commands/validate").then((m) => m.default),
    audit: () => import("./commands/audit").then((m) => m.default),
    preflight: () => import("./commands/preflight").then((m) => m.default),
  },
});

runMain(main);
