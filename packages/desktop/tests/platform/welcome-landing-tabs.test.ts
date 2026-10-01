/**
 * WelcomeLanding tab-state regressions (Codex review on PR #134, 2026-07-30).
 *
 * The landing is BOTH the start screen and the app's only empty state, and the
 * component stays mounted for the whole session — only its `{#if visible}`
 * block is torn down. So `activeTab` survives a dismissal unless something
 * resets it: read the Help tab, close the layer, and the next empty state (a
 * failed open, a closed project) reopens on Help with the book list and
 * recovery actions hidden behind a tab the author never chose.
 *
 * Source-text pins, per this repo's convention for component wiring (see
 * settings-connections.test.ts) — the reset is a transition-lifecycle
 * behaviour that a DOM-free unit test cannot observe.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf8");
const landing = read("src/lib/components/WelcomeLanding.svelte");

describe("the landing OPENS on Books", () => {
  test("`activeTab` initialises to projects", () => {
    expect(landing).toMatch(/let activeTab = \$state<LandingTab>\("projects"\)/);
  });

  test("nothing at launch hijacks the tab", () => {
    // Regression, 2026-08: a launch-time nudge in +page's onMount sent the
    // start screen to Settings → Accounts whenever the git identity was
    // empty — i.e. on EVERY first run — so a new author met account settings
    // instead of their books. The missing-identity nudge is the workspace
    // banner (`needsGitIdentity`), not the front door. `showTab` may only be
    // called from an explicit user action (the help button, openSettings,
    // the Books panel's "Welcome screen").
    const page = read("src/routes/+page.svelte");
    expect(page).not.toMatch(/onMount\([\s\S]{0,600}?showTab\(/);
    expect(page).not.toContain('landingSettingsTab = "connections"');
  });
});

describe("the landing returns to Books after it is dismissed", () => {
  test("the outro-end handler resets the tab", () => {
    expect(landing).toMatch(/function onOutroEnd\(\)\s*\{\s*activeTab = "projects";/);
  });

  test("the handler is actually bound to the transitioning element", () => {
    expect(landing).toContain("onoutroend={onOutroEnd}");
  });

  test("the transition that fires `outroend` is still there", () => {
    // The reset is deliberately coupled to the fade: `outroend` is dispatched
    // by the transition runtime, so dropping `transition:` would silently
    // strand the tab on Help. If the transition moves or changes, this test
    // is the prompt to re-home the reset rather than lose it.
    const section = landing.slice(landing.indexOf('<section\n    class="landing"'));
    const openTag = section.slice(0, section.indexOf(">"));
    expect(openTag).toMatch(/transition:fade/);
    expect(openTag).toContain("onoutroend={onOutroEnd}");
  });
});

describe("start-screen copy", () => {
  test("no 'Welcome back' greeting over the continue card", () => {
    // Owner request 2026-07-30: the card already names the book it is
    // offering to reopen. The first-run hero stays — with nothing to
    // continue, the screen still has to introduce itself.
    expect(landing).not.toContain("Welcome back");
    expect(landing).toContain("Welcome to Gutterpress");
  });
});

describe("the Troubleshooting tab (diagnostics, logs, about)", () => {
  test("Troubleshooting is the LAST tab, after Help; no standalone Logs tab", () => {
    const tabs = landing.slice(
      landing.indexOf("const LANDING_TABS"),
      landing.indexOf("];", landing.indexOf("const LANDING_TABS")),
    );
    const order = [...tabs.matchAll(/id: "([a-z]+)"/g)].map((m) => m[1]);
    expect(order).toEqual(["projects", "settings", "help", "troubleshooting"]);
    expect(landing).not.toContain('activeTab === "logs"');
  });

  test("showTab takes an optional sub-tab for deep links", () => {
    expect(landing).toMatch(/export function showTab\(tab: LandingTab, sub\?: TroubleshootingTab\)/);
    expect(landing).toContain("sanitizeTroubleshootingTab(sub)");
  });

  test("the panel mounts TroubleshootingView with the update wiring", () => {
    expect(landing).toContain("<TroubleshootingView");
    expect(landing).toContain("{onCheckForUpdates}");
    expect(landing).not.toContain("LogsPanel");
  });

  test("its Logs sub-tab re-lists on every visit (LogsPanel mounts only while active)", () => {
    const view = read("src/lib/components/TroubleshootingView.svelte");
    expect(view).toMatch(/\{#if activeTab === "logs"\}\s*(<!--[\s\S]*?-->\s*)?<LogsPanel \/>/);
    const logsPanel = read("src/lib/components/LogsPanel.svelte");
    expect(logsPanel).toContain("api.log.list()");
    expect(logsPanel).toContain("api.log.read(");
    expect(logsPanel).toContain("navigator.clipboard.writeText");
  });

  test("reuses SettingsView's sub-tab pattern", () => {
    const view = read("src/lib/components/TroubleshootingView.svelte");
    expect(view).toContain('role="tablist" aria-label="Troubleshooting sections"');
    expect(view).toContain("onTablistKeydown");
    expect(view).toContain('role="tabpanel"');
    expect(view).toContain("{idPrefix}-panel");
  });

  test("Diagnostics keeps the doctor load + copy report (with versions); About has versions + updates", () => {
    const view = read("src/lib/components/TroubleshootingView.svelte");
    expect(view).toContain("api.doctor()");
    expect(view).toContain("Copy diagnostic info");
    expect(view).toContain("`Gutterpress desktop ${data.desktopVersion}`");
    expect(view).toContain("Check for updates");
    expect(view).toContain("<strong>Desktop:</strong>");
  });
});

describe("the Help tab is guidance only", () => {
  const help = read("src/lib/components/HelpContent.svelte");

  test("no doctor call, loading/error state, diagnostics or updates", () => {
    expect(help).not.toContain("api.doctor");
    expect(help).not.toContain("loading");
    expect(help).not.toContain("Retry");
    expect(help).not.toContain("Copy diagnostic info");
    expect(help).not.toContain("system-info");
    expect(help).not.toContain("Optional system tools");
    expect(help).not.toContain("Check for updates");
    expect(help).not.toContain("Loaded versions");
  });

  test("sections run Getting Started, Online Copy, Keyboard Shortcuts, with the one-line intro", () => {
    const at = (t: string) => help.indexOf(t);
    expect(help).toContain("How to open, edit, save and publish your book.");
    expect(at("Getting Started")).toBeGreaterThan(-1);
    expect(at("Getting Started")).toBeLessThan(at("Work with an Online Copy"));
    expect(at("Work with an Online Copy")).toBeLessThan(at("Keyboard Shortcuts"));
  });
});

describe("the left panel's Books footer", () => {
  test("is Open book… then New book — no Welcome screen / GitHub buttons", () => {
    const body = read("src/lib/components/ProjectsListBody.svelte");
    expect(body).not.toContain("onShowWelcome");
    expect(body).not.toContain("Welcome screen");
    expect(body).not.toContain("Open from GitHub");
    expect(body.indexOf("Open book…")).toBeGreaterThan(-1);
    expect(body.indexOf("Open book…")).toBeLessThan(body.indexOf("> New book"));
    expect(read("src/routes/+page.svelte")).not.toContain("onShowWelcome");
  });

  test("Open book… hands off to the existing local-folder and GitHub flows", () => {
    // Mounted by +page (outside the transformed left panel, which would
    // otherwise become the containing block of the modal's fixed positioning).
    const page = read("src/routes/+page.svelte");
    expect(page).toMatch(/onLocal=\{\(\) => \{[^}]*pickAndOpenFolder\(\)/);
    expect(page).toMatch(/onGitHub=\{isDesktop\(\) \? \(\) => \{[^}]*githubOpen = true/);
    expect(read("src/lib/components/ProjectsListBody.svelte")).not.toContain("OpenBookDialog");
    const dlg = read("src/lib/components/OpenBookDialog.svelte");
    expect(dlg).toContain("Open a book");
    expect(dlg).toContain("From this computer");
    expect(dlg).toContain("From GitHub");
    expect(dlg).toContain("dialogBehavior");
  });
});
