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
    expect(src).toContain("getDesktopPrefs()");
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

describe("NewProjectWizard — ADR 0008 template drives preset + targets", () => {
  test("the template section is rendered ABOVE the preset and target sections", () => {
    const src = readSource();
    const tplIdx = src.indexOf("Start from a template");
    const presetIdx = src.indexOf("What are you designing it for?");
    const targetIdx = src.indexOf("Where will you publish it?");
    expect(tplIdx).toBeGreaterThan(-1);
    expect(tplIdx).toBeLessThan(presetIdx);
    expect(presetIdx).toBeLessThan(targetIdx);
  });

  test("choosing a template seeds the preset and targets from the template's own manifest", () => {
    const src = readSource();
    // Every template click routes through selectTemplate (never a bare
    // assignment), so the seeding can't be bypassed by a new call site.
    expect(src).toContain("onclick={() => selectTemplate(tpl)}");
    expect(src).not.toMatch(/onclick=\{\(\) => \(selectedTemplate = tpl\)\}/);
    const fn = src.slice(src.indexOf("function selectTemplate("), src.indexOf("async function importTemplate("));
    expect(fn).toContain("selectedTemplate = tpl;");
    expect(fn).toContain("const preset = tpl?.preset;");
    expect(fn).toContain("templateTargets = tpl?.targets ?? null;");
    // A stale writer-touched selection must not survive a template change.
    expect(fn).toContain("targetsTouched = false;");
  });

  test("an unrecognised template preset leaves the choice unmade rather than guessing", () => {
    const src = readSource();
    const fn = src.slice(src.indexOf("function selectTemplate("), src.indexOf("async function importTemplate("));
    expect(fn).toMatch(/preset === "dtrpg" \|\| preset === "book" \|\| preset === "custom" \? preset : null/);
  });

  test("all three registry presets are offered, and Create needs a valid one", () => {
    const src = readSource();
    expect(src).toMatch(/id:\s*"dtrpg"/);
    expect(src).toMatch(/id:\s*"book"/);
    expect(src).toMatch(/id:\s*"custom"/);
    expect(src).toMatch(
      /canCreate\s*=\s*\$derived\(nameValid\s*&&\s*!!parentDir\s*&&\s*presetValid\s*&&\s*!creating\)/
    );
    expect(src).toMatch(/selectedPreset !== "custom" \|\| customPagePoints !== null/);
  });

  test("a saved custom template keeps its captured design by pre-filling, not by hiding the pickers", () => {
    const src = readSource();
    // The old presetApplies gate is gone: what the dialog shows is what gets
    // written, for built-in and saved templates alike.
    expect(src).not.toContain("presetApplies");
    expect(src).toMatch(/preset:\s*selectedPreset \?\? undefined/);
    expect(src).toMatch(/targets:\s*\[\.\.\.effectiveTargets\]/);
  });

  test("reset() clears the template-seeded choices with the rest of the form", () => {
    const src = readSource();
    const resetFn = src.slice(src.indexOf("function reset()"), src.indexOf("function loadAuthorDefault"));
    expect(resetFn).toContain("selectedPreset = null;");
    expect(resetFn).toContain("templateTargets = null;");
    expect(resetFn).toContain("targetsTouched = false;");
    expect(resetFn).toContain("checkedTargets = [];");
  });
});

describe("NewProjectWizard — ADR 0008 page size in inches", () => {
  test("common trim sizes are offered as exact point values", () => {
    const src = readSource();
    // Named sizes carry POINTS, not inches: A4/A5 are not round inch numbers,
    // so converting them would land 595.44pt instead of the real 595.
    expect(src).toMatch(/id: "letter".*points: \{ width: 612, height: 792 \}/);
    expect(src).toMatch(/id: "trade".*points: \{ width: 432, height: 648 \}/);
    expect(src).toMatch(/id: "a4".*points: \{ width: 595, height: 842 \}/);
    expect(src).toMatch(/id: "custom".*points: null/);
  });

  test("a free-form size is typed in INCHES and converted to points", () => {
    const src = readSource();
    expect(src).toContain("const PT_PER_INCH = 72;");
    expect(src).toContain("<span>Width (in)</span>");
    expect(src).toContain("<span>Height (in)</span>");
    expect(src).toMatch(/width: Math\.round\(widthInNum \* PT_PER_INCH \* 1000\) \/ 1000/);
    // The inputs only appear for the "my own size" option.
    expect(src).toContain('{#if sizeChoice === "custom"}');
  });

  test("the size hint still ties the page size to the stylesheet's @page", () => {
    const src = readSource();
    expect(src).toMatch(/<code>@page<\/code>/);
  });
});

describe("NewProjectWizard — ADR 0008 publish targets", () => {
  test("the choices and tool-gap copy come from the shared module, not a local copy", () => {
    const src = readSource();
    expect(src).toMatch(/import \{[\s\S]*?PUBLISH_TARGET_CHOICES[\s\S]*?\} from "\$lib\/publish-targets"/);
    expect(src).toContain("const TARGET_CHOICES = PUBLISH_TARGET_CHOICES;");
    expect(src).toMatch(/toolGapMessage\(missingToolsForTargets\(effectiveTargets, missingTools\)\)/);
  });

  test("checkbox defaults follow the template's targets, then the preset's, until touched", () => {
    const src = readSource();
    expect(src).toMatch(
      /effectiveTargets = \$derived\(\s*targetsTouched \? checkedTargets : \(templateTargets \?\? defaultTargetsFor\(selectedPreset\)\)/
    );
    // First touch seeds from what is currently shown, so unchecking one box
    // doesn't wipe the others.
    expect(src).toContain("const base = effectiveTargets;");
  });

  test("the missing-tool probe reads real doctor data for the print tools", () => {
    const src = readSource();
    expect(src).toContain("getDoctorDiagnostics()");
    expect(src).toContain("PRINT_TOOL_IDS.includes(t.id)");
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
    expect(catchBlock).toContain("selectTemplate(null);");
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
