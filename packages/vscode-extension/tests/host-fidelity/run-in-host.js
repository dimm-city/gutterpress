// SFE-P3c Lane A — host-fidelity smoke test, INNER entry.
//
// Loaded by the REAL VS Code Extension Development Host (via
// @vscode/test-electron's `extensionTestsPath`), NOT by `bun test` — this
// file runs INSIDE a real running VS Code instance, where the real
// "vscode" module is a genuine host-injected API, not something any mock
// stands in for. Deliberately plain CommonJS with NO test framework
// (Mocha, jest, ...): @vscode/test-electron's contract only requires this
// module to export `function run(): Promise<void>` that throws on failure
// (see its own runTest.d.ts) — introducing Mocha here would be a
// dependency this run's specification does not name.
//
// UNVERIFIED IN THIS REPOSITORY'S CI/SANDBOX: this run's "ONE bounded,
// time-boxed attempt" confirmed the download step
// (`@vscode/test-electron`'s `downloadAndUnzipVSCode`) cannot reach
// `update.code.visualstudio.com` through this environment's outbound proxy
// allowlist (exact command and exact failure recorded in this run's
// report) — so this file's actual behavior inside a real VS Code instance
// has NOT been exercised end to end. It is written carefully against
// @vscode/test-electron's documented contract and the real `@types/vscode`
// `.d.ts` (`vscode.commands.executeCommand("vscode.openWith", ...)`,
// `vscode.window.tabGroups`, `vscode.TabInputCustom`), but should be
// treated as a best-effort scaffold to VALIDATE, not a proven pass, until
// run somewhere with real network access to the VS Code download CDN. See
// ../../src/extension.ts's header and this run's report.

const assert = require("node:assert");
const path = require("node:path");
const vscode = require("vscode");

async function run() {
  // 1. Activate the extension (mirrors a real user opening a Markdown file
  //    for the first time — `getExtension` + `.activate()` is the
  //    documented way to force activation deterministically in a test
  //    rather than relying on VS Code's own activation-event timing).
  const extension = vscode.extensions.getExtension("dimm-city.gutterpress-vscode");
  assert.ok(extension, "extension 'dimm-city.gutterpress-vscode' should be discoverable by the test host");
  await extension.activate();
  assert.ok(extension.isActive, "extension should report isActive after activate()");

  // 2. Open the fixture .md file WITH the custom editor specifically
  //    (vscode.openWith — the documented command for choosing a specific
  //    viewType rather than the default handler, matching D9: this custom
  //    editor is never the default *.md handler).
  const fixtureUri = vscode.Uri.file(path.join(__dirname, "fixtures", "sample.md"));
  await vscode.commands.executeCommand("vscode.openWith", fixtureUri, "gutterpress.markdownEditor");

  // 3. Assert the webview actually resolved: the active tab should now be
  //    a TabInputCustom for our viewType (a custom/webview editor tab has
  //    no vscode.window.activeTextEditor — that API only reflects plain
  //    text editors — so the active tab's input shape is the correct,
  //    documented observable here).
  const activeTab = vscode.window.tabGroups.activeTabGroup.activeTab;
  assert.ok(activeTab, "opening the fixture should produce an active tab");
  assert.ok(
    activeTab.input instanceof vscode.TabInputCustom,
    `active tab should be a custom-editor tab, got: ${JSON.stringify(activeTab.input)}`,
  );
  assert.strictEqual(
    activeTab.input.viewType,
    "gutterpress.markdownEditor",
    "active tab's viewType should be gutterpress.markdownEditor",
  );

  // eslint-disable-next-line no-console -- test-runner-visible progress line, not a diagnostic
  console.log("[host-fidelity] smoke test passed: extension activated, webview resolved for gutterpress.markdownEditor");
}

module.exports = { run };
