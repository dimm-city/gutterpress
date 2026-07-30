/**
 * Settings tabs + the central Connections tab, and the toolbar Save button
 * (owner requests, 2026-07-13). Source-text pins per the repo convention for
 * component wiring (see publish-wizard.test.ts).
 */
import { expect, test, describe } from "bun:test";
import * as fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");

describe("Toolbar Save button — flush all pending changes beside Export", () => {
  const page = read("src/routes/+page.svelte");
  const toolbar = read("src/lib/components/AppToolbar.svelte");
  test("wired to the same force-save the status bar uses, disabled when clean", () => {
    // The button markup lives in the extracted AppToolbar; +page wires the
    // intent (onSave → handleForceSave) and the clean-state disable.
    const idx = toolbar.indexOf('class="save-btn icon-text"');
    expect(idx).toBeGreaterThan(-1);
    const btn = toolbar.slice(idx, idx + 700);
    expect(btn).toContain("onclick={onSave}");
    expect(btn).toContain("All changes saved");
    expect(page).toContain("onSave={handleForceSave}");
    expect(page).toMatch(/saveDisabled=\{[^}]*editorSavePhase === "clean"/);
    // Sits after the Export button — Save is the right-most action.
    expect(idx).toBeGreaterThan(toolbar.indexOf('class="export-btn'));
  });
});

describe("Settings panel — tabbed layout", () => {
  const dlg = read("src/lib/components/SettingsView.svelte");
  test("four tabs incl. Accounts; sections render per-tab", () => {
    expect(dlg).toContain('class="settings-view"');
    expect(dlg).not.toContain('class="dlg-shell"');
    expect(dlg).not.toContain("dialogBehavior");
    expect(dlg).toContain('role="tablist"');
    // The Connections tab id survives (deep links keep working) but reads
    // "Accounts"; the Advanced tab folded into Editor (owner request
    // 2026-07-30).
    for (const label of ['label: "App"', 'label: "Editor"', 'label: "Saving"', 'label: "Accounts"']) {
      expect(dlg).toContain(label);
    }
    expect(dlg).not.toContain('label: "Advanced"');
    expect(dlg).not.toContain('label: "Connections"');
    expect(dlg).toContain('{#if activeTab === "app"}');
    expect(dlg).toContain('{#if activeTab === "connections"}');
    expect(dlg).toContain("<ConnectionsSettings {projectDir} />");
    expect(dlg).not.toContain("<details class=\"group advanced\">");
    // The Advanced sections now render inside the Editor tab.
    const editorTab = dlg.slice(dlg.indexOf('{#if activeTab === "editor"}'), dlg.indexOf('{#if activeTab === "saving"}'));
    expect(editorTab).toContain('class="group advanced"');
    expect(editorTab).toContain("set-watcher");
    expect(editorTab).toContain("set-loglevel");
  });
  test("the author's name/email is the FIRST section on the Accounts tab", () => {
    const accountsTab = dlg.slice(dlg.indexOf('{#if activeTab === "connections"}'));
    const identity = accountsTab.indexOf("<GitIdentitySection />");
    const connections = accountsTab.indexOf("<ConnectionsSettings");
    expect(identity).toBeGreaterThan(-1);
    expect(connections).toBeGreaterThan(-1);
    expect(identity).toBeLessThan(connections);
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
  test("GitHub is the FIRST section (owner request 2026-07-30)", () => {
    // GitHub sits directly under the author's name & email — the identity it
    // carries — on both Accounts surfaces (Settings and the welcome screen).
    // Compare the section headings' positions in the template.
    const gh = conn.indexOf("<h4>GitHub</h4>");
    const pub = conn.indexOf("<h4>Publishing accounts</h4>");
    const git = conn.indexOf("<h4>Git servers</h4>");
    expect(gh).toBeGreaterThan(-1);
    expect(pub).toBeGreaterThan(-1);
    expect(git).toBeGreaterThan(-1);
    expect(gh).toBeLessThan(pub);
    expect(pub).toBeLessThan(git);
  });
  test("Accounts is the FIRST settings tab (owner request 2026-07-30)", () => {
    const view = read("src/lib/components/SettingsView.svelte");
    const tabs = view.slice(view.indexOf("const TABS"), view.indexOf("];", view.indexOf("const TABS")));
    expect(tabs.indexOf('label: "Accounts"')).toBeLessThan(tabs.indexOf('label: "App"'));
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

describe("Advanced setup consolidated into the Connections tab (owner request 2026-07-22)", () => {
  const conn = read("src/lib/components/ConnectionsSettings.svelte");
  const view = read("src/lib/components/SettingsView.svelte");

  test("the AdvancedSetupDialog component is gone — modal path was dead, embedded body duplicated Connections", () => {
    expect(fs.existsSync(path.join(root, "src/lib/components/AdvancedSetupDialog.svelte"))).toBe(false);
    expect(view).not.toContain("AdvancedSetupDialog");
    expect(view).not.toContain("Advanced setup");
  });

  test("the Connections tab hosts ONE component with no duplicate connect form", () => {
    // Exactly one connect-a-git-server call site remains, in ConnectionsSettings.
    expect(conn.split("connectGenericHost").length - 1).toBe(1);
    expect(view).toContain("<ConnectionsSettings {projectDir} />");
  });

  test("the token-URL helper moved onto the single Git-server form (debounced forge lookup)", () => {
    expect(conn).toContain("api.remote");
    expect(conn).toContain("forgeTokenUrl");
    expect(conn).toMatch(/setTimeout\([\s\S]{0,200}forgeTokenUrl/);
  });

  test("the git-server connect stays project-aware: repo-scoped validation + host prefill", () => {
    // Validate against the open project's repository when the typed host
    // matches its HTTPS remote (proves repo access, not just reachability)…
    expect(conn).toMatch(/repoUrl:\s*diag\.remoteUrl/);
    expect(conn).toContain("sameHost(");
    // …and pre-fill the server field when the project needs that server.
    expect(conn).toContain('"https-connect-server"');
  });

  test("project diagnostics + Test remote access live on Project settings > Connections", () => {
    // Moved out of the app-level Accounts tab (2026-07-30): the diagnosis is
    // about ONE project, so it renders as ProjectSettingsView's Connections
    // tab. ConnectionsSettings keeps fetching the diagnosis for its
    // connect-form prefill/validation, but no longer renders the section.
    const proj = read("src/lib/components/ProjectConnectionsSection.svelte");
    expect(proj).toContain("diagnoseProjectRemote");
    expect(proj).toContain("testRemoteAccess");
    expect(proj).toContain("Test remote access");
    // The explicit-click-only contract survives the move: no automatic probe.
    expect(proj).toMatch(/onclick=\{runRemoteTest\}/);
    expect(conn).toContain("diagnoseProjectRemote");
    expect(conn).not.toContain("testRemoteAccess");
    const view = read("src/lib/components/ProjectSettingsView.svelte");
    expect(view).toContain('{ id: "connections", label: "Connections" }');
    expect(view).toContain("<ProjectConnectionsSection");
  });

  test("provider guidance (how to get a token, SSH limits) survives, once", () => {
    expect(conn).toContain("Which server do you use?");
    expect(conn).toContain("SSH addresses (git@");
  });

  test("no stale references to the removed dialog anywhere in src", () => {
    const hits: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.(svelte|ts)$/.test(entry.name) && fs.readFileSync(full, "utf8").includes("AdvancedSetupDialog")) {
          hits.push(path.relative(root, full));
        }
      }
    };
    walk(path.join(root, "src"));
    expect(hits).toEqual([]);
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
