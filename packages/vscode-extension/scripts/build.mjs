#!/usr/bin/env bun
// packages/vscode-extension/scripts/build.mjs — SFE-P3c Lane A, "BUILD"
// deliverable (run spec DETAILS #5).
//
// `bun run build` emits:
//   dist/extension.js — CommonJS, target node, "vscode" EXTERNAL. This is
//     the file package.json's "main" points at, loaded by the real VS Code
//     extension host via require(). Entry: src/extension.ts.
//   dist/webview.js — browser target, ESM. Loaded by the webview via a
//     <script type="module"> tag (see ../src/provider.ts's renderWebviewHtml)
//     at whatever path webviewPanel.webview.asWebviewUri(...) resolves to
//     under this package's dist/ directory.
//
// WEBVIEW ENTRY OWNERSHIP (run spec DETAILS #4: "The webview ENTRY FILE is
// Lane C's — reference it by its built path (dist/webview.js); do not
// create src/webview/**. If your build cannot succeed without that file
// existing, emit a clearly-marked placeholder from the build script and SAY
// SO PROMINENTLY in your report — never silently ship a fake editor."):
// this script looks for src/webview/index.ts (the entry path Lane C should
// create — see WEBVIEW_ENTRY_PATH below) and bundles it for real if present.
// It does NOT exist yet as of this run's own commit (Lane A does not write
// src/webview/**), so THIS RUN's own `bun run build` emits the PLACEHOLDER
// below instead — see this run's report for the prominent flag the spec
// asks for, and WEBVIEW_PLACEHOLDER_JS's own comment for exactly what it
// does (renders an honest "not yet built" notice; never pretends to mount a
// real editor).
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
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIST_DIR = join(PACKAGE_ROOT, "dist");
const WEBVIEW_ENTRY_PATH = join(PACKAGE_ROOT, "src", "webview", "index.ts");

const WEBVIEW_PLACEHOLDER_JS = `// SFE-P3c Lane A placeholder — packages/vscode-extension/src/webview/index.ts
// (Lane C's real webview entry, which mounts @dimm-city/gutterpress-editor
// over a ProxyDocumentHost) does not exist in this build yet. This file
// exists ONLY so "bun run build" always produces a loadable dist/webview.js
// and the extension never silently ships a fake editor — see this run's
// report for the prominent flag the run spec requires. It renders an
// honest, visible "not yet built" notice instead of mounting anything, and
// is replaced automatically the moment src/webview/index.ts exists (see
// scripts/build.mjs).
(function () {
  var root = document.getElementById("gp-editor-root");
  if (root) {
    root.textContent =
      "Gutterpress rich editor webview is not yet built (SFE-P3c Lane C pending — placeholder from scripts/build.mjs).";
    root.style.cssText = "font-family:sans-serif;padding:1rem;color:#888;";
  }
})();
`;

async function main() {
  rmSync(DIST_DIR, { recursive: true, force: true });
  mkdirSync(DIST_DIR, { recursive: true });

  const extensionResult = await Bun.build({
    entrypoints: [join(PACKAGE_ROOT, "src", "extension.ts")],
    outdir: DIST_DIR,
    naming: "extension.js",
    target: "node",
    format: "cjs",
    external: ["vscode"],
  });
  reportBuildResult("dist/extension.js", extensionResult);

  if (existsSync(WEBVIEW_ENTRY_PATH)) {
    const webviewResult = await Bun.build({
      entrypoints: [WEBVIEW_ENTRY_PATH],
      outdir: DIST_DIR,
      naming: "webview.js",
      target: "browser",
      format: "esm",
    });
    reportBuildResult("dist/webview.js", webviewResult);
  } else {
    writeFileSync(join(DIST_DIR, "webview.js"), WEBVIEW_PLACEHOLDER_JS);
    console.warn(
      "\n[build.mjs] WARNING: src/webview/index.ts does not exist yet (Lane C's SFE-P3c " +
        "deliverable). Emitted a CLEARLY-MARKED PLACEHOLDER dist/webview.js instead of a " +
        "real editor bundle — see this run's report and this script's own header. Once " +
        "src/webview/index.ts exists, this build will bundle it for real automatically.\n",
    );
  }

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
