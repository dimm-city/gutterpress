import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

test("ProjectConfigPanel theme thumbnails always render a non-blank fallback", () => {
  // The theme grid + thumbnail markup was extracted into the AppearanceSection
  // child when ProjectConfigPanel was split into a composition root + sections.
  const src = read("src/lib/components/config/AppearanceSection.svelte");
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
  // The Save button's copy/icon are now declared once in toolbar-actions.ts
  // (M23: one item array drives both the toolbar and the More menu) rather
  // than hand-typed inline in the component markup.
  const actions = read("src/lib/editor/toolbar-actions.ts");
  expect(src).toContain("onSave");
  expect(src).toContain("saveItems");
  expect(actions).toContain("Save changes now");
  expect(actions).toContain('icon: "save"');
  expect(src).toContain("overflow: visible");
  expect(src).toContain("background: var(--app-surface-raised");
});

test("M23: the More menu renders the full shared item array, not a hand-duplicated subset that can drop Save/Snippet", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  const morePopupIdx = src.indexOf('class="toolbar-popup more-popup"');
  expect(morePopupIdx).toBeGreaterThan(-1);
  // The More menu must iterate the SAME unfiltered array the toolbar groups
  // are filtered from, so it can never omit an item the toolbar shows.
  const moreEachIdx = src.indexOf("{#each visibleItems as item, i (item.id)}", morePopupIdx);
  expect(moreEachIdx).toBeGreaterThan(morePopupIdx);
  // Guard against reverting to the old bug: a second, hand-typed list of
  // buttons that called onAction directly and had already dropped Save and
  // Snippet by the time it was reviewed.
  expect(src).not.toContain('onAction("bold"); moreOpen = false');
  expect(src).not.toContain('onAction("italic"); moreOpen = false');
});

test("M11: the table-insert dialog is hoisted outside .insert-group, which is display:none at exactly the widths where the More menu exists", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  const groupStart = src.indexOf('<div class="tb-group insert-group">');
  const groupEnd = src.indexOf('<!-- "More" overflow button', groupStart);
  expect(groupStart).toBeGreaterThan(-1);
  expect(groupEnd).toBeGreaterThan(groupStart);
  const insertGroupRegion = src.slice(groupStart, groupEnd);

  // The trigger button lives inside the (hideable) insert group...
  expect(insertGroupRegion).toContain("openTableDialog");
  // ...but the popup/dialog itself — and its backdrop — must NOT be nested
  // inside that group, unlike the old dead control.
  expect(insertGroupRegion).not.toContain("image-dialog-backdrop");
  expect(insertGroupRegion).not.toContain('aria-label="Insert table"');

  // The dialog is rendered as a top-level sibling after the toolbar's
  // {#if isMarkdown} block closes, exactly like the (already-correct) image
  // dialog — so it keeps working from the More menu even when
  // `.insert-group` is hidden.
  const toolbarCloseIdx = src.indexOf("{/if}", groupEnd);
  const tableDialogIdx = src.indexOf('aria-label="Insert table"');
  expect(tableDialogIdx).toBeGreaterThan(toolbarCloseIdx);
});

test("M24 (fix round 1): opening the heading or More popup moves focus inside it, so an Escape keydown fired right after opening reaches the popup's own handler", () => {
  // The popup <div> is a SIBLING of its trigger button, not an ancestor, and
  // <svelte:window> only binds onclick — so an Escape keydown whose target is
  // still the trigger (focus never moved) can never bubble to the popup div's
  // onkeydown handler. Opening must move focus into the popup itself, the
  // same pattern already used by the table/image dialogs.
  const src = read("src/lib/components/EditorToolbar.svelte");

  const openHeadingIdx = src.indexOf("function openHeadingPopup");
  const openHeadingEnd = src.indexOf("\n  }", openHeadingIdx);
  expect(openHeadingIdx).toBeGreaterThan(-1);
  const openHeadingBody = src.slice(openHeadingIdx, openHeadingEnd);
  expect(openHeadingBody).toContain("queueMicrotask");
  expect(openHeadingBody).toContain("headingPopupEl");

  const openMoreIdx = src.indexOf("function openMorePopup");
  const openMoreEnd = src.indexOf("\n  }", openMoreIdx);
  expect(openMoreIdx).toBeGreaterThan(-1);
  const openMoreBody = src.slice(openMoreIdx, openMoreEnd);
  expect(openMoreBody).toContain("queueMicrotask");
  expect(openMoreBody).toContain("morePopupEl");

  // The popup divs must actually expose the elements referenced above.
  expect(src).toContain("bind:this={headingPopupEl}");
  expect(src).toContain("bind:this={morePopupEl}");

  // The existing Escape handlers must stay in place (option B was not taken).
  expect(src).toContain('if (e.key === "Escape") closeHeadingPopup();');
  expect(src).toContain('if (e.key === "Escape") closeMorePopup();');

  // No ARIA role should be reintroduced while fixing this (M24 stays a plain
  // disclosure).
  expect(src).not.toContain('role="listbox"');
  expect(src).not.toContain('role="menu"');
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
  expect(src).toMatch(/\.tab-label\s*\{\s*display:\s*none;\s*\}/);
  expect(src).toContain("min-height: 32px");
});

test("editor top saved/configure overlay is removed", () => {
  const src = read("src/routes/+page.svelte");
  expect(src).not.toContain("editor-status-bar");
  expect(src).not.toContain("save-status saved");
  expect(src).not.toContain("Configure</button>");
});

test("C2: a folder open classifies BEFORE the content pipeline opens, so a bare multi-book repo root retargets to the resolved book", () => {
  const src = read("src/routes/+page.svelte");
  const classifyIdx = src.indexOf("await projectSession.classify(dir)");
  const startPreviewIdx = src.indexOf("await platform.startPreview(");
  expect(classifyIdx).toBeGreaterThan(-1);
  expect(startPreviewIdx).toBeGreaterThan(-1);
  expect(classifyIdx).toBeLessThan(startPreviewIdx);
  expect(src).toContain("const targetDir = projectSession.activeBookDir ?? dir;");
  expect(src).toContain("input: { key: targetDir, displayName: targetDisplayName }");
});

test("C2: the book switcher is wired into the status bar and gated on books.length > 1", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  expect(status).toContain('import BookSwitcher from "$lib/components/BookSwitcher.svelte"');
  expect(status).toContain("books.length > 1");
  const page = read("src/routes/+page.svelte");
  expect(page).toContain("books={projectSession.books}");
  expect(page).toContain("onSwitchBook={(path) => void switchBook(path)}");
});

test("C2: recents for a repo-backed project key on the repo root, remembering the last active book", () => {
  // The preview-open pipeline (recents upsert included) was extracted from
  // main.ts into electron/preview/controller.ts (ARCH review finding #6) —
  // this logic now lives there, not in main.ts.
  const controller = read("electron/preview/controller.ts");
  expect(controller).toContain('path: source.type === "local-git-folder" ? source.repoRoot : openedDir');
  expect(controller).toContain("lastActiveBook: openedDir");
});
