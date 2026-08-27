#!/usr/bin/env node
/**
 * Verifies packages/vscode-markdown-editor's vendored files against the
 * committed checksums.json manifest.
 *
 * Three independent claims are checked:
 *
 *   1. "unpatched" files — every vendored file EXCEPT dist/index.js and
 *      dist/index.d.ts — must still byte-match the sha256 recorded in
 *      checksums.json.unpatched, which was computed at vendor time directly
 *      from the published @vscode/markdown-editor@0.0.2-84 tarball, BEFORE
 *      any patch was applied. A match proves this file is still exactly
 *      what npm published — no silent local edit.
 *
 *   2. "patched" files — dist/index.js and dist/index.d.ts — must match the
 *      POST-patch sha256 recorded in checksums.json.patched. A match proves
 *      these files are exactly the reviewed gp-fork renderCustomBlock patch
 *      state — no undocumented drift in either direction (further edits, or
 *      an accidental revert toward the unpatched original).
 *
 *   3. Completeness — every file git tracks under this package, EXCEPT the
 *      small gutterpress-authored allowlist below, must appear as a key in
 *      checksums.json.unpatched OR checksums.json.patched. This is what
 *      claims (1) and (2) do NOT prove on their own: they are manifest-
 *      driven (they only look at the paths the manifest already names), so
 *      neither one alone would notice a file added to the tree, or a
 *      manifest entry quietly deleted, without checksums.json itself being
 *      re-verified against what git actually tracks. A file that is
 *      git-tracked, not allowlisted, and not a manifest key fails this
 *      check — including checksums.json being edited to drop an entry for a
 *      file that still exists on disk.
 *
 * The gutterpress-authored allowlist — files this package's own tooling
 * writes, not files vendored from the published tarball, so they are
 * intentionally absent from checksums.json's unpatched/patched maps and
 * exempt from claim 3 above: package.json, NOTICE, PATCHES.md,
 * checksums.json, .gitignore, and everything under scripts/ (this script and
 * its self-test).
 *
 * Exit codes:
 *   0 — every file matched its recorded hash, and every tracked file is
 *       accounted for in the manifest.
 *   1 — at least one file was missing, its hash did not match, or a tracked
 *       file was not accounted for in the manifest (integrity failure —
 *       this is the failure this script exists to catch).
 *   2 — usage/environment error: checksums.json missing or malformed, a
 *       manifest entry pointing outside the package directory, or `git
 *       ls-files` could not be run against the package root.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

// Files this package's own tooling authors — not vendored from the
// published tarball, so they are exempt from both the hash manifest and the
// completeness pass below. Exact-name allowlist plus one directory prefix,
// mirroring tools/check-generated-files.mjs's ALLOWLIST_PREFIXES pattern:
// explicit and narrow, never a broad heuristic that could also swallow a
// vendored file.
const ALLOWLIST_EXACT = new Set(["package.json", "NOTICE", "PATCHES.md", "checksums.json", ".gitignore"]);
const ALLOWLIST_PREFIXES = ["scripts/"];

function isAllowlisted(relPath) {
  if (ALLOWLIST_EXACT.has(relPath)) return true;
  return ALLOWLIST_PREFIXES.some((prefix) => relPath.startsWith(prefix));
}

function parseArgs(argv) {
  let root;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") {
      root = argv[i + 1];
      i++;
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
    }
  }
  return { root };
}

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const { root: rootArg } = parseArgs(process.argv.slice(2));
// --root lets verify-vendored.test.mjs point this script at a disposable
// fixture package directory instead of the live vendored package, so the
// sabotage cases never touch this repo's real tracked files.
const packageRoot = rootArg ? path.resolve(rootArg) : path.resolve(scriptDir, "..");
const checksumsPath = path.join(packageRoot, "checksums.json");

/** Resolves `relPath` under `packageRoot` and rejects any escape attempt. */
function resolveVendoredPath(relPath) {
  const resolved = path.resolve(packageRoot, relPath);
  const rootWithSep = packageRoot.endsWith(path.sep) ? packageRoot : packageRoot + path.sep;
  if (resolved !== packageRoot && !resolved.startsWith(rootWithSep)) {
    throw new Error(`checksums.json entry escapes the package directory: ${relPath}`);
  }
  return resolved;
}

async function sha256(filePath) {
  const buf = await readFile(filePath);
  return createHash("sha256").update(buf).digest("hex");
}

/**
 * Every path git tracks at or below packageRoot, relative to packageRoot.
 * Run with cwd = packageRoot so the returned paths are already relative to
 * it (git's default behavior from within a subdirectory), matching
 * checksums.json's own relative-path convention.
 */
function listTrackedFiles(root) {
  // -z: NUL-separated, so filenames containing newlines can't corrupt parsing.
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw.split("\0").filter((p) => p.length > 0);
}

async function main() {
  let manifest;
  try {
    const raw = await readFile(checksumsPath, "utf8");
    manifest = JSON.parse(raw);
  } catch (err) {
    console.error(`[verify-vendored] FATAL: could not read/parse ${checksumsPath}: ${err.message}`);
    process.exit(2);
  }

  const unpatched = manifest.unpatched;
  const patched = manifest.patched;
  if (!unpatched || typeof unpatched !== "object" || !patched || typeof patched !== "object") {
    console.error(
      "[verify-vendored] FATAL: checksums.json is missing its 'unpatched' and/or 'patched' object.",
    );
    process.exit(2);
  }

  const unpatchedEntries = Object.entries(unpatched);
  const patchedEntries = Object.entries(patched);

  if (unpatchedEntries.length === 0) {
    console.error("[verify-vendored] FATAL: checksums.json.unpatched is empty — nothing to verify.");
    process.exit(2);
  }
  if (patchedEntries.length === 0) {
    console.error("[verify-vendored] FATAL: checksums.json.patched is empty — nothing to verify.");
    process.exit(2);
  }

  const failures = [];
  let checked = 0;

  for (const [relPath, expected, group] of [
    ...unpatchedEntries.map(([p, h]) => [p, h, "unpatched"]),
    ...patchedEntries.map(([p, h]) => [p, h, "patched"]),
  ]) {
    let absPath;
    try {
      absPath = resolveVendoredPath(relPath);
    } catch (err) {
      failures.push(`[${group}] ${relPath}: ${err.message}`);
      continue;
    }

    let actual;
    try {
      actual = await sha256(absPath);
    } catch (err) {
      failures.push(`[${group}] ${relPath}: could not read file (${err.code ?? err.message})`);
      continue;
    }

    checked += 1;
    if (actual !== expected) {
      failures.push(`[${group}] ${relPath}: hash mismatch\n    expected ${expected}\n    actual   ${actual}`);
    }
  }

  // Completeness pass (claim 3): every git-tracked file under this package,
  // outside the gutterpress-authored allowlist, must be a manifest key.
  // This is what catches a file added to the tree without a manifest entry,
  // AND a manifest entry silently removed for a file that still exists —
  // neither of which the manifest-driven loop above can see, since it only
  // ever looks at paths the manifest already names.
  let trackedFiles;
  try {
    trackedFiles = listTrackedFiles(packageRoot);
  } catch (err) {
    console.error(
      `[verify-vendored] FATAL: \`git ls-files\` failed against ${packageRoot}: ${err.message}`,
    );
    process.exit(2);
    return;
  }

  const manifestPaths = new Set([...unpatchedEntries.map(([p]) => p), ...patchedEntries.map(([p]) => p)]);
  const unlisted = [];
  for (const file of trackedFiles) {
    if (isAllowlisted(file)) continue;
    if (!manifestPaths.has(file)) unlisted.push(file);
  }
  if (unlisted.length > 0) {
    for (const file of unlisted) {
      failures.push(
        `[completeness] ${file}: git-tracked but not a key in checksums.json's 'unpatched' or 'patched' map`,
      );
    }
  }

  if (failures.length > 0) {
    console.error(`[verify-vendored] FAILED — ${failures.length} issue(s) found:\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\n[verify-vendored] An 'unpatched' mismatch means a vendored file no longer matches the published " +
        "@vscode/markdown-editor@0.0.2-84 tarball. A 'patched' mismatch means dist/index.js or dist/index.d.ts " +
        "no longer matches the reviewed gp-fork patch state. A 'completeness' failure means a git-tracked file " +
        "in this package is not accounted for in checksums.json at all — either a new file was added without a " +
        "manifest entry, or an existing entry was removed from checksums.json. See PATCHES.md.",
    );
    process.exit(1);
  }

  console.log(
    `[verify-vendored] OK — ${unpatchedEntries.length} unpatched file(s) byte-identical to the published tarball, ` +
      `${patchedEntries.length} patched file(s) match the reviewed patch state (${checked} hash(es) checked), ` +
      `${trackedFiles.length} tracked file(s) all accounted for in the manifest.`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[verify-vendored] FATAL: unexpected error: ${err.stack ?? err.message}`);
  process.exit(2);
});
