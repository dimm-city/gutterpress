/**
 * Reader or Author (Settings → How you use Gutterpress): a fresh profile is a
 * Reader, who only reads; an Author has the whole app; creating a book makes
 * a Reader an Author. The default and the saved value are pinned in
 * settings-store.test.ts and the left panel in left-panel-tabs.test.ts; this
 * pins the rest: the Settings group, what the toolbar, the Focus bar and the
 * workspace do for a Reader, and what stays for both roles.
 */
import { describe, test, expect } from "bun:test";
import { readFileSync } from "node:fs";

const read = (rel: string) => readFileSync(new URL(`../../src/${rel}`, import.meta.url), "utf8");
const settingsView = read("lib/components/SettingsView.svelte");
const toolbar = read("lib/components/AppToolbar.svelte");
const focusBar = read("lib/components/FocusBar.svelte");
const page = read("routes/+page.svelte");

describe("Settings", () => {
  test("the choice is the first group, worded as the Reader and Author descriptions", () => {
    expect(settingsView.indexOf('id="settings-role"')).toBeGreaterThan(-1);
    expect(settingsView.indexOf('id="settings-role"')).toBeLessThan(settingsView.indexOf('id="settings-appearance"'));
    expect(settingsView).toContain(">How you use Gutterpress</h2>");
    expect(settingsView).toContain(
      "Just the pages. Edit, Setup and Publish stay out of the way. Creating a book switches you to Author.",
    );
    expect(settingsView).toContain("Write and set up your book, then publish it.");
  });

  test("each radio saves its role at once", () => {
    expect(settingsView).toContain('value: "reader"');
    expect(settingsView).toContain('value: "author"');
    expect(settingsView).toContain("settings.set({ workspace: { role: r.value } })");
    expect(settingsView).toContain("checked={s.workspace.role === r.value}");
  });
});

describe("a Reader's toolbar", () => {
  const css = toolbar.slice(toolbar.indexOf(".toolbar.reader"));

  test("takes the reader flag", () => {
    expect(toolbar).toContain("class:reader={readerMode}");
  });

  test("loses Edit/Read, the pane tabs, Setup and Publish, which are removed, not disabled", () => {
    const rule = css.slice(0, css.indexOf("}"));
    for (const control of [".pane-toggle", ".mode-group", ".mode-menu", ".project-settings-btn", ".publish-btn"]) {
      expect(rule).toContain(`.toolbar.reader ${control}`);
    }
    expect(rule).toContain("display: none");
    expect(rule).not.toContain(".focus-btn");
    // The controls it hides are the ones the toolbar draws.
    for (const cls of ["pane-toggle", "mode-group", "mode-menu", "project-settings-btn", "publish-btn"]) {
      expect(toolbar).toContain(cls);
    }
  });

  test("the Focus bar has no Edit/Read switch", () => {
    expect(focusBar).toMatch(/\{#if !readerMode\}\s*<div class="view-switch"/);
  });
});

describe("the workspace", () => {
  test("a Reader's mode is always Read; an Author's is their saved choice", () => {
    expect(page).toContain('let readerMode = $derived(settings.current.workspace.role === "reader");');
    expect(page).toContain('s.workspace.role === "reader" ? "viewer" : s.preview.mode');
    expect(page).toContain("modeSink(effectiveMode(s));");
  });

  test("a Reader cannot open the editor", () => {
    expect(page).toMatch(/function openEditorPane\([^)]*\) \{\s*if \(readerMode\) return;/);
    expect(page).toContain('if (next === "editor" && readerMode) return;');
  });

  test("the Reader flag reaches the toolbar, the Focus bar and the left panel", () => {
    expect(page).toMatch(/<FocusBar[^>]*\{readerMode\}/);
    expect(page).toMatch(/<AppToolbar[\s\S]*?\{readerMode\}[\s\S]*?\/>/);
    expect(page).toMatch(/<LeftPanel[^>]*\{readerMode\}/);
  });

  test("creating a book makes a Reader an Author, and nothing else does", () => {
    expect(page).toContain('if (settings.current.workspace.role === "reader") settings.set({ workspace: { role: "author" } });');
    expect(page.match(/workspace: \{ role: "author" \}/g)).toHaveLength(1);
  });
});

describe("what stays for both roles", () => {
  test("Accounts, the start screen, the New book buttons and the status bar never read the role", () => {
    for (const file of [
      "lib/components/AccountsView.svelte",
      "lib/components/WelcomeLanding.svelte",
      "lib/components/ProjectsListBody.svelte",
      "lib/components/StatusBar.svelte",
    ]) {
      expect(read(file)).not.toMatch(/readerMode|workspace\.role/);
    }
  });
});
