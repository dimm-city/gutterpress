#!/usr/bin/env node
// tools/check-architecture.mjs — SFE-P0b architecture fitness gate.
//
// Run specification: docs/plans/source-first-editor/runs/SFE-P0b.md
// Binding decisions: docs/plans/source-first-editor-enterprise-refactor.md
//   D4  — module/ownership map and import direction (no service locator, no
//         cli<->desktop cross-package coupling other than the published
//         `gutterpress` / `gutterpress/render` / `gutterpress/api` specifiers).
//   D10 — no new desktop HTTP route during the P5 migration; the route count
//         may only ratchet DOWN as routes are deleted.
//   Lane rules — "No lane may add a new desktop HTTP route during P5." /
//         "No lane may introduce ProseMirror-family dependencies."
// Guardrails: docs/plans/source-first-editor/pr158-lessons.md
//   G-12/AP-20 — a gate must prove it ran and prove it can fail (see
//         tools/check-architecture.test.mjs for the sabotage proofs).
//   AP-21 — an empty/vacuous result must never read as a silent pass; a
//         present-but-empty packages/editor or packages/vscode-extension
//         `src` is reported as a liveness warning, not swallowed into SKIP.
//
// This script enforces four rules, run every time, each producing its own
// PASS/FAIL/SKIP/WARN summary line so CI logs show every rule ran even when
// only one of them fails:
//
//   1. PROSEMIRROR-FAMILY BAN — no `prosemirror*` / `@tiptap`/`tiptap` /
//      `@milkdown`/`milkdown` dependency in any workspace package.json dep
//      field, no matching package entry in bun.lock, and no matching import/
//      require specifier under packages/*/src or packages/*/electron.
//   2. DESKTOP HTTP ROUTE RATCHET — the number of `+server.ts` files under
//      packages/desktop/src/routes/api must never exceed the baseline
//      recorded in tools/architecture-baseline.json. Fewer routes than the
//      baseline is a WARN (lower the baseline), never a failure.
//   3. D4 IMPORT DIRECTION — packages/cli/src must not import packages/desktop
//      (by relative path or by the `@dimm-city/gutterpress-desktop`
//      specifier); packages/desktop/src and packages/desktop/electron must
//      not deep-relative-import into packages/cli/src (the sanctioned path
//      is the published `gutterpress` / `gutterpress/render` /
//      `gutterpress/api` specifier).
//   4. FUTURE-PACKAGE RULES — activate automatically once packages/editor or
//      packages/vscode-extension exist. Absent packages are SKIPPED, never
//      failed. A present package with zero scannable `src` files is reported
//      as a liveness warning (nothing to check yet is not the same as
//      "checked and clean"). SFE-P3c EXTENDS this rule's existing
//      packages/vscode-extension scan (it is NOT a new analyzer): files
//      under packages/vscode-extension/src/webview/**, src/protocol/**, and
//      src/webview-host/** additionally fail on any 'vscode' import (bare
//      or subpath) and any node:/bare-Node-builtin import — the D9/D12
//      "webview has no filesystem or Node access" boundary, and the
//      browser-safety this package's protocol module needs to be usable
//      from both the extension host and the webview. Scoped to those three
//      subdirectories only: src/host/**, src/provider.ts, and
//      src/extension.ts legitimately run in the Node extension host and
//      import both freely.
//
// Import/require specifiers are detected by string-scanning quoted literals
// (import ... from "x", bare import "x", require("x"), dynamic import("x")) —
// the same spirit as tools/check-render-purity.mjs's quoted-specifier scan.
// Relative specifiers are resolved with node:path against the importing
// file's directory and tested for containment in the forbidden directory,
// so the check is correct regardless of how many "../" segments a given
// file happens to need (a naive substring match on "../desktop" would both
// under- and over-match — see check-architecture.test.mjs).
//
// Usage:  node tools/check-architecture.mjs [--root <path>]
//   --root defaults to the repository root (two levels up from this file).
//   Self-tests pass a temp-dir fixture via --root so no rule ever touches the
//   live repository during a test run.
//
// Exit codes (matching tools/check-render-purity.mjs's convention):
//   0 — every rule passed (WARNs allowed).
//   1 — at least one rule found a real violation.
//   2 — usage/internal error (missing/invalid baseline file, unreadable root).
//
// Dependency-free (Node built-ins only) by design — it must run in bare CI.
// Tested by tools/check-architecture.test.mjs (node tools/check-architecture.test.mjs).
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { builtinModules } from "node:module";
import {
  join,
  dirname,
  basename,
  resolve as pathResolve,
  relative as pathRelative,
  isAbsolute,
} from "node:path";
import { fileURLToPath } from "node:url";

const PM_FAMILY_RE = /^(prosemirror|@tiptap|tiptap|@milkdown|milkdown)/;
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".svelte"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".svelte-kit", "dist", "build", "out"]);
const NODE_BUILTIN_SET = new Set(builtinModules.filter((name) => !name.startsWith("_")));

// Sibling package directory names known today. packages/editor is included so
// that once it exists, OTHER packages' rules (and its own "no relative escape
// into another package" rule) see it as a real sibling to guard against.
const KNOWN_PACKAGE_NAMES = ["cli", "desktop", "vscode-extension", "open-design-plugin", "editor"];

function repoRoot() {
  // tools/ lives at the repo root.
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function parseArgs(argv) {
  let root;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--root") {
      root = argv[++i];
    } else if (arg.startsWith("--root=")) {
      root = arg.slice("--root=".length);
    }
  }
  return { root };
}

function walk(dir, out) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return; // absent/unreadable directory — caller treats an empty result as "nothing found".
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue; // never follow symlinks (loop safety).
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (entry.isFile()) {
      out.push(full);
    }
  }
}

function listCodeFiles(dir) {
  if (!existsSync(dir)) return [];
  const all = [];
  walk(dir, all);
  return all.filter((f) => CODE_EXT.has(extOf(f)));
}

function extOf(file) {
  const dot = file.lastIndexOf(".");
  return dot === -1 ? "" : file.slice(dot);
}

function listWorkspacePackageDirs(root) {
  const packagesDir = join(root, "packages");
  if (!existsSync(packagesDir)) return [];
  return readdirSync(packagesDir, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => join(packagesDir, e.name));
}

// Quoted-specifier scan: `import ... from "x"`, bare `import "x"`,
// `require("x")`, dynamic `import("x")`. Deliberately permissive (string
// scan, not a real parser) — matching the documented spirit of
// check-render-purity.mjs. Overlap between patterns can report the same
// specifier twice; that only affects diagnostic verbosity, never correctness
// of the pass/fail decision.
const SPECIFIER_PATTERNS = [
  /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
  /\brequire\(\s*["']([^"']+)["']\s*\)/g,
  /\bfrom\s*["']([^"']+)["']/g,
  /\bimport\s*["']([^"']+)["']\s*;?/g,
];

function extractSpecifiers(file) {
  const text = readFileSync(file, "utf8");
  const found = [];
  const seen = new Set();
  for (const pattern of SPECIFIER_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text))) {
      const specifier = m[1];
      const key = `${m.index}:${specifier}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const line = text.slice(0, m.index).split("\n").length;
      found.push({ specifier, line, file });
    }
  }
  return found;
}

function isInside(childAbs, parentAbs) {
  if (childAbs === parentAbs) return true;
  const rel = pathRelative(parentAbs, childAbs);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
}

function resolveRelativeSpecifier(specifier, fromFile) {
  return pathResolve(dirname(fromFile), specifier);
}

function isBareOrSubpath(specifier, packageName) {
  return specifier === packageName || specifier.startsWith(`${packageName}/`);
}

function isNodeBuiltinSpecifier(specifier) {
  if (specifier.startsWith("node:")) return true;
  const base = specifier.split("/")[0];
  return NODE_BUILTIN_SET.has(base);
}

// ---------------------------------------------------------------------------
// Rule 1 — ProseMirror-family ban
// ---------------------------------------------------------------------------

function checkProsemirrorBan(root) {
  const violations = [];
  const DEP_FIELDS = ["dependencies", "devDependencies", "peerDependencies", "optionalDependencies"];

  const pkgFiles = [join(root, "package.json"), ...listWorkspacePackageDirs(root).map((d) => join(d, "package.json"))];
  let pkgFilesRead = 0;
  for (const pkgFile of pkgFiles) {
    if (!existsSync(pkgFile)) continue;
    pkgFilesRead++;
    let json;
    try {
      json = JSON.parse(readFileSync(pkgFile, "utf8"));
    } catch (err) {
      violations.push({ kind: "package.json", file: pkgFile, detail: `could not parse JSON: ${err.message}` });
      continue;
    }
    for (const field of DEP_FIELDS) {
      const deps = json[field];
      if (!deps || typeof deps !== "object") continue;
      for (const name of Object.keys(deps)) {
        if (PM_FAMILY_RE.test(name)) {
          violations.push({ kind: "package.json", file: pkgFile, detail: `${field}["${name}"]` });
        }
      }
    }
  }

  const lockFile = join(root, "bun.lock");
  const bunLockFound = existsSync(lockFile);
  if (bunLockFound) {
    const text = readFileSync(lockFile, "utf8");
    // bun.lock package entries look like `  "name": ["name@version", ...],`.
    // Matching the quoted key directly followed by `: [` targets resolved
    // package entries and skips ordinary `"dep": "^1.2.3"` version strings.
    const re = /^\s*"((?:prosemirror|@tiptap|tiptap|@milkdown|milkdown)[^"]*)":\s*\[/gm;
    let m;
    while ((m = re.exec(text))) {
      violations.push({ kind: "bun.lock", file: lockFile, detail: `package entry "${m[1]}"` });
    }
  }

  let codeFilesScanned = 0;
  for (const pkgDir of listWorkspacePackageDirs(root)) {
    for (const sub of ["src", "electron"]) {
      const files = listCodeFiles(join(pkgDir, sub));
      codeFilesScanned += files.length;
      for (const file of files) {
        for (const { specifier, line } of extractSpecifiers(file)) {
          if (PM_FAMILY_RE.test(specifier)) {
            violations.push({ kind: "import", file, line, detail: `specifier "${specifier}"` });
          }
        }
      }
    }
  }

  return { violations, pkgFilesRead, bunLockFound, codeFilesScanned };
}

// ---------------------------------------------------------------------------
// Rule 2 — desktop HTTP route ratchet (D10)
// ---------------------------------------------------------------------------

function checkRouteRatchet(root) {
  const baselinePath = join(root, "tools", "architecture-baseline.json");
  if (!existsSync(baselinePath)) {
    return { error: `baseline file not found: ${baselinePath}` };
  }
  let baselineJson;
  try {
    baselineJson = JSON.parse(readFileSync(baselinePath, "utf8"));
  } catch (err) {
    return { error: `invalid JSON in ${baselinePath}: ${err.message}` };
  }
  const baseline = baselineJson.desktopHttpRoutes;
  if (typeof baseline !== "number" || !Number.isFinite(baseline)) {
    return { error: `${baselinePath} is missing a numeric "desktopHttpRoutes" field` };
  }

  const routesDir = join(root, "packages", "desktop", "src", "routes", "api");
  const allFiles = [];
  walk(routesDir, allFiles);
  const routeFiles = allFiles.filter((f) => basename(f) === "+server.ts");

  return { baseline, count: routeFiles.length, routeFiles, baselinePath };
}

// ---------------------------------------------------------------------------
// Rule 3 — D4 import direction (cli <-> desktop)
// ---------------------------------------------------------------------------

function checkImportDirection(root) {
  const violations = [];
  const cliSrcDir = join(root, "packages", "cli", "src");
  const desktopPkgDir = join(root, "packages", "desktop");

  const cliFiles = listCodeFiles(cliSrcDir);
  for (const file of cliFiles) {
    for (const { specifier, line } of extractSpecifiers(file)) {
      if (isBareOrSubpath(specifier, "@dimm-city/gutterpress-desktop")) {
        violations.push({
          file,
          line,
          detail: `bare specifier "${specifier}" imports the desktop package (D4: packages/cli/src must not import packages/desktop)`,
        });
        continue;
      }
      if (specifier.startsWith(".")) {
        const resolved = resolveRelativeSpecifier(specifier, file);
        if (isInside(resolved, desktopPkgDir)) {
          violations.push({
            file,
            line,
            detail: `relative import "${specifier}" resolves into packages/desktop (D4: packages/cli/src must not import packages/desktop)`,
          });
        }
      }
    }
  }

  let desktopFilesScanned = 0;
  for (const sub of ["src", "electron"]) {
    const files = listCodeFiles(join(desktopPkgDir, sub));
    desktopFilesScanned += files.length;
    for (const file of files) {
      for (const { specifier, line } of extractSpecifiers(file)) {
        if (!specifier.startsWith(".")) continue;
        const resolved = resolveRelativeSpecifier(specifier, file);
        if (isInside(resolved, cliSrcDir)) {
          violations.push({
            file,
            line,
            detail: `relative import "${specifier}" resolves into packages/cli/src (D4: use the published "gutterpress" / "gutterpress/render" / "gutterpress/api" specifier instead)`,
          });
        }
      }
    }
  }

  return { violations, cliFilesScanned: cliFiles.length, desktopFilesScanned };
}

// ---------------------------------------------------------------------------
// Rule 4 — future-package rules (activate when the package appears)
// ---------------------------------------------------------------------------

function checkFuturePackageDir(root, pkgName, bannedChecks) {
  const pkgDir = join(root, "packages", pkgName);
  if (!existsSync(pkgDir)) {
    return { status: "SKIP", note: `packages/${pkgName}: SKIP (package absent)`, violations: [] };
  }
  const files = listCodeFiles(join(pkgDir, "src"));
  if (files.length === 0) {
    // AP-21: present but nothing to scan is a liveness fact, not a silent pass.
    return {
      status: "WARN",
      note: `packages/${pkgName}: LIVENESS WARN — package exists but packages/${pkgName}/src has no scannable source files; import-direction rules cannot be exercised yet (AP-21)`,
      violations: [],
    };
  }
  const violations = [];
  for (const file of files) {
    for (const { specifier, line } of extractSpecifiers(file)) {
      const reason = bannedChecks(specifier, file);
      if (reason) violations.push({ file, line, detail: `${reason}: "${specifier}"` });
    }
  }
  return {
    status: violations.length > 0 ? "FAIL" : "PASS",
    note: `packages/${pkgName}: scanned ${files.length} file(s), ${violations.length} violation(s)`,
    violations,
  };
}

function checkFuturePackages(root) {
  const editorSiblings = KNOWN_PACKAGE_NAMES.filter((n) => n !== "editor").map((n) => join(root, "packages", n));

  const editorResult = checkFuturePackageDir(root, "editor", (specifier, file) => {
    if (isBareOrSubpath(specifier, "svelte")) return "svelte import (packages/editor must stay framework-free)";
    if (isBareOrSubpath(specifier, "electron")) return "electron import (packages/editor must stay host-agnostic)";
    if (specifier === "vscode" || specifier.startsWith("vscode/")) return "vscode import (packages/editor must stay host-agnostic)";
    if (isBareOrSubpath(specifier, "@dimm-city/gutterpress-desktop")) return "desktop package import (packages/editor must stay host-agnostic)";
    if (isNodeBuiltinSpecifier(specifier)) return `Node builtin import (packages/editor must stay browser-safe)`;
    if (specifier.startsWith(".")) {
      const resolved = resolveRelativeSpecifier(specifier, file);
      for (const sibDir of editorSiblings) {
        if (isInside(resolved, sibDir)) {
          return `relative escape into ${sibDir.slice(root.length + 1)}`;
        }
      }
    }
    return null;
  });

  // SFE-P3c webview-purity subdirectories (D9/D12): the webview has no
  // filesystem or Node access, and the protocol module must stay usable
  // from both sides of the host<->webview boundary. Computed once, outside
  // the per-file callback, so `isInside` (already used elsewhere in this
  // file) does the real path-containment check rather than a fragile
  // string-prefix comparison.
  const vscodeExtDir = join(root, "packages", "vscode-extension");
  const webviewPurityDirs = ["webview", "protocol", "webview-host"].map((d) => join(vscodeExtDir, "src", d));

  const vscodeExtResult = checkFuturePackageDir(root, "vscode-extension", (specifier, file) => {
    if (isBareOrSubpath(specifier, "@dimm-city/gutterpress-desktop")) return "desktop package import (packages/vscode-extension must not import the desktop shell)";
    if (isBareOrSubpath(specifier, "svelte")) return "svelte import (packages/vscode-extension must not import the desktop UI framework)";

    if (webviewPurityDirs.some((dir) => isInside(file, dir))) {
      if (specifier === "vscode" || specifier.startsWith("vscode/")) {
        return "vscode import (webview-purity: src/webview, src/protocol, and src/webview-host must not import 'vscode' — D9/D12, no filesystem or Node access from the webview)";
      }
      if (isNodeBuiltinSpecifier(specifier)) {
        return "Node builtin import (webview-purity: src/webview, src/protocol, and src/webview-host must stay browser-safe)";
      }
    }
    return null;
  });

  return {
    notes: [editorResult.note, vscodeExtResult.note],
    violations: [...editorResult.violations, ...vscodeExtResult.violations],
    hasLivenessWarn: editorResult.status === "WARN" || vscodeExtResult.status === "WARN",
  };
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

function main() {
  const { root: rootArg } = parseArgs(process.argv.slice(2));
  const root = rootArg ? pathResolve(rootArg) : repoRoot();

  if (!existsSync(root)) {
    console.error(`check-architecture: ERROR — root not found: ${root}`);
    process.exit(2);
  }

  const summary = [];
  let hasFail = false;

  // Rule 1
  const r1 = checkProsemirrorBan(root);
  const r1HasViolations = r1.violations.length > 0;
  summary.push(
    `RULE 1 [prosemirror-ban]: ${r1HasViolations ? "FAIL" : "PASS"} — scanned ${r1.pkgFilesRead} package.json file(s) (bun.lock: ${r1.bunLockFound ? "found" : "absent"}), ${r1.codeFilesScanned} code file(s)`,
  );
  if (r1HasViolations) hasFail = true;

  // Rule 2
  const r2 = checkRouteRatchet(root);
  if (r2.error) {
    summary.push(`RULE 2 [desktop-route-ratchet]: ERROR — ${r2.error}`);
  } else if (r2.count > r2.baseline) {
    summary.push(`RULE 2 [desktop-route-ratchet]: FAIL (${r2.count} > baseline ${r2.baseline})`);
    hasFail = true;
  } else if (r2.count < r2.baseline) {
    summary.push(`RULE 2 [desktop-route-ratchet]: PASS with WARN (${r2.count} < baseline ${r2.baseline})`);
  } else {
    summary.push(`RULE 2 [desktop-route-ratchet]: PASS (${r2.count} == baseline ${r2.baseline})`);
  }

  // Rule 3
  const r3 = checkImportDirection(root);
  const r3HasViolations = r3.violations.length > 0;
  // AP-21: a scan of zero files on either side of the D4 boundary is not a
  // clean pass — it means the rule was never actually exercised (exactly
  // what a future P1a/P6 package move could do to packages/cli/src or
  // packages/desktop/src without CI noticing). Report it as a real FAIL,
  // not a silent PASS, distinct from an ordinary violation FAIL.
  const r3Liveness = r3.cliFilesScanned === 0 || r3.desktopFilesScanned === 0;
  const r3Status = r3HasViolations ? "FAIL" : r3Liveness ? "FAIL (liveness)" : "PASS";
  summary.push(
    `RULE 3 [d4-import-direction]: ${r3Status} — scanned ${r3.cliFilesScanned} packages/cli/src file(s), ${r3.desktopFilesScanned} packages/desktop/{src,electron} file(s)`,
  );
  if (r3HasViolations || r3Liveness) hasFail = true;

  // Rule 4
  const r4 = checkFuturePackages(root);
  summary.push(
    `RULE 4 [future-package-rules]: ${r4.violations.length > 0 ? "FAIL" : "PASS"} — ${r4.notes.join("; ")}`,
  );
  if (r4.violations.length > 0) hasFail = true;

  console.log("check-architecture: rule summary");
  for (const line of summary) console.log(`  ${line}`);

  if (r1HasViolations) {
    console.error(
      "\ncheck-architecture: FAIL — ProseMirror-family dependency or import found. " +
        "Plan and lane rules forbid prosemirror/tiptap/milkdown (no ProseMirror, Tiptap, or Milkdown runtime).",
    );
    for (const v of r1.violations) {
      console.error(`  ${v.kind}: ${v.file}${v.line ? `:${v.line}` : ""} — ${v.detail}`);
    }
  }

  if (!r2.error && r2.count > r2.baseline) {
    console.error(
      `\ncheck-architecture: FAIL — desktop HTTP route count ${r2.count} exceeds baseline ${r2.baseline} ` +
        `(${r2.baselinePath}).`,
    );
    console.error(
      '  Plan rule D10: "No new HTTP route may be added during the migration without a decision-record exception."',
    );
    console.error('  Lane rule: "No lane may add a new desktop HTTP route during P5."');
    console.error(
      "  The ratchet only moves DOWN: when routes are deleted, lower tools/architecture-baseline.json in the same run.",
    );
  } else if (!r2.error && r2.count < r2.baseline) {
    console.warn(
      `\ncheck-architecture: WARN — desktop HTTP route count ${r2.count} is below baseline ${r2.baseline}. ` +
        `Lower "desktopHttpRoutes" in ${r2.baselinePath} in this run so the ratchet reflects reality.`,
    );
  }

  if (r3HasViolations) {
    console.error("\ncheck-architecture: FAIL — D4 import-direction violation(s) found.");
    for (const v of r3.violations) {
      console.error(`  ${v.file}:${v.line} — ${v.detail}`);
    }
  }

  if (r3Liveness) {
    console.error(
      "\ncheck-architecture: FAIL — D4 import-direction liveness check failed (AP-21): an empty/vacuous " +
        "scan must never read as a silent pass. A required scan target has zero scannable source files, " +
        "which means the D4 rule was never actually exercised this run.",
    );
    if (r3.cliFilesScanned === 0) {
      console.error(
        "  packages/cli/src has zero scannable source files (missing or empty) — the cli-imports-desktop " +
          "half of D4 cannot be enforced against an empty target.",
      );
    }
    if (r3.desktopFilesScanned === 0) {
      console.error(
        "  packages/desktop/{src,electron} has zero scannable source files (missing or empty) — the " +
          "desktop-imports-cli half of D4 cannot be enforced against an empty target.",
      );
    }
  }

  if (r4.violations.length > 0) {
    console.error("\ncheck-architecture: FAIL — future-package import rule violation(s) found.");
    for (const v of r4.violations) {
      console.error(`  ${v.file}:${v.line} — ${v.detail}`);
    }
  }
  if (r4.hasLivenessWarn) {
    for (const note of r4.notes) {
      if (note.includes("LIVENESS WARN")) console.warn(`check-architecture: ${note}`);
    }
  }

  if (r2.error) {
    console.error(`\ncheck-architecture: ERROR — ${r2.error}`);
    process.exit(2);
  }

  if (hasFail) {
    console.error("\ncheck-architecture: FAIL — one or more architecture fitness rules failed. See details above.");
    process.exit(1);
  }

  console.log("\ncheck-architecture: OK — all architecture fitness rules passed.");
  process.exit(0);
}

try {
  main();
} catch (err) {
  console.error(`check-architecture: ERROR — ${err && err.stack ? err.stack : err}`);
  process.exit(2);
}
