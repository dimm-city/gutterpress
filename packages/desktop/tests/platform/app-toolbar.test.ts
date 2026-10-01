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
 *  2. Modern responsive layout: a flex row of two clusters (start / end)
 *     with a small documented set of container-query collapse stages.
 *  3. Action order: Publish, Export — Export is the right-most button; Save
 *     lives in the editor toolbar, not here.
 *  4. Page navigation and zoom are NOT here — they live on the preview
 *     pane's own strip (PreviewToolbar.svelte, see preview-toolbar.test.ts).
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

/** `@container (max-width: Npx) { … }` bodies keyed by N (brace-matched). */
function containerStages(src: string): Map<number, string> {
  const out = new Map<number, string>();
  for (const m of src.matchAll(/@container\s*\(max-width:\s*(\d+)px\)\s*\{/g)) {
    const start = m.index! + m[0].length;
    let depth = 1;
    let i = start;
    while (i < src.length && depth > 0) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}") depth--;
      i++;
    }
    out.set(Number(m[1]), src.slice(start, i - 1));
  }
  return out;
}

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
  test("is a flex row of two clusters: the start cluster shrinks, the end cluster keeps its controls", () => {
    const src = toolbar();
    expect(src).toMatch(/\.toolbar\s*\{[^}]*display:\s*flex/);
    expect(src).toMatch(/\.toolbar\s*\{[^}]*justify-content:\s*space-between/);
    expect(src).toContain('class="toolbar-start"');
    expect(src).toContain('class="toolbar-end"');
    // Page navigation and zoom moved to the preview pane's own strip.
    expect(src).not.toContain("toolbar-center");
    expect(src).not.toContain("page-nav");
    expect(src).not.toContain("page-select");
    expect(src).not.toContain("zoom-menu");
    expect(src).not.toContain("pageNav");
    expect(src).not.toContain("onApplyZoom");
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
    // A URL source has no editor, so BOTH forms of the mode switch go, and Focus with them.
    expect(src).toMatch(/\.toolbar\.url-mode \.mode-group,\s*\n\s*\.toolbar\.url-mode \.focus-btn,\s*\n\s*\.toolbar\.url-mode details\.mode-menu\s*\{\s*display:\s*none/);
    expect(src).toMatch(/\.toolbar\.url-mode \.save-hint\s*\{\s*display:\s*none/);
    // Publish is disabled for a URL source, so its label yields at every width.
    expect(src).toMatch(/\.toolbar\.url-mode \.publish-btn \.btn-label\s*\{\s*display:\s*none/);
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

describe("AppToolbar — action order: Publish, Export (no Save)", () => {
  test("markup order is Publish, then Export (Export right-most)", () => {
    const src = toolbar();
    const publishIdx = src.indexOf('class="publish-btn');
    const exportIdx = src.indexOf('class="export-btn');
    expect(publishIdx).toBeGreaterThan(-1);
    expect(exportIdx).toBeGreaterThan(publishIdx);
  });

  test("Save lives in the editor toolbar — the app toolbar carries no save control or props", () => {
    const src = toolbar();
    expect(src).not.toContain("save-btn");
    expect(src).not.toContain("savePending");
    expect(src).not.toContain("saveDisabled");
    expect(src).not.toContain("onSave");
  });

  test("there is no overflow menu — Export is the right-most button with nothing after it", () => {
    const src = toolbar();
    expect(src).not.toContain("more-menu");
    expect(src).not.toContain("ellipsis-vertical");
    const exportIdx = src.indexOf('class="export-btn');
    const afterExport = src.slice(exportIdx, src.indexOf("</header>"));
    expect(afterExport).not.toContain("<details");
    expect(afterExport.indexOf("<button")).toBe(afterExport.lastIndexOf("<button"));
  });

  test("actions keep their intents: onPublish, onOpenExport (the export dialog)", () => {
    const src = toolbar();
    expect(src).toMatch(/publish-btn[\s\S]{0,400}?onclick=\{[^}]*onPublish/);
    expect(src).toMatch(/export-btn[\s\S]{0,400}?onclick=\{[^}]*onOpenExport/);
  });

  test("the Book settings button follows Focus after a separator, and sits with the actions (no separator before Publish)", () => {
    const src = toolbar();
    const focusIdx = src.indexOf('id="focus-toggle-btn"');
    const settingsIdx = src.indexOf('class="icon-btn icon-text project-settings-btn"');
    const publishIdx = src.indexOf('class="publish-btn');
    expect(focusIdx).toBeGreaterThan(-1);
    expect(settingsIdx).toBeGreaterThan(focusIdx);
    expect(settingsIdx).toBeLessThan(publishIdx);
    const sep = '<span class="toolbar-sep" aria-hidden="true"></span>';
    // Focus | Setup Publish: one separator between Focus and Setup…
    expect(src.slice(focusIdx, settingsIdx)).toContain(sep);
    // …and none between Setup and the actions.
    expect(src.slice(settingsIdx, publishIdx)).not.toContain(sep);
    // Gated only on `showProjectSettings` — narrow layouts keep it.
    expect(src).toMatch(/\{#if showProjectSettings\}[\s\S]{0,400}?project-settings-btn/);
    expect(src).toMatch(/project-settings-btn[\s\S]{0,200}?onclick=\{onOpenProjectSettings\}/);
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

// ── One segmented control per workspace mode, plus a separate Focus toggle ───
//
// `WorkspaceMode` has two values (editor | viewer): the segmented control is
// the whole mode story. Focus is NOT a mode — it is a session boolean layered
// on top of either one, so it is a toggle button beside the control.
describe("AppToolbar — the mode control is the whole mode model", () => {
  test("the segmented group has one segment per WorkspaceMode value — and no Focus segment", () => {
    const src = toolbar();
    const group = src.slice(src.indexOf('<div class="mode-group">'), src.indexOf("</div>", src.indexOf('<div class="mode-group">')));
    expect(group).toContain('onSetMode("editor")');
    expect(group).toContain('onSetMode("viewer")');
    expect(group).toContain('aria-label="Edit"');
    expect(group).toContain('aria-label="Read"');
    expect(group).not.toContain("focus");
    expect(src).not.toContain('onSetMode("focus")');
  });

  test("segments are mutually exclusive — active/aria-pressed track the mode exactly", () => {
    const src = toolbar();
    expect(src).toContain('class:active={mode === "editor"}');
    expect(src).toContain('class:active={mode === "viewer"}');
    expect(src).not.toContain('mode === "focus"');
    expect(src).not.toContain("editorShowing");
  });

  test("the collapsed menu twin carries the same two modes, and its icon reports the current one", () => {
    const src = toolbar();
    const menu = src.slice(src.indexOf('<details class="menu mode-menu">'), src.indexOf("</details>", src.indexOf('<details class="menu mode-menu">')));
    for (const m of ["editor", "viewer"]) {
      expect(menu).toContain(`onSetMode("${m}"); closeMenu(e);`);
    }
    expect(menu).not.toContain("focus");
    expect(src).toContain('mode === "viewer" ? "book-open" : "pen-line"');
  });

  test("Focus is a toggle button (aria-pressed) for Edit AND Read, enabled on narrow layouts too", () => {
    const src = toolbar();
    const at = src.indexOf('id="focus-toggle-btn"');
    expect(at).toBeGreaterThan(-1);
    const btn = src.slice(src.lastIndexOf("<button", at), src.indexOf("</button>", at));
    expect(btn).toContain("onclick={onToggleFocus}");
    expect(btn).toContain("aria-pressed={focus}");
    expect(btn).toContain('aria-label="Focus"');
    // Gated only on having a project — NOT on the mode and NOT on isNarrow.
    expect(btn).toContain("disabled={editorToggleDisabled}");
    expect(btn).not.toMatch(/isNarrow|mode ===/);
    // A URL source has no workspace to hide chrome from; the phone floor drops it with the mode switch.
    expect(src).toMatch(/\.toolbar\.url-mode \.focus-btn/);
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
    expect(src).toContain("function setFocus(");
    expect(src).toContain("function toggleEditor()");
    expect(src).not.toContain("togglePreview");
  });

  test("Ctrl+E keeps a visible home now that the pen button is gone", () => {
    const src = toolbar();
    // The pen button's tooltip was the only place the app named Ctrl+E.
    expect(src).toContain("(Ctrl+E)");
  });
});

// ── The selected mode reads as selected (#305) ───────────────────────────────
describe("AppToolbar — the selected mode never looks disabled (#305)", () => {
  test("hover cannot override the selected fill: the :hover rules exclude .active", () => {
    const src = toolbar();
    // `.mode-group button:hover:not(:disabled)` (0,3,1) out-specified
    // `.mode-group button.active` (0,2,1). The just-clicked segment sits under
    // the pointer, so it lost its accent fill but kept its white text: white on
    // pale grey, i.e. it looked disabled exactly when the author had chosen it.
    // The collapsed menu's `.menu-item` had the identical defect.
    expect(src).toMatch(/\.mode-group button:not\(\.active\):hover:not\(:disabled\)/);
    expect(src).toMatch(/\.menu-item:not\(\.active\):hover:not\(:disabled\)/);
    expect(src).not.toMatch(/\.mode-group button:hover/);
    expect(src).not.toMatch(/\.menu-item:hover/);
  });

  test("every segment and its collapsed-menu twin reports the mode with aria-pressed", () => {
    const src = toolbar();
    for (const m of ["editor", "viewer"]) {
      expect(src.split(`aria-pressed={mode === "${m}"}`).length - 1).toBe(2);
    }
  });

  test("each tooltip names its layout and says what it shows; Focus names the real way out", () => {
    const src = toolbar();
    const table = src.match(/const MODE_TITLE = \{([\s\S]*?)\} as const/)?.[1] ?? "";
    const title = (k: string) => table.match(new RegExp(`${k}:\\s*"([^"]+)"`))?.[1] ?? "";
    expect(title("editor")).toMatch(/^Edit — editor and preview side by side/);
    expect(title("viewer")).toMatch(/^Read — the preview on its own/);
    expect(table).not.toContain("focus");
    // Both forms of the mode control carry them (the menu items had no tooltip).
    for (const m of ["editor", "viewer"]) {
      expect(src.split(`title={MODE_TITLE.${m}}`).length - 1).toBe(2);
    }
    // Esc is the one way out of Focus (Ctrl+Shift+F was dropped in 0.11.7).
    const focusTitle = src.match(/const FOCUS_TITLE =\s*"([^"]+)"/)?.[1] ?? "";
    expect(focusTitle).toMatch(/^Focus — /);
    expect(focusTitle).not.toContain("Ctrl+Shift+F");
    expect(focusTitle).toContain("Esc");
    expect(src).toContain("title={FOCUS_TITLE}");
  });

  test("the first Focus entry of a session shows a transient hint naming the exit keys", () => {
    const src = page();
    const body = src.slice(
      src.indexOf("function setFocus("),
      src.indexOf("function selectFocusView("),
    );
    // setFocus is the one writer of `focus`, so every way in gets the hint.
    expect(body).toMatch(
      /if \(on && !focusHintShown\) \{\s+focusHintShown = true;\s+toast\?\.info\?\.\(/,
    );
    // ONCE per app session: a plain component-level flag — set when the hint
    // shows and never reset, not persisted, no new setting.
    expect(src).toMatch(/^\s*let focusHintShown = false;/m);
    expect(src.match(/focusHintShown = true/g)).toHaveLength(1);
    expect(src.match(/focusHintShown = false/g)).toHaveLength(1);
    expect(body).toContain('"Focus: press Esc to exit"');
  });
});

// ── One primary action (#306) ────────────────────────────────────────────────
describe("AppToolbar — Export is the one primary action (#306)", () => {
  test("only Export carries the primary recipe; Publish is a secondary button", () => {
    const src = toolbar();
    const primaries = [...src.matchAll(/class="([^"]*\bapp-btn-primary\b[^"]*)"/g)].map((m) => m[1]);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]).toContain("export-btn");
    const at = src.indexOf('class="publish-btn');
    const publish = src.slice(at, src.indexOf("</button>", at));
    expect(publish).not.toMatch(/\bprimary\b/);
    // Its look comes from the toolbar's existing non-primary button recipe (the
    // one Setup uses) — no new colours or tokens.
    expect(src).toMatch(/\.toolbar button:not\(\.app-btn-primary\):not\(\.active\)\s*\{/);
  });
});

// ── Deliberate collapse (#316) ───────────────────────────────────────────────
//
// The container is the toolbar's content box (window width − 24px of padding),
// so a 900px window measures 876px, and the narrow layout (≤820px window)
// starts at 796px. Thresholds were calibrated by sweeping real window widths
// from 1440 down to 360 against the measured cluster widths (no clipped nav or
// cluster overlap at any width; touch measured separately).
describe("AppToolbar — deliberate collapse (#316)", () => {
  test("Publish/Export/Setup keep their labels on a 900px window and drop them together", () => {
    const stages = containerStages(toolbar());
    // Line-anchored, so `.save-btn .btn-label` does not count as the general rule.
    const labelStage = [...stages].find(([, body]) => /^\s*\.btn-label\s*\{\s*display:\s*none/m.test(body));
    expect(labelStage).toBeDefined();
    // 900px window → 876px container: still labelled. But they must be gone
    // before the narrow layout's pane tabs (796px), which leave no room.
    expect(labelStage![0]).toBeLessThan(876);
    expect(labelStage![0]).toBeGreaterThanOrEqual(796);
  });

  test("the Book setup button is a labelled wrench that shares the .btn-label collapse and keeps its name", () => {
    const src = toolbar();
    const at = src.indexOf('class="icon-btn icon-text project-settings-btn"');
    const button = src.slice(at, src.indexOf("</button>", at));
    expect(button).toContain('name="wrench"');
    expect(button).toContain('<span class="btn-label">Setup</span>');
    expect(button).toContain('aria-label="Book setup"');
    expect(button).toContain('title="Book setup"');
  });

  test("every control that can turn icon-only keeps an aria-label and a tooltip", () => {
    const src = toolbar();
    for (const cls of ["publish-btn", "export-btn", "icon-btn icon-text project-settings-btn"]) {
      const at = src.indexOf(`class="${cls}`);
      expect(at).toBeGreaterThan(-1);
      const button = src.slice(at, src.indexOf("</button>", at));
      expect(button).toContain("aria-label=");
      expect(button).toContain("title=");
    }
  });

  test("the phone floor hides the mode switch, Focus, separators and identity — nothing clips", () => {
    const stages = containerStages(toolbar());
    expect(stages.get(620)).toMatch(/\.mode-group,\s*\n\s*\.mode-menu,\s*\n\s*\.focus-btn\s*\{\s*display:\s*none/);
    expect(stages.get(620)).toMatch(/\.toolbar-sep,/);
    // No stage references the page nav any more — it is not in this bar.
    for (const [, body] of stages) expect(body).not.toMatch(/page-nav|page-select|zoom-menu/);
  });

  test("+page.svelte mounts the preview strip inside the preview pane (hidden in Focus) and hands the toolbar no page/zoom props", () => {
    const src = page();
    expect(src).toContain('import PreviewToolbar from "$lib/components/PreviewToolbar.svelte"');
    const pane = src.slice(src.indexOf('class="pane preview-pane"'), src.indexOf("<PreviewFrame"));
    expect(pane).toMatch(/\{#if !inFocus && lifecycle\.previewUrl\}[\s\S]{0,400}?<PreviewToolbar/);
    expect(src).not.toContain("showPageNav={!!lifecycle.previewUrl}");
    const appToolbar = src.slice(src.indexOf("<AppToolbar"), src.indexOf("/>", src.indexOf("<AppToolbar")));
    expect(appToolbar).not.toMatch(/pageNav|zoom|onApplyZoom|showPageNav/);
    // Narrow + editor tab: the preview is hidden, so the mode switch is noise.
    expect(toolbar()).toMatch(/\.toolbar\.edit-narrow \.mode-group/);
  });
});

describe("AppToolbar — relocated overflow-menu items stay reachable elsewhere", () => {
  test("advanced setup lives in app Settings, template export in the export dialog", () => {
    const actions = read("src/lib/editor/toolbar-actions.ts");
    expect(actions).not.toMatch(/id: "focus-mode"/);
    const settings = read("src/lib/components/SettingsView.svelte");
    expect(settings).toContain("<ConnectionsSettings {projectDir} />");
    const exportDialog = read("src/lib/components/ExportDialog.svelte");
    expect(exportDialog).toContain("template");
    // The app-toolbar toggle and the shortcut are Focus's only entry points.
    expect(page()).not.toContain('action === "focus-mode"');
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
