import { expect, test } from "bun:test";
import { PluginsSectionController } from "../../src/lib/routes/plugins-section-controller.svelte";
import type { ProjectPluginEntry, PluginValidationResult, RecommendedPlugin } from "../../src/lib/platform/dtos";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as design-section-controller.test.ts).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

const REC_A: RecommendedPlugin = { name: "markdown-it-mark", label: "Highlight", description: "d" };

interface Harness {
  ctrl: PluginsSectionController;
  projectDir: string | null;
  plugins: ProjectPluginEntry[];
  recommended: RecommendedPlugin[];
  validation: PluginValidationResult[];
  setEnabledCalls: Array<{ dir: string; ref: string; enabled: boolean }>;
  addNpmCalls: Array<{ dir: string; name: string }>;
  failValidate: boolean;
  failAddNpm: boolean;
}

function make(over: Partial<{ noProject: boolean; plugins: ProjectPluginEntry[]; recommended: RecommendedPlugin[] }> = {}): Harness {
  const h = {
    projectDir: over.noProject ? null : "/proj",
    plugins: over.plugins ?? [{ ref: "markdown-it-mark", kind: "npm", enabled: true }],
    recommended: over.recommended ?? [REC_A],
    validation: [],
    setEnabledCalls: [],
    addNpmCalls: [],
    failValidate: false,
    failAddNpm: false,
  } as Harness;
  h.validation = h.plugins.map((p) => ({ ref: p.ref, kind: p.kind, enabled: p.enabled, ok: true }));
  h.ctrl = new PluginsSectionController({
    projectDir: () => h.projectDir,
    list: () => Promise.resolve(h.plugins),
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
    addNpm: (dir, name) => {
      h.addNpmCalls.push({ dir, name });
      if (h.failAddNpm) return Promise.reject(new Error("add failed"));
      const entry: ProjectPluginEntry = { ref: name, kind: "npm", enabled: true };
      h.plugins = [...h.plugins, entry];
      return Promise.resolve(entry);
    },
    addLocal: () => Promise.resolve(null),
  });
  return h;
}

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.plugins).toEqual([]);
  expect(ctrl.validation).toEqual({});
  expect(ctrl.recommended).toEqual([]);
  expect(ctrl.pluginValidating).toBe(false);
  expect(ctrl.pluginError).toBeNull();
  expect(ctrl.pluginBusyRef).toBeNull();
  expect(ctrl.npmName).toBe("");
});

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

test("a failed addNpmPlugin surfaces pluginError and keeps the busy ref cleared", async () => {
  const h = make({ plugins: [] });
  h.failAddNpm = true;
  h.ctrl.npmName = "bad-pkg";
  await h.ctrl.addNpmPlugin();
  expect(h.ctrl.pluginError).toContain("add failed");
  expect(h.ctrl.pluginBusyRef).toBeNull();
});

test("addRecommended adds the recommendation's package name", async () => {
  const h = make({ plugins: [] });
  await h.ctrl.addRecommended(REC_A);
  expect(h.addNpmCalls).toEqual([{ dir: "/proj", name: "markdown-it-mark" }]);
});
