/**
 * Source-level tests for the Project settings view (toolbar-refactor):
 * project settings moved OUT of the left sidebar's Config tab into a
 * full-screen view patterned after the app SettingsView, for a friendlier
 * layout when managing the project manifest.
 *
 * Same source-assertion convention as the other component tests (no Svelte
 * mount harness in this repo's bun:test setup).
 *
 * Contract under test:
 *  1. ProjectSettingsView.svelte exists and follows the SettingsView pattern:
 *     header + close button + a WAI-ARIA tab bar over cohesive sections.
 *  2. It is the composition root for the existing per-domain section
 *     components/controllers (Details, Look & style, Plugins) — one
 *     implementation, new frame.
 *  3. LeftPanel no longer has a Config tab (or any embedded config panel).
 *  4. +page.svelte mounts the view full-window like SettingsView, remounts it
 *     per project ({#key}), resets it on project teardown, and sanitizes a
 *     persisted leftPanel.activeTab of "config" from older sessions.
 *  5. The retired sidebar ProjectConfigPanel is gone.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");
const exists = (rel: string) => fs.existsSync(path.join(root, rel));

const view = () => read("src/lib/components/ProjectSettingsView.svelte");
const left = () => read("src/lib/components/LeftPanel.svelte");
const page = () => read("src/routes/+page.svelte");

describe("ProjectSettingsView — SettingsView-patterned full view", () => {
  test("has the settings-view frame: header, title, close button", () => {
    const src = view();
    expect(src).toContain("Project settings");
    expect(src).toMatch(/aria-label="Close project settings"/);
    expect(src).toMatch(/<Icon name="x"/);
  });

  test("takes keyboard focus on open (the opener goes inert, so focus would drop to <body>)", () => {
    const src = view();
    expect(src).toContain("bind:this={closeBtnEl}");
    const mountIdx = src.indexOf("onMount(");
    expect(mountIdx).toBeGreaterThan(-1);
    expect(src.slice(mountIdx, mountIdx + 200)).toContain("closeBtnEl?.focus()");
  });

  test("uses the tabbed layout (WAI-ARIA tabs with arrow-key navigation)", () => {
    const src = view();
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toContain('role="tabpanel"');
    expect(src).toMatch(/ArrowRight|ArrowLeft/);
    // The writer-shaped sections, one tab each.
    expect(src).toContain("Details");
    expect(src).toContain("Look &amp; style");
    expect(src).toContain("Plugins");
  });

  test("composes the existing section components with their controllers", () => {
    const src = view();
    for (const section of ["DetailsSection", "AppearanceSection", "DesignSection", "StylesSection", "PluginsSection"]) {
      expect(src).toContain(`<${section} `);
      expect(src).toMatch(new RegExp(`import ${section} from "\\$lib/components/config/${section}\\.svelte"`));
    }
    for (const controller of [
      "DetailsSectionController",
      "AppearanceSectionController",
      "StylesSectionController",
      "DesignSectionController",
      "PluginsSectionController",
    ]) {
      expect(src).toContain(`new ${controller}(`);
    }
    // Cross-section refresh hooks survive the move (theme apply reloads
    // styles+design; style toggle reloads design).
    expect(src).toContain("afterThemeChange");
    expect(src).toContain("afterStyleChange");
  });

  test("loads every section's data once on mount and flushes pending token writes on destroy", () => {
    const src = view();
    expect(src).toMatch(/onMount\(/);
    expect(src).toContain("loadAll()");
    expect(src).toContain("flushPendingTokenWrites()");
  });

  test("the centered body includes its padding in its width (no horizontal overflow in narrow windows)", () => {
    const src = view();
    // No global border-box reset exists: width:100% + side padding in
    // content-box overflows the fixed full-window sheet below ~896px.
    expect(src).toMatch(/\.settings-body\s*\{[^}]*box-sizing:\s*border-box/);
  });

  test("no CSS-content glyph disclosure markers — the Advanced disclosure uses SVG icons", () => {
    const src = view();
    expect(src).not.toContain('content: "▸"');
    expect(src).not.toContain('content: "▾"');
  });

  test("PWA-clean (§8): host access only through controllers/capability modules, no host imports", () => {
    const src = view();
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toMatch(/from\s+["'](fs|path|url|child_process)["']/);
    expect(src).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["']@dimm-city\/gutterpress["']/);
    expect(src).not.toContain("window.electron");
  });
});

describe("LeftPanel — Config tab removed", () => {
  test("PanelTab union and TABS no longer include config", () => {
    const src = left();
    expect(src).toContain('export type PanelTab = "projects" | "toc" | "files" | "media"');
    expect(src).not.toContain('id: "config"');
    expect(src).not.toContain("ProjectConfigPanel");
    expect(src).not.toContain("panel-content-config");
  });

  test("the other four tabs are untouched", () => {
    const src = left();
    for (const id of ["projects", "toc", "files", "media"]) {
      expect(src).toContain(`id: "${id}"`);
    }
  });

  test("the dead onOpenProjectConfig seam is gone", () => {
    expect(left()).not.toContain("onOpenProjectConfig");
    expect(page()).not.toContain("onOpenProjectConfig");
  });
});

describe("+page.svelte — full-window mount, teardown, prefs migration", () => {
  test("openProjectConfig opens the full view instead of a sidebar tab", () => {
    const src = page();
    const fnIdx = src.indexOf("function openProjectConfig()");
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, fnIdx + 600);
    expect(body).toContain("projectSettingsOpen = true");
    expect(body).not.toContain('leftPanelTab = "config"');
  });

  test("mounts ProjectSettingsView full-window (settings-global-view) and remounts per project", () => {
    const src = page();
    expect(src).toContain('import ProjectSettingsView from "$lib/components/ProjectSettingsView.svelte"');
    const mountIdx = src.indexOf('aria-label="Project settings"');
    expect(mountIdx).toBeGreaterThan(-1);
    const mount = src.slice(Math.max(0, mountIdx - 300), mountIdx + 800);
    expect(mount).toContain('class="settings-global-view"');
    expect(mount).toContain("{#key lifecycle.currentDir}");
    expect(mount).toContain("<ProjectSettingsView");
    // The workspace behind the view goes inert, like the start screen.
    expect(src).toMatch(/inert=\{landingVisible \|\| projectSettingsOpen\}/);
  });

  test("project teardown closes the view (resetExtras)", () => {
    const src = page();
    const idx = src.indexOf("resetExtras: () => {");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, src.indexOf("},", idx));
    expect(body).toContain("projectSettingsOpen = false");
  });

  test("the raw-CSS escape hatch closes the view before opening the editor", () => {
    const src = page();
    const mountIdx = src.indexOf("<ProjectSettingsView");
    const mount = src.slice(mountIdx, mountIdx + 800);
    expect(mount).toMatch(/onEditRawCss=\{[\s\S]{0,200}?closeProjectSettings\(\);?[\s\S]{0,200}?openStyleFile\(/);
  });

  test("the view owns the keyboard: workspace shortcuts are suppressed and Escape closes it", () => {
    const src = page();
    const fnIdx = src.indexOf("function onGlobalKey");
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, fnIdx + 900);
    // Early-return guard BEFORE any command dispatch, with Escape-to-close —
    // otherwise Ctrl+, mounts the app SettingsView invisibly beneath this
    // view, Ctrl+Shift+F toggles focus mode behind it, etc.
    expect(body).toMatch(/if \(projectSettingsOpen\) \{[\s\S]{0,300}?closeProjectSettings\(\);[\s\S]{0,100}?return;/);
    expect(body.indexOf("if (projectSettingsOpen)")).toBeLessThan(body.indexOf("resolveGlobalShortcut"));
    // Preview paging/zoom keys must not act on the hidden preview behind the
    // full-window project settings (app settings live on the start screen,
    // which the landingVisible guard above already covers).
    const navIdx = src.indexOf("function onPreviewNavKey");
    expect(src.slice(navIdx, navIdx + 700)).toContain("if (projectSettingsOpen) return;");
  });

  test("a persisted activeTab of 'config' from an older session falls back to a live tab", () => {
    const src = page();
    const idx = src.indexOf("applyLeftPanelPrefs");
    expect(idx).toBeGreaterThan(-1);
    const body = src.slice(idx, idx + 700);
    // Restored tab must be validated against the live tab set, not blind-cast.
    expect(body).toMatch(/projects.*toc.*files.*media/s);
    expect(body).not.toMatch(/leftPanelTab = panelPrefs\.activeTab as typeof leftPanelTab/);
  });
});

describe("retired surfaces", () => {
  test("the sidebar ProjectConfigPanel is deleted", () => {
    expect(exists("src/lib/components/ProjectConfigPanel.svelte")).toBe(false);
  });
});
