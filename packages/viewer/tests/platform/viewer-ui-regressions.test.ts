import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

test("ProjectConfigPanel theme thumbnails always render a non-blank fallback", () => {
  const src = read("src/lib/components/ProjectConfigPanel.svelte");
  expect(src).toContain("theme-fallback-title");
  expect(src).toContain("Theme preview loading");
  expect(src).not.toContain("thumb-placeholder\" aria-hidden=\"true\"");
});

test("preview toolbar button toggles preview visibility so the editor can fill the workspace", () => {
  const src = read("src/routes/+page.svelte");
  expect(src).toContain("let previewHidden");
  expect(src).toContain("function togglePreview");
  expect(src).toContain("class:preview-hidden={previewHidden}");
  expect(src).toContain("title={previewHidden ? \"Show preview\" : \"Hide preview\"}");
  expect(src).not.toContain("Preview only");
});

test("Electron windows and AppImage package carry the app icon", () => {
  const main = read("electron/main.ts");
  const builder = read("electron-builder.yml");
  expect(main).toContain("function appIconPath");
  expect(main).toContain("icon: appIconPath()");
  expect(builder).toContain("extraResources:");
  expect(builder).toContain("icon.png");
});

test("splash screen is closable and has a shorter fallback timeout", () => {
  const splash = read("electron/splash.html");
  const main = read("electron/main.ts");
  expect(splash).toContain("splash-close");
  expect(splash).toContain("window.close()");
  expect(main).toContain("splashFallbackTimer = setTimeout(showMainWindowAndCloseSplash, 15_000)");
  expect(main).not.toContain("splashFallbackTimer = setTimeout(showMainWindowAndCloseSplash, 60_000)");
});

test("editor toolbar has a save button and usable small-screen overflow", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  expect(src).toContain("onSave");
  expect(src).toContain("Save changes now");
  expect(src).toContain("Icon name=\"save\"");
  expect(src).toContain("overflow: visible");
  expect(src).toContain("background: var(--app-surface-raised");
});

test("About dialog copy reflects current save/export shortcuts", () => {
  const src = read("src/lib/components/HelpDialog.svelte");
  expect(src).toContain("Save source edits");
  expect(src).toContain("{modKey}+S");
  expect(src).toContain("Export PDF");
  expect(src).toContain("{modKey}+Shift+E");
  expect(src).not.toContain("Save PDF</td><td>{modKey}+S");
});

test("settings/help live in a bottom-right status toolbar and problems overlay wins over the sidebar", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  const page = read("src/routes/+page.svelte");
  expect(status).toContain("onOpenSettings");
  expect(status).toContain("onOpenHelp");
  expect(status).toContain("shell-actions");
  expect(status).toContain("z-index: 300");
  expect(page).toContain("onOpenSettings={() => (settingsOpen = true)}");
  expect(page).toContain("onOpenHelp={() => (helpOpen = true)}");
});

test("left sidebar replaces History with Config and uses icon-only short tabs", () => {
  const src = read("src/lib/components/LeftPanel.svelte");
  expect(src).toContain('export type PanelTab = "projects" | "toc" | "files" | "media" | "config"');
  expect(src).toContain("ProjectConfigPanel");
  expect(src).toContain('id: "config"');
  expect(src).not.toContain('id: "history"');
  expect(src).toContain(".tab-label { display: none; }");
  expect(src).toContain("min-height: 32px");
});

test("editor top saved/configure overlay is removed", () => {
  const src = read("src/routes/+page.svelte");
  expect(src).not.toContain("editor-status-bar");
  expect(src).not.toContain("save-status saved");
  expect(src).not.toContain("Configure</button>");
});
