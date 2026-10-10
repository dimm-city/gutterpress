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

/** What a `.gitignore` says about one entry: covered, re-included by the author, or silent. */
type IgnoreStatus = "ignored" | "negated" | "open";

interface Rule {
  negate: boolean;
  dirOnly: boolean;
  re: RegExp;
}

/** One `.gitignore` line as a rule, or null for blanks and comments. The common spellings: `*`, `**`, `?`, `/`-anchoring, trailing `/`, leading `!`. */
function parseRule(line: string): Rule | null {
  let pattern = line.trim();
  if (!pattern || pattern.startsWith("#")) return null;
  const negate = pattern.startsWith("!");
  if (negate) pattern = pattern.slice(1);
  const dirOnly = pattern.endsWith("/");
  if (dirOnly) pattern = pattern.slice(0, -1);
  const anchored = pattern.includes("/");
  if (pattern.startsWith("/")) pattern = pattern.slice(1);
  const body = pattern
    .split(/(\*\*\/|\/\*\*|\*|\?)/)
    .map((part) =>
      part === "**/" ? "(?:.*/)?"
        : part === "/**" ? "/.*"
          : part === "*" ? "[^/]*"
            : part === "?" ? "[^/]"
              : part.replace(/[.+^${}()|[\]\\]/g, "\\$&"),
    )
    .join("");
  return { negate, dirOnly, re: new RegExp(`^${anchored ? "" : "(?:.*/)?"}${body}$`) };
}

/**
 * Would these `.gitignore` lines ignore `<entry>/…`? Walks the entry's
 * ancestors like git does (a directory that is ignored cannot be re-included
 * from inside); within one path the last matching rule wins.
 */
function ignoreStatus(lines: string[], entry: string): IgnoreStatus {
  const rules = lines.map(parseRule).filter((r): r is Rule => r !== null);
  const parts = entry.replace(/\/$/, "").split("/");
  let negated = false;
  // The ancestors of the entry, the entry itself (a directory), then a file inside it.
  const probes = [...parts.map((_, i) => ({ p: parts.slice(0, i + 1).join("/"), dir: true })), { p: `${parts.join("/")}/probe`, dir: false }];
  for (const { p, dir } of probes) {
    let verdict: boolean | null = null;
    for (const rule of rules) {
      if (rule.dirOnly && !dir) continue;
      if (!rule.re.test(p)) continue;
      verdict = !rule.negate;
      if (rule.negate) negated = true;
    }
    if (verdict) return "ignored";
  }
  return negated ? "negated" : "open";
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

  const lines = (existing ?? "").split(/\r?\n/);
  const missing: string[] = [];
  const negated: string[] = [];
  for (const entry of PROJECT_GITIGNORE_ENTRIES) {
    const status = ignoreStatus(lines, entry);
    if (status === "open") missing.push(entry);
    else if (status === "negated") negated.push(entry);
  }
  if (missing.length > 0) {
    const lead = existing !== null && existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
    await writeFile(gitignorePath, `${existing ?? ""}${lead}${missing.join("\n")}\n`, "utf8");
  }
  return { negated };
}
