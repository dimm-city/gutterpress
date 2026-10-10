/**
 * The `.gitignore` every gutterpress book carries: build output (`dist/`) and
 * downloaded extensions (`plugins/npm/`) are regenerable, so neither belongs in
 * the book's version history.
 *
 *   - `dist/` — every build writes an incompressible PDF there; without an
 *     ignore rule the very next auto-snapshot commits and pushes it, growing
 *     `.git` by a PDF per build until one crosses GitHub's 100MB file limit.
 *   - `plugins/npm/` — `gutterpress ext add` vendors a package's whole
 *     dependency tree there. The manifest pins the exact version and a build
 *     downloads a missing copy again (`restorePinnedExtensions`), so a fresh
 *     clone needs nothing from git.
 *
 * The file lives in the PROJECT folder — for a book inside a larger repository
 * (`repo/field-guide/`) that is `repo/field-guide/.gitignore`, which git and
 * the desktop's isomorphic-git snapshot both honour: `isIgnored` reads the
 * `.gitignore` of every directory from the repository root down to the file.
 *
 * Never overwrites: an existing file is only ever APPENDED to, an entry it
 * already covers is left alone, and an entry the author explicitly re-includes
 * (`!plugins/npm/`) is theirs to keep — it is reported, not fought.
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import ignore from "ignore";

/** What a `.gitignore` says about one entry: covered, re-included by the author, or silent. */
type IgnoreStatus = "ignored" | "negated" | "open";

/**
 * Would these `.gitignore` lines ignore a file inside `<entry>`? The matching
 * is the `ignore` package's — gitignore's own rules, incl. `[abc]` classes and
 * the "an ignored directory cannot be re-included from inside" rule — the
 * same matcher isomorphic-git uses for the desktop's snapshots.
 */
function ignoreStatus(gitignore: string, entry: string): IgnoreStatus {
  const matcher = ignore().add(gitignore);
  const dir = matcher.test(entry);
  const file = matcher.test(`${entry}probe`);
  if (file.ignored) return "ignored";
  return dir.unignored || file.unignored ? "negated" : "open";
}

/** Entries every book ignores, in the order they are appended. */
export const PROJECT_GITIGNORE_ENTRIES = ["dist/", "plugins/npm/"] as const;

/**
 * Make sure `<projectDir>/.gitignore` ignores `dist/` and `plugins/npm/`,
 * creating the file or appending what is missing. Returns the entries the
 * author's own rules re-include (left alone) so a caller can warn.
 */
export async function ensureProjectGitignore(projectDir: string): Promise<{ negated: string[] }> {
  const gitignorePath = path.join(projectDir, ".gitignore");
  let existing: string | null = null;
  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    // No .gitignore yet.
  }

  const missing: string[] = [];
  const negated: string[] = [];
  for (const entry of PROJECT_GITIGNORE_ENTRIES) {
    const status = ignoreStatus(existing ?? "", entry);
    if (status === "open") missing.push(entry);
    else if (status === "negated") negated.push(entry);
  }
  if (missing.length > 0) {
    const lead = existing !== null && existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(gitignorePath, `${existing ?? ""}${lead}${missing.join("\n")}\n`, "utf8");
  }
  return { negated };
}
