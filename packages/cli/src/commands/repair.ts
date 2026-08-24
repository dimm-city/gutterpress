/**
 * `gutterpress repair [dir]` — diagnose and repair a project's version history.
 *
 * The CLI front-end for the SAME single repair pipeline the desktop uses
 * (`repairRepo` — see lib/remote-auth/recovery/repair.ts): health probe →
 * stale-lock sweep → in-place fixes → last-resort re-clone with salvage.
 * Working files are never touched; every readable commit stays reachable; the
 * damaged `.git` is kept on disk in the OS temp dir (`gutterpress-damaged-*`),
 * outside the project so a later snapshot can never commit it.
 *
 * Modes:
 *   gutterpress repair            diagnose + one y/N prompt before repairing
 *   gutterpress repair --check    diagnose only; exit 1 when repair is needed
 *   gutterpress repair --yes      skip the prompt
 *
 * All git work happens in the shared library (isomorphic-git); this file is
 * argument parsing, terminal I/O, and exit codes only.
 */

import { defineCommand } from "citty";
import * as readline from "node:readline/promises";
import path from "node:path";

import {
  classifyFromHealth,
  defaultConfigDir,
  FileTokenStore,
  inspectRepo,
  isUnbornRepo,
  repairRepo,
  verifyRepoReadable,
} from "../index.ts";
import {
  rejectExtraPositionals,
  rejectUnknownFlags,
  UsageError,
} from "../lib/cli-args.ts";

/** Ask a y/N question on the terminal. Non-interactive stdin → false (deny). */
async function promptYesNo(question: string): Promise<boolean> {
  if (!process.stdin.isTTY) return false;
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
    return answer === "y" || answer === "yes";
  } finally {
    rl.close();
  }
}

const commandArgs = {
  dir: {
    type: "positional",
    description: "Project directory (defaults to the current directory)",
    required: false,
  },
  check: {
    type: "boolean",
    description: "Diagnose only — never change anything (exit 1 when repair is needed)",
    default: false,
  },
  yes: {
    type: "boolean",
    description: "Approve the repair without prompting",
    default: false,
  },
} as const;

export default defineCommand({
  meta: {
    name: "repair",
    description: "Diagnose and repair the project's version history",
  },
  args: commandArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, commandArgs, "repair");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "repair");
    } catch (error) {
      if (error instanceof UsageError) {
        console.error(error.message);
        process.exitCode = error.exitCode;
        return;
      }
      throw error;
    }

    const openedDir = path.resolve(args.dir ?? ".");

    // Diagnose. classifyFromHealth only inspects filesystem PRESENCE (lock
    // files, MERGE_HEAD, HEAD readability) — it never reads a git object, so
    // object-store/index corruption is probed separately with
    // verifyRepoReadable (an unborn fresh repo throws the same NotFoundError
    // but is healthy, hence the isUnbornRepo carve-out).
    const health = await inspectRepo({ repoDir: openedDir });
    let needsRepair = classifyFromHealth(health, { minLockAgeMs: 0 }) !== null;
    if (!needsRepair && health.hasGitDir) {
      try {
        await verifyRepoReadable(openedDir);
      } catch {
        if (!isUnbornRepo(openedDir)) needsRepair = true;
      }
    }
    if (!health.hasGitDir) needsRepair = true;

    if (!needsRepair) {
      console.log("Your project's version history looks healthy. Nothing to repair.");
      return;
    }

    console.log("Found a problem with this project's version history.");

    if (args.check) {
      console.log("\nRun `gutterpress repair` to fix it. Your files will not be changed.");
      process.exitCode = 1;
      return;
    }

    if (!args.yes) {
      console.log(
        "\nThe repair never changes your project files. If history has to be rebuilt,\n" +
          "the old history folder is kept on disk as a backup and your saved versions\n" +
          "are brought back into it wherever they are still readable.",
      );
      if (!(await promptYesNo("Repair now?"))) {
        console.log("Nothing was changed.");
        process.exitCode = 1;
        return;
      }
    }

    const result = await repairRepo({
      projectDir: openedDir,
      tokenStore: new FileTokenStore(defaultConfigDir()),
    });

    console.log(`\n${result.message}`);
    for (const action of result.actions) console.log(`  - ${action}`);
    if (result.damagedGitBackupPath) {
      console.log(`  - Old history kept at: ${result.damagedGitBackupPath}`);
    }
    if (result.status !== "repaired") process.exitCode = 1;
  },
});
