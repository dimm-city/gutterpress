/**
 * Shared corpus walker for the editor gates (review finding: the
 * readdir/filter/stat/sort dance was pasted into both corpus suites; new
 * suites should import from here — the sibling route-test-helpers.ts exists
 * for exactly the same reason).
 */
import { readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** The monorepo root. (URL form, not `import.meta.dir` — this dir is not in
 * the tsconfig test excludes, so svelte-check type-checks it without Bun's
 * ImportMeta augmentation.) */
export const REPO = resolve(fileURLToPath(new URL("../../../..", import.meta.url)));

/**
 * Every `.md` file directly inside `dir`, sorted. A missing book resolves to
 * `[]` rather than throwing — each suite's "must not pass vacuously" test is
 * what catches a corpus that silently went absent.
 */
export function mdFilesIn(dir: string): string[] {
  try {
    return readdirSync(dir)
      .filter((n) => n.endsWith(".md"))
      .map((n) => join(dir, n))
      .filter((p) => statSync(p).isFile())
      .sort();
  } catch {
    return [];
  }
}
