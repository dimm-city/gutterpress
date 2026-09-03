import { expect, test } from "bun:test";
import { ExtensionsSectionController } from "../../src/lib/routes/extensions-section-controller.svelte";
import type {
  ThemeInfo,
  ApplyThemeTarget,
  ThemeImportResult,
  ProjectPluginEntry,
  PluginValidationResult,
  RecommendedPlugin,
} from "../../src/lib/platform/dtos";
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

const REC_A: RecommendedPlugin = { name: "markdown-it-mark", label: "Highlight", description: "d" };

interface Harness {
  ctrl: ExtensionsSectionController;
  onApplied: ReturnType<typeof spy>;
  afterThemeChange: ReturnType<typeof spy>;
  projectDir: string | null;

  // Look (theme) fakes
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

  // Features (plugin) fakes
  plugins: ProjectPluginEntry[];
  recommended: RecommendedPlugin[];
  validation: PluginValidationResult[];
  setEnabledCalls: Array<{ dir: string; ref: string; enabled: boolean }>;
  addNpmCalls: Array<{ dir: string; name: string; exportName?: string }>;
  failValidate: boolean;
  failAddNpm: boolean;
  cancelAddNpm: boolean;
  addNpmWarnings: string[];
}

function make(
  over: Partial<{
    noProject: boolean;
    builtIns: ThemeInfo[];
    projectThemes: ThemeInfo[];
    plugins: ProjectPluginEntry[];
    recommended: RecommendedPlugin[];
  }> = {},
): Harness {
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
    plugins: over.plugins ?? [{ ref: "markdown-it-mark", kind: "npm", enabled: true }],
    recommended: over.recommended ?? [REC_A],
    validation: [],
    setEnabledCalls: [],
    addNpmCalls: [],
    failValidate: false,
    failAddNpm: false,
    cancelAddNpm: false,
    addNpmWarnings: [],
  } as Harness;
  h.validation = h.plugins.map((p) => ({ ref: p.ref, kind: p.kind, enabled: p.enabled, ok: true }));
  h.ctrl = new ExtensionsSectionController({
    projectDir: () => h.projectDir,

    // Look deps
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

    // Features deps
    listPlugins: () => Promise.resolve(h.plugins),
    recommended: () => Promise.resolve(h.recommended),
    validate: () => {
      if (h.failValidate) return Promise.reject(new Error("validate failed"));
      return Promise.resolve(h.validation);
    },
    setEnabled: (dir, ref, enabled) => {
      h.setEnabledCalls.push({ dir, ref, enabled });
      h.plugins = h.plugins.map((p) => (p.ref === ref ? { ...p, enabled } : p));
      return Promise.resolve({ ok: true });
    },
    addNpm: (dir, name, exportName) => {
      h.addNpmCalls.push({ dir, name, ...(exportName ? { exportName } : {}) });
      if (h.failAddNpm) return Promise.reject(new Error("add failed"));
      if (h.cancelAddNpm) return Promise.resolve(null);
      const entry: ProjectPluginEntry = {
        ref: name,
        kind: "npm",
        enabled: true,
        ...(exportName ? { export: exportName } : {}),
        ...(h.addNpmWarnings.length ? { warnings: h.addNpmWarnings } : {}),
      };
      h.plugins = [...h.plugins, entry];
      return Promise.resolve(entry);
    },
    addLocal: () => Promise.resolve(null),
  });
  return h;
}

// -- Look (ex-appearance-section-controller.test.ts) ------------------------

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
  expect(ctrl.plugins).toEqual([]);
  expect(ctrl.validation).toEqual({});
  expect(ctrl.recommended).toEqual([]);
  expect(ctrl.pluginValidating).toBe(false);
  expect(ctrl.pluginError).toBeNull();
  expect(ctrl.pluginNotice).toBeNull();
  expect(ctrl.pluginBusyRef).toBeNull();
  expect(ctrl.npmName).toBe("");
  expect(ctrl.npmExport).toBe("");
});

test("loadThemes populates built-in + project lists and the active id", async () => {
  const h = make({ projectThemes: [PROJECT_A] });
  h.active = PROJECT_A;
  await h.ctrl.loadThemes();
  expect(h.ctrl.builtIns).toEqual([BUILTIN_A, BUILTIN_B]);
  expect(h.ctrl.projectThemes).toEqual([PROJECT_A]);
  expect(h.ctrl.activeThemeId).toBe("classic");
  // Thumbnails lazy-load in the background - allow the microtask queue to settle.
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
  expect(h.ctrl.themeError).toContain("Enter a URL");
});

test("importThemeUrl trims, imports, clears the draft, and reloads themes", async () => {
  const h = make();
  h.ctrl.themeUrl = "  https://example.com/theme.css  ";
  await h.ctrl.importThemeUrl();
  expect(h.ctrl.themeUrl).toBe("");
  expect(h.ctrl.themeError).toBeNull();
});

// -- #106: file import, revert, hover preview --------------------------------

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

// -- Features (ex-plugins-section-controller.test.ts) ------------------------

test("loadPlugins populates the configured list, recommended list, and validation map", async () => {
  const h = make();
  await h.ctrl.loadPlugins();
  expect(h.ctrl.plugins).toEqual(h.plugins);
  expect(h.ctrl.recommended).toEqual([REC_A]);
  expect(h.ctrl.validation["markdown-it-mark"]).toEqual({ ref: "markdown-it-mark", kind: "npm", enabled: true, ok: true });
  expect(h.ctrl.pluginValidating).toBe(false);
});

test("loadPlugins no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadPlugins();
  expect(h.ctrl.plugins).toEqual([]);
});

test("a failed validate surfaces pluginError via loadPlugins' awaited validatePlugins", async () => {
  const h = make();
  h.failValidate = true;
  await h.ctrl.loadPlugins();
  expect(h.ctrl.plugins).toEqual(h.plugins); // the list load itself still succeeded
  expect(h.ctrl.pluginError).toContain("validate failed");
  expect(h.ctrl.pluginValidating).toBe(false);
});

test("togglePlugin flips enabled and reloads", async () => {
  const h = make();
  await h.ctrl.loadPlugins();
  await h.ctrl.togglePlugin(h.ctrl.plugins[0]);
  expect(h.setEnabledCalls).toEqual([{ dir: "/proj", ref: "markdown-it-mark", enabled: false }]);
  expect(h.ctrl.plugins[0].enabled).toBe(false);
  expect(h.ctrl.pluginBusyRef).toBeNull();
});

test("addNpmPlugin rejects a blank name without calling the host", async () => {
  const h = make();
  h.ctrl.npmName = "   ";
  await h.ctrl.addNpmPlugin();
  expect(h.ctrl.pluginError).toContain("Enter an npm package name");
  expect(h.addNpmCalls.length).toBe(0);
});

test("addNpmPlugin trims, adds, clears the draft, and reloads", async () => {
  const h = make({ plugins: [] });
  h.ctrl.npmName = "  markdown-it-footnote  ";
  await h.ctrl.addNpmPlugin();
  expect(h.addNpmCalls).toEqual([{ dir: "/proj", name: "markdown-it-footnote" }]);
  expect(h.ctrl.npmName).toBe("");
  expect(h.ctrl.plugins.some((p) => p.ref === "markdown-it-footnote")).toBe(true);
});

test("addNpmPlugin forwards and clears an optional named export", async () => {
  const h = make({ plugins: [] });
  h.ctrl.npmName = "markdown-it-emoji@3.0.0";
  h.ctrl.npmExport = "  full  ";

  await h.ctrl.addNpmPlugin();

  expect(h.addNpmCalls).toEqual([{
    dir: "/proj",
    name: "markdown-it-emoji@3.0.0",
    exportName: "full",
  }]);
  expect(h.ctrl.npmName).toBe("");
  expect(h.ctrl.npmExport).toBe("");
});

test("a failed addNpmPlugin surfaces pluginError and keeps the busy ref cleared", async () => {
  const h = make({ plugins: [] });
  h.failAddNpm = true;
  h.ctrl.npmName = "bad-pkg";
  await h.ctrl.addNpmPlugin();
  expect(h.ctrl.pluginError).toContain("add failed");
  expect(h.ctrl.pluginBusyRef).toBeNull();
});

test("cancelling native npm confirmation keeps the draft and does not reload", async () => {
  const h = make({ plugins: [] });
  h.cancelAddNpm = true;
  h.ctrl.npmName = "markdown-it-highlightjs";
  await h.ctrl.addNpmPlugin();
  expect(h.ctrl.npmName).toBe("markdown-it-highlightjs");
  expect(h.ctrl.plugins).toEqual([]);
  expect(h.ctrl.pluginError).toBeNull();
});

test("a non-fatal installer warning is surfaced after a successful add", async () => {
  const h = make({ plugins: [] });
  h.addNpmWarnings = ["Registry provided legacy SHA-1 integrity."];
  h.ctrl.npmName = "old-plugin";
  await h.ctrl.addNpmPlugin();
  expect(h.ctrl.pluginNotice).toContain("legacy SHA-1");
});

test("addRecommended adds the recommendation's package name", async () => {
  const h = make({ plugins: [] });
  await h.ctrl.addRecommended(REC_A);
  expect(h.addNpmCalls).toEqual([{ dir: "/proj", name: "markdown-it-mark" }]);
});

// -- #243: one controller owns both halves -----------------------------------

test("loadExtensions loads both the look and the features data in one call", async () => {
  const h = make({ projectThemes: [PROJECT_A] });
  h.active = PROJECT_A;
  await h.ctrl.loadExtensions();
  expect(h.ctrl.builtIns).toEqual([BUILTIN_A, BUILTIN_B]);
  expect(h.ctrl.projectThemes).toEqual([PROJECT_A]);
  expect(h.ctrl.activeThemeId).toBe("classic");
  expect(h.ctrl.plugins).toEqual(h.plugins);
  expect(h.ctrl.recommended).toEqual([REC_A]);
});
