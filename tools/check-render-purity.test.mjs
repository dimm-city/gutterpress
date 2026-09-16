// Test for tools/check-render-purity.mjs — run with: node tools/check-render-purity.test.mjs
//
// Verifies the §8 renderer-purity guardrail: scanning a directory whose files
// contain none of the forbidden host/node tokens exits 0, while a directory
// containing even one (e.g. "fileURLToPath") exits 1. Also checks the
// "build dir absent" skip path exits 0, and — the case that matters for §8
// post-SFE-P5d, when adapter-static writes a single flat build/ tree with no
// legitimate host-code subtree to exclude — that the scan actually recurses
// into nested subdirectories rather than only checking top-level files.
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

// Case 5: host code nested several directories deep in the scanned tree is
// still caught. adapter-static (SFE-P5d) emits a single flat build/ tree
// with no server-only sibling to carve out — unlike the deleted adapter-node
// layout, there is no legitimate host-code subtree for this gate to exclude,
// so the default buildDir and the CI/npm-run-build invocations now scan the
// WHOLE directory. This fixture proves the walk recurses into an arbitrary
// nested subdirectory (mirroring a real _app/immutable/chunks/ layout) and
// still finds a violation there, rather than only checking top-level files.
const nestedRoot = mkdtempSync(join(tmpdir(), "render-purity-nested-"));
try {
  const assetsDir = join(nestedRoot, "_app", "immutable", "chunks");
  mkdirSync(assetsDir, { recursive: true });
  writeFileSync(join(nestedRoot, "index.html"), "<!doctype html><title>Gutterpress</title>\n");
  writeFileSync(
    join(assetsDir, "leaked.js"),
    "import { createRequire } from 'node:module';\nconst require = createRequire(import.meta.url);\n",
  );

  check("host code nested deep in the tree fails the whole-tree scan (exit 1)", run(nestedRoot).status, 1);
} finally {
  rmSync(nestedRoot, { recursive: true, force: true });
}


// Case 6 (widened policy): quoted digit-bearing builtin specifier => exit 1.
const dirtyDir3 = mkdtempSync(join(tmpdir(), "render-purity-v8-"));
try {
  writeFileSync(join(dirtyDir3, "chunk.js"), 'import { getHeapStatistics } from "node:v8";\n');
  check("directory with quoted node:v8 exits 1", run(dirtyDir3).status, 1);
} finally {
  rmSync(dirtyDir3, { recursive: true, force: true });
}

// Case 7 (widened policy): bare builtin require (whitespace-tolerant) => exit 1.
const dirtyDir4 = mkdtempSync(join(tmpdir(), "render-purity-require-"));
try {
  writeFileSync(join(dirtyDir4, "chunk.js"), 'const e = require( "events" );\n');
  check("directory with bare require(\"events\") exits 1", run(dirtyDir4).status, 1);
} finally {
  rmSync(dirtyDir4, { recursive: true, force: true });
}

// Case 8 (no false positive): minified object property {node:t} is NOT a
// specifier and must pass.
const cleanDir2 = mkdtempSync(join(tmpdir(), "render-purity-prop-"));
try {
  writeFileSync(join(cleanDir2, "chunk.js"), "const a={node:t,parent:p};export{a};\n");
  check("minified {node:t} property passes (exit 0)", run(cleanDir2).status, 0);
} finally {
  rmSync(cleanDir2, { recursive: true, force: true });
}

// Case 9 (--strict): absent dir fails instead of skipping.
const parent2 = mkdtempSync(join(tmpdir(), "render-purity-strict-absent-"));
try {
  const missing = join(parent2, "does-not-exist");
  const r = spawnSync(process.execPath, [SCRIPT, missing, "--strict"], { encoding: "utf8" });
  check("--strict absent directory exits 1", r.status, 1);
} finally {
  rmSync(parent2, { recursive: true, force: true });
}

// Case 10 (--strict): existing dir with ZERO scannable files fails — a gate
// that scans nothing has silently stopped guarding.
const emptyDir = mkdtempSync(join(tmpdir(), "render-purity-strict-empty-"));
try {
  writeFileSync(join(emptyDir, "image.png"), "not-really-a-png");
  const r = spawnSync(process.execPath, [SCRIPT, emptyDir, "--strict"], { encoding: "utf8" });
  check("--strict zero scannable files exits 1", r.status, 1);
} finally {
  rmSync(emptyDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
