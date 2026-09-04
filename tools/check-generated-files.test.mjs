// Test for tools/check-generated-files.mjs — run with:
//   node tools/check-generated-files.test.mjs
//
// Builds throwaway git repositories under a fresh temp directory for every
// case (git init + local `git config user.*` scoped to the fixture only —
// never the live repo's git config or index), and drives the check against
// them via --root. Proves:
//   - PASS on a clean fixture (no generated paths tracked);
//   - FAIL (exit 1) — the sabotage/deliberate-failure proof (lesson G-12) —
//     when a generated-looking file is deliberately `git add`ed and
//     committed into the fixture, for EACH of the 5 patterns
//     tools/check-generated-files.mjs declares (.svelte-kit/, build/, out/,
//     .tsbuildinfo, packages/*/dist/);
//   - the failure output names the offending path;
//   - no false positive on a fixture that merely has "build"/"out"/"dist"
//     as a substring, not a full path segment;
//   - --root is honored (the live repo's tracked files are never scanned by
//     these fixture cases);
//   - a non-git-repository --root is an internal error (exit 2), not a
//     silent pass.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-generated-files.mjs");

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`NOT OK - ${name}: expected exit ${expected}, got ${actual}`);
  }
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed in ${cwd}: ${result.stderr || result.stdout}`,
    );
  }
  return result;
}

function initFixtureRepo(dir) {
  git(["init", "-q"], dir);
  // Local (not --global) config, scoped to this throwaway repo only.
  git(["config", "user.email", "check-generated-files-test@example.com"], dir);
  git(["config", "user.name", "check-generated-files test fixture"], dir);
  // Never rely on the ambient environment's commit signing setup for a
  // disposable fixture commit.
  git(["config", "commit.gpgsign", "false"], dir);
}

function commitAll(dir, message) {
  git(["add", "-A"], dir);
  git(["commit", "-q", "-m", message], dir);
}

function run(root) {
  return spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
}

// Case 1: clean fixture (ordinary source files only) => exit 0.
const cleanDir = mkdtempSync(join(tmpdir(), "check-generated-clean-"));
try {
  initFixtureRepo(cleanDir);
  mkdirSync(join(cleanDir, "src"), { recursive: true });
  writeFileSync(join(cleanDir, "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(join(cleanDir, "package.json"), '{"name":"fixture"}\n');
  commitAll(cleanDir, "clean fixture");
  const r = run(cleanDir);
  check("clean fixture exits 0", r.status, 0);
} finally {
  rmSync(cleanDir, { recursive: true, force: true });
}

// Case 2 (sabotage / deliberate-failure proof, lesson G-12): a tracked
// root-level .svelte-kit/ file (the exact real-world case this check exists
// for) makes the check FAIL.
const svelteKitDir = mkdtempSync(join(tmpdir(), "check-generated-sveltekit-"));
try {
  initFixtureRepo(svelteKitDir);
  writeFileSync(join(svelteKitDir, "README.md"), "# fixture\n");
  mkdirSync(join(svelteKitDir, ".svelte-kit"), { recursive: true });
  writeFileSync(join(svelteKitDir, ".svelte-kit", "ambient.d.ts"), "// generated\n");
  commitAll(svelteKitDir, "sabotage: track .svelte-kit output");
  const r = run(svelteKitDir);
  check("tracked .svelte-kit/ file exits 1", r.status, 1);
  check(
    "failure output names the offending .svelte-kit path",
    r.stderr.includes(".svelte-kit/ambient.d.ts"),
    true,
  );
} finally {
  rmSync(svelteKitDir, { recursive: true, force: true });
}

// Case 3 (sabotage): a tracked packages/<pkg>/dist/ file also fails, and is
// reported by name — proves the check is not single-pattern-only.
const distDir = mkdtempSync(join(tmpdir(), "check-generated-dist-"));
try {
  initFixtureRepo(distDir);
  mkdirSync(join(distDir, "packages", "cli", "dist"), { recursive: true });
  writeFileSync(join(distDir, "packages", "cli", "dist", "index.js"), "// built output\n");
  commitAll(distDir, "sabotage: track packages/cli/dist output");
  const r = run(distDir);
  check("tracked packages/*/dist/ file exits 1", r.status, 1);
  check(
    "failure output names the offending dist path",
    r.stderr.includes("packages/cli/dist/index.js"),
    true,
  );
} finally {
  rmSync(distDir, { recursive: true, force: true });
}

// Case 4 (sabotage): a tracked .tsbuildinfo file fails.
const tsbuildDir = mkdtempSync(join(tmpdir(), "check-generated-tsbuildinfo-"));
try {
  initFixtureRepo(tsbuildDir);
  writeFileSync(join(tsbuildDir, "tsconfig.tsbuildinfo"), "{}\n");
  commitAll(tsbuildDir, "sabotage: track tsbuildinfo");
  const r = run(tsbuildDir);
  check("tracked .tsbuildinfo file exits 1", r.status, 1);
  check(
    "failure output names the offending tsbuildinfo path",
    r.stderr.includes("tsconfig.tsbuildinfo"),
    true,
  );
} finally {
  rmSync(tsbuildDir, { recursive: true, force: true });
}

// Case 4b (sabotage): a tracked file under a directory literally named
// `build/` fails — the desktop adapter-node / electron-vite output shape
// (CLAUDE.md §8) this pattern exists to catch.
const buildDir = mkdtempSync(join(tmpdir(), "check-generated-build-"));
try {
  initFixtureRepo(buildDir);
  mkdirSync(join(buildDir, "packages", "desktop", "build"), { recursive: true });
  writeFileSync(join(buildDir, "packages", "desktop", "build", "app.js"), "// built output\n");
  commitAll(buildDir, "sabotage: track packages/desktop/build output");
  const r = run(buildDir);
  check("tracked build/ file exits 1", r.status, 1);
  check(
    "failure output names the offending build/ path",
    r.stderr.includes("packages/desktop/build/app.js"),
    true,
  );
} finally {
  rmSync(buildDir, { recursive: true, force: true });
}

// Case 4c (sabotage): a tracked file under a root-level directory literally
// named `out/` fails — bun build --compile / electron-builder output shape.
const outDir = mkdtempSync(join(tmpdir(), "check-generated-out-"));
try {
  initFixtureRepo(outDir);
  mkdirSync(join(outDir, "out"), { recursive: true });
  writeFileSync(join(outDir, "out", "main.js"), "// built output\n");
  commitAll(outDir, "sabotage: track out/ output");
  const r = run(outDir);
  check("tracked out/ file exits 1", r.status, 1);
  check("failure output names the offending out/ path", r.stderr.includes("out/main.js"), true);
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

// Case 5 (no false positive): "build"/"out"/"dist" as filename SUBSTRINGS
// (not full path segments) must pass — e.g. a source file named
// "builder.ts" or "outline.md", or a package literally named "dist-utils".
const substringDir = mkdtempSync(join(tmpdir(), "check-generated-substring-"));
try {
  initFixtureRepo(substringDir);
  mkdirSync(join(substringDir, "src"), { recursive: true });
  writeFileSync(join(substringDir, "src", "builder.ts"), "export const build = () => 1;\n");
  writeFileSync(join(substringDir, "outline.md"), "# outline\n");
  mkdirSync(join(substringDir, "packages", "dist-utils"), { recursive: true });
  writeFileSync(
    join(substringDir, "packages", "dist-utils", "index.ts"),
    "export const y = 1;\n",
  );
  commitAll(substringDir, "substrings only, no real generated dirs");
  const r = run(substringDir);
  check("filename/dirname substrings of generated names pass (exit 0)", r.status, 0);
} finally {
  rmSync(substringDir, { recursive: true, force: true });
}

// Case 6: --root is honored — pointing at a clean fixture never touches or
// reports anything about the live repo (which, before this run's git rm
// --cached, tracked 7 root .svelte-kit/ files).
const isolationDir = mkdtempSync(join(tmpdir(), "check-generated-isolation-"));
try {
  initFixtureRepo(isolationDir);
  writeFileSync(join(isolationDir, "a.txt"), "hello\n");
  commitAll(isolationDir, "isolation fixture");
  const r = run(isolationDir);
  check("--root scopes the scan to the fixture (exit 0)", r.status, 0);
  check("--root output names the fixture path, not the live repo", r.stdout.includes(isolationDir), true);
} finally {
  rmSync(isolationDir, { recursive: true, force: true });
}

// Case 7: --root pointing at a non-git directory is an internal error
// (exit 2), never a silent pass.
const notARepo = mkdtempSync(join(tmpdir(), "check-generated-not-a-repo-"));
try {
  writeFileSync(join(notARepo, "file.txt"), "hi\n");
  const r = run(notARepo);
  check("non-git --root exits 2 (internal error, not a silent pass)", r.status, 2);
} finally {
  rmSync(notARepo, { recursive: true, force: true });
}

// Case 8: --root pointing at a path that does not exist at all is also an
// internal error (exit 2).
const missingParent = mkdtempSync(join(tmpdir(), "check-generated-missing-"));
try {
  const missing = join(missingParent, "does-not-exist");
  const r = run(missing);
  check("nonexistent --root exits 2", r.status, 2);
} finally {
  rmSync(missingParent, { recursive: true, force: true });
}

// Allowlist cases: packages/vscode-markdown-editor/dist/ is the ONE tracked
// dist that is vendored source, not build output (its own checksum gate
// enforces byte identity — see the ALLOWLIST_PREFIXES comment in the checker).
// Prove the exemption admits exactly that prefix and nothing else: the same
// fixture tracks the exempt path AND a sibling package's dist, and only the
// sibling is reported.
const allowDir = mkdtempSync(join(tmpdir(), "check-generated-allowlist-"));
try {
  initFixtureRepo(allowDir);
  mkdirSync(join(allowDir, "packages", "vscode-markdown-editor", "dist"), { recursive: true });
  writeFileSync(
    join(allowDir, "packages", "vscode-markdown-editor", "dist", "index.js"),
    "// vendored upstream artifact\n",
  );
  mkdirSync(join(allowDir, "packages", "cli", "dist"), { recursive: true });
  writeFileSync(join(allowDir, "packages", "cli", "dist", "index.js"), "// built output\n");
  commitAll(allowDir, "vendored fork dist + sabotage sibling dist");
  const r = run(allowDir);
  check("allowlisted fork dist does not pass the whole check vacuously", r.status, 1);
  check(
    "sibling packages/cli/dist is still reported",
    r.stderr.includes("packages/cli/dist/index.js"),
    true,
  );
  check(
    "allowlisted packages/vscode-markdown-editor/dist is NOT reported",
    r.stderr.includes("packages/vscode-markdown-editor/dist/index.js"),
    false,
  );
} finally {
  rmSync(allowDir, { recursive: true, force: true });
}

// And alone, the allowlisted path is a clean pass.
const allowOnlyDir = mkdtempSync(join(tmpdir(), "check-generated-allowonly-"));
try {
  initFixtureRepo(allowOnlyDir);
  mkdirSync(join(allowOnlyDir, "packages", "vscode-markdown-editor", "dist"), { recursive: true });
  writeFileSync(
    join(allowOnlyDir, "packages", "vscode-markdown-editor", "dist", "index.js"),
    "// vendored upstream artifact\n",
  );
  commitAll(allowOnlyDir, "vendored fork dist only");
  const r = run(allowOnlyDir);
  check("allowlisted fork dist alone exits 0", r.status, 0);
} finally {
  rmSync(allowOnlyDir, { recursive: true, force: true });
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
