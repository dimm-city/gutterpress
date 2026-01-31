#!/usr/bin/env bun

import { defineCommand, runMain } from "citty";
import build from "./commands/build";
import validate from "./commands/validate";
import convert from "./commands/convert";
import lint from "./commands/lint";
import assets from "./commands/assets";
import run from "./commands/run";
import preview from "./commands/preview";

const main = defineCommand({
  meta: {
    name: "print-md",
    version: "2.0.0",
    description: "Markdown to print-ready PDF pipeline using Chromium + Paged.js",
  },
  subCommands: {
    build,
    validate,
    convert,
    lint,
    assets,
    run,
    preview,
  },
});

runMain(main);
