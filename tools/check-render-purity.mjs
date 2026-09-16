#!/usr/bin/env node
// tools/check-render-purity.mjs — §8 renderer-purity guardrail.
//
// CLAUDE.md §8 requires the desktop renderer bundle to stay "PWA-clean": it may
// value-import exactly one lib entry (`gutterpress/render`), and that
// entry MUST remain free of host/node code. This script scans the built desktop
// SPA output and FAILS (exit 1) if any forbidden host/node marker appears in
// it. It is the ONE implementation of the client-bundle check — CI runs it
// (.github/workflows/ci.yml) and the desktop app's `npm run build` runs it with
// --strict, so the two invocations can never drift.
//
// Detection policy (three layers):
//   1. Named identifiers that every historical leak carried
//      (fileURLToPath / createRequire / isomorphic-git — the 0.4.0-beta.4 and
//      2026-07 regressions).
//   2. Any QUOTED `node:*` specifier — covers every builtin vite externalizes
//      into a client chunk (node:path, node:v8, node:http2, …). Quoted, because
//      a bare `node:x` also matches minified object properties like `{node:t}`.
//   3. Bare `require("<builtin>")` for every entry in node:module's
//      builtinModules — CJS-interop output that survives bundling. Generated,
//      never hand-listed, so new builtins are covered automatically.
//
// Usage:  node tools/check-render-purity.mjs [buildDir] [--strict]
//   buildDir defaults to packages/desktop/build (relative to the repo root)
//   — the whole SPA build adapter-static emits. adapter-static (SFE-P5d
//   replaced adapter-node) writes a single static file tree with no
//   client/server split — no build/server/, no build/handler.js, no
//   +server.ts routes compiled in anywhere — so there is no host-code
//   subtree left to carve out of the scan; the whole directory IS the
//   renderer bundle. (Before SFE-P5d, adapter-node also emitted
//   build/server/ + build/handler.js, host Node code BY DESIGN (§8) that a
//   narrower build/client/-only scope had to exclude — that carve-out no
//   longer applies and must not be reintroduced without a matching
//   client/server split actually existing again.)
//   Without --strict, an absent dir prints a skip notice and exits 0 (safe to
//   run before a build). With --strict — the desktop build's mode — an absent
//   dir OR zero scanned files is a FAILURE: a gate that scans nothing has
//   silently stopped guarding.
//
// Dependency-free (Node built-ins only) by design — it must run in bare CI.
// Tested by tools/check-render-purity.test.mjs (node tools/check-render-purity.test.mjs).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { builtinModules } from "node:module";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

// Layer 1: named identifiers (substring match — they also catch unquoted use).
const FORBIDDEN_IDENTIFIERS = ["fileURLToPath", "createRequire", "isomorphic-git"];

// Layer 2: any quoted node:-prefixed specifier (digits included: node:v8).
const QUOTED_NODE_SPECIFIER = /["'`]node:[a-z0-9_/]+["'`]/;

// Layer 3: bare require of any builtin, whitespace-tolerant. Generated from
// the runtime's own builtin list; private "_"-prefixed entries excluded.
const BARE_BUILTIN_REQUIRE = new RegExp(
  `(?<![\\w$])require\\(\\s*["'](?:${builtinModules
    .filter((name) => !name.startsWith("_"))
    .map((name) => name.replace(/\//g, "\\/"))
    .join("|")})["']\\s*\\)`,
);

// Only scan text-y build artifacts; skip source maps and binary assets.
const SCAN_EXT = new Set([".js", ".mjs", ".cjs", ".ts", ".html", ".json", ".css"]);

function repoRoot() {
  // tools/ lives at the repo root.
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function walk(dir, out) {
  // withFileTypes + no symlink following: a stray symlink loop in the build
  // output must not turn the gate into an ELOOP crash.
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (entry.isFile()) {
      const dot = entry.name.lastIndexOf(".");
      const ext = dot === -1 ? "" : entry.name.slice(dot);
      if (SCAN_EXT.has(ext)) out.push(full);
    }
  }
}

function findViolation(text) {
  for (const token of FORBIDDEN_IDENTIFIERS) {
    if (text.includes(token)) return token;
  }
  const quoted = QUOTED_NODE_SPECIFIER.exec(text);
  if (quoted) return quoted[0];
  const bare = BARE_BUILTIN_REQUIRE.exec(text);
  if (bare) return bare[0];
  return null;
}

function main() {
  const args = process.argv.slice(2);
  const strict = args.includes("--strict");
  const dirArg = args.find((a) => !a.startsWith("--"));
  const buildDir = dirArg ? dirArg : join(repoRoot(), "packages", "desktop", "build");

  if (!existsSync(buildDir)) {
    if (strict) {
      console.error(
        `check-render-purity: FAIL — build dir not found (${buildDir}) in --strict mode.`,
      );
      process.exit(1);
    }
    console.log(
      `check-render-purity: build dir not found (${buildDir}) — skipping (run after the desktop build).`,
    );
    process.exit(0);
  }

  const files = [];
  walk(buildDir, files);

  if (strict && files.length === 0) {
    console.error(
      `check-render-purity: FAIL — no scannable files under ${buildDir}; ` +
        "the client bundle moved and this gate is scanning nothing. Update the path so it guards again.",
    );
    process.exit(1);
  }

  const violations = [];
  for (const file of files) {
    const token = findViolation(readFileSync(file, "utf8"));
    if (token) violations.push({ file, token });
  }

  if (violations.length > 0) {
    console.error(
      "check-render-purity: FAIL — host/node code leaked into the renderer bundle (CLAUDE.md §8).",
    );
    for (const { file, token } of violations) {
      console.error(`  ${token}  ->  ${file}`);
    }
    console.error(
      "\nThe SPA must only value-import gutterpress/render, which must stay node-free.\n" +
        "Move the Node work into a typed IPC channel (electron/main.ts secureHandle(...),\n" +
        "electron/api/*.ts) and call it through a feature-owned capability module over\n" +
        "src/lib/platform/bridge.ts; use `import type` for types.",
    );
    process.exit(1);
  }

  console.log(
    `check-render-purity: OK — scanned ${files.length} file(s) in ${buildDir}, no forbidden host/node markers.`,
  );
  process.exit(0);
}

main();
