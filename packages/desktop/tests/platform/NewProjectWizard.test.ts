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
    expect(src).toContain("onchange={() => selectTemplate(tpl)}");
    expect(src).not.toMatch(/on(click|change)=\{\(\) => \(selectedTemplate = tpl\)\}/);
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
    expect(src).toContain("api.doctor()");
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
    const templateStart = src.indexOf("{#if templates.length > 0}");
    const templateEnd = src.indexOf("What are you designing it for?", templateStart);
    // Both bounds must exist, or the slice below would silently cover the wrong text.
    expect(templateStart).toBeGreaterThan(-1);
    expect(templateEnd).toBeGreaterThan(templateStart);
    const templateArea = src.slice(templateStart, templateEnd);
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

/**
 * The text between two markers. Both must exist: a missing end marker would
 * make `slice(start, -1)` quietly cover the wrong region and let a test pass.
 */
function between(src: string, start: string | RegExp, end: string | RegExp, from = 0): string {
  const find = (m: string | RegExp, at: number): { index: number; length: number } => {
    if (typeof m === "string") return { index: src.indexOf(m, at), length: m.length };
    const hit = m.exec(src.slice(at));
    return hit ? { index: at + hit.index, length: hit[0].length } : { index: -1, length: 0 };
  };
  const s = find(start, from);
  expect(s.index).toBeGreaterThan(-1);
  const e = find(end, s.index + s.length);
  expect(e.index).toBeGreaterThan(-1);
  return src.slice(s.index, e.index);
}

describe("NewProjectWizard — #312 three short steps", () => {
  test("asks in three steps, with an indicator that marks the current one", () => {
    const src = readSource();
    expect(src).toContain('const STEPS = ["Name & author", "Template", "Print & save"];');
    expect(src).toContain("const LAST_STEP = STEPS.length - 1;");
    expect(src).toContain('<ol class="steps"');
    expect(src).toContain('aria-current={step === i ? "step" : undefined}');
  });

  test("each question lives on its own step: name+author, then template, then print target / publish / save", () => {
    const src = readSource();
    const step1 = between(src, "{#if step === 0}", "{:else if step === 1}");
    expect(step1).toContain('id="np-name"');
    expect(step1).toContain('id="np-author"');
    expect(step1).not.toContain("Start from a template");

    const step2 = between(src, "{:else if step === 1}", /\{:else\}\s*<div class="field">\s*<span>What are you designing it for\?/);
    expect(step2).toContain("Start from a template");
    expect(step2).toContain("Import template from folder…");
    expect(step2).not.toContain("What are you designing it for?");

    const step3 = between(src, /\{:else\}\s*<div class="field">\s*<span>What are you designing it for\?/, "{#if error}");
    expect(step3).toContain("What are you designing it for?");
    expect(step3).toContain("Where will you publish it?");
    expect(step3).toContain("Where should we save it?");
    expect(step3).toContain("Keep a history of my changes");
  });

  test("the footer is pinned outside the scrolling body, so Create can't fall below the fold", () => {
    const src = readSource();
    // The body closes, then the error line, then the footer — the footer is not nested in `.dialog-body`.
    expect(src).toMatch(
      /<\/div>\s*\{#if error\}\s*<p class="error" role="alert">\{error\}<\/p>\s*\{\/if\}\s*<footer class="dlg-actions">/,
    );
    // The old in-flow overrides are gone, so the shared pinned-bar geometry applies as-is.
    const style = src.slice(src.indexOf("<style>"));
    expect(style).not.toMatch(/\.dlg-actions\s*\{/);
    expect(style).not.toMatch(/\.dlg-actions button\s*\{/);
  });

  test("the footer offers Back/Cancel and Next/Create by step — Create only on the last step", () => {
    const src = readSource();
    const footer = between(src, '<footer class="dlg-actions">', "</footer>");
    expect(footer).toMatch(
      /\{#if step > 0\}\s*<button class="dlg-ghost" onclick=\{back\} disabled=\{creating\}>Back<\/button>\s*\{:else\}\s*<button class="dlg-ghost" onclick=\{close\} disabled=\{creating\}>Cancel<\/button>/,
    );
    expect(footer).toMatch(
      /\{#if step < LAST_STEP\}\s*<button class="dlg-primary app-btn-primary" onclick=\{next\}>Next<\/button>\s*\{:else\}\s*<button class="dlg-primary app-btn-primary" onclick=\{create\} disabled=\{!canCreate\}>/,
    );
  });

  test("Next validates the title before leaving step 1 and says why on that step", () => {
    const src = readSource();
    const fn = between(src, "function next()", "function back()");
    expect(fn).toMatch(/if \(step === 0 && !nameValid\) \{[\s\S]*?error = /);
    // It returns before moving on, so an invalid title can't be skipped.
    expect(fn.indexOf("return;")).toBeGreaterThan(-1);
    expect(fn.indexOf("return;")).toBeLessThan(fn.indexOf("void goTo(step + 1)"));
    // A symbols-only title (empty slug) gets its own reason rather than "give a title".
    expect(fn).toContain("The title needs at least one letter or number.");
    // The caret goes back to the title, so the message and the field read as one.
    expect(fn).toContain('bodyEl?.querySelector<HTMLElement>("#np-name")?.focus();');
  });

  test("Enter in the title and author fields advances instead of creating", () => {
    const src = readSource();
    const fn = between(src, "function advanceOnEnter(", "async function create(");
    expect(fn).toContain("next();");
    expect(fn).not.toContain("create()");
    expect(src.match(/onkeydown=\{advanceOnEnter\}/g)?.length).toBe(2);
    // The old Enter-creates handler must not survive on either field.
    expect(src).not.toMatch(/e\.key === "Enter" && canCreate/);
  });

  test("a stale title error clears as the writer types and when they change step", () => {
    const src = readSource();
    expect(between(src, 'id="np-name"', "/>")).toContain("oninput={() => (error = null)}");
    expect(between(src, "async function goTo(", "function next()")).toContain("error = null;");
  });

  test("changing step keeps focus inside the dialog (the focused control unmounts with its step)", () => {
    const src = readSource();
    expect(src).toMatch(/import\s*\{[^}]*FOCUSABLE[^}]*\}\s*from\s*["']\$lib\/dialog["']/);
    const fn = between(src, "async function goTo(", "function next()");
    expect(fn).toContain("await tick();");
    // Prefer the step's selected card, else its first control.
    expect(fn).toContain('"input[type=radio]:checked"');
    expect(fn).toContain("FOCUSABLE");
    expect(fn).toMatch(/\.focus\(\)/);
  });

  test("reset() returns to the first step", () => {
    const src = readSource();
    expect(between(src, "function reset()", "function loadAuthorDefault")).toContain("step = 0;");
  });
});

describe("NewProjectWizard — #312 selectable cards", () => {
  test("template and preset cards are native radios in labelled radiogroups", () => {
    const src = readSource();
    expect(src.match(/role="radiogroup"/g)?.length).toBe(2);
    expect(src).toContain('aria-label="Project template"');
    expect(src).toContain('aria-label="Book preset"');
    expect(src).toMatch(/type="radio"\s+class="dlg-sr-only"\s+name="np-template"\s+checked=\{picked\}/);
    expect(src).toMatch(/type="radio"\s+class="dlg-sr-only"\s+name="np-preset"\s+checked=\{picked\}/);
    // The old click-only <button role="radio"> cards had no arrow-key selection.
    expect(src).not.toContain('role="radio"');
  });

  test("the selected card is filled and carries a check mark, not just a border", () => {
    const src = readSource();
    expect(src.match(/\{#if picked\}<span class="template-check"><Icon name="check"/g)?.length).toBe(2);
    const style = src.slice(src.indexOf("<style>"));
    const selected = between(style, ".template-card.selected {", "}");
    expect(selected).toContain("background: var(--app-accent-subtle)");
    expect(selected).toContain("border-color: var(--app-accent-border)");
    // The input is visually hidden, so keyboard focus is shown on the card.
    expect(style).toContain(".template-card:has(input:focus-visible)");
  });
});

describe("NewProjectWizard — #312 in-body secondary buttons", () => {
  test("Change…/Choose folder… and Import share one styled ghost button, not a bare native one", () => {
    const src = readSource();
    expect(src).toMatch(/class="dlg-ghost body-btn browse" onclick=\{chooseLocation\}/);
    expect(src).toMatch(/class="dlg-ghost body-btn" onclick=\{importTemplate\}/);
    expect(src).not.toContain("import-tpl");
    const style = src.slice(src.indexOf("<style>"));
    // `.dlg-ghost` only supplies colours; outside `.dlg-actions` the border width/style
    // must be restated or the button renders with the native bevelled border.
    const body = between(style, ".body-btn {", "}");
    expect(body).toContain("border-width: 1px;");
    expect(body).toContain("border-style: solid;");
  });
});
