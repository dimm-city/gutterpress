import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dir, "../..");
const read = (rel: string) => readFileSync(path.join(root, rel), "utf8");

test("ProjectConfigPanel theme thumbnails always render a non-blank fallback", () => {
  // The theme grid + thumbnail markup was extracted into the AppearanceSection
  // child when ProjectConfigPanel was split into a composition root + sections;
  // AppearanceSection was later renamed LookSection when the Theme grid and
  // Plugins panel merged into one Extensions surface (#243).
  const src = read("src/lib/components/config/LookSection.svelte");
  expect(src).toContain("theme-fallback-title");
  expect(src).toContain("thumb-placeholder");
  expect(src).toContain("Sample preview for");
  expect(src).not.toContain("thumb-placeholder\" aria-hidden=\"true\"");
});

test("Focus is a toggle that swaps the app toolbar for the minimal bar and hides the other chrome", () => {
  const src = read("src/routes/+page.svelte");
  const toolbar = read("src/lib/components/AppToolbar.svelte");
  // One session boolean beside the mode — not a third mode value.
  expect(src).toContain("let focus = $state(false);");
  expect(src).toContain("let inFocus = $derived(focus && toolbarProjectOpen);");
  // Each piece of chrome is gated on it: app toolbar, editor toolbar, status bar.
  expect(src).toMatch(/\{#if inFocus\}\s*<FocusBar/);
  expect(src).toMatch(/\{#if !inFocus\}\s*<EditorToolbar/);
  expect(src).toMatch(/\{#if !inFocus\}\s*<StatusBar/);
  // The left panel is hidden by CSS so the PERSISTED open flag is never touched.
  expect(src).toContain("class:in-focus={inFocus}");
  expect(src).toMatch(/\.left-panel-region\.in-focus > :global\(\.left-panel\)/);
  // Focus is dropped on close (resetExtras) and on book switch (onProjectSwitch).
  expect(src).toContain("onProjectSwitch: () => setFocus(false),");
  expect(src).toMatch(/resetExtras: \(\) => \{[\s\S]*?focus = false;/);
  // The preview is never hidden by Focus any more (Edit+Focus keeps it beside the editor).
  expect(src).not.toContain("previewVisible");
  expect(src).not.toContain("preview-collapsed");
  expect(toolbar).toContain("onclick={onToggleFocus}");
  expect(toolbar).not.toContain("Preview only");
});

test("Edit+Focus shows the book's files in the minimal bar, reusing the existing file switch", () => {
  const src = read("src/routes/+page.svelte");
  const bar = read("src/lib/components/FocusBar.svelte");
  // Book order = the Details section's list (manifest sourceFiles, else natural order).
  expect(src).toContain("buildSourceList(md, cfg.sourceFiles ?? null)");
  expect(src).toContain("api.fs.listProjectFiles(dir)");
  // Edit only; selecting goes through openChapter (atomic selectEditorFile + preview follow).
  expect(src).toContain('files={focusView === "edit" ? focusFiles : []}');
  expect(src).toMatch(/onSelectFile=\{\(name\) =>[^\n]*openChapter\(joinPath\(lifecycle\.currentDir, name\)\)/);
  expect(bar).toContain('aria-label="Chapter"');
  // A cancelled switch snaps the select back; the bar's select-hold logic still applies.
  expect(bar).toContain('el.value = currentFile ?? "";');
  expect(bar).toContain('t.tagName === "SELECT"');
});

test("a preview-generation failure keeps the folder workspace open with repair actions", () => {
  const src = read("src/routes/+page.svelte");
  expect(src).toContain(
    '{#if lifecycle.previewUrl || (lifecycle.sourceMode === "folder" && lifecycle.currentDir)}',
  );
  expect(src).toContain('class="preview-error-view" role="alert"');
  expect(src).toContain("void lifecycle.retryPreview()");
  expect(src).toContain("onclick={showPreviewFiles}");
  expect(src).toContain('source: "desktop.preview"');
  expect(src).toContain("problems={displayedProblems}");
});

test("Electron windows and AppImage package carry the app icon", () => {
  const main = read("electron/main.ts");
  const builder = read("electron-builder.yml");
  expect(main).toContain("function appIconPath");
  expect(main).toContain("icon: appIconPath()");
  expect(builder).toContain("extraResources:");
  expect(builder).toContain("icon.png");
});

test("closing activity restores the workspace it displaced (no stuck 'Loading content')", () => {
  const src = read("src/routes/+page.svelte");
  // Activity borrows the editor pane and captures the displaced workspace
  // mode…
  expect(src).toContain("paneViewRestore = { mode }");
  // …and closing restores it, loading the editor module + a file whenever the
  // pane stays open (the activity view needed neither, so the editor used to
  // come back mounted-but-empty, stuck on "Loading content" until the author
  // manually toggled Edit — and the toggle buttons read out of sync).
  const closeIdx = src.indexOf("function closePaneView()");
  expect(closeIdx).toBeGreaterThan(-1);
  const closeBody = src.slice(closeIdx, closeIdx + 900);
  expect(closeBody).toContain("setMode(restore.mode)");
  expect(closeBody).toContain("ensureEditorFile()");
  // The lazy editor chunk is loaded BY ensureEditorFile, so every caller that
  // wants a usable editor gets one — including the project-open path, which
  // called only ensureEditorFile and so opened a book in Edit mode behind a
  // pane stuck on "Loading editor…" (0.10.2 defect 1).
  const ensureIdx = src.indexOf("async function ensureEditorFile()");
  expect(ensureIdx).toBeGreaterThan(-1);
  expect(src.slice(ensureIdx, ensureIdx + 400)).toContain("loadEditorModule()");
  // Manually toggling Edit while activity is shown exits that mode.
  const toggleIdx = src.indexOf("function toggleEditor()");
  const toggleBody = src.slice(toggleIdx, toggleIdx + 700);
  expect(toggleBody).toContain('editorView !== "editor"');
  // Project teardown resets the borrowed-pane state too.
  expect(src).toContain('editorView = "editor";\n      paneViewRestore = null;');
});

test("preview interactions treat Project Activity as closed, not as a Markdown editor", () => {
  const src = read("src/routes/+page.svelte");
  // Both preview→editor navigations (a TOC jump and a click in the book) share
  // one guard, so neither can move the editor while the activity view is
  // borrowing the pane, and neither ever OPENS the pane.
  const idx = src.indexOf("function syncOpenEditorTo(");
  expect(idx).toBeGreaterThan(-1);
  expect(src.slice(idx, idx + 400)).toContain('!editorPaneOpen || editorView !== "editor"');
});

test("a persisted narrow Edit tab cannot open the editor without an explicit action", () => {
  const src = read("src/routes/+page.svelte");
  const derived = src.slice(
    src.indexOf("let editorPaneOpen = $derived("),
    src.indexOf("let splitGridColumns = $derived("),
  );
  expect(derived).toContain("editorVisible &&");
  expect(src).toContain("class:show-edit={isNarrow && editorPaneOpen}");
  expect(src).toContain("class:show-view={isNarrow && !editorPaneOpen}");
});

test("app settings live ONLY on the start screen's Settings tab — no separate window", () => {
  const src = read("src/routes/+page.svelte");
  // One settings surface: the settings button opens the landing on its
  // Settings tab, exactly like the help button. The standalone sheet (and its
  // `settingsOpen` state) is gone, so there is no second instance to keep
  // above the landing, and no second inert gate to maintain.
  expect(src).toContain('inert={landingVisible || projectSettingsOpen}');
  expect(src).toContain('visible={landingVisible}');
  expect(src).not.toContain("settingsOpen");
  expect(src).not.toContain('editorView === "settings"');
  // openSettings targets the landing tab and forces the layer open.
  const openIdx = src.indexOf("function openSettings(");
  const openBody = src.slice(openIdx, openIdx + 400);
  expect(openBody).toContain('landingRef?.showTab("settings")');
  expect(openBody).toContain("landingForcedOpen = true");
  // Book settings keep their own view (docked beside the workspace).
  expect(src).toContain('class="settings-global-view"');
});

test("desktop builds its shared runtime without invoking the CLI entry build", () => {
  const desktopPackage = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  const cliPackage = JSON.parse(read("../cli/package.json")) as { scripts: Record<string, string> };
  expect(desktopPackage.scripts["build:runtime"]).toBe("bun run --cwd ../cli build:library");
  expect(desktopPackage.scripts.build).toContain("build:runtime");
  expect(cliPackage.scripts["build:library"]).not.toContain("src/cli.ts");
});

test("the external splash window is gone — the in-window start screen is the launch surface", () => {
  const main = read("electron/main.ts");
  // No splash window, no splash markup, no reveal machinery…
  expect(existsSync(path.join(root, "electron/splash.html"))).toBe(false);
  expect(main).not.toContain("createSplashWindow");
  expect(main).not.toContain("showMainWindowAndCloseSplash");
  expect(main).not.toContain("splashFallbackTimer");
  // …and the main window shows immediately (the viewer needs a visible window
  // to render at full speed; WelcomeLanding covers the boot).
  expect(main).toContain("mainWindow.show();");
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

test("M23: the Insert and More menus render rows from the shared item arrays through one snippet, not hand-duplicated lists that can drop Save/Snippet", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  // Every group array is filtered from the ONE visibleItems list…
  expect(src).toContain("visibleToolbarItems({ hasSave: !!onSave, desktop: isDesktop() })");
  for (const group of ["save", "primary", "block", "insert"]) {
    expect(src).toContain(`visibleItems.filter((i) => i.group === "${group}")`);
  }
  // …and both popups draw their rows from those arrays via the same
  // `menuRows` snippet, so a row can never exist in one menu and be missing
  // from the other.
  const insertPopupIdx = src.indexOf('class="toolbar-popup insert-popup"');
  expect(insertPopupIdx).toBeGreaterThan(-1);
  expect(src.indexOf("{@render menuRows(insertItems, insertMenu)}", insertPopupIdx)).toBeGreaterThan(insertPopupIdx);
  const morePopupIdx = src.indexOf('class="toolbar-popup more-popup"');
  expect(morePopupIdx).toBeGreaterThan(-1);
  const morePopup = src.slice(morePopupIdx, src.indexOf("{/if}", morePopupIdx));
  expect(morePopup).toContain("{@render menuRows(blockItems, moreMenu)}");
  expect(morePopup).toContain("{@render menuRows(insertItems, moreMenu)}");
  // Guard against reverting to the old bugs: a second, hand-typed list of
  // buttons that called onAction directly and had already dropped Save and
  // Snippet by the time it was reviewed…
  expect(src).not.toContain('onAction("bold"); moreOpen = false');
  expect(src).not.toContain('onAction("italic"); moreOpen = false');
  // …and a More menu that walks the WHOLE array, repeating buttons the
  // toolbar is still showing (#311).
  expect(morePopup).not.toContain("{#each visibleItems");
});

/** The body of the CSS block that opens at `marker` (brace-balanced). */
function cssBlock(css: string, marker: string): string {
  const start = css.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const open = css.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error(`unbalanced CSS block at ${marker}`);
}

/** Which selectors a (tier) CSS block hides (`display: none`) and shows (`display: flex`). */
function displayRules(css: string): { hidden: string[]; shown: string[] } {
  const hidden: string[] = [];
  const shown: string[] = [];
  for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const list = selectors.split(",").map((s) => s.trim());
    if (/display:\s*none/.test(body)) hidden.push(...list);
    if (/display:\s*flex/.test(body)) shown.push(...list);
  }
  return { hidden, shown };
}

test("#311: \"…\" lists only what the toolbar hides — each More section is switched on by the container query that hides its group", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  const style = src.slice(src.indexOf("<style>"));

  // Nothing overflows by default: the "…" button and both of its sections are
  // off, so a toolbar that fits shows no "…" at all.
  expect(cssBlock(style, ".tb-more-wrap {")).toMatch(/display:\s*none/);
  expect(cssBlock(style, ".more-block,")).toMatch(/display:\s*none/);

  // The tiers, found by what they hide rather than by their breakpoint value
  // (the numbers are measured widths and get retuned when a group changes).
  const tiers = [...style.matchAll(/@container editor-toolbar \(max-width: (\d+)px\)/g)].map((m) => ({
    maxWidth: Number(m[1]),
    ...displayRules(cssBlock(style, m[0])),
  }));
  const labelTier = tiers.find((t) => t.hidden.includes(".tb-insert-label"));
  const tailTier = tiers.find((t) => t.hidden.includes(".insert-group"));
  const blockTier = tiers.find((t) => t.hidden.includes(".block-group"));
  if (!labelTier || !tailTier || !blockTier) throw new Error("expected label, tail and block tiers");

  // As the toolbar narrows: the Insert label drops first, then the Insert menu
  // moves into "…", then the block group (quote, lists, heading).
  expect(labelTier.maxWidth).toBeGreaterThan(tailTier.maxWidth);
  expect(tailTier.maxWidth).toBeGreaterThan(blockTier.maxWidth);
  expect(tailTier.hidden.sort()).toEqual([".insert-group", ".sep-tail"]);
  expect(tailTier.shown.sort()).toEqual([".more-tail", ".tb-more-wrap"]);
  expect(blockTier.hidden.sort()).toEqual([".block-group", ".sep-block"]);
  expect(blockTier.shown).toEqual([".more-block"]);

  // Every group a tier hides gets its rows into the popup in that same tier
  // (the narrower tier inherits the wider tier's rules, so it must not need
  // to repeat them).
  const homeInMore: Record<string, string> = {
    ".block-group": ".more-block",
    ".insert-group": ".more-tail",
    ".view-group": ".more-tail",
  };
  const shownIn = { tail: [...tailTier.shown], block: [...tailTier.shown, ...blockTier.shown] };
  for (const group of tailTier.hidden.filter((s) => s in homeInMore)) {
    expect(shownIn.tail).toContain(homeInMore[group]);
  }
  for (const group of [...tailTier.hidden, ...blockTier.hidden].filter((s) => s in homeInMore)) {
    expect(shownIn.block).toContain(homeInMore[group]);
  }

  // Save + inline formatting never overflow, and "…" itself is never hidden.
  for (const tier of tiers) {
    expect(tier.hidden).not.toContain(".primary-group");
    expect(tier.hidden).not.toContain(".tb-more-wrap");
  }
  // "…" stays at the right edge in every tier: its popup is right-aligned, so
  // a tier that reset margin-left put it at the pane's left edge with the
  // popup opening off the pane (clipped) — the pre-#311 narrow-width bug.
  expect(cssBlock(style, ".tb-more-wrap {")).toMatch(/margin-left:\s*auto/);
  expect(style).not.toMatch(/\.tb-more-wrap\s*\{[^}]*margin-left:\s*0/);
});

test("#311: every insert action sits behind ONE Insert menu button, so the toolbar keeps its shape when the left panel narrows the pane", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  const groupStart = src.indexOf('<div class="tb-group insert-group">');
  const groupEnd = src.indexOf("<!-- \"More\" overflow button", groupStart);
  expect(groupStart).toBeGreaterThan(-1);
  expect(groupEnd).toBeGreaterThan(groupStart);
  const insertGroup = src.slice(groupStart, groupEnd);

  // One trigger, labelled (name + tooltip), announcing its expanded state…
  expect(insertGroup.match(/<button/g)).toHaveLength(1);
  expect(insertGroup).toContain("onclick={openInsertPopup}");
  expect(insertGroup).toContain("aria-expanded={insertOpen}");
  expect(insertGroup).toContain('aria-label="Insert"');
  expect(insertGroup).toContain('title="Insert');
  // …and no per-action buttons (the old row of icons that vanished at ~520px).
  expect(insertGroup).not.toContain("{#each insertItems");
  expect(insertGroup).not.toContain("openTableDialog");

  // Focus is not an editor-toolbar item at all: the app toolbar's toggle is
  // its only entry point.
  expect(src).not.toContain("view-group");
  expect(src).not.toContain("viewItems");
});

test("M11: the table-insert dialog is hoisted outside .insert-group, which is display:none at exactly the widths where the More menu exists", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  const groupStart = src.indexOf('<div class="tb-group insert-group">');
  const groupEnd = src.indexOf("<!-- \"More\" overflow button", groupStart);
  expect(groupStart).toBeGreaterThan(-1);
  expect(groupEnd).toBeGreaterThan(groupStart);
  const insertGroupRegion = src.slice(groupStart, groupEnd);

  // The Insert menu's table row (rendered by the shared `menuRows` snippet)
  // only calls openTableDialog...
  expect(insertGroupRegion).toContain("{@render menuRows(insertItems, insertMenu)}");
  expect(src).toContain("menu.pick(openTableDialog)");
  // ...but the popup/dialog itself — and its backdrop — must NOT be nested
  // inside that group, unlike the old dead control.
  expect(insertGroupRegion).not.toContain("image-dialog-backdrop");
  expect(insertGroupRegion).not.toContain('aria-label="Insert table"');

  // The dialog is rendered as a top-level sibling after the toolbar's
  // {#if isMarkdown} block closes, exactly like the (already-correct) image
  // dialog — so it keeps working from the More menu even when
  // `.insert-group` is hidden.
  const toolbarCloseIdx = src.indexOf("</div>\n{/if}\n", groupEnd);
  const tableDialogIdx = src.indexOf('aria-label="Insert table"');
  expect(toolbarCloseIdx).toBeGreaterThan(groupEnd);
  expect(tableDialogIdx).toBeGreaterThan(toolbarCloseIdx);
});

test("M24 (fix round 1): opening the heading, Insert or More popup moves focus inside it, so an Escape keydown fired right after opening reaches the popup's own handler", () => {
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

  // The Insert popup (#311) follows the same pattern as its neighbours.
  const openInsertIdx = src.indexOf("function openInsertPopup");
  const openInsertEnd = src.indexOf("\n  }", openInsertIdx);
  expect(openInsertIdx).toBeGreaterThan(-1);
  const openInsertBody = src.slice(openInsertIdx, openInsertEnd);
  expect(openInsertBody).toContain("queueMicrotask");
  expect(openInsertBody).toContain("insertPopupEl");

  // The popup divs must actually expose the elements referenced above.
  expect(src).toContain("bind:this={headingPopupEl}");
  expect(src).toContain("bind:this={insertPopupEl}");
  expect(src).toContain("bind:this={morePopupEl}");

  // The existing Escape handlers must stay in place (option B was not taken).
  expect(src).toContain('if (e.key === "Escape") closeHeadingPopup();');
  expect(src).toContain('if (e.key === "Escape") closeInsertPopup();');
  expect(src).toContain('if (e.key === "Escape") closeMorePopup();');

  // Opening one popup closes the others: Heading, Insert and "…" sit side by
  // side, and two open at once would overlap.
  expect(openHeadingBody).toContain("insertOpen = moreOpen = false");
  expect(openInsertBody).toContain("headingOpen = moreOpen = false");
  expect(openMoreBody).toContain("headingOpen = insertOpen = false");

  // The first-focus helper skips hidden rows: the More popup keeps the
  // sections of currently-visible groups display:none, and .focus() on those
  // silently does nothing (Escape would then never reach the popup).
  const helperIdx = src.indexOf("function focusableElementsIn");
  expect(src.slice(helperIdx, src.indexOf("\n  }", helperIdx))).toContain("offsetParent !== null");

  // No ARIA role should be reintroduced while fixing this (M24 stays a plain
  // disclosure).
  expect(src).not.toContain('role="listbox"');
  expect(src).not.toContain('role="menu"');
});

test("ARCH #42: the table and image dialogs use the shared dialogBehavior action, not a hand-rolled trap", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");

  expect(src).toMatch(
    /import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/,
  );

  const tableStart = src.indexOf("{#if tableOpen}");
  const tableEnd = src.indexOf("{/if}", tableStart);
  expect(tableStart).toBeGreaterThan(-1);
  expect(tableEnd).toBeGreaterThan(tableStart);
  const tableBlock = src.slice(tableStart, tableEnd);

  const imageStart = src.indexOf("{#if imageOpen}");
  const imageEnd = src.indexOf("{/if}", imageStart);
  expect(imageStart).toBeGreaterThan(-1);
  expect(imageEnd).toBeGreaterThan(imageStart);
  const imageBlock = src.slice(imageStart, imageEnd);

  // Each fixed-position dialog wires the shared action with its own close
  // handler and trigger button for focus-restore — mirroring every other
  // migrated dialog shell (dialogBehavior owns ARIA/Escape/trap/restore).
  expect(tableBlock).toMatch(/use:dialogBehavior=\{\{\s*onClose:\s*cancelTable,\s*triggerEl:\s*tableDialogTriggerEl\s*\}\}/);
  expect(imageBlock).toMatch(/use:dialogBehavior=\{\{\s*onClose:\s*cancelImage,\s*triggerEl:\s*imageDialogTriggerEl\s*\}\}/);

  for (const block of [tableBlock, imageBlock]) {
    // No hand-declared ARIA (owned by the action now) and no hand-rolled trap.
    expect(block).not.toContain('role="dialog"');
    expect(block).not.toContain('aria-modal="true"');
    expect(block).not.toContain('tabindex="-1"');
    expect(block).not.toContain("trapFocusIn");
    expect(block).not.toMatch(/onkeydown=\{[\s\S]*?Escape/);
  }

  // The hand-rolled trap helper (and its duplicated FOCUSABLE copy) is gone
  // entirely — dialogBehavior is the one implementation now.
  expect(src).not.toContain("function trapFocusIn");
});

test("ARCH #42: EditorToolbar no longer hand-declares its own FOCUSABLE selector string", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  // This exact literal used to be duplicated here (EditorToolbar.svelte:97-99),
  // copying dialog.ts's private FOCUSABLE constant. It must not come back —
  // any remaining non-modal need (the heading/layout/more popups still want
  // "focus the first focusable child" on open) sources the selector from the
  // shared export instead of re-declaring it.
  expect(src).not.toContain(
    'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
  );
  expect(src).toMatch(
    /import\s*\{[^}]*FOCUSABLE[^}]*\}\s*from\s*["']\$lib\/dialog["']/,
  );
});

test("ARCH #42: image/table dialog triggers are still captured on open for focus-restore", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  const openImageIdx = src.indexOf("function openImageDialog");
  const openImageEnd = src.indexOf("\n  }", openImageIdx);
  expect(src.slice(openImageIdx, openImageEnd)).toContain(
    "imageDialogTriggerEl = trigger;",
  );

  const openTableIdx = src.indexOf("function openTableDialog");
  const openTableEnd = src.indexOf("\n  }", openTableIdx);
  expect(src.slice(openTableIdx, openTableEnd)).toContain(
    "tableDialogTriggerEl = trigger;",
  );
});

test("#311: a dialog opened from a popup row restores focus to the popup's trigger, not to the row that unmounts with the popup", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  // The table/image rows now live inside the Insert and More popups. The row
  // itself is gone by the time the dialog closes, and dialogBehavior can only
  // focus a button that still exists — so each popup's `pick` closes it (which
  // focuses its trigger) and then hands that trigger to the action.
  expect(src).toMatch(/pick\(run\)\s*\{\s*closeInsertPopup\(\);\s*run\(insertTriggerEl\);\s*\}/);
  expect(src).toMatch(/pick\(run\)\s*\{\s*closeMorePopup\(\);\s*run\(moreTriggerEl\);\s*\}/);
  expect(src).toContain("menu.pick(openTableDialog)");
  expect(src).toContain("menu.pick(openImageDialog)");
  // The rows must not capture their own (about to detach) button as the trigger.
  expect(src).not.toMatch(/(?:table|image)DialogTriggerEl\s*=\s*e\.currentTarget/);
});

test("ARCH #42: dialog.ts exports FOCUSABLE and owns the one private trapFocus implementation", () => {
  const dialogSrc = read("src/lib/dialog.ts");
  expect(dialogSrc).toMatch(/export const FOCUSABLE\s*=/);
  // dialog.ts now owns trapFocus directly (not imported from a11y.ts) since
  // dialogBehavior is its only legitimate caller.
  expect(dialogSrc).not.toMatch(/import\s*\{\s*trapFocus\s*\}\s*from\s*["']\$lib\/a11y["']/);
  expect(dialogSrc).toMatch(/function trapFocus\(/);
  expect(dialogSrc).not.toMatch(/export\s+function\s+trapFocus/);

  const a11ySrc = read("src/lib/a11y.ts");
  expect(a11ySrc).not.toMatch(/export\s+function\s+trapFocus/);
});

test("Help content copy reflects current save/export shortcuts", () => {
  const src = read("src/lib/components/HelpContent.svelte");
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
  expect(status).toContain("z-index: var(--app-z-popover)");
  expect(page).toContain("onOpenSettings={openSettings}");
  // The help button routes to the welcome screen's Help tab (2026-07-30),
  // not a modal dialog.
  expect(page).toContain("onOpenHelp={openHelp}");
});

test("left sidebar has four content tabs (book settings moved to the full-screen view), each labelled under its icon", () => {
  const src = read("src/lib/components/LeftPanel.svelte");
  expect(src).toContain('export type PanelTab = "projects" | "toc" | "files" | "media"');
  expect(src).not.toContain("ProjectConfigPanel");
  expect(src).not.toContain('id: "config"');
  expect(src).not.toContain('id: "history"');
  // #313: the label is visible, not display:none. A narrow panel ellipsizes it
  // (every tab must stay on screen) and title/aria-label stay as the tooltip
  // and accessible name.
  const style = src.slice(src.indexOf("<style>")).replace(/\/\*[\s\S]*?\*\//g, "");
  const tabLabelRule = style.match(/\.tab-label\s*\{([^}]*)\}/);
  expect(tabLabelRule).not.toBeNull();
  expect(tabLabelRule![1]).not.toMatch(/display:\s*none/);
  expect(tabLabelRule![1]).toContain("text-overflow: ellipsis");
  expect(src).toContain('<span class="tab-label">{tab.label}</span>');
  expect(src).toContain("aria-label={tab.label}");
  expect(src).toContain("title={tab.title}");
  expect(src).toContain("min-height: 32px");
});

test("editor top saved/configure overlay is removed", () => {
  const src = read("src/routes/+page.svelte");
  expect(src).not.toContain("editor-status-bar");
  expect(src).not.toContain("save-status saved");
  expect(src).not.toContain("Configure</button>");
});

test("C2: a folder open classifies BEFORE the content pipeline opens, so a bare multi-book repo root retargets to the resolved book", () => {
  // The folder-open pipeline (startFolderPreview) moved from +page.svelte into
  // ProjectLifecycleController (Phase 5d, UX H5 / ARCH #10) — see
  // project-lifecycle-controller.test.ts for the behavioral (non-source-text)
  // characterization of this same C2 guarantee.
  const src = read("src/lib/routes/project-lifecycle-controller.svelte.ts");
  const classifyIdx = src.indexOf("await d.projectSession.classify(dir)");
  const startPreviewIdx = src.indexOf("await d.startPreviewHost(");
  expect(classifyIdx).toBeGreaterThan(-1);
  expect(startPreviewIdx).toBeGreaterThan(-1);
  expect(classifyIdx).toBeLessThan(startPreviewIdx);
  expect(src).toContain("const targetDir = d.projectSession.activeBookDir ?? dir;");
  expect(src).toContain("d.startPreviewHost({ key: targetDir, displayName: targetDisplayName })");
});

test("C2: the book switcher is wired into the status bar and gated on books.length > 1", () => {
  const status = read("src/lib/components/StatusBar.svelte");
  expect(status).toContain('import BookSwitcher from "$lib/components/BookSwitcher.svelte"');
  expect(status).toContain("books.length > 1");
  const page = read("src/routes/+page.svelte");
  expect(page).toContain("books={projectSession.books}");
  expect(page).toContain("onSwitchBook={(path) => void switchBook(path)}");
});

test("V5: setup is offered only after a loose folder opens successfully", () => {
  const page = read("src/routes/+page.svelte");
  const landing = read("src/lib/components/WelcomeLanding.svelte");
  expect(page).toContain("!lifecycle.currentFolderHasManifest");
  expect(page).toContain("setUpAsBook(lifecycle.currentDir)");
  expect(page).not.toContain("canAdoptFailedFolder");
  expect(landing).not.toContain("canAdopt");
  expect(landing).not.toContain("onAdopt");
});

test("C2: recents for a repo-backed project key on the repo root, remembering the last active book", () => {
  // The preview-open pipeline (recents upsert included) was extracted from
  // main.ts into electron/preview/controller.ts (ARCH review finding #6) —
  // this logic now lives there, not in main.ts.
  const controller = read("electron/preview/controller.ts");
  expect(controller).toContain('path: source?.type === "local-git-folder" ? source.repoRoot : openedDir');
  expect(controller).toContain("lastActiveBook: openedDir");
});

test("ContextMenu focus-on-open runs per menu-open, not once at app boot (keyboard-focus regression)", () => {
  // Root cause (found via live-app instrumentation, not guesswork): <ContextMenu>
  // itself is mounted ONCE, unconditionally, by +page.svelte's `{#if isDesktop()}`
  // guard — NOT by `controller.open`. A plain `onMount(...)` at the component's
  // top level therefore only ever fires once, at app boot, long before any real
  // menu ever opens: `document.activeElement` was empty/irrelevant, the item
  // buttons didn't exist yet (menu wasn't open), and the callback never ran
  // again for any actual right-click / Shift+F10. That's why focus never landed
  // in the menu — NOT because `.focus()` silently no-ops against the cross-
  // origin preview iframe (manually driving `.focus()` in the live app proves
  // that theory false; a bare `el.focus()` reliably steals focus from the
  // iframe when it actually runs).
  //
  // The fix moves the focus-management code into a Svelte ACTION (`use:`)
  // attached to the `.context-menu` div that lives inside `{#if controller.open}`
  // — Svelte creates/destroys that exact DOM node on every open/close cycle, so
  // the action re-runs on every real open. This test pins that structure: it
  // fails loudly if someone "simplifies" this back to a top-level `onMount`,
  // which would silently reintroduce the bug (the smoke test that originally
  // caught it — tests/integration/inline-editing.pw.mjs step 4 — is not CI-gated).
  const src = read("src/lib/components/ContextMenu.svelte");
  expect(src).not.toMatch(/\bimport\s*\{[^}]*\bonMount\b[^}]*\}\s*from\s*["']svelte["']/);
  expect(src).not.toMatch(/\bonMount\s*\(/);
  // The action must be declared and attached to the menu div specifically —
  // not e.g. only defined-but-unused, and not attached to some other element
  // outside the `{#if controller.open}` block (which would reintroduce the
  // same once-at-boot bug via a different route).
  expect(src).toContain("function menuLifecycle(node: HTMLDivElement)");
  const openBlockIdx = src.indexOf("{#if controller.open}");
  expect(openBlockIdx).toBeGreaterThan(-1);
  const menuDiv = src.slice(openBlockIdx, src.indexOf("</div>", openBlockIdx));
  expect(menuDiv).toContain("use:menuLifecycle");
  expect(menuDiv).toContain('class="context-menu"');
  expect(src).toContain("node.focus({ preventScroll: true });");
  expect(src).toContain("focusFirstEnabled(node)");
});

// ── One workspace-mode enum ──────────────────────────────────────────────────
//
// The wide workspace used to be described by four overlapping switches —
// `editorOpen`, `previewHidden`, `focusMode`, and a persisted `preview.viewMode`
// that a width heuristic and a `userSetViewMode` lock fought over. They could
// disagree, and the combinations nobody intended were reachable. There is now
// ONE enum; every other layout value is derived from it.

test("the workspace layout derives from one mode enum, in exactly one direction", () => {
  const src = read("src/routes/+page.svelte");
  expect(src).toContain('let mode = $state<WorkspaceMode>(settings.current.preview.mode)');
  // The derivations ARE the rule — read them off the source.
  expect(src).toContain('mode === "viewer" && !isNarrow ? "two-column" : "single"');
  expect(src).toContain('let editorVisible = $derived(mode !== "viewer")');
  // `isNarrow` clamps the derived value; it is not a second decider, and the
  // duplicated 1280 width heuristic that used to be one is gone.
  expect(src).not.toContain("1280");
  expect(read("src/lib/routes/preview-event-controller.ts")).not.toContain("1280");
});

test("Focus is not a workspace mode and is never persisted", () => {
  const src = read("src/routes/+page.svelte");
  const types = read("src/lib/platform/shared-types.ts");
  expect(types).toContain('export type WorkspaceMode = "editor" | "viewer";');
  expect(types).not.toContain("Exclude<WorkspaceMode");
  // setMode persists the mode verbatim; Focus has no settings.set of its own.
  expect(src).toContain("settings.set({ preview: { mode: next } })");
  const focusBody = src.slice(src.indexOf("function setFocus("), src.indexOf("function selectFocusView("));
  expect(focusBody).not.toContain("settings.set");
  expect(focusBody).not.toContain("setMode(");
  expect(focusBody).not.toContain("leftPanelOpen");
  expect(focusBody).not.toContain("persistLeftPanelPrefs");
  // The mode-before-focus bookkeeping is gone with the third mode.
  expect(src).not.toContain("modeBeforeFocus");
  expect(src).not.toContain('"focus" ?');
});

test("Esc leaves Focus only through escapeExitsFocus, after the book-settings and landing guards", () => {
  const src = read("src/routes/+page.svelte");
  const escIdx = src.indexOf("escapeExitsFocus(e, document, findBarOpen)");
  expect(escIdx).toBeGreaterThan(-1);
  // The settings panel and start screen own Esc first (they return before this).
  expect(src.indexOf("if (projectSettingsOpen) {")).toBeLessThan(escIdx);
  expect(src.indexOf("if (landingVisible) return;")).toBeLessThan(escIdx);
  // An Esc pressed inside the preview iframe (forwarded by preview-bridge.js
  // as `escapePressed`) goes through the same rule.
  const fwd = src.slice(src.indexOf("function onPreviewEscape("), src.indexOf("function onClientReady("));
  expect(fwd).toContain('e.name !== "escapePressed"');
  expect(fwd).toContain("escapeExitsFocus(");
  expect(src).toContain("c.on(onPreviewEscape);");
  // Ctrl+Shift+F is gone (0.11.7): Esc and the toolbar toggle are the controls.
  expect(src).not.toContain('command === "focus-mode"');
});

test("the Edit/Read switch in the minimal bar maps to a mode on wide and a tab on narrow", () => {
  const src = read("src/routes/+page.svelte");
  const body = src.slice(src.indexOf("function selectFocusView("), src.indexOf("let focusView"));
  expect(body).toContain('selectMobileTab(view === "edit" ? "markdown" : "preview")');
  expect(body).toContain('setMode(view === "edit" ? "editor" : "viewer")');
});

test("the retired view-mode machinery is gone, not merely unused", () => {
  const page = read("src/routes/+page.svelte");
  const zoomView = read("src/lib/routes/zoom-view-controller.svelte.ts");
  const settingsView = read("src/lib/components/SettingsView.svelte");
  for (const dead of ["userSetViewMode", "persistViewMode", "pendingRestoreViewMode", "focusMode"]) {
    expect(page).not.toContain(dead);
    expect(zoomView).not.toContain(dead);
  }
  expect(zoomView).not.toContain("toggleViewMode");
  // No Settings control for a value that is no longer stored.
  expect(settingsView).not.toContain("set-viewmode");
  // Focus swaps components ({#if inFocus}) rather than toggling a chrome
  // class on the shell.
  expect(page).not.toContain("class:focus-mode");
  expect(page).not.toContain(".shell.focus-mode");
});

// ── First run: Edit with the panel open, and no jargon banner (#304, #315) ───
//
// A first-time writer used to open a book on a single cover page — Read mode,
// left panel collapsed, no visible way to type — and meet a yellow "versions"
// banner before doing anything. These pin the defaults that replaced that and
// the two places that could quietly undo them.

test("a book opens in Edit by default; the left panel opens too unless the window is narrow", () => {
  const types = read("src/lib/platform/shared-types.ts");
  expect(types).toMatch(/mode: "editor",\s*\n\s*paneMode: "view",/);
  // Only a profile with NO saved panel choice reaches the fallback; a saved
  // `open: false` (or true) wins because `??` only fills undefined/null.
  const page = read("src/routes/+page.svelte");
  expect(page).toContain("leftPanelOpen = panelPrefs?.open ?? !isNarrow;");
  expect(page).not.toContain("panelPrefs?.open ?? false");
});

test("resetting the workspace drops Focus and never touches the SAVED mode — it must not force Read and save it", () => {
  const src = read("src/routes/+page.svelte");
  const idx = src.indexOf("resetExtras: () => {");
  expect(idx).toBeGreaterThan(-1);
  const body = src.slice(idx, src.indexOf("problemsOpen = false;", idx));
  // A failed open, a cancelled open and a URL preview all reset the workspace.
  // `setMode` persists, so forcing "viewer" here turned a new writer's Edit
  // default into a saved Read after their first mistyped path.
  expect(body).toContain("focus = false;");
  expect(body).not.toContain("setMode(");
});

test("the name/email notice needs version history AND a first save or sync, and says it in plain words", () => {
  const src = read("src/routes/+page.svelte");
  const start = src.indexOf("const needsGitIdentity");
  expect(start).toBeGreaterThan(-1);
  const derived = src.slice(start, src.indexOf("/** After a successful snapshot restore", start));
  expect(derived).toContain("settings.loaded");
  expect(derived).toContain("identityNoticeArmed");
  expect(derived).toContain("!identityNoticeDismissed");
  // A plain folder (no history) never needs it.
  expect(derived).toContain("projectSession.projectCapabilities?.canSnapshot");
  // Armed only by events the renderer already receives: a sync starting…
  expect(src).toContain('if (status.state === "syncing") identityNoticeArmed = true;');
  // …and a version saved by hand.
  expect(src).toMatch(/await api\.vcs\.saveSnapshot\(dir\);\s*identityNoticeArmed = true;/);
  // The copy carries no version-control jargon; the action and "Not now" stay.
  const banner = src.slice(src.indexOf('<div class="identity-banner"'), src.indexOf("{/if}", src.indexOf('<div class="identity-banner"')));
  const message = banner.slice(banner.indexOf('<span class="identity-banner-msg">'), banner.indexOf("</span>"));
  expect(message).not.toMatch(/version/i);
  expect(banner).toContain('openSettings("connections")');
  expect(banner).toContain("Add your name &amp; email");
  expect(banner).toContain("identityNoticeDismissed = true");
});

test("closing the left panel with Escape or the scrim is remembered, exactly like the toolbar toggle", () => {
  const left = read("src/lib/components/LeftPanel.svelte");
  const start = left.indexOf("function close() {");
  expect(start).toBeGreaterThan(-1);
  const closeBody = left.slice(start, left.indexOf("// ── Keyboard: close on Escape", start));
  // The panel opens by default (#304), so a close that wasn't saved came back on
  // every launch. Escape and the scrim both close through `close()`…
  expect(closeBody).toContain("open = false;");
  expect(closeBody).toContain("onPanelStateChange?.();");
  expect(left).toMatch(/if \(e\.key === "Escape"\) \{[\s\S]{0,80}?close\(\);/);
  expect(left).toContain("onclick={close}");
  // …and the page saves on that callback the way its own toolbar toggle does.
  const page = read("src/routes/+page.svelte");
  expect(page).toContain("onPanelStateChange={persistLeftPanelPrefs}");
  const toggleAt = page.indexOf("function toggleLeftPanel() {");
  expect(toggleAt).toBeGreaterThan(-1);
  expect(page.slice(toggleAt, toggleAt + 160)).toContain("persistLeftPanelPrefs();");
});
