#!/usr/bin/env node
// tools/check-render-purity.mjs — §8 renderer-purity guardrail.
//
// CLAUDE.md §8 requires the viewer renderer bundle to stay "PWA-clean": it may
// value-import exactly one lib entry (`@dimm-city/print-md/render`), and that
// entry MUST remain free of host/node code. Nothing else enforced this. This
// script scans the built viewer SPA output and FAILS (exit 1) if any forbidden
// host/node token appears in it — the same tokens §8's grep verification lists.
//
// Usage:  node tools/check-render-purity.mjs [buildDir]
//   buildDir defaults to packages/viewer/build/client (relative to the repo
//   root) — the browser assets adapter-node emits. It MUST NOT default to the
//   whole build/ tree: adapter-node also emits build/server/ + build/handler.js
//   (the compiled +server.ts host routes), which are host Node code BY DESIGN
//   (§8) and legitimately contain node:fs/isomorphic-git/etc. Scoping to
//   build/client/ is the whole point of the §8 verification contract.
//   If the dir is absent (no build yet), it prints a skip notice and exits 0,
//   so the check is safe to run before a build.
//
// Dependency-free (Node built-ins only) by design — it must run in bare CI.
// Tested by tools/check-render-purity.test.mjs (node tools/check-render-purity.test.mjs).
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Forbidden host/node markers — a hit means Node-target lib code leaked into the
// renderer bundle (the exact failure that shipped the 0.4.0-beta.4 crash).
// This is exactly §8's canonical verification list — do not widen it (e.g.
// `postcss` was dropped: it's not in §8's grep, and scanning .css for it just
// manufactures false positives).
const FORBIDDEN = [
  "fileURLToPath",
  "node:module",
  "createRequire",
  "node:fs",
  "node:url",
  "isomorphic-git",
];

// Only scan text-y build artifacts; skip source maps and binary assets.
const SCAN_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".html", ".json", ".css"]);

function repoRoot() {
  // tools/ lives at the repo root.
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function walk(dir, out) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      walk(full, out);
    } else if (st.isFile()) {
      const dot = entry.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.slice(dot);
      if (SCAN_EXT.has(ext)) out.push(full);
    }
  }
}

function main() {
  const arg = process.argv[2];
  const buildDir = arg
    ? arg
    : join(repoRoot(), "packages", "viewer", "build", "client");

  if (!existsSync(buildDir)) {
    console.log(
      `check-render-purity: build dir not found (${buildDir}) — skipping (run after the viewer build).`,
    );
    process.exit(0);
  }

  const files = [];
  walk(buildDir, files);

  const violations = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const token of FORBIDDEN) {
      if (text.includes(token)) violations.push({ file, token });
    }
  }

  if (violations.length > 0) {
    console.error(
      "check-render-purity: FAIL — host/node code leaked into the renderer bundle (CLAUDE.md §8).",
    );
    for (const { file, token } of violations) {
      console.error(`  ${token}  ->  ${file}`);
    }
    console.error(
      "\nThe SPA must only value-import @dimm-city/print-md/render, which must stay node-free.",
    );
    process.exit(1);
  }

  console.log(
    `check-render-purity: OK — scanned ${files.length} file(s) in ${buildDir}, no forbidden host/node tokens.`,
  );
  process.exit(0);
}

main();
