import { existsSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Locate a lint config file for a source check. An explicit relative path
 * (from the check's manifest config) wins when it exists; otherwise the first
 * of `names` found in the input dir is used. Returns null when nothing
 * matches. Shared by the markdownlint and htmlhint wrappers so their
 * config-discovery rules can never drift.
 */
export function findConfigFile(
  inputDir: string,
  names: readonly string[],
  explicit?: string | null,
): string | null {
  if (explicit) {
    const p = resolve(inputDir, explicit);
    return existsSync(p) ? p : null;
  }
  for (const name of names) {
    const p = resolve(inputDir, name);
    if (existsSync(p)) return p;
  }
  return null;
}
