// Test for scripts/verify-vendored.mjs — run with:
//   node packages/vscode-markdown-editor/scripts/verify-vendored.test.mjs
//
// Builds throwaway git repositories under a fresh temp directory for every
// case (git init + local `git config user.*` scoped to the fixture only —
// never the live repo's git config, index, or vendored package), and drives
// the checker against them via --root. Proves, per lesson G-12 (a gate must
// prove it can fail) and AP-20 (gate exists but is never invoked):
//
//   - PASS on a clean fixture (hashes match, nothing unaccounted for);
//   - FAIL (exit 1) — a vendored file's bytes are corrupted (silent local
//     edit) without updating its recorded hash;
//   - FAIL (exit 1) — a manifest hash entry is corrupted (edited to a wrong
//     value) without touching the file;
//   - FAIL (exit 2) — checksums.json is missing, is malformed JSON, or is
//     missing/empty 'unpatched'/'patched' — never a silent pass;
//   - FAIL (exit 1) — completeness: a new file is added to the vendored
//     tree and git-tracked, but never given a manifest entry;
//   - FAIL (exit 1) — completeness: a manifest entry is deleted for a file
//     that is still on disk and still git-tracked (the exact "delete the
//     entry, then edit the file" bypass the completeness pass exists to
//     close — see the SFE-P1b2 finding this test backs);
//   - PASS: gutterpress-authored allowlisted files (package.json, NOTICE,
//     PATCHES.md, checksums.json, .gitignore, scripts/) are never required
//     to have a manifest entry;
//   - failure output names the offending path in every FAIL case;
//   - --root scopes every check to the fixture, never the live repo (a
//     fixture's tracked-file count is asserted exactly, so accidentally
//     scanning the real ~30-file vendored package would be caught).
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "verify-vendored.mjs");

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`NOT OK - ${name}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${cwd}: ${result.stderr || result.stdout}`);
  }
  return result;
}

function initFixtureRepo(dir) {
  git(["init", "-q"], dir);
  // Local (not --global) config, scoped to this throwaway repo only.
  git(["config", "user.email", "verify-vendored-test@example.com"], dir);
  git(["config", "user.name", "verify-vendored test fixture"], dir);
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

function sha256(text) {
  return createHash("sha256").update(Buffer.from(text)).digest("hex");
}

const OTHER_CONTENT = "// upstream unpatched file one\n";
const OTHER2_CONTENT = "// upstream unpatched file two\n";
const PATCHED_JS_CONTENT = "// patched dist/index.js\n";
const PATCHED_DTS_CONTENT = "// patched dist/index.d.ts\n";

/**
 * A clean, internally-consistent fixture package: two "unpatched" vendored
 * files, two "patched" vendored files, a correct checksums.json, and the
 * gutterpress-authored allowlisted files (deliberately NOT in the
 * manifest, to prove the allowlist works). Ten git-tracked files total.
 */
function buildBaseFixture(dir) {
  initFixtureRepo(dir);
  mkdirSync(join(dir, "dist"), { recursive: true });
  mkdirSync(join(dir, "scripts"), { recursive: true });

  writeFileSync(join(dir, "dist", "other.js"), OTHER_CONTENT);
  writeFileSync(join(dir, "dist", "other2.js"), OTHER2_CONTENT);
  writeFileSync(join(dir, "dist", "index.js"), PATCHED_JS_CONTENT);
  writeFileSync(join(dir, "dist", "index.d.ts"), PATCHED_DTS_CONTENT);

  // Allowlisted, gutterpress-authored files — deliberately absent from the
  // manifest below. A clean pass with these present proves the allowlist.
  writeFileSync(join(dir, "package.json"), '{"name":"fixture"}\n');
  writeFileSync(join(dir, "NOTICE"), "fixture notice\n");
  writeFileSync(join(dir, "PATCHES.md"), "# fixture patches\n");
  writeFileSync(join(dir, ".gitignore"), "node_modules\n");
  writeFileSync(join(dir, "scripts", "verify-vendored.mjs"), "// fixture copy of self\n");

  const checksums = {
    unpatched: {
      "dist/other.js": sha256(OTHER_CONTENT),
      "dist/other2.js": sha256(OTHER2_CONTENT),
    },
    patched: {
      "dist/index.js": sha256(PATCHED_JS_CONTENT),
      "dist/index.d.ts": sha256(PATCHED_DTS_CONTENT),
    },
  };
  writeFileSync(join(dir, "checksums.json"), JSON.stringify(checksums, null, 2) + "\n");

  commitAll(dir, "base fixture");
  return checksums;
}

function readManifest(dir) {
  return JSON.parse(readFileSync(join(dir, "checksums.json"), "utf8"));
}

function writeManifest(dir, manifest) {
  writeFileSync(join(dir, "checksums.json"), JSON.stringify(manifest, null, 2) + "\n");
}

// Case 1: clean fixture => exit 0, with exact counts proving --root scoped
// the scan to the 10-file fixture (not the live ~30-file vendored package).
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-clean-"));
  try {
    buildBaseFixture(dir);
    const r = run(dir);
    check("clean fixture exits 0", r.status, 0);
    check(
      "clean fixture reports 2 unpatched + 2 patched",
      r.stdout.includes("2 unpatched file(s)") && r.stdout.includes("2 patched file(s)"),
      true,
    );
    check(
      "clean fixture reports all 10 tracked files accounted for",
      r.stdout.includes("10 tracked file(s) all accounted for in the manifest"),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 2 (sabotage, G-12): corrupt a vendored file's BYTES on disk without
// touching its recorded hash — the exact "silent local edit" this script
// exists to catch.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-corrupt-file-"));
  try {
    buildBaseFixture(dir);
    writeFileSync(join(dir, "dist", "other.js"), "// corrupted content, hash no longer matches\n");
    const r = run(dir);
    check("corrupted vendored file exits 1", r.status, 1);
    check(
      "failure output names the corrupted file",
      r.stderr.includes("dist/other.js") && r.stderr.includes("hash mismatch"),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 3 (sabotage, G-12): corrupt a manifest HASH entry without touching
// the file — proves the check is symmetric (file-vs-manifest drift in
// either direction is caught, not just file-side edits).
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-corrupt-hash-"));
  try {
    buildBaseFixture(dir);
    const manifest = readManifest(dir);
    manifest.patched["dist/index.js"] = "0".repeat(64);
    writeManifest(dir, manifest);
    const r = run(dir);
    check("corrupted manifest hash exits 1", r.status, 1);
    check(
      "failure output names dist/index.js",
      r.stderr.includes("dist/index.js") && r.stderr.includes("hash mismatch"),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 4 (malformed/empty manifest, exit 2): checksums.json missing entirely.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-missing-manifest-"));
  try {
    buildBaseFixture(dir);
    rmSync(join(dir, "checksums.json"));
    const r = run(dir);
    check("missing checksums.json exits 2", r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 5 (malformed manifest, exit 2): checksums.json is not valid JSON.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-bad-json-"));
  try {
    buildBaseFixture(dir);
    writeFileSync(join(dir, "checksums.json"), "{ this is not json");
    const r = run(dir);
    check("malformed JSON checksums.json exits 2", r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 6 (malformed manifest, exit 2): 'unpatched'/'patched' keys entirely
// absent — never a silent pass on an empty/shaped-wrong manifest.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-empty-manifest-"));
  try {
    buildBaseFixture(dir);
    writeManifest(dir, {});
    const r = run(dir);
    check("manifest with no unpatched/patched exits 2", r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 7 (malformed manifest, exit 2): 'unpatched' present but empty.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-empty-unpatched-"));
  try {
    const manifest = buildBaseFixture(dir);
    manifest.unpatched = {};
    writeManifest(dir, manifest);
    const r = run(dir);
    check("empty 'unpatched' map exits 2", r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 8 (malformed manifest, exit 2): 'patched' present but empty.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-empty-patched-"));
  try {
    const manifest = buildBaseFixture(dir);
    manifest.patched = {};
    writeManifest(dir, manifest);
    const r = run(dir);
    check("empty 'patched' map exits 2", r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 9 (completeness sabotage, exit 1): a new file is added to the
// vendored tree and git-tracked, but never given a manifest entry — the
// "newly added file... passes both gates silently" failure mode named in
// the SFE-P1b2 finding this test backs.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-unlisted-file-"));
  try {
    buildBaseFixture(dir);
    writeFileSync(join(dir, "dist", "new-file.js"), "// added without a manifest entry\n");
    commitAll(dir, "sabotage: add unlisted vendored file");
    const r = run(dir);
    check("unlisted git-tracked file exits 1", r.status, 1);
    check(
      "failure output names dist/new-file.js as a completeness issue",
      r.stderr.includes("dist/new-file.js") && r.stderr.includes("completeness"),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 10 (completeness sabotage, exit 1): a manifest entry is DELETED for
// a file that is still on disk and still git-tracked. This is the "delete
// the entry, then edit the file" bypass: proves the completeness pass
// catches the deletion on its own, independent of whether the file's
// content was also changed.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-deleted-entry-"));
  try {
    const manifest = buildBaseFixture(dir);
    delete manifest.unpatched["dist/other.js"];
    writeManifest(dir, manifest);
    const r = run(dir);
    check("deleted manifest entry (file untouched) exits 1", r.status, 1);
    check(
      "failure output names dist/other.js as a completeness issue",
      r.stderr.includes("dist/other.js") && r.stderr.includes("completeness"),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 11 (completeness sabotage, exit 1, combined): delete the manifest
// entry AND edit the file's content in the same fixture — the exact attack
// the SFE-P1b2 finding describes ("deleting an entry and then editing that
// file passes cleanly"). Must still fail, and for the completeness reason
// (the hash loop never even looks at a path that isn't a manifest key).
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-delete-then-edit-"));
  try {
    const manifest = buildBaseFixture(dir);
    delete manifest.unpatched["dist/other.js"];
    writeManifest(dir, manifest);
    writeFileSync(join(dir, "dist", "other.js"), "// edited after its manifest entry was deleted\n");
    const r = run(dir);
    check("delete-entry-then-edit-file exits 1", r.status, 1);
    check(
      "failure output names dist/other.js as a completeness issue",
      r.stderr.includes("dist/other.js") && r.stderr.includes("completeness"),
      true,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 12 (no false positive): every gutterpress-authored allowlisted path
// is absent from the manifest in every case above, and every one of those
// cases involving an unrelated failure still reports success for the
// allowlist itself — i.e. the base clean fixture (case 1) already proves
// package.json/NOTICE/PATCHES.md/checksums.json/.gitignore/scripts/ never
// need a manifest entry. This case additionally proves a NESTED file under
// scripts/ (not just the top-level script) is covered by the scripts/
// prefix, not just an exact-name match.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-nested-scripts-"));
  try {
    buildBaseFixture(dir);
    mkdirSync(join(dir, "scripts", "lib"), { recursive: true });
    writeFileSync(join(dir, "scripts", "lib", "helper.mjs"), "// nested script helper\n");
    commitAll(dir, "add nested scripts/ file");
    const r = run(dir);
    check("nested scripts/ file needs no manifest entry (exits 0)", r.status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Case 13 (usage/environment error, exit 2, never a silent pass): --root
// pointing at a manifest-bearing directory that is NOT a git repository at
// all fails at the `git ls-files` step, not the manifest-read step.
{
  const dir = mkdtempSync(join(tmpdir(), "verify-vendored-not-a-repo-"));
  try {
    mkdirSync(join(dir, "dist"), { recursive: true });
    writeFileSync(join(dir, "dist", "index.js"), PATCHED_JS_CONTENT);
    writeFileSync(join(dir, "dist", "index.d.ts"), PATCHED_DTS_CONTENT);
    writeFileSync(
      join(dir, "checksums.json"),
      JSON.stringify(
        {
          unpatched: { "dist/other.js": "a".repeat(64) },
          patched: {
            "dist/index.js": sha256(PATCHED_JS_CONTENT),
            "dist/index.d.ts": sha256(PATCHED_DTS_CONTENT),
          },
        },
        null,
        2,
      ) + "\n",
    );
    const r = run(dir);
    check("non-git --root exits 2 (internal error, not a silent pass)", r.status, 2);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
