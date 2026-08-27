#!/usr/bin/env node
// packages/editor/scripts/check-browser-purity.mjs — SFE-P1a browser-purity
// guardrail for @dimm-city/gutterpress-editor.
//
// D4 (docs/plans/source-first-editor-enterprise-refactor.md): "packages/editor
// ... no Svelte, Electron, vscode, node:fs, or desktop imports." This script
// is the dependency-free, sabotage-tested enforcement of that rule: it scans
// packages/editor/src for forbidden import/require specifiers and FAILS
// (exit 1) if any appear. Structure mirrors tools/check-render-purity.mjs;
// exit-code convention mirrors tools/check-generated-files.mjs.
//
// Forbidden:
//   1. Every Node builtin, prefixed OR bare ("fs", "node:fs",
//      "node:fs/promises", "path/posix", ...) — the bare-name set is
//      derived from node:module's own `builtinModules` IN THIS SCRIPT
//      (this script itself runs under node/bun, so importing node:module
//      here is fine — it is packages/editor/src that must stay Node-free),
//      so the list is always version-accurate and never hand-maintained.
//      A quoted "node:..." specifier is ALSO checked with a standalone
//      regex as a second, independent layer (defense in depth, mirrors
//      tools/check-render-purity.mjs's layering) in case a specifier-
//      extraction miss lets one slip past layer 1.
//   2. "svelte" and any "svelte/..." subpath; "@sveltejs/*".
//   3. "electron" and any "electron/..." subpath.
//   4. "vscode" (the VS Code extension-host API module) and any
//      "vscode/..." subpath.
//   5. "@dimm-city/gutterpress-desktop" and any subpath of it.
//   6. A relative import ("./..." or "../...") that RESOLVES outside the
//      package root (one directory above the scanned src/ dir by default)
//      — e.g. "../../cli/src/whatever" reaching into a sibling workspace
//      package.
//
// This checker deliberately does NOT special-case `import type` — even a
// type-only forbidden import is flagged, since packages/editor ships as raw
// TypeScript source with no build step yet (nothing erases it before a
// consumer could resolve it) and D4 draws no "types are fine" exception for
// this package the way CLAUDE.md §8 does for the desktop SPA's Node-target
// lib import.
//
// Usage:  node scripts/check-browser-purity.mjs [srcDir] [--package-root <dir>]
//   srcDir defaults to <packageRoot>/src, where packageRoot is the directory
//   containing this scripts/ dir (i.e. packages/editor).
//   --package-root overrides the boundary used for the relative-escape
//   check (rule 6); defaults to dirname(srcDir). Only the self-test
//   (check-browser-purity.test.mjs) needs to pass it explicitly, so it can
//   point both at disposable temp directories shaped like a real package.
//
// Exit codes: 0 clean, 1 a forbidden specifier was found, 2 internal/usage
// error (e.g. srcDir does not exist or is not a directory).
//
// Dependency-free (Node built-ins only) by design, matching this package's
// own zero-runtime-dependency contract.
// Tested by scripts/check-browser-purity.test.mjs.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { builtinModules } from "node:module";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

// Every Node builtin's BARE (unprefixed) name, including subpath forms like
// "fs/promises" — builtinModules already lists those. Private "_"-prefixed
// entries excluded (never a real import target).
const BARE_BUILTINS = new Set(builtinModules.filter((name) => !name.startsWith("_")));

// Layer 2 (defense in depth): any quoted "node:"-prefixed specifier, even
// one layer-1 extraction might miss.
const QUOTED_NODE_SPECIFIER = /["'`]node:[a-z0-9_/]+["'`]/;

// Same specifier-extraction shape as packages/cli/scripts/check-render-pure.mjs:
// static import/export, dynamic import(), and require().
const SPECIFIER_PATTERNS = [
  /(?:^|[^\w.])(?:import|export)\s*(?:[\w*\s{},$]+from\s*)?["']([^"']+)["']/g,
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
  /require\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const SCAN_EXT = new Set([".ts", ".tsx", ".mts", ".js", ".mjs", ".cjs"]);

function scriptsDir() {
  return dirname(fileURLToPath(import.meta.url));
}

function walk(dir, out) {
  // withFileTypes + no symlink following: a stray symlink loop must not
  // turn the gate into an ELOOP crash.
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

function specifiersOf(text) {
  const out = [];
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    for (let m; (m = pattern.exec(text)); ) out.push(m[1]);
  }
  return out;
}

function isForbiddenBareSpecifier(spec) {
  if (spec.startsWith("node:")) return `Node builtin "${spec}"`;
  if (BARE_BUILTINS.has(spec)) return `Node builtin "${spec}"`;
  if (spec === "svelte" || spec.startsWith("svelte/")) return `Svelte import "${spec}"`;
  if (spec.startsWith("@sveltejs/")) return `@sveltejs import "${spec}"`;
  if (spec === "electron" || spec.startsWith("electron/")) return `Electron import "${spec}"`;
  if (spec === "vscode" || spec.startsWith("vscode/")) return `vscode import "${spec}"`;
  if (
    spec === "@dimm-city/gutterpress-desktop" ||
    spec.startsWith("@dimm-city/gutterpress-desktop/")
  ) {
    return `desktop package import "${spec}"`;
  }
  return null;
}

function relativeEscape(spec, filePath, packageRoot) {
  if (!spec.startsWith("./") && !spec.startsWith("../")) return null;
  const resolved = resolve(dirname(filePath), spec);
  const rel = relative(packageRoot, resolved);
  if (rel === "") return null; // resolves to the package root itself — allowed
  const firstSegment = rel.split(sep)[0];
  if (firstSegment === "..") {
    return `relative import "${spec}" resolves outside the package (${resolved})`;
  }
  return null;
}

function findViolations(filePath, text, packageRoot) {
  const violations = [];

  const quotedNode = QUOTED_NODE_SPECIFIER.exec(text);
  if (quotedNode) violations.push(`quoted node specifier ${quotedNode[0]}`);

  for (const spec of specifiersOf(text)) {
    const bare = isForbiddenBareSpecifier(spec);
    if (bare) {
      violations.push(bare);
      continue;
    }
    const escape = relativeEscape(spec, filePath, packageRoot);
    if (escape) violations.push(escape);
  }

  return violations;
}

function parseArgs(argv) {
  let packageRoot;
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--package-root") {
      packageRoot = argv[i + 1];
      i++;
    } else if (arg.startsWith("--package-root=")) {
      packageRoot = arg.slice("--package-root=".length);
    } else {
      positional.push(arg);
    }
  }
  return { packageRoot, positional };
}

function main() {
  const { packageRoot: packageRootArg, positional } = parseArgs(process.argv.slice(2));
  const srcDir = positional[0] ?? join(dirname(scriptsDir()), "src");
  const packageRoot = packageRootArg ?? dirname(srcDir);

  if (!existsSync(srcDir)) {
    console.error(`check-browser-purity: ERROR — src dir not found: ${srcDir}`);
    process.exit(2);
  }
  if (!statSync(srcDir).isDirectory()) {
    console.error(`check-browser-purity: ERROR — not a directory: ${srcDir}`);
    process.exit(2);
  }

  const files = [];
  walk(srcDir, files);

  const allViolations = [];
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    for (const violation of findViolations(file, text, packageRoot)) {
      allViolations.push({ file, violation });
    }
  }

  if (allViolations.length > 0) {
    console.error(
      `check-browser-purity: FAIL — forbidden import(s) found under ${srcDir} (D4).`,
    );
    for (const { file, violation } of allViolations) {
      console.error(`  ${violation}  ->  ${file}`);
    }
    console.error(
      "\npackages/editor must stay framework-free and browser-safe: no Svelte, Electron,\n" +
        "vscode, Node builtins, or desktop imports, and no relative import escaping the package.",
    );
    process.exit(1);
  }

  console.log(
    `check-browser-purity: OK — scanned ${files.length} file(s) under ${srcDir}, no forbidden imports.`,
  );
  process.exit(0);
}

main();
