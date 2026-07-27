#!/usr/bin/env node

import { defineCommand, parseArgs, runMain } from "citty";
import { statSync } from "node:fs";
import pkg from "../package.json" with { type: "json" };
import { previewArgs } from "./commands/preview-args.ts";
import { EXIT_CODES, rejectUnknownFlags, UsageError } from "./lib/cli-args.ts";

// Subcommands are loaded lazily so `--version` and `--help` (and any single
// subcommand) only pay the import cost of what they actually use — e.g.
// puppeteer-core (the biggest dep) stays out of the startup path and only
// loads on `build`/`preview`.
const SUBCOMMANDS = {
  // Primary author commands:
  new: () => import("./commands/new").then((m) => m.default),
  preview: () => import("./commands/preview").then((m) => m.default),
  build: () => import("./commands/build").then((m) => m.default),
  publish: () => import("./commands/publish").then((m) => m.default),
  // CI / advanced:
  lint: () => import("./commands/lint").then((m) => m.default),
  validate: () => import("./commands/validate").then((m) => m.default),
  audit: () => import("./commands/audit").then((m) => m.default),
  preflight: () => import("./commands/preflight").then((m) => m.default),
  repair: () => import("./commands/repair").then((m) => m.default),
  doctor: () => import("./commands/doctor").then((m) => m.default),
  plugin: () => import("./commands/plugin").then((m) => m.default),
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
  setup({ rawArgs }) {
    return preflightRequiredInvocations(rawArgs);
  },
  subCommands: SUBCOMMANDS,
});

function exitUsage(error: unknown): never {
  if (error instanceof UsageError) {
    console.error(error.message);
    process.exit(error.exitCode);
  }
  throw error;
}

async function preflightRequiredInvocations(rawArgs: string[]): Promise<void> {
  const [command, ...commandArgs] = rawArgs;
  try {
    if (command === "new") {
      const { newArgs } = await import("./commands/new");
      rejectUnknownFlags(commandArgs, newArgs, "new");
      const parsed = parseArgs(commandArgs, {
        ...newArgs,
        name: { ...newArgs.name, required: false },
      });
      if (parsed.name === undefined) {
        throw new UsageError("print-md new: missing required positional argument NAME");
      }
      return;
    }

    if (command === "preflight") {
      const { preflightArgs } = await import("./commands/preflight");
      rejectUnknownFlags(commandArgs, preflightArgs, "preflight");
      const parsed = parseArgs(commandArgs, {
        ...preflightArgs,
        pdf: { ...preflightArgs.pdf, required: false },
      });
      if (parsed.pdf === undefined) {
        throw new UsageError("print-md preflight: missing required argument --pdf");
      }
      return;
    }

    if (command !== "plugin") return;
    const [subcommand, ...subcommandArgs] = commandArgs;
    if (subcommand === undefined) return;
    if (subcommand === "--" || subcommand === "-") {
      throw new UsageError(
        `print-md plugin: expected a subcommand before ${subcommand}`,
      );
    }
    if (subcommand.startsWith("-")) return;
    if (subcommand !== "add") {
      throw new UsageError(`print-md plugin: unknown command "${subcommand}"`);
    }
    const { pluginAddArgs } = await import("./commands/plugin");
    rejectUnknownFlags(subcommandArgs, pluginAddArgs, "plugin add");
    const parsed = parseArgs(subcommandArgs, {
      ...pluginAddArgs,
      package: { ...pluginAddArgs.package, required: false },
    });
    if (parsed.package === undefined) {
      throw new UsageError("print-md plugin add: missing required positional argument PACKAGE");
    }
  } catch (error) {
    exitUsage(error);
  }
}

function isDirectory(candidate: string): boolean {
  try {
    return statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function editDistance(left: string, right: string): number {
  let previous = Array.from({ length: right.length + 1 }, (_, i) => i);
  for (let i = 1; i <= left.length; i++) {
    const current = [i];
    for (let j = 1; j <= right.length; j++) {
      current[j] = Math.min(
        current[j - 1]! + 1,
        previous[j]! + 1,
        previous[j - 1]! + (left[i - 1] === right[j - 1] ? 0 : 1)
      );
    }
    previous = current;
  }
  return previous[right.length]!;
}

function closestSubcommand(input: string): string | undefined {
  const commands = Object.keys(SUBCOMMANDS);
  const closest = commands
    .map((command) => ({ command, distance: editDistance(input, command) }))
    .sort((a, b) => a.distance - b.distance)[0];
  if (!closest) return undefined;
  return closest.distance <= Math.max(2, Math.floor(input.length / 3))
    ? closest.command
    : undefined;
}

function resolveImplicitPreview(rawArgs: string[]):
  | { usePreview: true }
  | { usePreview: false; unknownCommand: string } {
  try {
    rejectUnknownFlags(rawArgs, previewArgs, "preview");
  } catch {
    // Let the preview command emit the canonical unknown-option UsageError.
    return { usePreview: true };
  }

  const positional = parseArgs(rawArgs, previewArgs)._[0];
  return positional === undefined || isDirectory(positional)
    ? { usePreview: true }
    : { usePreview: false, unknownCommand: positional };
}

// With no explicit command, keep the author-friendly preview default. A bare
// positional only gets that treatment when it is an existing directory;
// otherwise it is almost certainly a misspelled command and should say so.
const rawArgs = process.argv.slice(2);
if (rawArgs.length === 1 && rawArgs[0] === "plugin") rawArgs.push("--help");
const wantsHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
const wantsVersion =
  rawArgs.length === 1 &&
  (rawArgs[0] === "--version" || rawArgs[0] === "-v");
const firstArg = rawArgs[0];
const isKnownSubcommand = firstArg !== undefined && firstArg in SUBCOMMANDS;
let shouldRun = true;

if (!wantsHelp && !wantsVersion && !isKnownSubcommand) {
  const implicit = resolveImplicitPreview(rawArgs);
  if (implicit.usePreview) {
    rawArgs.unshift("preview");
  } else {
    const suggestion = closestSubcommand(implicit.unknownCommand);
    console.error(
      `Unknown command "${implicit.unknownCommand}".` +
        (suggestion
          ? ` Did you mean "${suggestion}"?`
          : ` Run "print-md --help" to see available commands.`)
    );
    process.exitCode = EXIT_CODES.USAGE;
    shouldRun = false;
  }
}

if (shouldRun) runMain(main, { rawArgs });
