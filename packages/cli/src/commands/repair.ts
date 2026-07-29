/**
 * `gutterpress repair [dir]` — diagnose and repair a project's version history.
 *
 * The CLI front-end for the same recovery subsystem the desktop uses
 * (inspectRepo → classifyFromHealth → recover), with a terminal confirmation
 * gate in place of the desktop's dialog. `gutterpress new` initializes projects by
 * default, so CLI-only users of the standalone binary need a way out of a
 * stale lock / interrupted operation / damaged repo without git knowledge —
 * this command is that way out (CLAUDE.md §7: no system git required).
 *
 * Modes:
 *   gutterpress repair            diagnose + prompt before any repair
 *   gutterpress repair --check    diagnose only; exit 1 when repair is needed
 *   gutterpress repair --yes      skip the prompt (still prints what will happen)
 *   gutterpress repair --force    repair even if the app appears to have this open
 *
 * The app-open guard: the desktop leaves a small liveness marker under the
 * repo's own `.git` dir while a project is open (app-heartbeat.ts). A fresh
 * marker means the app may be mid-write on this same repo right now, so
 * `repair` refuses to mutate anything (still safe to `--check`) unless the
 * author passes `--force`. This is detection + an explicit override, not a
 * cross-process lock — the author is always in control.
 *
 * All git work happens in the shared library (isomorphic-git); this file is
 * argument parsing, terminal I/O, and exit codes only.
 */

import { defineCommand } from "citty";
import * as readline from "node:readline/promises";
import path from "node:path";

import {
  buildRecoveryContext,
  classifyFromHealth,
  classifyGitError,
  defaultConfigDir,
  FileTokenStore,
  inspectRepo,
  isAppHeartbeatFresh,
  isUnbornRepo,
  recover,
  verifyRepoReadable,
} from "../index.ts";
import { makeManualGuidance } from "../lib/remote-auth/recovery/manual-guidance.ts";
import {
  rejectExtraPositionals,
  rejectUnknownFlags,
  UsageError,
} from "../lib/cli-args.ts";
import type {
  ConfirmationGate,
  RecoveryResult,
  RepairConfirmation,
} from "../lib/remote-auth/recovery/types.ts";

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

/** Render the confirmation summary the desktop's dialog would show. */
function describeRepair(req: RepairConfirmation): string {
  const lines = [
    "",
    `  ${req.summary}`,
    "",
    `  • Changes your project files:        ${req.willChangeLocalFiles ? "yes" : "no"}`,
    `  • Changes version-history internals: ${req.willChangeGitMetadata ? "yes" : "no"}`,
    `  • Changes anything online:           ${req.willChangeRemote ? "yes" : "no"}`,
  ];
  if (req.backupZipPath) {
    lines.push(`  • Safety copy saved first:           ${req.backupZipPath}`);
  }
  lines.push("");
  return lines.join("\n");
}

function printResult(result: RecoveryResult): void {
  console.log(result.message);
  if ("guidance" in result && result.guidance) {
    const g = result.guidance;
    console.log(`\nNext step: ${g.recommendedNextStep}`);
    for (const step of g.safeNextSteps ?? []) console.log(`  - ${step}`);
    if (g.supportDetails) console.log(`\nDetails (for support): ${g.supportDetails}`);
  }
  if ("backupZipPath" in result && result.backupZipPath) {
    console.log(`\nSafety copy: ${result.backupZipPath}`);
  }
}

/** Terminal confirmation gate: show the summary, then prompt (or honor --yes). */
function terminalConfirmationGate(autoApprove: boolean): ConfirmationGate {
  return {
    confirmRepair: async (req) => {
      console.log(describeRepair(req));
      if (autoApprove) {
        console.log("Proceeding (--yes).");
        return true;
      }
      return promptYesNo("Apply this fix?");
    },
  };
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
  force: {
    type: "boolean",
        description: "Repair even if the Gutterpress app appears to have this project open",
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

    // The lib resolves everything (the project's OWN repo root — never an
    // ancestor repo — branch, remote, credential, backup slug); this command
    // contributes only the terminal confirmation gate.
    const ctx = await buildRecoveryContext({
      projectDir: openedDir,
      confirmation: terminalConfirmationGate(args.yes),
      tokenStore: new FileTokenStore(defaultConfigDir()),
    });

    const health = await inspectRepo({ repoDir: ctx.repoDir, source: ctx.source });
    // minLockAgeMs: 0 — a stuck lock the author is asking us to look at right
    // now should be diagnosed regardless of age; the stale-lock HANDLER still
    // re-checks age itself and returns retry_later while the lock is fresh,
    // so this only affects what `repair` reports, not whether it acts.
    let kind = classifyFromHealth(health, { minLockAgeMs: 0 });

    if (kind === null) {
      // classifyFromHealth only inspects filesystem PRESENCE (lock files,
      // MERGE_HEAD, HEAD readability) — it never reads a git object, so it
      // can't see object-store or index corruption. Probe readability (the
      // same HEAD/commit/tree check the missing-objects repair uses to
      // verify a fix) before declaring the repo healthy, so corrupt_index /
      // missing_or_corrupt_objects / unrelated_histories / wrong_remote_or_branch
      // repos are diagnosed correctly instead of reported "healthy".
      try {
        await verifyRepoReadable(ctx.repoDir);
      } catch (err) {
        // A fresh `git init` with no commits yet throws the same
        // NotFoundError as a damaged ref store — but it's healthy, not
        // corrupt. Only classify when the object store shows the repo ever
        // had content.
        if (!isUnbornRepo(ctx.repoDir)) {
          kind = classifyGitError(err, health);
        }
      }
    }

    if (kind === null) {
      console.log("Your project's version history looks healthy. Nothing to repair.");
      return;
    }

    const guidance = makeManualGuidance(ctx, kind);
    console.log(`Found a problem: ${guidance.userSummary}`);

    if (args.check) {
      console.log(`\nRun \`gutterpress repair\` to fix it. ${guidance.recommendedNextStep}`);
      process.exitCode = 1;
      return;
    }

    // --check is diagnose-only and never reaches here, so this guard only ever
    // blocks an actual repair. A fresh heartbeat means the app may be mid-write
    // on this same project right now — refuse to race it unless overridden.
    if (!args.force && (await isAppHeartbeatFresh(ctx.repoDir))) {
      console.log(
        "\nThe Gutterpress app appears to have this project open. Close it first, or re-run with --force.",
      );
      process.exitCode = 1;
      return;
    }

    const result = await recover(kind, ctx);
    console.log("");
    printResult(result);

    // Exit non-zero when the repo still needs attention.
    if (result.status !== "recovered" && result.status !== "retry_later") {
      process.exitCode = 1;
    }
  },
});
