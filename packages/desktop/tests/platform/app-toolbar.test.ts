/**
 * Source-level tests for AppToolbar.svelte — the main window toolbar extracted
 * out of +page.svelte (toolbar-refactor).
 *
 * Svelte component templates lack a mount/DOM test harness in this repo's
 * bun:test setup (no JSDOM/Svelte-compile harness is wired up) — these tests
 * follow the established project convention (NewProjectWizard.test.ts,
 * ProjectsListBody.test.ts, CrashRecoveryDialog.test.ts, …) of asserting the
 * source contains the required wiring, rather than exercising a live
 * component.
 *
 * Contract under test:
 *  1. The toolbar is its own component — +page.svelte renders <AppToolbar>
 *     instead of carrying ~400 lines of inline toolbar markup + CSS.
 *  2. Modern responsive layout: a 3-region CSS grid (start / center / end)
 *     whose center participates in layout (no absolutely-positioned center
 *     column that overlaps its neighbours = the overflow bug), with a small
 *     documented set of container-query collapse stages.
 *  3. Action order: Publish, Export, Save — Save is the right-most button.
 *  4. The page number control is a native <select> (one option per page,
 *     current page selected), not a numeric text input.
 *  5. The small-screen pane switcher has exactly the editor and desktop tabs —
 *     the defunct style/CSS tab is gone.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const root = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(root, rel), "utf-8");

const toolbar = () => read("src/lib/components/AppToolbar.svelte");
const page = () => read("src/routes/+page.svelte");

describe("AppToolbar — extraction out of +page.svelte", () => {
  test("+page.svelte renders the AppToolbar component instead of inline toolbar markup", () => {
    const src = page();
    expect(src).toContain('import AppToolbar from "$lib/components/AppToolbar.svelte"');
    expect(src).toContain("<AppToolbar");
    // The old inline toolbar shell and its hand-rolled centering hacks are gone.
    expect(src).not.toContain('<header class="toolbar"');
    expect(src).not.toContain("toolbar-center-col");
    expect(src).not.toContain("toolbar-spacer");
    expect(src).not.toContain('class="page-pill"');
    expect(src).not.toContain('class="pane-toggle"');
  });

  test("the toolbar root is a semantic header with container queries enabled", () => {
    const src = toolbar();
    expect(src).toContain('<header class="toolbar"');
    expect(src).toContain("container-type: inline-size");
  });
});

describe("AppToolbar — modern responsive layout (no overflow)", () => {
  test("uses an in-flow 3-column grid: fixed side clusters, center fills the REMAINING space", () => {
    const src = toolbar();
    // The load-bearing pattern: `auto minmax(0,1fr) auto`. The page-nav lives
    // in the middle track, which is exactly the space left over after the
    // start/end clusters — so it can NEVER paint over them (the failure mode
    // of both the old absolutely-positioned center column and a naive
    // `1fr auto 1fr` grid, where an end cluster wider than its track bleeds
    // across the middle).
    expect(src).toMatch(/display:\s*grid/);
    expect(src).toMatch(/grid-template-columns:\s*auto\s+minmax\(0,\s*1fr\)\s+auto/);
    expect(src).toContain('class="toolbar-start"');
    expect(src).toContain('class="toolbar-center"');
    expect(src).toContain('class="toolbar-end"');
    // The middle track clips instead of overlapping if it ever runs out of
    // room (the collapse stages are sized so it doesn't).
    expect(src).toMatch(/\.toolbar-center\s*\{[^}]*overflow-x:\s*clip/);
  });

  test("the absolute-centering + spacer hacks did not come along", () => {
    const src = toolbar();
    expect(src).not.toContain("toolbar-center-col");
    expect(src).not.toContain("toolbar-spacer");
    // The center region must not be ripped out of flow.
    expect(src).not.toMatch(/\.toolbar-center\s*\{[^}]*position:\s*absolute/);
    expect(src).not.toMatch(/translateX\(-50%\)/);
  });

  test("collapse stages respond to the toolbar's own width via @container queries", () => {
    const src = toolbar();
    const stages = src.match(/@container\s*\(max-width:\s*\d+px\)/g) ?? [];
    // A handful of documented stages — not the previous 8-step ladder.
    expect(stages.length).toBeGreaterThanOrEqual(3);
    expect(stages.length).toBeLessThanOrEqual(5);
    // No viewport media queries for toolbar-internal collapsing (media queries
    // may only gate behavior tied to the app layout mode, e.g. touch targets).
    expect(src).toMatch(/@media\s*\(pointer:\s*coarse\)/);
  });

  test("overflow can never hide the primary actions: sides clip, controls go icon-only", () => {
    const src = toolbar();
    // Label spans hide at a collapse stage instead of overflowing…
    expect(src).toMatch(/\.view-label\s*\{\s*display:\s*none/);
    expect(src).toMatch(/\.btn-label\s*\{\s*display:\s*none/);
    // …and the start region is allowed to shrink (min-width: 0), so the grid
    // can always fit the end region's actions.
    expect(src).toMatch(/\.toolbar-start\s*\{[^}]*min-width:\s*0/);
  });

  test("URL mode pre-pays for the page nav: tighter caps, no mode switch, no hints", () => {
    const src = toolbar();
    // The URL start cluster (title + URL + open-in-browser) is ~2× the folder
    // cluster; without these the middle track starves and the page nav clips
    // on ordinary desktop windows.
    expect(src).toContain('class:url-mode={sourceMode === "url"}');
    expect(src).toMatch(/\.toolbar\.url-mode \.path\s*\{\s*max-width/);
    // A URL source has no editor, so BOTH forms of the mode switch go.
    expect(src).toMatch(/\.toolbar\.url-mode \.mode-group,\s*\n\s*\.toolbar\.url-mode details\.mode-menu\s*\{\s*display:\s*none/);
    expect(src).toMatch(/\.toolbar\.url-mode \.save-hint\s*\{\s*display:\s*none/);
  });

  test("edit-narrow hides the separators along with the view controls (no adjacent double rule)", () => {
    const src = toolbar();
    expect(src).toMatch(/\.toolbar\.edit-narrow \.toolbar-sep\s*[,{]/);
  });

  test("coarse pointers get a small-screen step-down so 44px targets can't clip the actions off a phone", () => {
    const src = toolbar();
    const coarseIdx = src.indexOf("@media (pointer: coarse)");
    expect(coarseIdx).toBeGreaterThan(-1);
    const coarseBlock = src.slice(coarseIdx);
    expect(coarseBlock).toMatch(/@container \(max-width: \d+px\)[\s\S]{0,600}?min-width:\s*40px/);
  });
});

describe("AppToolbar — primary action order: Publish, Export, Save", () => {
  test("markup order is Publish, then Export, then Save (Save right-most)", () => {
    const src = toolbar();
    const publishIdx = src.indexOf('class="publish-btn');
    const exportIdx = src.indexOf('class="export-btn');
    const saveIdx = src.indexOf('class="save-btn');
    expect(publishIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeGreaterThan(publishIdx);
    expect(saveIdx).toBeGreaterThan(exportIdx);
  });

  test("there is no overflow menu — Save is the right-most button with nothing after it", () => {
    const src = toolbar();
    expect(src).not.toContain("more-menu");
    expect(src).not.toContain("ellipsis-vertical");
    const saveIdx = src.indexOf('class="save-btn');
    const afterSave = src.slice(saveIdx, src.indexOf("</header>"));
    expect(afterSave).not.toContain("<details");
    expect(afterSave.indexOf("<button")).toBe(afterSave.lastIndexOf("<button"));
  });

  test("actions keep their intents: onPublish, onOpenExport (the export dialog), onSave", () => {
    const src = toolbar();
    expect(src).toMatch(/publish-btn[\s\S]{0,400}?onclick=\{[^}]*onPublish/);
    expect(src).toMatch(/export-btn[\s\S]{0,400}?onclick=\{[^}]*onOpenExport/);
    expect(src).toMatch(/save-btn[\s\S]{0,400}?onclick=\{[^}]*onSave/);
  });

  test("the Project settings button sits beside the view controls (and stays reachable on narrow layouts)", () => {
    const src = toolbar();
    const zoomIdx = src.indexOf('class="menu zoom-menu"');
    const settingsIdx = src.indexOf('class="icon-btn project-settings-btn"');
    expect(zoomIdx).toBeGreaterThan(-1);
    expect(settingsIdx).toBeGreaterThan(zoomIdx);
    // Before the separator that leads into the primary actions.
    expect(settingsIdx).toBeLessThan(src.indexOf('class="publish-btn'));
    // Gated only on `showProjectSettings` — narrow layouts keep it.
    expect(src).toMatch(/\{#if showProjectSettings\}[\s\S]{0,400}?project-settings-btn/);
    expect(src).toMatch(/project-settings-btn[\s\S]{0,200}?onclick=\{onOpenProjectSettings\}/);
  });
});

describe("AppToolbar — page select (replaces the numeric page input)", () => {
  test("the page control is a native select labelled for navigation", () => {
    const src = toolbar();
    expect(src).toContain('<select');
    expect(src).toContain('class="page-select"');
    expect(src).toMatch(/<select[^>]*aria-label="Go to page"/);
    // The old inline-edit input + pill pair is gone.
    expect(src).not.toContain('type="number"');
    expect(src).not.toContain("page-pill");
    expect(src).not.toContain("beginPageEdit");
    expect(src).not.toContain("commitPageEdit");
  });

  test("carries the machine-readable page seam the perf gates scrape (tests/perf/*-gate.mjs)", () => {
    const src = toolbar();
    // A select's option text never appears in document.body.innerText, so the
    // CI render/rerender gates read these data attributes instead of the old
    // "Page X / Y" pill text. Removing them breaks the packaged-app CI job.
    expect(src).toMatch(/data-current-page=\{pageNav\.currentPage\}/);
    expect(src).toMatch(/data-total-pages=\{pageNav\.totalPages\}/);
  });

  test("renders one option per page, selection driven by the select's VALUE (a property write)", () => {
    const src = toolbar();
    expect(src).toMatch(/\{#each\s+pageNav\.pageOptions\s+as\s+\w+/);
    // Load-bearing: per-option `selected` attributes are ignored by the
    // browser once the user has picked an option (the dirty flag), which
    // froze the display on stale pages. The select's value property is the
    // only reliable channel.
    expect(src).toMatch(/<select[\s\S]{0,400}?value=\{pageNav\.currentPage\}/);
    expect(src).not.toMatch(/<option[^>]*selected=\{/);
  });

  test("changing the select navigates via selectPage and re-syncs the DOM so a dropped/failed goto can't desync it", () => {
    const src = toolbar();
    expect(src).toMatch(/pageNav\.selectPage\(/);
    // Immediately after issuing the intent, the DOM value snaps back to
    // currentPage; a successful navigation updates currentPage (and the
    // value with it), a dropped or rejected one leaves the select truthful.
    expect(src).toMatch(/el\.value = String\(pageNav\.currentPage\)/);
  });

  test("the dropdown options are explicitly styled — the OS popup must never render same-color text on background", () => {
    const src = toolbar();
    expect(src).toMatch(/\.page-select option\s*\{[^}]*background:[^}]*color:/s);
  });
});

describe("AppToolbar — small-screen pane switcher (defunct style tab removed)", () => {
  test("exactly two tabs: editor (markdown) and desktop (preview)", () => {
    const src = toolbar();
    expect(src).toContain('id="mobile-tab-markdown"');
    expect(src).toContain('id="mobile-tab-preview"');
    expect(src).not.toContain('id="mobile-tab-css"');
    expect(src).not.toMatch(/selectMobileTab\("css"\)|onSelectMobileTab\("css"\)/);
  });

  test("keeps the WAI-ARIA tabs pattern (tablist, aria-selected, roving tabindex)", () => {
    const src = toolbar();
    expect(src).toContain('role="tablist"');
    expect(src).toMatch(/aria-selected=\{mobileTab === "markdown"\}/);
    expect(src).toMatch(/aria-selected=\{mobileTab === "preview"\}/);
    expect(src).toMatch(/tabindex=\{mobileTab === "markdown" \? 0 : -1\}/);
  });
});

// -- One segmented control: Edit / Read ------
//
// The toolbar used to carry FOUR controls for the workspace mode (an Edit/Read
// segmented pair, an eye button for `focus`, and a pen button that toggled the
// editor), then three segments with Focus as a mode of its own. Focus is Edit
// without the preview -  a way of writing, not a third thing to read -  so it
// is a toggle on the source editor's toolbar and the segmented control has
// exactly the two modes there are to choose between.
describe("AppToolbar — the mode control is the whole mode model", () => {
  test("the segmented group has Edit and Read, and no Focus segment", () => {
    const src = toolbar();
    const group = src.slice(src.indexOf('<div class="mode-group">'), src.indexOf("</div>", src.indexOf('<div class="mode-group">')));
    expect(group).toContain('onSetMode("editor")');
    expect(group).toContain('onSetMode("viewer")');
    expect(group).toContain('aria-label="Edit"');
    expect(group).toContain('aria-label="Read"');
    expect(src).not.toContain('onSetMode("focus")');
    expect(src).not.toContain('aria-label="Focus"');
  });

  test("segments are mutually exclusive - Edit lights up for Edit and its Focus sub-state, Read for Read", () => {
    const src = toolbar();
    expect(src).toContain('class:active={mode !== "viewer"}');
    expect(src).toContain('class:active={mode === "viewer"}');
    expect(src).not.toContain('mode === "focus"');
    expect(src).not.toContain("editorShowing");
  });

  test("the collapsed menu twin carries the same two modes", () => {
    const src = toolbar();
    const menu = src.slice(src.indexOf('<details class="menu mode-menu">'), src.indexOf("</details>", src.indexOf('<details class="menu mode-menu">')));
    for (const m of ["editor", "viewer"]) {
      expect(menu).toContain(`onSetMode("${m}"); closeMenu(e);`);
    }
    expect(menu).not.toContain("focus");
    // Its summary icon reports the CURRENT mode.
    expect(src).toContain('mode === "viewer" ? "book-open" : "pen-line"');
  });

  test("Focus lives on the source editor's toolbar, where the preview it hides is", () => {
    const actions = read("src/lib/editor/toolbar-actions.ts");
    expect(actions).toMatch(/id: "focus-mode"/);
    // ...and is dropped for the paged editor, which has no preview beside it.
    expect(actions).toContain('if (item.id === "focus-mode" && opts.richMode) return false;');
  });

  test("the eye and pen icon buttons are gone, along with the props that fed them", () => {
    const src = toolbar();
    for (const dead of ["onTogglePreview", "previewToggleDisabled", "onToggleEditor"]) {
      expect(src).not.toContain(dead);
    }
    expect(src).not.toContain('aria-label="Toggle markdown editor"');
    expect(src).not.toContain("Hide preview");
    expect(src).not.toContain("Show preview");
    // The whole `{#if !isNarrow && sourceMode !== "url"}` block existed only to
    // host those two buttons.
    expect(src).not.toContain('{#if !isNarrow && sourceMode !== "url"}');
  });

  test("+page.svelte stops handing the toolbar the retired props", () => {
    const src = page();
    for (const dead of ["onTogglePreview=", "previewToggleDisabled=", "onToggleEditor="]) {
      expect(src).not.toContain(dead);
    }
    // Both shortcut targets survive — they are keyboard/editor-toolbar paths,
    // not toolbar buttons.
    expect(src).toContain("function togglePreview");
    expect(src).toContain("function toggleEditor()");
  });

  test("Ctrl+E keeps a visible home now that the pen button is gone", () => {
    const src = toolbar();
    // The pen button's tooltip was the only place the app named Ctrl+E.
    expect(src).toContain("(Ctrl+E)");
    // Ctrl+Shift+F is named where Focus lives: the source editor's toolbar.
    expect(read("src/lib/editor/toolbar-actions.ts")).toContain("(Ctrl+Shift+F)");
  });
});

describe("AppToolbar — relocated overflow-menu items stay reachable elsewhere", () => {
  test("focus mode is an editor-toolbar item, advanced setup lives in app Settings, template export in the export dialog", () => {
    const actions = read("src/lib/editor/toolbar-actions.ts");
    expect(actions).toMatch(/id: "focus-mode"/);
    expect(actions).toContain("Focus mode (Ctrl+Shift+F)");
    const settings = read("src/lib/components/SettingsView.svelte");
    expect(settings).toContain("<ConnectionsSettings {projectDir} />");
    const exportDialog = read("src/lib/components/ExportDialog.svelte");
    expect(exportDialog).toContain("template");
    // +page routes the editor-toolbar action to the hide-the-viewer toggle.
    expect(page()).toMatch(/action === "focus-mode"[\s\S]{0,120}?togglePreview\(\)/);
  });
});

describe("AppToolbar — PWA cleanliness (CLAUDE.md §8)", () => {
  test("no host/Node value imports in the SPA component", () => {
    const src = toolbar();
    expect(src).not.toMatch(/from\s+["']node:/);
    expect(src).not.toMatch(/from\s+["'](fs|path|url|child_process)["']/);
    expect(src).not.toMatch(/import\s+\{[^}]*\}\s+from\s+["']@dimm-city\/gutterpress["']/);
    expect(src).not.toContain("window.electron");
    expect(src).not.toContain("ipcRenderer");
  });
});
