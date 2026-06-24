/**
 * Cross-platform tool detection helper.
 *
 * Wraps the platform's "where is this binary?" command:
 *   - Windows: where.exe
 *   - POSIX:   which
 *
 * Used in two places in the lib:
 *   - packages/cli/src/checks/tool-check.ts — the validation gate, decides
 *     which checks to skip when their backing CLI tool isn't installed.
 *   - packages/cli/src/lib/chromium.ts — PATH-fallback for Chromium when the
 *     fixed-path scan misses non-default installs (Scoop, Chocolatey, Brave,
 *     Vivaldi, Arc, portable installs).
 *   - packages/cli/src/lib/build-runner.ts — pre-flight check at the top of
 *     runBuild so a missing tool becomes an actionable error in 50ms instead
 *     of a confusing ENOENT 90 seconds into the pipeline.
 *
 * One implementation; one place to fix bugs.
 */

import { spawn } from "node:child_process";
import { resolve as resolvePath, join, delimiter } from "node:path";
import { platform } from "node:os";

/**
 * print-md's own node_modules/.bin so locally-installed tools (htmlhint,
 * markdownlint-cli2, stylelint, etc) are findable when running from source.
 */
const localBin = resolvePath(join(import.meta.dirname, "..", "..", "node_modules", ".bin"));
const enhancedPath = `${localBin}${delimiter}${process.env.PATH ?? ""}`;

const IS_WINDOWS = platform() === "win32";
const PROBE_CMD = IS_WINDOWS ? "where.exe" : "which";

/**
 * Returns true if `tool` is resolvable via the platform's path-probe command.
 */
export async function isToolAvailable(tool: string): Promise<boolean> {
  return new Promise((resolve) => {
    const p = spawn(PROBE_CMD, [tool], {
      stdio: ["ignore", "ignore", "ignore"],
      env: { ...process.env, PATH: enhancedPath },
    });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

/**
 * Returns the absolute path of `tool` if it's resolvable on PATH, or undefined.
 *
 * On Windows, where.exe prints one match per line (the first is the highest-
 * priority match in PATH). On POSIX, which prints exactly one line. We always
 * return the first line.
 */
export async function findTool(tool: string): Promise<string | undefined> {
  return new Promise((resolve) => {
    let stdout = "";
    const p = spawn(PROBE_CMD, [tool], {
      stdio: ["ignore", "pipe", "ignore"],
      env: { ...process.env, PATH: enhancedPath },
    });
    p.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    p.on("error", () => resolve(undefined));
    p.on("exit", (code) => {
      if (code !== 0) return resolve(undefined);
      const firstLine = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
      resolve(firstLine?.trim() || undefined);
    });
  });
}
