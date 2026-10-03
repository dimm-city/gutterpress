/**
 * Source-level tests for the Book settings view (toolbar-refactor):
 * book settings moved OUT of the left sidebar's Config tab into a
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
 *     components/controllers (Details, Look & style, Features) — one
 *     implementation, new frame.
 *  3. LeftPanel no longer has a Config tab (or any embedded config panel).
 *  4. +page.svelte mounts the view as a panel docked beside the workspace
 *     (#308: the live preview stays visible while the writer styles the
 *     book), remounts it per project ({#key}), resets it on project teardown,
 *     and sanitizes a persisted leftPanel.activeTab of "config" from older
 *     sessions.
 *  5. The retired sidebar ProjectConfigPanel is gone.
 *  6. The Look tab (#308): plain-language token labels (the CSS variable
 *     stays visible) and font pickers styled like the other form controls.
 *  7. The Details tab (#308): the Title input is bound to its label.
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
    expect(src).toContain("Book settings");
    expect(src).toMatch(/aria-label="Close book settings"/);
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
    // The writer-shaped sections, one tab each. #243: "Look & style" and
    // "Plugins" merged into the "Look" / "Features" tab pair over one
    // ExtensionsSectionController (the Look tab's own section heading still
    // reads "Look & style", since it also hosts Design tokens + Stylesheets).
    expect(src).toContain("Details");
    expect(src).toContain('{ id: "look", label: "Look" }');
    expect(src).toContain('{ id: "features", label: "Features" }');
    expect(src).toContain("Look &amp; style");
    expect(src).not.toContain('{ id: "plugins", label: "Plugins" }');
  });

  test("composes the existing section components with their controllers, merged Look+Features into one ExtensionsSectionController (#243)", () => {
    const src = view();
    for (const section of ["DetailsSection", "LookSection", "DesignSection", "StylesSection", "FeaturesSection"]) {
      expect(src).toContain(`<${section} `);
      expect(src).toMatch(new RegExp(`import ${section} from "\\$lib/components/config/${section}\\.svelte"`));
    }
    for (const controller of [
      "DetailsSectionController",
      "ExtensionsSectionController",
      "StylesSectionController",
      "DesignSectionController",
    ]) {
      expect(src).toContain(`new ${controller}(`);
    }
    // Look and Features both read the SAME controller instance - the literal
    // "one controller and one model" shape #243 asks for.
    expect(src).toContain("<LookSection controller={extensions} />");
    expect(src).toContain("<FeaturesSection controller={extensions} />");
    // The retired per-domain controllers/components are gone, not just unused.
    expect(src).not.toContain("AppearanceSectionController");
    expect(src).not.toContain("PluginsSectionController");
    expect(src).not.toContain("AppearanceSection.svelte");
    expect(src).not.toContain("PluginsSection.svelte");
    // Cross-section refresh hooks survive the move (a look change reloads
    // styles+design; style toggle reloads design).
    expect(src).toContain("afterLookChange");
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
    // content-box overflows the fixed sheet (it covers the whole window below
    // 900px) below ~896px.
    expect(src).toMatch(/\.settings-body\s*\{[^}]*box-sizing:\s*border-box/);
  });

  test("no CSS-content glyph disclosure markers — the Advanced disclosure uses SVG icons", () => {
    const src = view();
    expect(src).not.toContain('content: "▸"');
    expect(src).not.toContain('content: "▾"');
  });

  test("PWA-clean (§8): api access only through controllers/$lib/api, no host imports", () => {
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

describe("+page.svelte — docked mount, teardown, prefs migration", () => {
  test("openProjectConfig opens the full view instead of a sidebar tab", () => {
    const src = page();
    const fnIdx = src.indexOf("function openProjectConfig()");
    expect(fnIdx).toBeGreaterThan(-1);
    const body = src.slice(fnIdx, fnIdx + 600);
    expect(body).toContain("projectSettingsOpen = true");
    expect(body).not.toContain('leftPanelTab = "config"');
  });

  test("mounts ProjectSettingsView as the settings-global-view panel and remounts per project", () => {
    const src = page();
    expect(src).toContain('import ProjectSettingsView from "$lib/components/ProjectSettingsView.svelte"');
    const mountIdx = src.indexOf('aria-label="Book settings"');
    expect(mountIdx).toBeGreaterThan(-1);
    const mount = src.slice(Math.max(0, mountIdx - 300), mountIdx + 800);
    expect(mount).toContain('class="settings-global-view"');
    expect(mount).toContain("{#key lifecycle.currentDir}");
    expect(mount).toContain("<ProjectSettingsView");
    // Only the start screen makes the workspace inert; Book settings docks beside it.
    expect(src).toMatch(/inert=\{landingVisible\}/);
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
    // view, Ctrl+F opens find behind it, etc.
    expect(body).toMatch(/if \(projectSettingsOpen\) \{[\s\S]{0,300}?closeProjectSettings\(\);[\s\S]{0,100}?return;/);
    expect(body.indexOf("if (projectSettingsOpen)")).toBeLessThan(body.indexOf("resolveGlobalShortcut"));
    // Preview paging/zoom keys must not act on the (inert) preview beside the
    // book settings panel (app settings live on the start screen,
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

describe("+page.svelte — Book settings docks beside the live preview (#308)", () => {
  // The preview already re-renders as soon as a stylesheet is written (the
  // folder watcher rebuilds it); it was only hidden under an opaque full-window
  // sheet. So the fix is presentational: dock the panel and let the app shrink.
  test("the app shrinks by the panel's width, so the preview stays visible", () => {
    const src = page();
    expect(src).toContain("class:settings-docked={projectSettingsOpen}");
    expect(src).toMatch(/\.app-root\.settings-docked\s*\{\s*margin-right:\s*var\(--app-settings-panel-width\);?\s*\}/);
    expect(src).toMatch(/\.settings-global-view\s*\{[^}]*width:\s*var\(--app-settings-panel-width\)/);
    // The workspace beside the panel stays live, so the preview scrolls.
    expect(src).toMatch(/inert=\{landingVisible\}/);
  });

  test("a window too narrow for both lets the panel cover it, as before", () => {
    const src = page();
    const from = src.indexOf(".settings-global-view {");
    expect(from).toBeGreaterThan(-1);
    const rules = src.slice(from, src.indexOf("@media (prefers-reduced-motion", from));
    const narrow = rules.slice(rules.indexOf("@media screen and (max-width: 900px)"));
    expect(narrow).toMatch(/\.settings-global-view\s*\{[^}]*inset:\s*0;[^}]*width:\s*auto/);
    expect(narrow).toMatch(/\.app-root\.settings-docked\s*\{\s*margin-right:\s*0/);
  });

  test("no copy tells the writer to close Book settings to see the preview", () => {
    const design = read("src/lib/components/config/DesignSection.svelte");
    expect(design).not.toContain("close Book settings");
    expect(design).toContain("the preview updates live");
    expect(view()).not.toContain("close Book settings to see");
  });

  test("the panel width is one shared token that the Look tab's hover flyout also honours", () => {
    expect(read("src/lib/theme.css")).toMatch(/--app-settings-panel-width:\s*clamp\(/);
    // Pinned to the viewport edge the flyout would sit on top of the docked panel.
    const look = read("src/lib/components/config/LookSection.svelte");
    expect(look).toMatch(/\.hover-preview\s*\{[^}]*right:\s*calc\(var\(--app-settings-panel-width\)/);
  });
});

describe("Look tab — plain-language token labels and styled font pickers (#308)", () => {
  const design = () => read("src/lib/components/config/DesignSection.svelte");

  test("a token row leads with its plain label and keeps the real CSS variable visible", () => {
    const src = design();
    expect(src).toContain('<span class="token-name">{t.label}</span>');
    // Muted secondary line, out of the control's accessible name; the tooltip
    // repeats it for the case the line is truncated.
    expect(src).toContain('<span class="token-var" aria-hidden="true">{t.name}</span>');
    expect(src).toContain("title={t.name}");
  });

  test("the panel's copy uses the app's US spelling, like the token labels (Colors)", () => {
    const src = design();
    const template = src.slice(0, src.indexOf("<style>"));
    expect(template).toContain('<h4 class="subhead">Colors</h4>');
    expect(template).toContain("fine-tune its colors and sizes here");
    expect(template).not.toMatch(/colour/i);
  });

  test("font pickers wear the form tokens instead of native select chrome", () => {
    const src = design();
    const rule = src.match(/\.control\.font select\s*\{([^}]*)\}/)?.[1] ?? "";
    for (const token of ["--app-surface-sunken", "--app-border", "--app-text-secondary"]) {
      expect(rule).toContain(`var(${token})`);
    }
    expect(src).toMatch(/\.control\.font select:focus\s*\{[^}]*var\(--app-focus-ring\)/);
  });

  test("a font row stacks, and no row's shape depends on its dirty state", () => {
    const src = design();
    // Only font rows stack (label over select + text input)…
    expect(src).toContain("class:stacked={t.kind === \"font\"}");
    expect(src).toMatch(/\.token-row\.stacked\s*\{[^}]*flex-wrap:\s*wrap/);
    // …every other row stays a single line, so the reset button appearing can't
    // wrap it and move the field the writer is typing in.
    const plain = src.match(/\.token-row\s*\{([^}]*)\}/)?.[1] ?? "";
    expect(plain).not.toContain("wrap");
  });
});

describe("Details tab — the Title input is bound to its label (#308)", () => {
  test("the label's for= matches the input's id (the placeholder must not become its name)", () => {
    const src = read("src/lib/components/config/DetailsSection.svelte");
    expect(src).toContain('<label class="field" for="details-title">');
    expect(src).toMatch(/<input\s+id="details-title"[^>]*type="text"[^>]*bind:value=\{controller\.titleDraft\}/s);
    expect(src).toContain('<span class="lbl">Title</span>');
  });
});

describe("retired surfaces", () => {
  test("the sidebar ProjectConfigPanel is deleted", () => {
    expect(exists("src/lib/components/ProjectConfigPanel.svelte")).toBe(false);
  });
});
