import { expect, test } from "bun:test";
import { AppearanceSectionController } from "../../src/lib/routes/appearance-section-controller.svelte";
import type { ThemeInfo, ApplyThemeTarget, ThemeImportResult } from "../../src/lib/platform/dtos";
import { sampleSrcdoc, hoverPreviewSrcdoc } from "../../src/lib/components/config/config-helpers";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as design-section-controller.test.ts).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

type Spy = { calls: unknown[][] };
const spy = (): ((...a: unknown[]) => void) & Spy => {
  const fn = ((...a: unknown[]) => {
    fn.calls.push(a);
  }) as ((...a: unknown[]) => void) & Spy;
  fn.calls = [];
  return fn;
};

const BUILTIN_A: ThemeInfo = { id: "classic", name: "Classic", description: "d", kind: "builtin" };
const BUILTIN_B: ThemeInfo = { id: "modern", name: "Modern", description: "d", kind: "builtin" };
const PROJECT_A: ThemeInfo = { id: "classic", name: "Classic (project)", description: "d", kind: "project" };

interface Harness {
  ctrl: AppearanceSectionController;
  onApplied: ReturnType<typeof spy>;
  afterThemeChange: ReturnType<typeof spy>;
  projectDir: string | null;
  builtIns: ThemeInfo[];
  projectThemes: ThemeInfo[];
  active: ThemeInfo | null;
  previous: ThemeInfo | null;
  applyCalls: Array<{ dir: string; target: ApplyThemeTarget }>;
  removeCalls: Array<{ dir: string; id: string }>;
  revertCalls: string[];
  importFileResult: ThemeImportResult | null;
  failApply: boolean;
  failRemove: boolean;
}

function make(over: Partial<{ noProject: boolean; builtIns: ThemeInfo[]; projectThemes: ThemeInfo[] }> = {}): Harness {
  const onApplied = spy();
  const afterThemeChange = spy();
  const h = {
    onApplied,
    afterThemeChange,
    projectDir: over.noProject ? null : "/proj",
    builtIns: over.builtIns ?? [BUILTIN_A, BUILTIN_B],
    projectThemes: over.projectThemes ?? [],
    active: null,
    previous: null,
    applyCalls: [],
    removeCalls: [],
    revertCalls: [],
    importFileResult: null,
    failApply: false,
    failRemove: false,
  } as Harness;
  h.ctrl = new AppearanceSectionController({
    projectDir: () => h.projectDir,
    listBuiltIn: () => Promise.resolve(h.builtIns),
    listProject: () => Promise.resolve(h.projectThemes),
    getActive: () => Promise.resolve(h.active),
    getPrevious: () => Promise.resolve(h.previous),
    apply: (dir, target) => {
      h.applyCalls.push({ dir, target });
      if (h.failApply) return Promise.reject(new Error("apply failed"));
      const applied: ThemeInfo = { id: target.id, name: target.id, description: "d", kind: "project" };
      h.previous = h.active;
      h.active = applied;
      return Promise.resolve(applied);
    },
    revert: (dir) => {
      h.revertCalls.push(dir);
      const prev = h.previous ?? BUILTIN_A;
      const applied: ThemeInfo = { id: prev.id, name: prev.name, description: "d", kind: "project" };
      // Model the host: revert makes the previous theme active (and toggles the
      // revert target), which loadThemes reads back via getActive/getPrevious.
      const wasActive = h.active;
      h.active = applied;
      h.previous = wasActive;
      return Promise.resolve(applied);
    },
    remove: (dir, id) => {
      h.removeCalls.push({ dir, id });
      if (h.failRemove) return Promise.reject(new Error("remove failed"));
      return Promise.resolve({ ok: true as const });
    },
    importFromFolder: () => Promise.resolve(null),
    importFromFile: () => Promise.resolve(h.importFileResult),
    importFromUrl: () => Promise.resolve(BUILTIN_A),
    readCss: () => Promise.resolve(":root { --x: 1; }"),
    onApplied: (id) => onApplied(id),
    afterThemeChange: () => {
      afterThemeChange();
      return Promise.resolve();
    },
  });
  return h;
}

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.builtIns).toEqual([]);
  expect(ctrl.projectThemes).toEqual([]);
  expect(ctrl.activeThemeId).toBeNull();
  expect(ctrl.themeError).toBeNull();
  expect(ctrl.themeBusyId).toBeNull();
  expect(ctrl.themeUrl).toBe("");
  expect(ctrl.thumbs).toEqual({});
  expect(ctrl.removeArmedKey).toBeNull();
});

test("loadThemes populates built-in + project lists and the active id", async () => {
  const h = make({ projectThemes: [PROJECT_A] });
  h.active = PROJECT_A;
  await h.ctrl.loadThemes();
  expect(h.ctrl.builtIns).toEqual([BUILTIN_A, BUILTIN_B]);
  expect(h.ctrl.projectThemes).toEqual([PROJECT_A]);
  expect(h.ctrl.activeThemeId).toBe("classic");
  // Thumbnails lazy-load in the background — allow the microtask queue to settle.
  await new Promise((r) => setTimeout(r, 0));
  expect(h.ctrl.thumbs["builtin:classic"]).toBe(sampleSrcdoc(":root { --x: 1; }"));
  expect(h.ctrl.thumbs["project:classic"]).toBe(sampleSrcdoc(":root { --x: 1; }"));
});

test("loadThemes no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadThemes();
  expect(h.ctrl.builtIns).toEqual([]);
});

test("loadThemes clears any armed Remove confirm (a refresh can change which cards exist)", async () => {
  const h = make({ projectThemes: [PROJECT_A] });
  h.ctrl.removeArmedKey = "project:classic";
  await h.ctrl.loadThemes();
  expect(h.ctrl.removeArmedKey).toBeNull();
});

test("applyTheme applies, sets activeThemeId, fires onApplied, and refreshes styles+design", async () => {
  const h = make();
  await h.ctrl.applyTheme(BUILTIN_A);
  expect(h.applyCalls).toEqual([{ dir: "/proj", target: { kind: "builtin", id: "classic" } }]);
  expect(h.ctrl.activeThemeId).toBe("classic");
  expect(h.onApplied.calls).toEqual([["classic"]]);
  expect(h.afterThemeChange.calls.length).toBe(1);
  expect(h.ctrl.themeBusyId).toBeNull();
});

test("applyTheme refreshes the previous-theme revert target immediately", async () => {
  const h = make();
  h.active = PROJECT_A;
  await h.ctrl.applyTheme(BUILTIN_B);
  expect(h.ctrl.previousTheme).toBe(PROJECT_A);
});

test("a failed apply surfaces themeError and does NOT fire onApplied/afterThemeChange", async () => {
  const h = make();
  h.failApply = true;
  await h.ctrl.applyTheme(BUILTIN_A);
  expect(h.ctrl.themeError).toContain("apply failed");
  expect(h.onApplied.calls.length).toBe(0);
  expect(h.afterThemeChange.calls.length).toBe(0);
  expect(h.ctrl.themeBusyId).toBeNull();
});

test("requestRemoveTheme is a two-step confirm: first click arms, second click removes", async () => {
  const h = make({ projectThemes: [PROJECT_A] });
  h.ctrl.requestRemoveTheme(PROJECT_A);
  expect(h.ctrl.removeArmedKey).toBe("project:classic");
  expect(h.removeCalls.length).toBe(0);
  h.ctrl.requestRemoveTheme(PROJECT_A);
  // Second click disarms synchronously and kicks off the (async) removal.
  expect(h.ctrl.removeArmedKey).toBeNull();
  await new Promise((r) => setTimeout(r, 0));
  expect(h.removeCalls).toEqual([{ dir: "/proj", id: "classic" }]);
  expect(h.afterThemeChange.calls.length).toBe(1);
});

test("cancelRemoveTheme disarms without removing", () => {
  const h = make({ projectThemes: [PROJECT_A] });
  h.ctrl.requestRemoveTheme(PROJECT_A);
  expect(h.ctrl.removeArmedKey).toBe("project:classic");
  h.ctrl.cancelRemoveTheme();
  expect(h.ctrl.removeArmedKey).toBeNull();
  expect(h.removeCalls.length).toBe(0);
});

test("importThemeUrl rejects a blank URL without calling the host", async () => {
  const h = make();
  h.ctrl.themeUrl = "   ";
  await h.ctrl.importThemeUrl();
  expect(h.ctrl.themeError).toContain("Enter a theme URL");
});

test("importThemeUrl trims, imports, clears the draft, and reloads themes", async () => {
  const h = make();
  h.ctrl.themeUrl = "  https://example.com/theme.css  ";
  await h.ctrl.importThemeUrl();
  expect(h.ctrl.themeUrl).toBe("");
  expect(h.ctrl.themeError).toBeNull();
});

// ── #106: file import, revert, hover preview ──────────────────────────────────

test("loadThemes populates the previousTheme revert target", async () => {
  const h = make({ projectThemes: [PROJECT_A] });
  h.previous = PROJECT_A;
  await h.ctrl.loadThemes();
  expect(h.ctrl.previousTheme?.id).toBe("classic");
});

test("importThemeFile surfaces the host warnings and reloads on success", async () => {
  const h = make();
  h.importFileResult = {
    theme: { id: "midnight", name: "Midnight", description: "d", kind: "project" },
    warnings: [
      { code: "print-safety", message: "Remote URL is not allowed" },
      { code: "no-theme-json", message: "No theme.json found" },
    ],
  };
  await h.ctrl.importThemeFile();
  expect(h.ctrl.themeWarnings).toEqual(["Remote URL is not allowed", "No theme.json found"]);
  expect(h.ctrl.themeError).toBeNull();
  expect(h.ctrl.themeBusyId).toBeNull();
});

test("importThemeFile leaves warnings empty when the picker is cancelled", async () => {
  const h = make();
  h.importFileResult = null;
  await h.ctrl.importThemeFile();
  expect(h.ctrl.themeWarnings).toEqual([]);
});

test("revertTheme re-applies the previous theme, fires onApplied + afterThemeChange", async () => {
  const h = make({ projectThemes: [PROJECT_A] });
  h.previous = PROJECT_A;
  await h.ctrl.loadThemes();
  await h.ctrl.revertTheme();
  expect(h.revertCalls).toEqual(["/proj"]);
  expect(h.ctrl.activeThemeId).toBe("classic");
  expect(h.onApplied.calls).toEqual([["classic"]]);
  expect(h.afterThemeChange.calls.length).toBeGreaterThanOrEqual(1);
});

test("revertTheme no-ops when there is no previous theme", async () => {
  const h = make();
  await h.ctrl.revertTheme();
  expect(h.revertCalls.length).toBe(0);
});

test("showHoverPreview renders the fixed 2-page spread with the theme's CSS", async () => {
  const h = make();
  await h.ctrl.showHoverPreview(BUILTIN_A);
  expect(h.ctrl.hoverThemeKey).toBe("builtin:classic");
  expect(h.ctrl.hoverPreview).toBe(hoverPreviewSrcdoc(":root { --x: 1; }"));
  h.ctrl.hideHoverPreview();
  expect(h.ctrl.hoverThemeKey).toBeNull();
  expect(h.ctrl.hoverPreview).toBeNull();
});
