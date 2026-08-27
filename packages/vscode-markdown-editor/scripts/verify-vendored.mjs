#!/usr/bin/env node
/**
 * Verifies packages/vscode-markdown-editor's vendored files against the
 * committed checksums.json manifest.
 *
 * Two independent claims are checked:
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
 * checksums.json intentionally does NOT cover package.json, NOTICE,
 * PATCHES.md, checksums.json itself, or this script — those are
 * gutterpress-authored files, not vendored from the tarball.
 *
 * Exit codes:
 *   0 — every file matched its recorded hash.
 *   1 — at least one file was missing or its hash did not match (integrity
 *       failure — this is the failure this script exists to catch).
 *   2 — usage/environment error: checksums.json missing or malformed, or a
 *       manifest entry pointing outside the package directory.
 */

import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(scriptDir, "..");
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

  if (failures.length > 0) {
    console.error(`[verify-vendored] FAILED — ${failures.length} of ${checked} checked file(s) did not match:\n`);
    for (const f of failures) console.error(`  - ${f}`);
    console.error(
      "\n[verify-vendored] An 'unpatched' mismatch means a vendored file no longer matches the published " +
        "@vscode/markdown-editor@0.0.2-84 tarball. A 'patched' mismatch means dist/index.js or dist/index.d.ts " +
        "no longer matches the reviewed gp-fork patch state. See PATCHES.md.",
    );
    process.exit(1);
  }

  console.log(
    `[verify-vendored] OK — ${unpatchedEntries.length} unpatched file(s) byte-identical to the published tarball, ` +
      `${patchedEntries.length} patched file(s) match the reviewed patch state (${checked} total).`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(`[verify-vendored] FATAL: unexpected error: ${err.stack ?? err.message}`);
  process.exit(2);
});
