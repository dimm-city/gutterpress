import { expect, test } from "bun:test";
import { ExtensionsSectionController } from "../../src/lib/routes/extensions-section-controller.svelte";
import type {
  ProjectExtensionEntry,
  ExtensionValidationResult,
  RecommendedExtension,
  BuiltInStyleSet,
  ExtensionImportResult,
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

/** Flush the microtask/macrotask queue so background thumbnail loads settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

const NONE = { markdown: false, styles: false, snippets: false, components: false };
const STYLES = { ...NONE, styles: true };
const MARKDOWN = { ...NONE, markdown: true };

function entry(over: Partial<ProjectExtensionEntry> & { use: string }): ProjectExtensionEntry {
  return { kind: "path", name: over.use, enabled: true, label: over.use, carries: NONE, ...over };
}

// ONE list, several shapes: two looks the author owns, a bundled feature, a
// component library that carries both, and a missing folder carrying nothing.
const LOOK_A = entry({ use: "./extensions/clean-book", label: "Clean Book", carries: STYLES, dir: "/proj/extensions/clean-book", styles: ["theme.css"] });
const LOOK_B = entry({ use: "./extensions/zine", label: "Zine", carries: STYLES, dir: "/proj/extensions/zine", styles: ["theme.css"] });
const FEATURE = entry({ use: "markdown-it-mark", kind: "bundled", label: "Highlight", carries: MARKDOWN });
const BOTH = entry({ use: "../shared/house", label: "House", carries: { markdown: true, styles: true, snippets: true, components: false }, dir: "/shared/house", styles: ["theme.css"] });
const BROKEN = entry({ use: "./missing", label: "missing", warnings: ["Not found: /proj/missing"] });

const REC_MARK: RecommendedExtension = { use: "markdown-it-mark", label: "Highlight", description: "d" };
const REC_SUB: RecommendedExtension = { use: "markdown-it-sub", label: "Subscript", description: "d" };
const BUILTIN_CLEAN: BuiltInStyleSet = { id: "clean-book", name: "Clean Book", description: "d" };
const BUILTIN_ZINE: BuiltInStyleSet = { id: "zine", name: "Zine", description: "d" };

interface Harness {
  ctrl: ExtensionsSectionController;
  projectDir: string | null;
  entries: ProjectExtensionEntry[];
  recommended: RecommendedExtension[];
  builtIns: BuiltInStyleSet[];
  validation: ExtensionValidationResult[];
  /** Every host call, in order — `list` included, so "did it reload" is observable. */
  calls: Array<{ name: string; args: unknown[] }>;
  failValidate: boolean;
  failAdd: boolean;
  cancelAdd: boolean;
  addWarnings: string[];
  addLocalResult: ProjectExtensionEntry | null;
  importFileResult: ExtensionImportResult | null;
  onLookAdded: ReturnType<typeof spy>;
  afterLookChange: ReturnType<typeof spy>;
}

function make(
  over: Partial<{
    noProject: boolean;
    entries: ProjectExtensionEntry[];
    recommended: RecommendedExtension[];
    builtIns: BuiltInStyleSet[];
  }> = {},
): Harness {
  const onLookAdded = spy();
  const afterLookChange = spy();
  const h = {
    onLookAdded,
    afterLookChange,
    projectDir: over.noProject ? null : "/proj",
    entries: over.entries ?? [LOOK_A, FEATURE],
    recommended: over.recommended ?? [REC_MARK, REC_SUB],
    builtIns: over.builtIns ?? [BUILTIN_CLEAN, BUILTIN_ZINE],
    validation: [],
    calls: [],
    failValidate: false,
    failAdd: false,
    cancelAdd: false,
    addWarnings: [],
    addLocalResult: null,
    importFileResult: null,
  } as Harness;
  const record = (name: string, ...args: unknown[]) => h.calls.push({ name, args });
  const named = (n: string) => h.calls.filter((c) => c.name === n);
  (h as Harness & { named: typeof named }).named = named;

  h.ctrl = new ExtensionsSectionController({
    projectDir: () => h.projectDir,
    list: () => {
      record("list");
      return Promise.resolve(h.entries);
    },
    recommended: () => Promise.resolve(h.recommended),
    listBuiltIn: () => Promise.resolve(h.builtIns),
    validate: () => {
      if (h.failValidate) return Promise.reject(new Error("validate failed"));
      return Promise.resolve(
        h.entries.map((e) => ({ use: e.use, kind: e.kind, enabled: e.enabled, ok: true })),
      );
    },
    add: (dir, specifier, exportName) => {
      record("add", dir, specifier, exportName);
      if (h.failAdd) return Promise.reject(new Error("add failed"));
      if (h.cancelAdd) return Promise.resolve(null);
      const added = entry({
        use: specifier,
        kind: specifier.startsWith("./") ? "path" : "npm",
        label: specifier,
        carries: MARKDOWN,
        ...(exportName ? { export: exportName } : {}),
        ...(h.addWarnings.length ? { warnings: h.addWarnings } : {}),
      });
      h.entries = [...h.entries, added];
      return Promise.resolve(added);
    },
    addLocal: (dir) => {
      record("addLocal", dir);
      if (h.addLocalResult) h.entries = [...h.entries, h.addLocalResult];
      return Promise.resolve(h.addLocalResult);
    },
    addBuiltIn: (dir, id) => {
      record("addBuiltIn", dir, id);
      const added = entry({ use: `./extensions/${id}`, label: id, carries: STYLES, dir: `/proj/extensions/${id}`, styles: ["theme.css"] });
      h.entries = [...h.entries, added];
      return Promise.resolve(added);
    },
    remove: (dir, use) => {
      record("remove", dir, use);
      h.entries = h.entries.filter((e) => e.use !== use);
      return Promise.resolve({ ok: true });
    },
    setEnabled: (dir, use, enabled) => {
      record("setEnabled", dir, use, enabled);
      h.entries = h.entries.map((e) => (e.use === use ? { ...e, enabled } : e));
      return Promise.resolve({ ok: true });
    },
    reorder: (dir, order) => {
      record("reorder", dir, order);
      h.entries = order.map((u) => h.entries.find((e) => e.use === u)!);
      return Promise.resolve({ ok: true });
    },
    readCss: (dir, use) => {
      record("readCss", dir, use);
      return Promise.resolve(":root { --x: 1; }");
    },
    importFromFile: (dir) => {
      record("importFromFile", dir);
      if (h.importFileResult) h.entries = [...h.entries, h.importFileResult.entry];
      return Promise.resolve(h.importFileResult);
    },
    importFromUrl: (dir, url) => {
      record("importFromUrl", dir, url);
      h.entries = [...h.entries, LOOK_B];
      return Promise.resolve({ entry: LOOK_B, warnings: [{ code: "no-theme-json", message: "No theme.json found" }] });
    },
    onLookAdded: (label) => onLookAdded(label),
    afterLookChange: () => {
      afterLookChange();
      return Promise.resolve();
    },
  });
  return h;
}

const named = (h: Harness, n: string) => h.calls.filter((c) => c.name === n);

// ── Load: ONE list, two views ─────────────────────────────────────────────────

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.entries).toEqual([]);
  expect(ctrl.recommended).toEqual([]);
  expect(ctrl.builtIns).toEqual([]);
  expect(ctrl.validation).toEqual({});
  expect(ctrl.validating).toBe(false);
  expect(ctrl.error).toBeNull();
  expect(ctrl.notice).toBeNull();
  expect(ctrl.busy).toBeNull();
  expect(ctrl.importWarnings).toEqual([]);
  expect(ctrl.url).toBe("");
  expect(ctrl.npmName).toBe("");
  expect(ctrl.npmExport).toBe("");
  expect(ctrl.thumbs).toEqual({});
  expect(ctrl.hoverUse).toBeNull();
  expect(ctrl.hoverPreview).toBeNull();
  expect(ctrl.looks).toEqual([]);
  expect(ctrl.features).toEqual([]);
});

test("loadExtensions populates the list, the recommended + built-in catalogs, and the validation map keyed by use", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  expect(h.ctrl.entries).toEqual([LOOK_A, FEATURE]);
  expect(h.ctrl.recommended).toEqual([REC_MARK, REC_SUB]);
  expect(h.ctrl.builtIns).toEqual([BUILTIN_CLEAN, BUILTIN_ZINE]);
  expect(h.ctrl.validation["markdown-it-mark"]).toEqual({ use: "markdown-it-mark", kind: "bundled", enabled: true, ok: true });
  expect(h.ctrl.validating).toBe(false);
  expect(h.ctrl.error).toBeNull();
});

test("loadExtensions lazy-loads a sample thumbnail for looks with a folder only", async () => {
  const h = make({ entries: [LOOK_A, FEATURE, BROKEN] });
  await h.ctrl.loadExtensions();
  await flush();
  expect(h.ctrl.thumbs[LOOK_A.use]).toBe(sampleSrcdoc(":root { --x: 1; }"));
  expect(h.ctrl.thumbs[FEATURE.use]).toBeUndefined();
  expect(h.ctrl.thumbs[BROKEN.use]).toBeUndefined();
  expect(named(h, "readCss").map((c) => c.args[1])).toEqual([LOOK_A.use]);
});

test("loadExtensions no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadExtensions();
  expect(h.ctrl.entries).toEqual([]);
  expect(h.calls).toEqual([]);
});

test("a failed validate surfaces error via loadExtensions' awaited validateExtensions", async () => {
  const h = make();
  h.failValidate = true;
  await h.ctrl.loadExtensions();
  expect(h.ctrl.entries).toEqual([LOOK_A, FEATURE]); // the list load itself still succeeded
  expect(h.ctrl.error).toContain("validate failed");
  expect(h.ctrl.validating).toBe(false);
});

test("looks and features are two views over the one list; an extension carrying both is in both", async () => {
  const h = make({ entries: [LOOK_A, FEATURE, BOTH, BROKEN] });
  await h.ctrl.loadExtensions();
  expect(h.ctrl.looks.map((e) => e.use)).toEqual([LOOK_A.use, BOTH.use]);
  // An entry carrying nothing recognizable lands in Features so it is never invisible.
  expect(h.ctrl.features.map((e) => e.use)).toEqual([FEATURE.use, BOTH.use, BROKEN.use]);
});

test("availableRecommended hides bundled features already in the list", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  expect(h.ctrl.availableRecommended).toEqual([REC_SUB]);
});

test("isBuiltInAdded reflects a ./extensions/<id> entry", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  expect(h.ctrl.isBuiltInAdded("clean-book")).toBe(true);
  expect(h.ctrl.isBuiltInAdded("zine")).toBe(false);
});

// ── One verb set: toggle / remove / move ──────────────────────────────────────

test("toggle flips enabled, reloads, and refreshes Styles+Design for a look", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  await h.ctrl.toggle(LOOK_A);
  expect(named(h, "setEnabled").map((c) => c.args)).toEqual([["/proj", LOOK_A.use, false]]);
  expect(h.ctrl.entries.find((e) => e.use === LOOK_A.use)?.enabled).toBe(false);
  expect(h.afterLookChange.calls.length).toBe(1);
  expect(h.ctrl.busy).toBeNull();
});

test("toggling a markdown-only feature does not refresh Styles+Design", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  await h.ctrl.toggle(FEATURE);
  expect(named(h, "setEnabled").map((c) => c.args)).toEqual([["/proj", FEATURE.use, false]]);
  expect(h.afterLookChange.calls.length).toBe(0);
});

test("remove is a single click: drops the entry, reloads, refreshes for a look only", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  await h.ctrl.remove(FEATURE);
  expect(named(h, "remove").map((c) => c.args)).toEqual([["/proj", FEATURE.use]]);
  expect(h.ctrl.entries.map((e) => e.use)).toEqual([LOOK_A.use]);
  expect(h.afterLookChange.calls.length).toBe(0);
  await h.ctrl.remove(LOOK_A);
  expect(h.ctrl.entries).toEqual([]);
  expect(h.afterLookChange.calls.length).toBe(1);
});

test("move sends the FULL order with the entry past its neighbour in that view", async () => {
  const h = make({ entries: [LOOK_A, FEATURE, LOOK_B] });
  await h.ctrl.loadExtensions();
  await h.ctrl.move(LOOK_B, -1, "looks");
  expect(named(h, "reorder").map((c) => c.args[1])).toEqual([[LOOK_B.use, LOOK_A.use, FEATURE.use]]);
  expect(h.ctrl.looks.map((e) => e.use)).toEqual([LOOK_B.use, LOOK_A.use]);
  expect(h.afterLookChange.calls.length).toBe(1);
});

test("move at the edge of the view is a no-op — no host call", async () => {
  const h = make({ entries: [LOOK_A, FEATURE, LOOK_B] });
  await h.ctrl.loadExtensions();
  await h.ctrl.move(LOOK_A, -1, "looks");
  await h.ctrl.move(LOOK_B, 1, "looks");
  expect(named(h, "reorder")).toEqual([]);
});

test("a failed verb surfaces error, does not refresh, and clears busy", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  h.failAdd = true;
  h.ctrl.npmName = "bad-pkg";
  await h.ctrl.addNpm();
  expect(h.ctrl.error).toContain("add failed");
  expect(h.afterLookChange.calls.length).toBe(0);
  expect(h.ctrl.busy).toBeNull();
});

// ── Add, four ways to name the extension ──────────────────────────────────────

test("addNpm rejects a blank name without calling the host", async () => {
  const h = make();
  h.ctrl.npmName = "   ";
  await h.ctrl.addNpm();
  expect(h.ctrl.error).toContain("Enter an npm package name");
  expect(named(h, "add")).toEqual([]);
});

test("addNpm trims, adds, clears the draft, and reloads", async () => {
  const h = make({ entries: [] });
  h.ctrl.npmName = "  markdown-it-footnote  ";
  await h.ctrl.addNpm();
  expect(named(h, "add").map((c) => c.args)).toEqual([["/proj", "markdown-it-footnote", undefined]]);
  expect(h.ctrl.npmName).toBe("");
  expect(h.ctrl.entries.some((e) => e.use === "markdown-it-footnote")).toBe(true);
  expect(named(h, "list").length).toBe(1);
});

test("addNpm forwards and clears an optional named export", async () => {
  const h = make({ entries: [] });
  h.ctrl.npmName = "markdown-it-emoji@3.0.0";
  h.ctrl.npmExport = "  full  ";
  await h.ctrl.addNpm();
  expect(named(h, "add").map((c) => c.args)).toEqual([["/proj", "markdown-it-emoji@3.0.0", "full"]]);
  expect(h.ctrl.npmName).toBe("");
  expect(h.ctrl.npmExport).toBe("");
});

test("cancelling the native npm trust gate keeps the draft and does not reload", async () => {
  const h = make({ entries: [] });
  h.cancelAdd = true;
  h.ctrl.npmName = "markdown-it-highlightjs";
  await h.ctrl.addNpm();
  expect(h.ctrl.npmName).toBe("markdown-it-highlightjs");
  expect(h.ctrl.entries).toEqual([]);
  expect(h.ctrl.error).toBeNull();
  expect(named(h, "list")).toEqual([]);
});

test("a non-fatal installer warning is surfaced as a notice after a successful add", async () => {
  const h = make({ entries: [] });
  h.addWarnings = ["Registry provided legacy SHA-1 integrity."];
  h.ctrl.npmName = "old-plugin";
  await h.ctrl.addNpm();
  expect(h.ctrl.notice).toContain("legacy SHA-1");
});

test("addRecommended writes the bundled name", async () => {
  const h = make({ entries: [] });
  await h.ctrl.addRecommended(REC_SUB);
  expect(named(h, "add").map((c) => c.args)).toEqual([["/proj", "markdown-it-sub", undefined]]);
  expect(h.ctrl.availableRecommended.map((r) => r.use)).toEqual(["markdown-it-mark"]);
});

test("addLocal: a cancelled picker changes nothing; a picked look announces itself and refreshes", async () => {
  const h = make({ entries: [] });
  await h.ctrl.addLocal();
  expect(named(h, "list")).toEqual([]);
  expect(h.onLookAdded.calls.length).toBe(0);

  h.addLocalResult = BOTH;
  await h.ctrl.addLocal();
  expect(h.ctrl.looks).toEqual([BOTH]);
  expect(h.ctrl.features).toEqual([BOTH]);
  expect(h.onLookAdded.calls).toEqual([["House"]]);
  expect(h.afterLookChange.calls.length).toBe(1);
});

test("useBuiltIn copies the look in, marks it added, announces it, and refreshes Styles+Design", async () => {
  const h = make({ entries: [] });
  await h.ctrl.loadExtensions();
  expect(h.ctrl.isBuiltInAdded("zine")).toBe(false);
  await h.ctrl.useBuiltIn("zine");
  expect(named(h, "addBuiltIn").map((c) => c.args)).toEqual([["/proj", "zine"]]);
  expect(h.ctrl.isBuiltInAdded("zine")).toBe(true);
  expect(h.ctrl.looks.map((e) => e.use)).toEqual(["./extensions/zine"]);
  expect(h.onLookAdded.calls).toEqual([["zine"]]);
  expect(h.afterLookChange.calls.length).toBe(1);
  expect(h.ctrl.busy).toBeNull();
});

// ── #106: file / URL import ───────────────────────────────────────────────────

test("importFile surfaces the host warnings, announces the look, and reloads on success", async () => {
  const h = make({ entries: [] });
  h.importFileResult = {
    entry: LOOK_B,
    warnings: [
      { code: "print-safety", message: "Remote URL is not allowed" },
      { code: "no-theme-json", message: "No theme.json found" },
    ],
  };
  await h.ctrl.importFile();
  expect(h.ctrl.importWarnings).toEqual(["Remote URL is not allowed", "No theme.json found"]);
  expect(h.ctrl.looks).toEqual([LOOK_B]);
  expect(h.onLookAdded.calls).toEqual([["Zine"]]);
  expect(h.afterLookChange.calls.length).toBe(1);
  expect(h.ctrl.error).toBeNull();
  expect(h.ctrl.busy).toBeNull();
});

test("importFile leaves warnings empty and announces nothing when the picker is cancelled", async () => {
  const h = make();
  await h.ctrl.importFile();
  expect(h.ctrl.importWarnings).toEqual([]);
  expect(h.onLookAdded.calls.length).toBe(0);
});

test("importUrl rejects a blank URL without calling the host", async () => {
  const h = make();
  h.ctrl.url = "   ";
  await h.ctrl.importUrl();
  expect(h.ctrl.error).toContain("Enter a URL");
  expect(named(h, "importFromUrl")).toEqual([]);
});

test("importUrl trims, imports, clears the draft, surfaces warnings, and reloads", async () => {
  const h = make({ entries: [] });
  h.ctrl.url = "  https://example.com/theme.css  ";
  await h.ctrl.importUrl();
  expect(named(h, "importFromUrl").map((c) => c.args)).toEqual([["/proj", "https://example.com/theme.css"]]);
  expect(h.ctrl.url).toBe("");
  expect(h.ctrl.importWarnings).toEqual(["No theme.json found"]);
  expect(h.ctrl.looks).toEqual([LOOK_B]);
  expect(h.ctrl.error).toBeNull();
});

// ── #106: hover preview ───────────────────────────────────────────────────────

test("showHoverPreview renders the fixed 2-page spread with the look's CSS", async () => {
  const h = make();
  await h.ctrl.showHoverPreview(LOOK_A);
  expect(h.ctrl.hoverUse).toBe(LOOK_A.use);
  expect(h.ctrl.hoverPreview).toBe(hoverPreviewSrcdoc(":root { --x: 1; }"));
  h.ctrl.hideHoverPreview();
  expect(h.ctrl.hoverUse).toBeNull();
  expect(h.ctrl.hoverPreview).toBeNull();
});

test("showHoverPreview has nothing to render for an entry without a folder", async () => {
  const h = make();
  await h.ctrl.showHoverPreview(FEATURE);
  expect(h.ctrl.hoverUse).toBeNull();
  expect(h.ctrl.hoverPreview).toBeNull();
  expect(named(h, "readCss")).toEqual([]);
});
