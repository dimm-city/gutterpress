#!/usr/bin/env bun
// packages/vscode-extension/scripts/build.mjs — SFE-P3c Lane A, "BUILD"
// deliverable (run spec DETAILS #5).
//
// `bun run build` emits:
//   dist/extension.js — CommonJS, target node, "vscode" AND "gutterpress"
//     EXTERNAL. This is the file package.json's "main" points at, loaded by
//     the real VS Code extension host via require(). Entry: src/extension.ts.
//   dist/webview.js — browser target, ESM. Loaded by the webview via a
//     <script type="module"> tag (see ../src/provider.ts's renderWebviewHtml)
//     at whatever path webviewPanel.webview.asWebviewUri(...) resolves to
//     under this package's dist/ directory.
//
// EXTERNAL "gutterpress" (repair round 1, finding "dist/extension.js is not
// loadable by the VS Code extension host"): `gutterpress` is a real
// `dependencies` entry in package.json (D4's `@dimm-city/gutterpress-vscode`
// consumes it the same way any other extension dependency is consumed), so
// Node resolves it from node_modules like any other extension dep at
// require() time — exactly like "vscode" is resolved by the host, except
// "gutterpress" is a real, installable package rather than a host-injected
// one. Bundling it IN, as the pre-repair version of this script did, pulled
// `packages/cli/src/lib/pdf-inspect.ts`'s eager top-level
// `import { getDocumentProxy } from "unpdf"` into dist/extension.js — that
// module's body contains `import.meta.resolve`, a syntax error in a CommonJS
// file the real extension host's require() cannot parse at all (verified:
// `node -e "require('./extension.js')"` against a stub "vscode" and a
// {"type":"commonjs"} package.json throws `SyntaxError: Cannot use
// 'import.meta' outside a module` at parse time — unconditional, not a
// runtime-only failure). Externalizing "gutterpress" removes that whole
// subtree from the bundle (7.98 MB -> a fraction of that) and makes the
// extension load the same way every other VS Code extension with npm
// dependencies does. `@dimm-city/gutterpress-editor` stays BUNDLED
// (deliberately not external): it is framework-free/browser-safe by design
// (D4), so inlining it into a Node CJS target is safe, and it is not a
// `dependencies` entry a packaged extension's own node_modules would
// otherwise supply on its own resolution path the way `gutterpress` is.
//
// tests/extension-load.test.ts is the load-bearing regression proof this
// externalization needs (`bun run build` succeeding was ALREADY a gate
// command, but nothing ever LOADED the artifact the way the real extension
// host does) — it builds this exact config in-process, writes the output
// beside a `{"type":"commonjs"}` package.json and a stub "vscode"/
// "gutterpress" on the require() resolution path (the real packaged shape),
// and asserts a real `node -e "require(...)"` resolves `activate`/
// `deactivate` as functions. See that file for the full account.
//
// Both builds are single-entrypoint, single-file, with an explicit
// `naming` override rather than `outdir`'s default `"[dir]/[name].[ext]"`
// pattern (empirically verified while authoring this script: `Bun.build()`'s
// JS API has NO top-level `outfile` option — that field only exists inside
// `compile`, for standalone-executable builds, and is silently ignored
// everywhere else, which the FIRST version of this script did not realize:
// it built successfully in memory but wrote nothing to disk at all). An
// explicit `naming: "extension.js"` / `"webview.js"` avoids depending on
// each entrypoint's own directory name/basename matching the desired
// output name (`src/webview/index.ts`'s default-named output would be
// `webview/index.js`, not `webview.js`).
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_DIR = join(PACKAGE_ROOT, "dist");
const WEBVIEW_ENTRY_PATH = join(PACKAGE_ROOT, "src", "webview", "index.ts");

async function main() {
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });

  const extensionResult = await Bun.build({
    entrypoints: [join(PACKAGE_ROOT, "src", "extension.ts")],
    outdir: DIST_DIR,
    naming: "extension.js",
    target: "node",
    format: "cjs",
    external: ["vscode", "gutterpress"],
  });
  reportBuildResult("dist/extension.js", extensionResult);

  // src/webview/index.ts (Lane C's real webview entry, mounting
  // @dimm-city/gutterpress-editor over a ProxyDocumentHost) is a committed
  // source file in this same package — bundling it is an ordinary build
  // step, not a scenario that may or may not exist. A missing/renamed/
  // deleted entry is therefore a build FAILURE (Bun.build's own success:
  // false path below, via reportBuildResult, which already exits 1) rather
  // than a silently-shipped placeholder: the pre-repair version of this
  // script emitted a fake "not yet built" notice into dist/webview.js
  // whenever the entry was absent, with `bun run build` still exiting 0 —
  // exactly the "never silently ship a fake editor" outcome that placeholder
  // comment claimed to prevent. Removed (repair round 1, finding "build.mjs's
  // webview placeholder is dead machinery, a false header, and a silent-fail
  // path") along with the now-unreachable existsSync branch it lived in.
  const webviewResult = await Bun.build({
    entrypoints: [WEBVIEW_ENTRY_PATH],
    outdir: DIST_DIR,
    naming: "webview.js",
    target: "browser",
    format: "esm",
  });
  reportBuildResult("dist/webview.js", webviewResult);

  console.log("\n[build.mjs] OK — dist/extension.js and dist/webview.js written.");
}

function reportBuildResult(label, result) {
  if (!result.success) {
    console.error(`[build.mjs] FAILED building ${label}:`);
    for (const message of result.logs) console.error(`  ${message}`);
    process.exit(1);
  }
  console.log(`[build.mjs] built ${label}`);
}

main().catch((error) => {
  console.error("[build.mjs] ERROR:", error);
  process.exit(1);
});
