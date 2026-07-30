/**
 * Source-level tests for NewProjectWizard.svelte (M19 / M21 / M1 fixes).
 *
 * Svelte component templates lack a mount/DOM test harness in this repo's
 * bun:test setup (no JSDOM/Svelte-compile harness is wired up) — these tests
 * follow the established project convention (RecoveryConfirmDialog.test.ts,
 * CrashRecoveryDialog.test.ts, ConflictChoicesDialog.preview.test.ts, …) of
 * asserting the source contains the required wiring, rather than exercising
 * a live component.
 */
import { describe, test, expect } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";

const COMPONENT_PATH = path.resolve(
  __dirname,
  "../../src/lib/components/NewProjectWizard.svelte",
);

function readSource(): string {
  return fs.readFileSync(COMPONENT_PATH, "utf-8");
}

describe("NewProjectWizard — M1/#42 dialog-system migration", () => {
  test("imports and wires the shared dialogBehavior action", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[^}]*dialogBehavior[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/use:dialogBehavior=\{\{[^}]*onClose:\s*close/);
    expect(src).toMatch(/labelledBy:\s*["']new-project-title["']/);
  });

  test("role='dialog'/aria-modal/trapFocus are NOT hand-declared (owned by the action)", () => {
    const src = readSource();
    expect(src).not.toContain('role="dialog"');
    expect(src).not.toContain('aria-modal="true"');
    expect(src).not.toContain("trapFocus");
    expect(src).not.toMatch(/svelte:window/);
  });

  test("uses the shared dlg-* shell classes, not a local backdrop/dialog/actions block", () => {
    const src = readSource();
    expect(src).toContain('class="dlg-backdrop"');
    expect(src).toContain('class="dlg-shell"');
    expect(src).toContain('@import "$lib/styles/dialog-shell.css"');
  });
});

describe("NewProjectWizard — M19 mid-create dismissal guard", () => {
  test("close is built from the shared guardedClose helper, keyed on `creating`", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[^}]*guardedClose[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    expect(src).toMatch(/const close = guardedClose\(/);
    expect(src).toMatch(/\(\)\s*=>\s*creating\)/);
  });

  test("the header close button and footer Cancel button are disabled while creating", () => {
    const src = readSource();
    expect(src).toMatch(/class="dlg-close"[^>]*disabled=\{creating\}/);
    expect(src).toMatch(/class="dlg-ghost"\s+onclick=\{close\}\s+disabled=\{creating\}/);
  });

  test("create() clears `creating` before calling close() on success, so the guard doesn't swallow it", () => {
    const src = readSource();
    const createFn = src.slice(src.indexOf("async function create("), src.indexOf("friendlyCreateError"));
    // creating = false must appear BEFORE the close() call in the success path.
    const creatingFalseIdx = createFn.indexOf("creating = false;");
    const closeCallIdx = createFn.indexOf("close();");
    expect(creatingFalseIdx).toBeGreaterThan(-1);
    expect(closeCallIdx).toBeGreaterThan(-1);
    expect(creatingFalseIdx).toBeLessThan(closeCallIdx);
  });
});

describe("NewProjectWizard — M21 default parentDir", () => {
  test("show() loads a default parentDir instead of leaving it null", () => {
    const src = readSource();
    expect(src).toMatch(/export function show\([\s\S]{0,300}void loadDefaultParentDir\(\)/);
  });

  test("loadDefaultParentDir prefers the persisted newProjectParentDir pref", () => {
    const src = readSource();
    expect(src).toContain("api.app.getDesktopPrefs()");
    expect(src).toContain("newProjectParentDir");
  });

  test("loadDefaultParentDir falls back to the parent of lastProjectDir", () => {
    const src = readSource();
    expect(src).toContain("lastProjectDir");
    expect(src).toMatch(/parentDirOf\(lastProjectDir\)/);
  });

  test("loadDefaultParentDir never clobbers a folder the writer already chose", () => {
    const src = readSource();
    const fn = src.slice(
      src.indexOf("async function loadDefaultParentDir"),
      src.indexOf("/** Open the wizard"),
    );
    expect(fn).toMatch(/if\s*\(parentDir\)\s*return;/);
  });

  test("create() persists the chosen parentDir as the new default for next time", () => {
    const src = readSource();
    expect(src).toMatch(/setDesktopPrefs\(\{\s*newProjectParentDir:\s*parentDir\s*\}\)/);
  });

  test("the folder button reads 'Change…' once a default is prefilled, 'Choose folder…' otherwise", () => {
    const src = readSource();
    expect(src).toContain('{parentDir ? "Change…" : "Choose folder…"}');
  });

  test("canCreate requires name + folder + preset choice (ADR 0008)", () => {
    const src = readSource();
    expect(src).toMatch(
      /canCreate\s*=\s*\$derived\(nameValid\s*&&\s*!!parentDir\s*&&\s*presetValid\s*&&\s*!creating\)/
    );
  });
});

describe("NewProjectWizard — ADR 0008 preset choice", () => {
  test("the preset is deliberately NOT preselected, and reset() clears it with the trim fields", () => {
    const src = readSource();
    expect(src).toMatch(/let selectedPreset = \$state<PresetChoice \| null>\(null\)/);
    const resetFn = src.slice(src.indexOf("function reset()"), src.indexOf("function parentDirOf"));
    expect(resetFn).toContain("selectedPreset = null;");
    expect(resetFn).toContain('pageWidth = "";');
    expect(resetFn).toContain('pageHeight = "";');
  });

  test("all three registry presets are offered", () => {
    const src = readSource();
    expect(src).toMatch(/id:\s*"dtrpg"/);
    expect(src).toMatch(/id:\s*"book"/);
    expect(src).toMatch(/id:\s*"custom"/);
  });

  test("choosing custom requires a positive width and height before Create enables", () => {
    const src = readSource();
    expect(src).toMatch(/selectedPreset !== "custom" \|\| customPageValid/);
    expect(src).toMatch(/pageWidthPt > 0/);
    expect(src).toMatch(/pageHeightPt > 0/);
  });

  test("the picker is hidden for saved custom templates (their manifest carries the preset)", () => {
    const src = readSource();
    expect(src).toMatch(/presetApplies = \$derived\(selectedTemplate\?\.kind !== "custom"\)/);
    expect(src).toContain("{#if presetApplies}");
    // presetValid must not block Create when the picker doesn't apply.
    expect(src).toMatch(/presetValid = \$derived\(\s*!presetApplies \|\|/);
  });

  test("create() forwards the preset and the custom trim in points, gated on presetApplies", () => {
    const src = readSource();
    expect(src).toMatch(/preset:\s*presetApplies \? \(selectedPreset \?\? undefined\) : undefined/);
    expect(src).toMatch(/selectedPreset === "custom"\s*\? \{ width: pageWidthPt, height: pageHeightPt \}/);
  });

  test("the custom-trim form explains points and the @page contract", () => {
    const src = readSource();
    expect(src).toContain("72pt = 1in");
    expect(src).toContain("612 × 792");
    expect(src).toMatch(/<code>@page<\/code>/);
  });
});

describe("NewProjectWizard — M20 template-load failure surfaces instead of silently omitting the section", () => {
  test("tracks a templatesError surface separate from the create-flow `error` state", () => {
    const src = readSource();
    expect(src).toMatch(/let templatesError = \$state<string \| null>\(null\)/);
  });

  test("loadTemplates() clears templatesError up front and sets it (not templates = [] silently) on failure", () => {
    const src = readSource();
    const fn = src.slice(
      src.indexOf("async function loadTemplates("),
      src.indexOf("async function importTemplate("),
    );
    // Cleared before the try, so a retry after a prior failure starts clean.
    expect(fn).toMatch(/async function loadTemplates\(\)\s*\{\s*templatesError = null;/);
    const catchBlock = fn.slice(fn.lastIndexOf("} catch {"), fn.lastIndexOf("}"));
    expect(catchBlock).toContain("templates = [];");
    expect(catchBlock).toContain("selectedTemplate = null;");
    expect(catchBlock).toMatch(/templatesError\s*=\s*["'].+["'];/);
  });

  test("the template section renders a Retry (via loadTemplates) instead of vanishing when templates is empty due to an error", () => {
    const src = readSource();
    const templateArea = src.slice(
      src.indexOf("{#if templates.length > 0}"),
      src.indexOf("<div class=\"field\">\n        <span>Where should we save it?</span>"),
    );
    const errorBranchIdx = templateArea.indexOf("{:else if templatesError}");
    expect(errorBranchIdx).toBeGreaterThan(-1);
    const errorBranch = templateArea.slice(errorBranchIdx);
    expect(errorBranch).toContain("Start from a template");
    expect(errorBranch).toContain("{templatesError}");
    expect(errorBranch).toMatch(/onclick=\{loadTemplates\}/);
    expect(errorBranch).toContain(">Retry<");
    expect(errorBranch).toMatch(/role="alert"/);
  });
});
