/**
 * Settings tabs + the central Connections tab, and the toolbar Save button
 * (owner requests, 2026-07-13). Source-text pins per the repo convention for
 * component wiring (see publish-wizard.test.ts).
 */
import { expect, test, describe } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

describe("Toolbar Save button — flush all pending changes beside Export", () => {
  const page = read("src/routes/+page.svelte");
  test("wired to the same force-save the status bar uses, disabled when clean", () => {
    const idx = page.indexOf('class="save-btn icon-text save-now"');
    expect(idx).toBeGreaterThan(-1);
    const btn = page.slice(idx, idx + 700);
    expect(btn).toContain("onclick={handleForceSave}");
    expect(btn).toContain('editorSavePhase === "clean"');
    expect(btn).toContain("All changes saved");
    // Sits before the Export button in the same toolbar cluster.
    expect(idx).toBeLessThan(page.indexOf("onclick={() => exportController.savePdf()}"));
  });
});

describe("Settings dialog — tabbed layout", () => {
  const dlg = read("src/lib/components/SettingsDialog.svelte");
  test("five tabs incl. Connections; sections render per-tab", () => {
    expect(dlg).toContain('role="tablist"');
    for (const label of ['label: "App"', 'label: "Editor"', 'label: "Saving"', 'label: "Connections"', 'label: "Advanced"']) {
      expect(dlg).toContain(label);
    }
    expect(dlg).toContain('{#if activeTab === "app"}');
    expect(dlg).toContain('{#if activeTab === "connections"}');
    expect(dlg).toContain("<ConnectionsSettings {projectDir} />");
  });
  test("the page passes the open project dir through", () => {
    const page = read("src/routes/+page.svelte");
    expect(page).toContain("projectDir={lifecycle.currentDir}");
  });
});

describe("Connections tab — central credential management", () => {
  const conn = read("src/lib/components/ConnectionsSettings.svelte");
  test("lists GitHub + Git servers + publishing accounts from redacted entries", () => {
    expect(conn).toContain("api.remote.getRemoteConnection()");
    expect(conn).toContain("api.remote.listHostConnections()");
    expect(conn).toContain("api.publish.providers()");
    expect(conn).toContain("Publishing accounts");
    expect(conn).toContain("Git servers");
  });
  test("classifies publish entries by compound keys and provider hosts", () => {
    expect(conn).toContain('e.host.includes("#")');
    expect(conn).toContain("publishHosts.has(baseHost(e.host))");
  });
  test("removal deletes by the RAW store key (works for named publish accounts)", () => {
    expect(conn).toContain("api.remote.disconnectHost(key)");
    // Two-step confirm before deleting a credential (the most painful thing
    // to re-acquire — same pattern as AdvancedSetupDialog's Disconnect).
    expect(conn).toContain("requestInlineConfirm");
  });
  test("undecryptable entries are surfaced as needing reconnection", () => {
    expect(conn).toContain("entry.unreadable");
    expect(conn).toContain("Needs reconnecting");
    // The redacted contract type carries the flag.
    expect(read("src/lib/platform/shared-types.ts")).toContain("unreadable?: boolean");
  });
  test("GitHub connect runs the device flow inline (code shown, browser opened)", () => {
    expect(conn).toContain("connectGitHubStart()");
    expect(conn).toContain("connectGitHubWait()");
    expect(conn).toContain("ghCode.userCode");
    // Cancelled if the tab unmounts mid-poll.
    expect(conn).toContain("connectGitHubCancel()");
  });
  test("tokens never linger in renderer state after a connect", () => {
    expect(conn).toContain('serverToken = ""');
    expect(conn).toContain('pubToken = ""');
  });
  test("adding a publishing key uses verify-before-store and asks for an open project", () => {
    expect(conn).toContain("api.publish.connect(projectDir, pubProviderId, pubToken");
    expect(conn).toContain("Open a project to add a publishing key");
  });
  test("stays $effect-free (CLAUDE.md §8) — load happens onMount", () => {
    expect(conn).not.toContain("$effect(");
    expect(conn).toContain("onMount(");
  });
});

describe("publish:providers route — static metadata, no project required", () => {
  const route = read("src/routes/api/publish/providers/+server.ts");
  test("returns id/label/credential host without touching a manifest", () => {
    expect(route).toContain("listPublishProviders()");
    expect(route).toContain("credentialHost");
    expect(route).not.toContain("projectDir");
  });
});
