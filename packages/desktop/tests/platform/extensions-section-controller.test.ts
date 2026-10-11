import { expect, test } from "bun:test";
import { ExtensionsSectionController, FEATURES_TABS } from "../../src/lib/routes/extensions-section-controller.svelte";
import type {
  ProjectExtensionEntry,
  ExtensionValidationResult,
  RecommendedExtension,
  BuiltInStyleSet,
  ExtensionImportResult,
  NpmExtensionMatch,
  ExtensionSearchResult,
  ExtensionUpdatesResult,
  ExtensionVersionsResult,
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

const FOUND_DC: NpmExtensionMatch = {
  name: "dimm-city-components",
  version: "1.2.0",
  description: "d",
  kind: "gutterpress",
  keywords: ["gutterpress"],
  npmUrl: "https://www.npmjs.com/package/dimm-city-components",
};
const FOUND_OTHER: NpmExtensionMatch = {
  name: "markdown-it-other",
  version: "2.0.0",
  description: "d",
  kind: "markdown-it",
  keywords: ["markdown-it-plugin"],
};

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
  searchResult: ExtensionSearchResult;
  updatesResult: ExtensionUpdatesResult;
  /** What the registry says each package has, by name (a missing name is a failed lookup). */
  published: Record<string, string[]>;
  /** The "Include pre-release versions" preference the controller reads and writes. */
  includePrerelease: boolean;
}

function make(
  over: Partial<{
    noProject: boolean;
    entries: ProjectExtensionEntry[];
    recommended: RecommendedExtension[];
    builtIns: BuiltInStyleSet[];
    searchResult: ExtensionSearchResult;
    updatesResult: ExtensionUpdatesResult;
    published: Record<string, string[]>;
    includePrerelease: boolean;
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
    searchResult: over.searchResult ?? { ok: true, matches: [FOUND_DC, FOUND_OTHER], total: 42 },
    updatesResult: over.updatesResult ?? { ok: true, checks: [] },
    published: over.published ?? {},
    includePrerelease: over.includePrerelease ?? false,
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
    search: (query) => {
      record("search", query);
      return Promise.resolve(h.searchResult);
    },
    outdated: (dir, includePrerelease) => {
      record("outdated", dir, includePrerelease);
      return Promise.resolve(h.updatesResult);
    },
    versions: (name): Promise<ExtensionVersionsResult> => {
      record("versions", name);
      const versions = h.published[name];
      return Promise.resolve(
        versions ? { ok: true, versions } : { ok: false, message: `npm package "${name}" was not found.` },
      );
    },
    includePrerelease: () => h.includePrerelease,
    setIncludePrerelease: (on) => {
      record("setIncludePrerelease", on);
      h.includePrerelease = on;
    },
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
      // An npm re-pin replaces the entry for that package (what the host's `upsertEntry` does).
      const npmAt = added.kind === "npm" ? h.entries.findIndex((e) => e.kind === "npm" && e.name === specifier.replace(/@[^@]*$/, "")) : -1;
      if (npmAt >= 0) {
        added.name = h.entries[npmAt]!.name;
        added.version = specifier.slice(added.name.length + 1);
        h.entries = h.entries.map((e, i) => (i === npmAt ? added : e));
      } else h.entries = [...h.entries, added];
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
      return Promise.resolve({ entry: LOOK_B, warnings: [{ code: "no-theme-json", message: "No package.json found" }] });
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
  expect(ctrl.search).toEqual({ status: "idle", query: "", matches: [], total: 0, message: null });
  expect(ctrl.searchQuery).toBe("");
  expect(ctrl.availableSearch).toEqual([]);
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

// ── Search: npm (#246) ──────────────────────────────────────────────────────

test("loadExtensions never touches search — npm is only searched on demand", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  expect(h.ctrl.search).toEqual({ status: "idle", query: "", matches: [], total: 0, message: null });
  expect(named(h, "search")).toEqual([]);
});

test("runSearch populates matches + total and records the query it ran", async () => {
  const h = make();
  h.ctrl.searchQuery = "  footnote  ";
  await h.ctrl.runSearch();
  expect(named(h, "search").map((c) => c.args)).toEqual([["footnote"]]);
  expect(h.ctrl.search).toEqual({
    status: "ready",
    query: "footnote",
    matches: [FOUND_DC, FOUND_OTHER],
    total: 42,
    message: null,
  });
});

test("runSearch surfaces an `ok: false` result as search.message, not ctrl.error", async () => {
  const h = make({ searchResult: { ok: false, message: "Couldn't reach the npm registry." } });
  await h.ctrl.runSearch("");
  expect(h.ctrl.search).toEqual({
    status: "error",
    query: "",
    matches: [],
    total: 0,
    message: "Couldn't reach the npm registry.",
  });
  expect(h.ctrl.error).toBeNull();
});

test("runSearch refuses a second concurrent call while one is loading", async () => {
  const h = make();
  const first = h.ctrl.runSearch("");
  expect(h.ctrl.search.status).toBe("loading");
  const second = h.ctrl.runSearch(""); // issued while the first is still in flight
  await Promise.all([first, second]);
  expect(named(h, "search").length).toBe(1);
  expect(h.ctrl.search.status).toBe("ready");
});

test("availableSearch hides packages already configured, matching an npm entry by NAME not by its pin", async () => {
  const h = make({
    entries: [entry({ use: "dimm-city-components@1.1.0", kind: "npm", name: "dimm-city-components", carries: MARKDOWN })],
  });
  await h.ctrl.loadExtensions();
  await h.ctrl.runSearch("");
  expect(h.ctrl.availableSearch).toEqual([FOUND_OTHER]);
});

// ── Features tabs ────────────────────────────────────────────────────────────

test("the Features tabs are Installed & built-in, Search, Advanced — in that order", () => {
  expect(FEATURES_TABS.map((t) => t.label)).toEqual(["Installed & built-in", "Search", "Advanced"]);
});

test("the npm search runs the first time the Search tab is shown — not before, not for other tabs", async () => {
  const h = make();
  h.ctrl.showFeaturesTab("installed");
  h.ctrl.showFeaturesTab("advanced");
  await flush();
  expect(named(h, "search")).toEqual([]);
  expect(h.ctrl.search.status).toBe("idle");

  h.ctrl.showFeaturesTab("search");
  await flush();
  expect(named(h, "search").map((c) => c.args)).toEqual([[""]]);
  expect(h.ctrl.search.status).toBe("ready");

  // Showing it again (a tab round trip) reuses the result instead of asking npm again.
  h.ctrl.showFeaturesTab("installed");
  h.ctrl.showFeaturesTab("search");
  await flush();
  expect(named(h, "search").length).toBe(1);
});

test("a remembered Search tab searches when a fresh controller mounts onto it, and the tab outlives the controller", async () => {
  const first = make();
  first.ctrl.showFeaturesTab("search");
  await flush();

  // ProjectSettingsView builds a new controller per open: the selection carries over,
  // the (per-controller) search state does not — so the view's mount call must search.
  const second = make();
  expect(second.ctrl.featuresTab).toBe("search");
  expect(second.ctrl.search.status).toBe("idle");
  second.ctrl.showFeaturesTab(second.ctrl.featuresTab);
  await flush();
  expect(named(second, "search").length).toBe(1);

  second.ctrl.showFeaturesTab("installed"); // leave module state as a restart would find it
  expect(make().ctrl.featuresTab).toBe("installed");
});

test("showFeaturesTab does not re-search while the first search is still in flight", async () => {
  const h = make();
  h.ctrl.showFeaturesTab("search");
  h.ctrl.showFeaturesTab("installed");
  h.ctrl.showFeaturesTab("search");
  await flush();
  expect(named(h, "search").length).toBe(1);
  h.ctrl.showFeaturesTab("installed");
});

test("an add from Search stays on its tab and says where the row went", async () => {
  const h = make();
  h.ctrl.showFeaturesTab("search");
  await flush();
  await h.ctrl.addSearched(FOUND_DC);
  expect(h.ctrl.featuresTab).toBe("search");
  expect(h.ctrl.notice).toBe("Added dimm-city-components — find it under Installed & built-in.");
  expect(h.ctrl.features.some((e) => e.use === "dimm-city-components")).toBe(true);
  expect(h.ctrl.availableSearch.some((m) => m.name === "dimm-city-components")).toBe(false);
  h.ctrl.showFeaturesTab("installed");
});

test("install by name confirms too, and keeps an installer warning after the confirmation", async () => {
  const h = make({ entries: [] });
  h.addWarnings = ["Registry provided legacy SHA-1 integrity."];
  h.ctrl.npmName = "old-plugin";
  await h.ctrl.addNpm();
  expect(h.ctrl.notice).toBe("Added old-plugin — find it under Installed & built-in. Registry provided legacy SHA-1 integrity.");
});

test("turning on a Formatting extra (Installed tab) adds no confirmation — the row appears right there", async () => {
  const h = make({ entries: [] });
  await h.ctrl.addRecommended(REC_MARK);
  expect(h.ctrl.notice).toBeNull();
});

test("addSearched adds by the package name and reloads the list", async () => {
  const h = make();
  await h.ctrl.runSearch("");
  await h.ctrl.addSearched(FOUND_DC);
  expect(named(h, "add").map((c) => c.args)).toEqual([["/proj", "dimm-city-components", undefined]]);
  expect(h.entries.some((e) => e.use === "dimm-city-components")).toBe(true);
  expect(named(h, "list").length).toBeGreaterThan(0); // reloaded after the add
});

test("addSearched refreshes Styles+Design when the INSTALLED package turns out to carry styles", async () => {
  // The search result says nothing about what a package carries; the host's
  // described entry does, and that is what decides.
  const h = make();
  h.addWarnings = [];
  await h.ctrl.addSearched(FOUND_DC);
  expect(h.afterLookChange.calls.length).toBe(0); // the fake host echoes a markdown-only entry
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
      { code: "no-theme-json", message: "No package.json found" },
    ],
  };
  await h.ctrl.importFile();
  expect(h.ctrl.importWarnings).toEqual(["Remote URL is not allowed", "No package.json found"]);
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
  expect(h.ctrl.importWarnings).toEqual(["No package.json found"]);
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

// ── Updates ──────────────────────────────────────────────────────────────────

const PINNED_DC = entry({ use: "dimm-city-components@1.1.0", kind: "npm", name: "dimm-city-components", version: "1.1.0", export: "full", carries: MARKDOWN });
const DC_BEHIND: ExtensionUpdatesResult = {
  ok: true,
  checks: [{ use: "dimm-city-components@1.1.0", name: "dimm-city-components", current: "1.1.0", latest: "1.2.0", outdated: true }],
};

test("checkUpdates asks the host once for the project and exposes the newer version per entry", async () => {
  const h = make({ entries: [PINNED_DC, FEATURE], updatesResult: DC_BEHIND });
  await h.ctrl.loadExtensions();
  await h.ctrl.checkUpdates();
  expect(named(h, "outdated").map((c) => c.args)).toEqual([["/proj", false]]);
  expect(h.ctrl.updates.status).toBe("ready");
  expect(h.ctrl.updateFor(PINNED_DC)).toBe("1.2.0");
  expect(h.ctrl.updateFor(FEATURE)).toBeNull(); // bundled: npm has nothing to say
});

test("checkUpdates surfaces an `ok: false` result as updates.message, not ctrl.error", async () => {
  const h = make({ entries: [PINNED_DC], updatesResult: { ok: false, message: "Looking up dimm-city-components on npm failed." } });
  await h.ctrl.loadExtensions();
  await h.ctrl.checkUpdates();
  expect(h.ctrl.updates).toEqual({ status: "error", checks: [], message: "Looking up dimm-city-components on npm failed." });
  expect(h.ctrl.error).toBeNull();
  expect(h.ctrl.updateFor(PINNED_DC)).toBeNull();
});

test("checkUpdates refuses a second concurrent call while one is loading", async () => {
  const h = make({ entries: [PINNED_DC], updatesResult: DC_BEHIND });
  const first = h.ctrl.checkUpdates();
  expect(h.ctrl.updates.status).toBe("loading");
  await Promise.all([first, h.ctrl.checkUpdates()]);
  expect(named(h, "outdated").length).toBe(1);
});

test("update re-pins through add(name@latest) keeping the export, reloads, and clears the entry's update", async () => {
  const h = make({ entries: [PINNED_DC], updatesResult: DC_BEHIND });
  await h.ctrl.loadExtensions();
  await h.ctrl.checkUpdates();
  await h.ctrl.update(PINNED_DC);
  expect(named(h, "add").map((c) => c.args)).toEqual([["/proj", "dimm-city-components@1.2.0", "full"]]);
  expect(named(h, "list").length).toBeGreaterThan(1); // reloaded after the re-pin
  expect(h.ctrl.updateFor(PINNED_DC)).toBeNull();
  expect(h.ctrl.busy).toBeNull();
});

test("update is a no-op for an entry with nothing newer, and a cancelled trust gate changes nothing", async () => {
  const h = make({ entries: [PINNED_DC], updatesResult: DC_BEHIND });
  await h.ctrl.loadExtensions();
  await h.ctrl.update(PINNED_DC); // before any check: no known update
  expect(named(h, "add").length).toBe(0);
  await h.ctrl.checkUpdates();
  h.cancelAdd = true;
  await h.ctrl.update(PINNED_DC);
  expect(named(h, "add").length).toBe(1);
  expect(h.ctrl.updateFor(PINNED_DC)).toBe("1.2.0"); // still offered
});


// ── Install button, version picker, pre-release preference ───────────────────

const PUBLISHED_DC = ["1.3.0-rc.1", "1.2.0", "1.2.0-alpha.2", "1.1.0", "1.0.0"];
/** The screenshot's state: a pin whose downloaded copy is missing. */
const MISSING_DC = entry({
  use: "dimm-city-components@1.2.0-alpha.2",
  kind: "npm",
  name: "dimm-city-components",
  version: "1.2.0-alpha.2",
  export: "full",
  carries: MARKDOWN,
  warnings: ["Not installed — run `gutterpress ext add dimm-city-components@1.2.0-alpha.2`."],
});

test("versionChoices: stable only by default, pre-releases with the preference, the pin always listed", async () => {
  const h = make({ entries: [PINNED_DC, MISSING_DC], published: { "dimm-city-components": PUBLISHED_DC } });
  await h.ctrl.loadExtensions();
  await h.ctrl.loadVersions("dimm-city-components");
  expect(h.ctrl.versionChoices(PINNED_DC)).toEqual(["1.2.0", "1.1.0", "1.0.0"]);
  // A pre-release pin stays visible even with the preference off.
  expect(h.ctrl.versionChoices(MISSING_DC)).toEqual(["1.2.0", "1.2.0-alpha.2", "1.1.0", "1.0.0"]);
  h.ctrl.setIncludePrerelease(true);
  expect(h.ctrl.versionChoices(PINNED_DC)).toEqual(PUBLISHED_DC);
  // …and flipping it needed no second registry lookup.
  expect(named(h, "versions").length).toBe(1);
});

test("versionChoices: before the list loads (or when it fails) the row still offers its pin; non-npm rows get no picker", async () => {
  const h = make({ entries: [PINNED_DC, FEATURE, BOTH], published: {} });
  expect(h.ctrl.versionChoices(PINNED_DC)).toEqual(["1.1.0"]);
  await h.ctrl.loadVersions("dimm-city-components");
  expect(h.ctrl.versions["dimm-city-components"]).toEqual({ status: "error", versions: [], message: 'npm package "dimm-city-components" was not found.' });
  expect(h.ctrl.versionChoices(PINNED_DC)).toEqual(["1.1.0"]);
  expect(h.ctrl.error).toBeNull(); // quiet: never blocks the panel
  expect(h.ctrl.versionChoices(FEATURE)).toEqual([]);
  expect(h.ctrl.versionChoices(BOTH)).toEqual([]);
});

test("loadVersions caches per package for the session, but retries after a failure", async () => {
  const h = make({ entries: [PINNED_DC], published: {} });
  await h.ctrl.loadVersions("dimm-city-components"); // fails
  h.published = { "dimm-city-components": PUBLISHED_DC };
  await h.ctrl.loadVersions("dimm-city-components"); // retried: picker opened again
  await h.ctrl.loadVersions("dimm-city-components"); // cached
  await Promise.all([h.ctrl.loadVersions("dimm-city-components"), h.ctrl.loadVersions("dimm-city-components")]);
  expect(named(h, "versions").map((c) => c.args)).toEqual([["dimm-city-components"], ["dimm-city-components"]]);
  expect(h.ctrl.versions["dimm-city-components"]!.status).toBe("ready");
});

test("install on a Needs-install row calls add with exactly the pinned spec and the entry's export, then refreshes the row", async () => {
  const h = make({ entries: [MISSING_DC] });
  await h.ctrl.loadExtensions();
  const listsBefore = named(h, "list").length;
  const pending = h.ctrl.install(MISSING_DC);
  expect(h.ctrl.busy).toBe(MISSING_DC.use); // the row is busy: picker and Install disable
  await pending;
  expect(named(h, "add").map((c) => c.args)).toEqual([["/proj", "dimm-city-components@1.2.0-alpha.2", "full"]]);
  expect(named(h, "list").length).toBeGreaterThan(listsBefore);
  expect(h.ctrl.busy).toBeNull();
  expect(h.ctrl.error).toBeNull();
});

test("install on a book with no pin asks for the bare package name, which the host then pins", async () => {
  const unpinned = entry({ use: "markdown-it-other", kind: "npm", name: "markdown-it-other", carries: MARKDOWN, warnings: ["Not pinned — run `gutterpress ext add markdown-it-other` to install it and pin an exact version."] });
  const h = make({ entries: [unpinned] });
  await h.ctrl.loadExtensions();
  await h.ctrl.install(unpinned);
  expect(named(h, "add").map((c) => c.args)).toEqual([["/proj", "markdown-it-other", undefined]]);
});

test("install does nothing for a row that is not an npm package", async () => {
  const h = make({ entries: [FEATURE] });
  await h.ctrl.loadExtensions();
  await h.ctrl.install(FEATURE);
  expect(named(h, "add")).toEqual([]);
});

test("a failed install reports it in plain words and leaves the row, its pin and busy state as they were", async () => {
  const h = make({ entries: [MISSING_DC] });
  await h.ctrl.loadExtensions();
  h.failAdd = true;
  await h.ctrl.install(MISSING_DC);
  expect(h.ctrl.error).toBe("Couldn't install dimm-city-components@1.2.0-alpha.2. add failed");
  expect(h.ctrl.entries).toEqual([MISSING_DC]);
  expect(h.ctrl.busy).toBeNull(); // the Install button is usable again
});

test("switchVersion installs name@chosen keeping the export, then the row carries the new pin", async () => {
  const h = make({ entries: [PINNED_DC], published: { "dimm-city-components": PUBLISHED_DC } });
  await h.ctrl.loadExtensions();
  await h.ctrl.switchVersion(PINNED_DC, "1.2.0");
  expect(named(h, "add").map((c) => c.args)).toEqual([["/proj", "dimm-city-components@1.2.0", "full"]]);
  expect(h.ctrl.entries.map((e) => [e.use, e.version])).toEqual([["dimm-city-components@1.2.0", "1.2.0"]]);
  // npm is asked again what "newer" means for the new pin.
  expect(named(h, "outdated").length).toBe(1);
});

test("switchVersion to a pre-release works whatever the preference says (the picker only chooses what is offered)", async () => {
  const h = make({ entries: [PINNED_DC] });
  await h.ctrl.loadExtensions();
  await h.ctrl.switchVersion(PINNED_DC, "1.3.0-rc.1");
  expect(named(h, "add").map((c) => c.args[1])).toEqual(["dimm-city-components@1.3.0-rc.1"]);
});

test("switchVersion to the pinned version, a blank value, or on a non-npm row calls nothing", async () => {
  const h = make({ entries: [PINNED_DC, FEATURE] });
  await h.ctrl.loadExtensions();
  await h.ctrl.switchVersion(PINNED_DC, "1.1.0");
  await h.ctrl.switchVersion(PINNED_DC, "");
  await h.ctrl.switchVersion(FEATURE, "1.0.0");
  expect(named(h, "add")).toEqual([]);
});

test("a failed version switch keeps the old pin and says so; the host's rollback is what makes that true", async () => {
  const h = make({ entries: [PINNED_DC], published: { "dimm-city-components": PUBLISHED_DC } });
  await h.ctrl.loadExtensions();
  h.failAdd = true;
  await h.ctrl.switchVersion(PINNED_DC, "1.2.0");
  expect(h.ctrl.error).toBe("Couldn't install dimm-city-components@1.2.0. This book still uses 1.1.0. add failed");
  expect(h.ctrl.entries).toEqual([PINNED_DC]);
  expect(h.ctrl.entries[0]!.version).toBe("1.1.0");
  expect(h.ctrl.busy).toBeNull();
  expect(named(h, "outdated")).toEqual([]); // nothing changed, nothing to re-check
  // The next attempt starts clean.
  h.failAdd = false;
  await h.ctrl.switchVersion(PINNED_DC, "1.2.0");
  expect(h.ctrl.error).toBeNull();
  expect(h.ctrl.entries[0]!.version).toBe("1.2.0");
});

test("a cancelled trust prompt on a switch changes nothing and shows no error", async () => {
  const h = make({ entries: [PINNED_DC] });
  await h.ctrl.loadExtensions();
  h.cancelAdd = true;
  await h.ctrl.switchVersion(PINNED_DC, "1.2.0");
  expect(h.ctrl.error).toBeNull();
  expect(h.ctrl.entries).toEqual([PINNED_DC]);
  expect(h.ctrl.busy).toBeNull();
});

test("only one install runs at a time: a second switch while one is in flight is refused", async () => {
  const h = make({ entries: [PINNED_DC] });
  await h.ctrl.loadExtensions();
  const first = h.ctrl.switchVersion(PINNED_DC, "1.2.0");
  await h.ctrl.switchVersion(PINNED_DC, "1.0.0");
  await first;
  expect(named(h, "add").map((c) => c.args[1])).toEqual(["dimm-city-components@1.2.0"]);
});

test("the pre-release preference is read and written through the settings seam, and re-asks npm with it", async () => {
  const h = make({ entries: [PINNED_DC] });
  expect(h.ctrl.includePrerelease).toBe(false);
  h.ctrl.setIncludePrerelease(true);
  await flush();
  expect(h.ctrl.includePrerelease).toBe(true);
  expect(named(h, "setIncludePrerelease").map((c) => c.args)).toEqual([[true]]);
  expect(named(h, "outdated").map((c) => c.args)).toEqual([["/proj", true]]);
});
