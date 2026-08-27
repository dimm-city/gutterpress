#!/usr/bin/env node
// tools/check-generated-files.mjs — SFE-P0b generated-output hygiene guardrail.
//
// Regenerated build output (SvelteKit sync artifacts, bundler output, TS
// incremental-build info, package dist/) must never be tracked in git: it
// bloats the repo, drifts from source, and its accidental tracking is exactly
// what happened to the 7 root `.svelte-kit/` files this check exists to catch
// (see docs/plans/source-first-editor/runs/SFE-P0b.md). This script scans
// every path git currently tracks and FAILS (exit 1) if any of them looks
// like generated output.
//
// Detection policy — five patterns, each investigated against this repo's
// actual tracked tree (via `git ls-files`) before being finalized, specifically
// to rule out false positives on legitimately-tracked source directories that
// merely share a generated-output name:
//
//   1. (^|/)\.svelte-kit/   — SvelteKit's own sync/build output directory.
//      Investigated: no tracked path anywhere in the repo has a path segment
//      literally named `.svelte-kit` today (the 7 root files this check
//      exists to guard against were removed from tracking in this same run).
//   2. (^|/)build/          — a directory literally named `build` (Vite/
//      electron-vite/tsc output, per CLAUDE.md §8's adapter-node build/
//      convention). Investigated: `git ls-files | grep -E '(^|/)build/'`
//      returns nothing — no tracked source lives under a directory named
//      `build` anywhere in the tree. A future *source* directory literally
//      named `build/` would collide with this pattern; if that's ever
//      intentional, this script (not the source layout) is what should change.
//   3. (^|/)out/            — a directory literally named `out` (bun build
//      --compile output, tsc `outDir`, electron-builder output).
//      Investigated: same grep, zero tracked hits.
//   4. \.tsbuildinfo$       — TypeScript incremental build-info files.
//      Investigated: zero tracked hits; also already root-gitignored
//      (`*.tsbuildinfo`).
//   5. packages/*/dist/     — each workspace package's build output
//      (packages/cli/dist, packages/desktop/dist, ...). Anchored to the
//      literal `packages/<single-segment>/dist/` shape (not `(^|/)dist/`
//      generally) because that's the only `dist` shape this monorepo's
//      package.json `build`/`files` fields ever produce; a broader
//      `(^|/)dist/` would also flag any unrelated nested `dist` directory
//      a future package might legitimately vendor as source. Investigated:
//      zero tracked hits under packages/*/dist/ today.
//
// None of the above are inferred from .gitignore — this check reads git's
// tracked-file list directly (`git ls-files -z`), so it still catches a
// generated path that was force-added (`git add -f`) despite being ignored.
//
// Usage:  node tools/check-generated-files.mjs [--root <path>]
//   --root defaults to the repository root (one level above tools/). Pointed
//   at a fixture directory by check-generated-files.test.mjs so the sabotage
//   self-test never touches the live repo's git index.
//
// Exit codes: 0 clean, 1 a tracked path matches a generated-output pattern,
// 2 internal/usage error (e.g. --root does not point at a git repository).
//
// Dependency-free (Node built-ins only), mirrors tools/check-render-purity.mjs.
// Tested by tools/check-generated-files.test.mjs (node tools/check-generated-files.test.mjs).
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PATTERNS = [
  { name: "(^|/)\\.svelte-kit/", regex: /(^|\/)\.svelte-kit\// },
  { name: "(^|/)build/", regex: /(^|\/)build\// },
  { name: "(^|/)out/", regex: /(^|\/)out\// },
  { name: "\\.tsbuildinfo$", regex: /\.tsbuildinfo$/ },
  { name: "packages/*/dist/", regex: /^packages\/[^/]+\/dist\// },
];

function repoRoot() {
  // tools/ lives at the repo root.
  return dirname(dirname(fileURLToPath(import.meta.url)));
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

function listTrackedFiles(root) {
  // -z: NUL-separated, so filenames containing newlines can't corrupt parsing.
  const raw = execFileSync("git", ["ls-files", "-z"], {
    cwd: root,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return raw.split("\0").filter((p) => p.length > 0);
}

function findViolation(path) {
  for (const pattern of PATTERNS) {
    if (pattern.regex.test(path)) return pattern.name;
  }
  return null;
}

function main() {
  const { root: rootArg } = parseArgs(process.argv.slice(2));
  const root = rootArg ?? repoRoot();

  if (!existsSync(root)) {
    console.error(`check-generated-files: ERROR — root not found: ${root}`);
    process.exit(2);
  }
  if (!existsSync(join(root, ".git"))) {
    console.error(
      `check-generated-files: ERROR — root is not a git repository (no .git found): ${root}`,
    );
    process.exit(2);
  }

  let files;
  try {
    files = listTrackedFiles(root);
  } catch (err) {
    console.error(`check-generated-files: ERROR — \`git ls-files\` failed: ${err.message}`);
    process.exit(2);
    return;
  }

  const violations = [];
  for (const file of files) {
    const pattern = findViolation(file);
    if (pattern) violations.push({ file, pattern });
  }

  if (violations.length > 0) {
    console.error(
      "check-generated-files: FAIL — generated/output path(s) are tracked in git.",
    );
    for (const { file, pattern } of violations) {
      console.error(`  ${file}  (matches: ${pattern})`);
    }
    console.error(
      "\nGenerated output must not be committed. Untrack it and confirm .gitignore covers it:\n" +
        "  git rm -r --cached <path>",
    );
    process.exit(1);
  }

  console.log(
    `check-generated-files: OK — scanned ${files.length} tracked file(s) in ${root}, no generated/output paths tracked.`,
  );
  process.exit(0);
}

main();
