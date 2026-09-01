#!/usr/bin/env node
// SFE-P3c Lane A — host-fidelity smoke test, OUTER launcher.
//
// Runs OUTSIDE VS Code (a plain Node/Bun process): downloads (or reuses a
// cached) real VS Code, launches it as an "Extension Development Host"
// with THIS package as the extension under test, and points it at
// ./run-in-host.js (the INNER entry — see that file's own header). NOT
// part of `bun run test`'s default suite (deliberately: it needs real
// network access to a VS Code download CDN and, outside a real desktop
// session, a virtual display) — invoked explicitly via
// `bun run test:host-fidelity`. See package.json's script and this run's
// report for the confirmed reason this cannot run inside THIS repository's
// own sandboxed session.
//
// Prerequisite: `bun run build` must have already produced dist/extension.js
// (this launcher does not build it — a real CI job runs build before this).
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { runTests } from "@vscode/test-electron";

const PACKAGE_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const EXTENSION_ROOT = PACKAGE_ROOT;
const EXTENSION_TESTS_PATH = join(PACKAGE_ROOT, "tests", "host-fidelity", "run-in-host.js");
const FIXTURE_PATH = join(PACKAGE_ROOT, "tests", "host-fidelity", "fixtures", "sample.md");

async function main() {
  if (!existsSync(join(EXTENSION_ROOT, "dist", "extension.js"))) {
    console.error(
      "[host-fidelity] dist/extension.js does not exist — run `bun run build` in packages/vscode-extension first.",
    );
    process.exit(2);
  }

  const exitCode = await runTests({
    extensionDevelopmentPath: EXTENSION_ROOT,
    extensionTestsPath: EXTENSION_TESTS_PATH,
    launchArgs: [FIXTURE_PATH, "--disable-gpu", "--no-sandbox"],
  });
  process.exit(exitCode);
}

main().catch((error) => {
  console.error("[host-fidelity] launch failed:", error && error.stack ? error.stack : error);
  process.exit(1);
});
