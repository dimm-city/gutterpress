// Test for scripts/check-browser-purity.mjs — run with:
//   node scripts/check-browser-purity.test.mjs
// (also auto-discovered and run by `bun test` from packages/editor, since
// Bun's default test globbing matches any "*.test.mjs" file recursively).
//
// Verifies the D4 browser-purity guardrail (SFE-P1a): a clean src/ directory
// exits 0, while a directory containing any forbidden specifier exits 1 —
// proven with sabotage fixtures per specifier class, plus the "resolves
// outside the package" relative-escape rule, an absent-directory usage
// error, and a false-positive check. Conventions follow
// tools/check-render-purity.test.mjs / tools/check-generated-files.test.mjs.
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-browser-purity.mjs");

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`NOT OK - ${name}: expected exit ${expected}, got ${actual}`);
  }
}

function run(...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
}

function withTempSrc(fn) {
  // Shape it like a real package: <root>/src/... — so the default
  // "packageRoot = dirname(srcDir)" boundary matches production usage.
  const root = mkdtempSync(join(tmpdir(), "browser-purity-"));
  const src = join(root, "src");
  mkdirSync(src, { recursive: true });
  try {
    fn(root, src);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// Case 1: clean src directory => exit 0.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "contracts.ts"), "export const x = 1;\n");
  writeFileSync(join(src, "index.ts"), "export * from './contracts.ts';\n");
  check("clean src directory exits 0", run(src).status, 0);
});

// Case 2: "node:fs" import => exit 1.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "bad.ts"), "import { readFileSync } from 'node:fs';\n");
  check("node:fs import exits 1", run(src).status, 1);
});

// Case 3: bare (unprefixed) Node builtin => exit 1.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "bad.ts"), "import path from 'path';\n");
  check("bare Node builtin import (path) exits 1", run(src).status, 1);
});

// Case 4: Node builtin subpath form, in a nested directory => exit 1.
withTempSrc((_root, src) => {
  mkdirSync(join(src, "nested"));
  writeFileSync(join(src, "nested", "bad.ts"), "import { readFile } from 'fs/promises';\n");
  check("Node builtin subpath (fs/promises) exits 1", run(src).status, 1);
});

// Case 5: svelte => exit 1.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "bad.ts"), "import { onMount } from 'svelte';\n");
  check("svelte import exits 1", run(src).status, 1);
});

// Case 6: svelte subpath => exit 1.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "bad.ts"), "import { writable } from 'svelte/store';\n");
  check("svelte/store subpath import exits 1", run(src).status, 1);
});

// Case 7: @sveltejs/* => exit 1.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "bad.ts"), "import type { Handle } from '@sveltejs/kit';\n");
  check("@sveltejs/kit import exits 1", run(src).status, 1);
});

// Case 8: electron => exit 1.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "bad.ts"), "import { ipcRenderer } from 'electron';\n");
  check("electron import exits 1", run(src).status, 1);
});

// Case 9: vscode => exit 1.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "bad.ts"), "import * as vscode from 'vscode';\n");
  check("vscode import exits 1", run(src).status, 1);
});

// Case 10: @dimm-city/gutterpress-desktop => exit 1.
withTempSrc((_root, src) => {
  writeFileSync(
    join(src, "bad.ts"),
    "import { something } from '@dimm-city/gutterpress-desktop';\n",
  );
  check("desktop package import exits 1", run(src).status, 1);
});

// Case 11: relative import escaping the package (three levels up from
// src/deep/, which is two levels below the package root) => exit 1.
withTempSrc((_root, src) => {
  const deep = join(src, "deep");
  mkdirSync(deep);
  writeFileSync(join(deep, "bad.ts"), "import { thing } from '../../../outside/thing.ts';\n");
  check("relative import escaping the package exits 1", run(src).status, 1);
});

// Case 12: relative import that stays WITHIN the package (reaches the
// sibling scripts/ dir, not outside it) => exit 0.
withTempSrc((root, src) => {
  mkdirSync(join(root, "scripts"), { recursive: true });
  writeFileSync(join(src, "ok.ts"), "import { helper } from '../scripts/helper.mjs';\n");
  check("relative import staying within the package exits 0", run(src).status, 0);
});

// Case 13: no false positive — a minified-looking object property
// `{node:t}` (no quotes around "node:") must not trip the quoted-specifier
// layer.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "ok.ts"), "const a = { node: 1, parent: 2 };\nexport { a };\n");
  check("minified-looking {node:1} property passes (exit 0)", run(src).status, 0);
});

// Case 14: no false positive — importing this package's OWN name/subpath
// must not be flagged (only the desktop package name is forbidden).
withTempSrc((_root, src) => {
  writeFileSync(
    join(src, "ok.ts"),
    "import type { DocumentSnapshot } from '@dimm-city/gutterpress-editor/core';\n",
  );
  check("self-package import passes (exit 0)", run(src).status, 0);
});

// Case 15: absent src dir => usage error, exit 2.
{
  const parent = mkdtempSync(join(tmpdir(), "browser-purity-absent-"));
  try {
    const missing = join(parent, "does-not-exist");
    check("absent src dir exits 2", run(missing).status, 2);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

// Case 16: src dir argument is a file, not a directory => usage error, exit 2.
{
  const parent = mkdtempSync(join(tmpdir(), "browser-purity-notdir-"));
  try {
    const file = join(parent, "not-a-dir");
    writeFileSync(file, "");
    check("src dir argument that is a file exits 2", run(file).status, 2);
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
}

// Case 17: quoted "node:v8" (digit-bearing builtin) is caught even if it
// somehow evaded specifier extraction — proves the standalone regex layer.
withTempSrc((_root, src) => {
  writeFileSync(join(src, "bad.ts"), 'const spec = "node:v8"; void spec;\n');
  check("bare quoted node:v8 string exits 1", run(src).status, 1);
});

// Case 18 (AP-21 / G-12 liveness): an empty src/ directory — zero
// scannable files — must fail closed, never print "OK" on a gate that
// scanned nothing. `withTempSrc` already creates an empty `src/` and never
// writes into it here, so this exercises exactly that shape.
withTempSrc((_root, src) => {
  const result = run(src);
  check("empty src directory exits non-zero (not a silent pass)", result.status !== 0, true);
});

// Case 19 (AP-21 / G-12): a src/ whose ONLY file is a ".svelte" component
// containing a forbidden svelte import must still be caught — proves
// SCAN_EXT actually includes ".svelte" rather than silently reporting
// "scanned 0 file(s)" while sitting next to real, unscanned Svelte source
// (the single most likely way Svelte would actually enter this package).
withTempSrc((_root, src) => {
  mkdirSync(join(src, "only-svelte"));
  writeFileSync(
    join(src, "only-svelte", "Comp.svelte"),
    "<script>\n  import { onMount } from 'svelte';\n  onMount(() => {});\n</script>\n",
  );
  check("svelte-only src/ (.svelte file with a svelte import) exits 1", run(src).status, 1);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
