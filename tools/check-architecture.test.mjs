// Test for tools/check-architecture.mjs — run with: node tools/check-architecture.test.mjs
//
// Follows the tools/check-render-purity.test.mjs convention: every case builds
// a disposable temp-dir fixture (never the live repo — check-architecture.mjs
// is invoked with --root pointing at the fixture) and asserts the exit code.
// Per SFE-P0b / G-12 / AP-20, each rule gets both a clean-pass proof and a
// deliberate sabotage-fail proof, so this file proves the gate can actually
// fail, not just that it can pass.
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "check-architecture.mjs");

let failures = 0;
function check(name, actual, expected) {
  if (actual === expected) {
    console.log(`ok - ${name}`);
  } else {
    failures++;
    console.error(`NOT OK - ${name}: expected exit ${expected}, got ${actual}`);
  }
}

function run(root) {
  return spawnSync(process.execPath, [SCRIPT, "--root", root], { encoding: "utf8" });
}

function withFixture(fn) {
  const dir = mkdtempSync(join(tmpdir(), "check-architecture-"));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Builds a minimal, fully clean workspace fixture: root + cli + desktop
// package.json, one clean cli/src file, one clean desktop route matching the
// baseline exactly, one clean desktop/electron file, and the baseline JSON.
// Every sabotage test starts from this and corrupts exactly one thing, so a
// failure can be attributed to the rule under test and not an unrelated gap.
function scaffoldClean(root, { baselineRoutes = 1 } = {}) {
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(join(root, "packages", "cli", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "desktop", "src", "routes", "api", "status"), { recursive: true });
  mkdirSync(join(root, "packages", "desktop", "electron"), { recursive: true });

  writeFileSync(
    join(root, "package.json"),
    JSON.stringify({ name: "gutterpress-monorepo", private: true, devDependencies: { knip: "6.32.2" } }, null, 2),
  );
  writeFileSync(
    join(root, "packages", "cli", "package.json"),
    JSON.stringify({ name: "gutterpress", dependencies: { "markdown-it": "^14.1.0" } }, null, 2),
  );
  writeFileSync(
    join(root, "packages", "desktop", "package.json"),
    JSON.stringify({ name: "@dimm-city/gutterpress-desktop", dependencies: { svelte: "^5.0.0" } }, null, 2),
  );

  writeFileSync(
    join(root, "packages", "cli", "src", "index.ts"),
    'import { readFile } from "node:fs/promises";\nexport const hi = () => readFile;\n',
  );
  writeFileSync(
    join(root, "packages", "desktop", "src", "routes", "api", "status", "+server.ts"),
    'export function GET() { return new Response("ok"); }\n',
  );
  writeFileSync(
    join(root, "packages", "desktop", "electron", "main.ts"),
    'import { app } from "electron";\nimport pkg from "gutterpress";\nexport const start = () => { app; pkg; };\n',
  );

  writeFileSync(
    join(root, "tools", "architecture-baseline.json"),
    JSON.stringify({ desktopHttpRoutes: baselineRoutes }, null, 2),
  );
}

// --- Rule 1: ProseMirror-family ban -----------------------------------------

withFixture((root) => {
  scaffoldClean(root);
  check("clean fixture exits 0", run(root).status, 0);
});

// AP-21/AP-20: a PASS must come with printed scanned-target counts, and the
// clean fixture's counts must be nonzero — proving the printed numbers are
// real target counts, not a hardcoded placeholder that would print the same
// text regardless of what was actually scanned.
withFixture((root) => {
  scaffoldClean(root);
  const r = run(root);
  const rule1 = r.stdout.match(
    /RULE 1 \[prosemirror-ban\]: PASS — scanned (\d+) package\.json file\(s\) \(bun\.lock: (found|absent)\), (\d+) code file\(s\)/,
  );
  check("rule 1 prints a scanned package.json count", Boolean(rule1), true);
  check("rule 1's package.json count is nonzero on the clean fixture", rule1 && Number(rule1[1]) > 0, true);
  check("rule 1's code file count is nonzero on the clean fixture", rule1 && Number(rule1[3]) > 0, true);

  const rule3 = r.stdout.match(
    /RULE 3 \[d4-import-direction\]: PASS — scanned (\d+) packages\/cli\/src file\(s\), (\d+) packages\/desktop\/\{src,electron\} file\(s\)/,
  );
  check("rule 3 prints scanned cli/desktop file counts", Boolean(rule3), true);
  check("rule 3's packages/cli/src count is nonzero on the clean fixture", rule3 && Number(rule3[1]) > 0, true);
  check(
    "rule 3's packages/desktop/{src,electron} count is nonzero on the clean fixture",
    rule3 && Number(rule3[2]) > 0,
    true,
  );
});

withFixture((root) => {
  scaffoldClean(root);
  writeFileSync(
    join(root, "packages", "cli", "package.json"),
    JSON.stringify(
      { name: "gutterpress", dependencies: { "markdown-it": "^14.1.0", "prosemirror-state": "^1.0.0" } },
      null,
      2,
    ),
  );
  const r = run(root);
  check("prosemirror dependency in package.json exits 1", r.status, 1);
  check("prosemirror dependency failure names the package", r.stderr.includes("prosemirror-state"), true);
});

withFixture((root) => {
  scaffoldClean(root);
  writeFileSync(
    join(root, "bun.lock"),
    '{\n  "packages": {\n    "@tiptap/core": ["@tiptap/core@2.0.0", "", {}, "sha512-x"],\n  },\n}\n',
  );
  check("tiptap package entry in bun.lock exits 1", run(root).status, 1);
});

withFixture((root) => {
  scaffoldClean(root);
  writeFileSync(
    join(root, "packages", "desktop", "src", "milkdown-bridge.ts"),
    'import { Editor } from "milkdown";\nexport const e = Editor;\n',
  );
  const r = run(root);
  check("milkdown import under packages/*/src exits 1", r.status, 1);
  check("milkdown import failure quotes the specifier", r.stderr.includes("milkdown"), true);
});

// --- Rule 2: desktop HTTP route ratchet (D10) -------------------------------

withFixture((root) => {
  scaffoldClean(root, { baselineRoutes: 1 });
  mkdirSync(join(root, "packages", "desktop", "src", "routes", "api", "extra"), { recursive: true });
  writeFileSync(
    join(root, "packages", "desktop", "src", "routes", "api", "extra", "+server.ts"),
    'export function GET() { return new Response("new"); }\n',
  );
  const r = run(root);
  check("extra route over a baseline of 1 exits 1", r.status, 1);
  check("route ratchet failure cites plan rule D10", r.stderr.includes("D10"), true);
});

withFixture((root) => {
  scaffoldClean(root, { baselineRoutes: 5 });
  const r = run(root);
  check("route count below baseline still exits 0 (WARN only)", r.status, 0);
  check("route count below baseline prints a WARN", r.stderr.includes("WARN"), true);
});

withFixture((root) => {
  scaffoldClean(root);
  rmSync(join(root, "tools", "architecture-baseline.json"));
  check("missing baseline file exits 2 (usage/internal error)", run(root).status, 2);
});

// --- Rule 3: D4 import direction --------------------------------------------

withFixture((root) => {
  scaffoldClean(root);
  writeFileSync(
    join(root, "packages", "cli", "src", "bad-relative.ts"),
    // From packages/cli/src, escaping to the sibling packages/desktop needs
    // two levels up (src -> cli -> packages) before descending into desktop.
    'import { thing } from "../../desktop/src/foo";\nexport const x = thing;\n',
  );
  const r = run(root);
  check("cli/src relative import into packages/desktop exits 1", r.status, 1);
  check("cli->desktop failure names the offending file", r.stderr.includes("bad-relative.ts"), true);
});

withFixture((root) => {
  scaffoldClean(root);
  writeFileSync(
    join(root, "packages", "cli", "src", "bad-specifier.ts"),
    'import { thing } from "@dimm-city/gutterpress-desktop";\nexport const x = thing;\n',
  );
  check("cli/src bare @dimm-city/gutterpress-desktop import exits 1", run(root).status, 1);
});

withFixture((root) => {
  scaffoldClean(root);
  writeFileSync(
    join(root, "packages", "desktop", "src", "bad-relative.ts"),
    'import { lib } from "../../cli/src/lib/thing";\nexport const y = lib;\n',
  );
  const r = run(root);
  check("desktop/src deep-relative import into packages/cli/src exits 1", r.status, 1);
  check("desktop->cli/src failure recommends the published specifier", r.stderr.includes("gutterpress/render"), true);
});

withFixture((root) => {
  scaffoldClean(root);
  // Sanity: a relative import that merely LOOKS like it mentions "desktop" or
  // "cli" as a local path segment (not the sibling package) must NOT trip the
  // rule — this is exactly what a naive substring match on "../desktop" would
  // get wrong, and what resolving the path is meant to avoid.
  mkdirSync(join(root, "packages", "cli", "src", "lib"), { recursive: true });
  writeFileSync(join(root, "packages", "cli", "src", "lib", "desktop.ts"), "export const local = true;\n");
  writeFileSync(
    join(root, "packages", "cli", "src", "index.ts"),
    'import { readFile } from "node:fs/promises";\nimport { local } from "./lib/desktop";\nexport const hi = () => { readFile; local; };\n',
  );
  check("relative import to a same-package file named like a sibling package still exits 0", run(root).status, 0);
});

// AP-21 liveness FAIL (not merely WARN): if a required D4 scan target has
// zero scannable files, the rule was never actually exercised, so a clean
// exit would be indistinguishable from a real pass — this is exactly the
// shape a future P1a/P6 package move could produce by accident.
withFixture((root) => {
  // packages/cli is entirely absent — only packages/desktop exists.
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(join(root, "packages", "desktop", "src", "routes", "api", "status"), { recursive: true });
  mkdirSync(join(root, "packages", "desktop", "electron"), { recursive: true });
  writeFileSync(
    join(root, "packages", "desktop", "package.json"),
    JSON.stringify({ name: "@dimm-city/gutterpress-desktop", dependencies: { svelte: "^5.0.0" } }, null, 2),
  );
  writeFileSync(
    join(root, "packages", "desktop", "src", "routes", "api", "status", "+server.ts"),
    'export function GET() { return new Response("ok"); }\n',
  );
  writeFileSync(
    join(root, "packages", "desktop", "electron", "main.ts"),
    'import { app } from "electron";\nexport const start = () => { app; };\n',
  );
  writeFileSync(
    join(root, "tools", "architecture-baseline.json"),
    JSON.stringify({ desktopHttpRoutes: 1 }, null, 2),
  );
  const r = run(root);
  check("packages/cli entirely absent fails the gate (D4 liveness, AP-21), not a silent pass", r.status, 1);
  check("liveness failure names packages/cli/src", r.stderr.includes("packages/cli/src"), true);
  check("rule 3 summary reports the liveness FAIL, not PASS", r.stdout.includes("RULE 3 [d4-import-direction]: FAIL (liveness)"), true);
});

withFixture((root) => {
  // packages/cli exists normally; packages/desktop exists but has zero
  // scannable src/electron files (no routes, no code) — the other half of
  // the D4 boundary going empty.
  mkdirSync(join(root, "tools"), { recursive: true });
  mkdirSync(join(root, "packages", "cli", "src"), { recursive: true });
  mkdirSync(join(root, "packages", "desktop"), { recursive: true });
  writeFileSync(join(root, "packages", "cli", "src", "index.ts"), "export const x = 1;\n");
  writeFileSync(
    join(root, "packages", "desktop", "package.json"),
    JSON.stringify({ name: "@dimm-city/gutterpress-desktop" }, null, 2),
  );
  writeFileSync(
    join(root, "tools", "architecture-baseline.json"),
    JSON.stringify({ desktopHttpRoutes: 0 }, null, 2),
  );
  const r = run(root);
  check("packages/desktop with zero src/electron files fails the gate (D4 liveness, AP-21)", r.status, 1);
  check("liveness failure names packages/desktop/{src,electron}", r.stderr.includes("packages/desktop/{src,electron}"), true);
});

// --- Rule 4: future-package rules --------------------------------------------

withFixture((root) => {
  scaffoldClean(root);
  check("absent packages/editor and packages/vscode-extension are skipped, exits 0", run(root).status, 0);
});

withFixture((root) => {
  scaffoldClean(root);
  mkdirSync(join(root, "packages", "editor", "src"), { recursive: true });
  writeFileSync(
    join(root, "packages", "editor", "src", "index.ts"),
    'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
  );
  const r = run(root);
  check("fake packages/editor importing node:fs exits 1", r.status, 1);
  check("packages/editor node:fs failure names the specifier", r.stderr.includes("node:fs"), true);
});

withFixture((root) => {
  scaffoldClean(root);
  mkdirSync(join(root, "packages", "editor", "src"), { recursive: true });
  writeFileSync(
    join(root, "packages", "editor", "src", "index.ts"),
    'import { mount } from "svelte";\nexport const x = mount;\n',
  );
  check("fake packages/editor importing svelte exits 1", run(root).status, 1);
});

withFixture((root) => {
  scaffoldClean(root);
  mkdirSync(join(root, "packages", "editor", "src"), { recursive: true });
  // Present but empty: liveness must be reported, but must NOT fail the gate
  // on its own — there is nothing to check yet (AP-21).
  const r = run(root);
  check("present-but-empty packages/editor/src does not fail the gate", r.status, 0);
  check("present-but-empty packages/editor/src prints a liveness WARN", r.stderr.includes("LIVENESS WARN"), true);
});

withFixture((root) => {
  scaffoldClean(root);
  mkdirSync(join(root, "packages", "vscode-extension", "src"), { recursive: true });
  writeFileSync(
    join(root, "packages", "vscode-extension", "src", "extension.ts"),
    'import { mount } from "@dimm-city/gutterpress-desktop";\nexport const x = mount;\n',
  );
  const r = run(root);
  check("fake packages/vscode-extension importing the desktop package exits 1", r.status, 1);
});

withFixture((root) => {
  scaffoldClean(root);
  // vscode-extension legitimately runs in Node (D9): importing a Node builtin
  // must NOT be banned there the way it is for packages/editor.
  mkdirSync(join(root, "packages", "vscode-extension", "src"), { recursive: true });
  writeFileSync(
    join(root, "packages", "vscode-extension", "src", "extension.ts"),
    'import { readFileSync } from "node:fs";\nexport const x = readFileSync;\n',
  );
  check("packages/vscode-extension importing node:fs is allowed, exits 0", run(root).status, 0);
});

if (failures > 0) {
  console.error(`\n${failures} test(s) failed`);
  process.exit(1);
}
console.log("\nall tests passed");
