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

test("the Focus segment hides the preview so the editor can fill the workspace", () => {
  const src = read("src/routes/+page.svelte");
  const toolbar = read("src/lib/components/AppToolbar.svelte");
  // Hiding the preview IS the `focus` workspace mode — one enum, not a
  // second boolean beside it.
  expect(src).toContain("let previewVisible = $derived(mode !== \"focus\")");
  expect(src).toContain("function togglePreview");
  expect(src).toContain("class:preview-hidden={!previewVisible}");
  // The control is a segment of the one mode switch, not an eye button beside
  // it: a three-state model gets a three-segment control.
  expect(toolbar).toContain('onclick={() => onSetMode("focus")}');
  expect(toolbar).toContain('aria-label="Focus"');
  expect(toolbar).not.toContain("Preview only");
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
  // Project settings keep their own full-window view.
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
  for (const group of ["save", "primary", "block", "insert", "view"]) {
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
  expect(morePopup).toContain("{@render menuRows(viewItems, moreMenu)}");
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
  // + Focus mode move into "…", then the block group (quote, lists, heading).
  expect(labelTier.maxWidth).toBeGreaterThan(tailTier.maxWidth);
  expect(tailTier.maxWidth).toBeGreaterThan(blockTier.maxWidth);
  expect(tailTier.hidden.sort()).toEqual([".insert-group", ".sep-tail", ".view-group"]);
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
  const groupEnd = src.indexOf("<!-- View group", groupStart);
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

  // Focus mode is a posture toggle, not an insertion: it keeps its own direct
  // button in the View group instead of a row in the Insert menu.
  expect(src).toContain('<div class="tb-group view-group">');
  expect(src).toContain("{#each viewItems as item (item.id)}");
});

test("M11: the table-insert dialog is hoisted outside .insert-group, which is display:none at exactly the widths where the More menu exists", () => {
  const src = read("src/lib/components/EditorToolbar.svelte");
  const groupStart = src.indexOf('<div class="tb-group insert-group">');
  const groupEnd = src.indexOf("<!-- View group", groupStart);
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

test("left sidebar has four content tabs (project settings moved to the full-screen view) and icon-only short tabs", () => {
  const src = read("src/lib/components/LeftPanel.svelte");
  expect(src).toContain('export type PanelTab = "projects" | "toc" | "files" | "media"');
  expect(src).not.toContain("ProjectConfigPanel");
  expect(src).not.toContain('id: "config"');
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
  // The three derivations ARE the rule — read them off the source.
  expect(src).toContain('mode === "viewer" && !isNarrow ? "two-column" : "single"');
  expect(src).toContain('let previewVisible = $derived(mode !== "focus")');
  expect(src).toContain('let editorVisible = $derived(mode !== "viewer")');
  // `isNarrow` clamps the derived value; it is not a second decider, and the
  // duplicated 1280 width heuristic that used to be one is gone.
  expect(src).not.toContain("1280");
  expect(read("src/lib/routes/preview-event-controller.ts")).not.toContain("1280");
});

test("`focus` is transient: it never reaches the persisted settings", () => {
  const src = read("src/routes/+page.svelte");
  // One writer, and it maps focus to the layout it is a variant of — waking
  // into a viewer-less window would be hostile.
  expect(src).toContain('settings.set({ preview: { mode: next === "focus" ? "editor" : next } })');
  // Enforced by the type too: the persisted field cannot hold "focus".
  expect(read("src/lib/platform/shared-types.ts")).toContain(
    'mode: Exclude<WorkspaceMode, "focus">',
  );
});

test("setMode persists BEFORE it assigns, so its own write-back cannot land on `focus`", () => {
  const src = read("src/routes/+page.svelte");
  const body = src.slice(
    src.indexOf("function setMode(next: WorkspaceMode): void {"),
    src.indexOf("function togglePreview()"),
  );
  const persistIdx = body.indexOf("settings.set({ preview:");
  const assignIdx = body.indexOf("mode = next;");
  expect(persistIdx).toBeGreaterThan(-1);
  expect(assignIdx).toBeGreaterThan(-1);
  // `focus` persists AS "editor", and the settings notify is synchronous, so
  // entering focus from `viewer` fires modeSink with a value it has not seen
  // ("editor" ≠ "viewer") — the sink then assigns mode = "editor" and the
  // author lands in Edit with the viewer still on screen. Persisting first
  // means that echo happens BEFORE the assignment, so the one writer of
  // `mode` still wins. The guard's dedupe is a nicety, not the correctness
  // argument.
  expect(persistIdx).toBeLessThan(assignIdx);
});

test("only leaving `focus` is ambiguous, so only entering it stores a previous mode", () => {
  const src = read("src/routes/+page.svelte");
  const writes = src.match(/modeBeforeFocus = (?!null)/g) ?? [];
  expect(writes.length).toBe(1);
  expect(src).toContain('if (next === "focus") modeBeforeFocus =');
  // Closing the editor needs no stored state — it always lands on the viewer.
  const toggleIdx = src.indexOf("function toggleEditor()");
  expect(toggleIdx).toBeGreaterThan(-1);
  expect(src.slice(toggleIdx, toggleIdx + 900)).toContain("setMode(\"viewer\")");
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
  // Focus keeps the toolbar, so the chrome-hiding class + CSS have no reason
  // to exist. (The "focus-mode" COMMAND id survives — it is the Ctrl+Shift+F
  // shortcut's identity, and it now hides the viewer.)
  expect(page).not.toContain("class:focus-mode");
  expect(page).not.toContain(".shell.focus-mode");
});
