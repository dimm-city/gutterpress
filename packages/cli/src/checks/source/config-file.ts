import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

/**
 * Locate a lint config file for a source check by its usual name: the first
 * of `names` in the book's folder, else in the folder above, and so on up to
 * the repository the book lives in (the nearest folder with a `.git`), or the
 * filesystem root when there is none. A book inside a larger repository
 * therefore uses the repository's own `.markdownlint.jsonc`, as the linters'
 * own command-line tools do. Returns null when nothing matches. Shared by the
 * markdownlint, htmlhint and CSS-ownership checks so their config discovery
 * can never drift.
 */
export function findConfigFile(startDir: string, names: readonly string[]): string | null {
  let dir = resolve(startDir);
  for (;;) {
    for (const name of names) {
      const p = resolve(dir, name);
      if (existsSync(p)) return p;
    }
    const parent = dirname(dir);
    if (existsSync(resolve(dir, ".git")) || parent === dir) return null;
    dir = parent;
  }
}
