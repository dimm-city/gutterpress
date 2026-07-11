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
 * One implementation; one place to fix bugs. Spawning goes through
 * exec.ts's `execCapture`, which also owns the shared, correctly
 * delimiter-joined `enhancedPath` (this file used to keep its own copy of
 * that PATH construction, and exec.ts's copy hardcoded `:` — see
 * docs/reviews 2026-07-10-architecture-critical-review.md, finding #3).
 */

import { platform } from "node:os";
import { execCapture } from "./exec";

const IS_WINDOWS = platform() === "win32";
const PROBE_CMD = IS_WINDOWS ? "where.exe" : "which";

/**
 * Returns true if `tool` is resolvable via the platform's path-probe command.
 */
export async function isToolAvailable(tool: string): Promise<boolean> {
  try {
    await execCapture(PROBE_CMD, [tool]);
    return true;
  } catch {
    return false;
  }
}

/**
 * Returns the absolute path of `tool` if it's resolvable on PATH, or undefined.
 *
 * On Windows, where.exe prints one match per line (the first is the highest-
 * priority match in PATH). On POSIX, which prints exactly one line. We always
 * return the first line.
 */
export async function findTool(tool: string): Promise<string | undefined> {
  try {
    const { stdout } = await execCapture(PROBE_CMD, [tool]);
    const firstLine = stdout.split(/\r?\n/).find((line) => line.trim().length > 0);
    return firstLine?.trim() || undefined;
  } catch {
    return undefined;
  }
}
