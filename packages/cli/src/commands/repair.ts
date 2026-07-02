/**
 * `print-md repair [dir]` — diagnose and repair a project's version history.
 *
 * The CLI front-end for the same recovery subsystem the viewer uses
 * (inspectRepo → classifyFromHealth → recover), with a terminal confirmation
 * gate in place of the viewer's dialog. `print-md new` git-inits projects by
 * default, so CLI-only users of the standalone binary need a way out of a
 * stale lock / interrupted operation / damaged repo without git knowledge —
 * this command is that way out (CLAUDE.md §7: no system git required).
 *
 * Modes:
 *   print-md repair            diagnose + prompt before any repair
 *   print-md repair --check    diagnose only; exit 1 when repair is needed
 *   print-md repair --yes      skip the prompt (still prints what will happen)
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
  diagnoseProjectRemote,
  FileTokenStore,
  findEnclosingRepoDir,
  inspectRepo,
  recover,
} from "../index.ts";
import { makeManualGuidance } from "../lib/remote-auth/recovery/manual-guidance.ts";
import type {
  RecoveryContext,
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

/** Render the confirmation summary the viewer's dialog would show. */
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

export default defineCommand({
  meta: {
    name: "repair",
    description: "Diagnose and repair the project's version history",
  },
  args: {
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
  },
  async run({ args }) {
    const openedDir = path.resolve(args.dir ?? ".");
    // A project may be opened at a subfolder of its repo — repair the repo root.
    const repoDir = (await findEnclosingRepoDir(openedDir)) ?? openedDir;

    const health = await inspectRepo({ repoDir });
    const kind = classifyFromHealth(health);

    if (kind === null) {
      console.log("Your project's version history looks healthy. Nothing to repair.");
      return;
    }

    const guidance = makeManualGuidance(
      { repoSlug: path.basename(repoDir) },
      kind,
    );
    console.log(`Found a problem: ${guidance.userSummary}`);

    if (args.check) {
      console.log(`\nRun \`print-md repair\` to fix it. ${guidance.recommendedNextStep}`);
      process.exitCode = 1;
      return;
    }

    // Resolve the remote + credential the structural repairs may need
    // (fetching missing history, recovering a lost .git). Best-effort — a
    // local-only project simply repairs without a remote.
    const tokenStore = new FileTokenStore(defaultConfigDir());
    let remoteUrl: string | undefined;
    let credential;
    let branch = health.currentBranch ?? "";
    try {
      const diag = await diagnoseProjectRemote(repoDir, { tokenStore });
      remoteUrl = diag.remoteUrl;
      branch = branch || diag.branch || "";
      if (diag.remoteHost && diag.credentialPresent) {
        credential = (await tokenStore.get(diag.remoteHost)) ?? undefined;
      }
    } catch {
      // No remote info — the repair proceeds with local facts only.
    }

    const ctx: RecoveryContext = {
      projectDir: openedDir,
      repoDir,
      branch,
      remoteUrl,
      repoSlug: path.basename(repoDir).replace(/[^a-zA-Z0-9_-]/g, "_") || "repo",
      credential,
      tokenStore,
      confirmation: {
        confirmRepair: async (req) => {
          console.log(describeRepair(req));
          if (args.yes) {
            console.log("Proceeding (--yes).");
            return true;
          }
          return promptYesNo("Apply this fix?");
        },
      },
    };

    const result = await recover(kind, ctx);
    console.log("");
    printResult(result);

    // Exit non-zero when the repo still needs attention.
    if (result.status !== "recovered" && result.status !== "retry_later") {
      process.exitCode = 1;
    }
  },
});
