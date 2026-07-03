// Test for tools/check-render-purity.mjs — run with: node tools/check-render-purity.test.mjs
//
// Verifies the §8 renderer-purity guardrail: scanning a directory whose files
// contain none of the forbidden host/node tokens exits 0, while a directory
// containing even one (e.g. "fileURLToPath") exits 1. Also checks the
// "build dir absent" skip path exits 0, and — the case that matters for §8 —
// that an adapter-node layout (clean build/client + a host-code build/server)
// PASSES when scoped to build/client but FAILS when the whole build/ is scanned.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-render-purity.mjs");

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`NOT OK - ${name}: expected exit ${expected}, got ${actual}`);
  }
}

function run(dir) {
  return spawnSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
}

// Case 1: clean directory => exit 0
const cleanDir = mkdtempSync(join(tmpdir(), "render-purity-clean-"));
try {
  writeFileSync(join(cleanDir, "app.js"), "export const greet = () => 'hello world';\n");
  writeFileSync(join(cleanDir, "style.css"), ".x{color:red}\n");
  check("clean directory exits 0", run(cleanDir).status, 0);
} finally {
  rmSync(cleanDir, { recursive: true, force: true });
}

// Case 2: directory containing "fileURLToPath" => exit 1
const dirtyDir = mkdtempSync(join(tmpdir(), "render-purity-dirty-"));
try {
  writeFileSync(join(dirtyDir, "app.js"), "import { fileURLToPath } from 'node:url';\n");
  check("directory with fileURLToPath exits 1", run(dirtyDir).status, 1);
} finally {
  rmSync(dirtyDir, { recursive: true, force: true });
}

// Case 3: absent build dir => skip, exit 0
const parent = mkdtempSync(join(tmpdir(), "render-purity-absent-"));
try {
  const missing = join(parent, "does-not-exist");
  check("absent directory skips and exits 0", run(missing).status, 0);
} finally {
  rmSync(parent, { recursive: true, force: true });
}

// Case 4: another forbidden token (isomorphic-git) => exit 1
const dirtyDir2 = mkdtempSync(join(tmpdir(), "render-purity-git-"));
try {
  mkdirSync(join(dirtyDir2, "nested"));
  writeFileSync(join(dirtyDir2, "nested", "chunk.js"), "const g = require('isomorphic-git');\n");
  check("nested file with isomorphic-git exits 1", run(dirtyDir2).status, 1);
} finally {
  rmSync(dirtyDir2, { recursive: true, force: true });
}

// Case 5: adapter-node-shaped layout — the behavior that actually matters for
// §8. build/client is clean; build/server + build/handler.js contain host Node
// code (node:fs, isomorphic-git, createRequire) that is legitimate BY DESIGN.
// Scanning build/client must PASS (exit 0); scanning the whole build/ tree must
// FAIL (exit 1). This proves the check is scoped to the client bundle and that
// the legitimate server bundle is EXCLUDED — the exact scoping the default
// buildDir (packages/viewer/build/client) and the CI invocation rely on.
const buildRoot = mkdtempSync(join(tmpdir(), "render-purity-adapter-node-"));
try {
  const clientDir = join(buildRoot, "client");
  const clientAppDir = join(clientDir, "_app");
  const serverDir = join(buildRoot, "server");
  mkdirSync(clientAppDir, { recursive: true });
  mkdirSync(serverDir, { recursive: true });

  // Clean browser bundle: no forbidden host/node tokens.
  writeFileSync(join(clientAppDir, "entry.js"), "export const start = () => 'ready';\n");
  writeFileSync(join(clientDir, "index.html"), "<!doctype html><title>viewer</title>\n");

  // Legitimate host Node code the adapter emits — must be excluded when scoped.
  writeFileSync(
    join(serverDir, "index.js"),
    "import { readFileSync } from 'node:fs';\nimport git from 'isomorphic-git';\n",
  );
  writeFileSync(
    join(buildRoot, "handler.js"),
    "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n",
  );

  check("adapter-node: scanning build/client passes (exit 0)", run(clientDir).status, 0);
  check("adapter-node: scanning whole build/ fails on server host code (exit 1)", run(buildRoot).status, 1);
} finally {
  rmSync(buildRoot, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
