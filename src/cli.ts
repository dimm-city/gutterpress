#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import build from "./commands/build";
import validate from "./commands/validate";
import lint from "./commands/lint";
import audit from "./commands/audit";
import preview from "./commands/preview";
import preflight from "./commands/preflight";

const main = defineCommand({
  meta: {
    name: "print-md",
    version: "2.0.0",
    description:
      "Markdown to print-ready PDF (and static-site HTML) using Chromium + Paged.js",
  },
  subCommands: {
    // Primary author commands:
    preview, // live HTML preview (default) or one-shot build+open for pdf|pdfx
    build,   // unified pipeline: html | pdf | pdfx with format-aware lint/validate
    // CI / advanced:
    lint,
    validate,
    audit,
    preflight,
  },
});

runMain(main);
