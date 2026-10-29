import { expect, test } from "bun:test";
import { ExtensionsSectionController } from "../../src/lib/routes/extensions-section-controller.svelte";
import type {
  ProjectExtensionEntry,
  ExtensionValidationResult,
  BundledExtensionInfo,
  ExtensionImportResult,
  ExtensionUpdatesResult,
} from "../../src/lib/platform/dtos";
import { sampleSrcdoc, carriedKinds } from "../../src/lib/components/config/config-helpers";

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

// ONE list, several shapes: two looks the author owns on disk (the first an
// older version's copy of the built-in clean-book), a bundled feature, a
// bundled look, a component library that carries both, and a missing folder
// carrying nothing.
const LOOK_A = entry({ use: "./extensions/clean-book", label: "Clean Book", carries: STYLES, dir: "/proj/extensions/clean-book" });
const LOOK_B = entry({ use: "./extensions/zine", label: "Zine", carries: STYLES, dir: "/proj/extensions/zine" });
const FEATURE = entry({ use: "markdown-it-mark", kind: "bundled", label: "Highlight", carries: MARKDOWN });
const BUNDLED_LOOK = entry({ use: "academic", kind: "bundled", label: "Academic", carries: STYLES });
const BOTH = entry({ use: "../shared/house", label: "House", carries: { markdown: true, styles: true, snippets: true, components: false }, dir: "/shared/house" });
const NPM_LOOK = entry({ use: "house-look@1.0.0", kind: "npm", name: "house-look", version: "1.0.0", label: "House look", carries: STYLES });
const BROKEN = entry({ use: "./missing", label: "missing", warnings: ["Not found: /proj/missing"] });

const REC_MARK: BundledExtensionInfo = { use: "markdown-it-mark", label: "Highlight", description: "d", look: false };
const REC_SUB: BundledExtensionInfo = { use: "markdown-it-sub", label: "Subscript", description: "d", look: false };
const BUILTIN_CLEAN: BundledExtensionInfo = { use: "clean-book", label: "Clean Book", description: "d", look: true };
const BUILTIN_ZINE: BundledExtensionInfo = { use: "zine", label: "Zine", description: "d", look: true };
const BUNDLED = [REC_MARK, REC_SUB, BUILTIN_CLEAN, BUILTIN_ZINE];

interface Harness {
  ctrl: ExtensionsSectionController;
  projectDir: string | null;
  entries: ProjectExtensionEntry[];
  bundled: BundledExtensionInfo[];
  validation: ExtensionValidationResult[];
  /** Every host call, in order — `list` included, so "did it reload" is observable. */
  calls: Array<{ name: string; args: unknown[] }>;
  failValidate: boolean;
  failAdd: boolean;
  cancelAdd: boolean;
  addWarnings: string[];
  addLocalResult: ProjectExtensionEntry | null;
  importFileResult: ExtensionImportResult | null;
  afterLookChange: ReturnType<typeof spy>;
  updatesResult: ExtensionUpdatesResult;
}

function make(
  over: Partial<{
    noProject: boolean;
    entries: ProjectExtensionEntry[];
    bundled: BundledExtensionInfo[];
    updatesResult: ExtensionUpdatesResult;
  }> = {},
): Harness {
  const afterLookChange = spy();
  const h = {
    afterLookChange,
    projectDir: over.noProject ? null : "/proj",
    entries: over.entries ?? [LOOK_A, FEATURE],
    bundled: over.bundled ?? BUNDLED,
    validation: [],
    calls: [],
    failValidate: false,
    failAdd: false,
    cancelAdd: false,
    addWarnings: [],
    addLocalResult: null,
    importFileResult: null,
    updatesResult: over.updatesResult ?? { ok: true, checks: [] },
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
    bundled: () => Promise.resolve(h.bundled),
    outdated: (dir) => {
      record("outdated", dir);
      return Promise.resolve(h.updatesResult);
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
      // A bundled look (by name) carries styles and has no folder, as the lib describes it; anything else here is a markdown plugin.
      const look = h.bundled.some((b) => b.look && b.use === specifier);
      const added = entry({
        use: specifier,
        kind: specifier.startsWith("./") ? "path" : look ? "bundled" : "npm",
        label: specifier,
        carries: look ? STYLES : MARKDOWN,
        ...(exportName ? { export: exportName } : {}),
        ...(h.addWarnings.length ? { warnings: h.addWarnings } : {}),
      });
      // An npm re-pin replaces the entry for that package in place (what the
      // host's `upsertEntry` does); the package still carries what it did.
      const npmAt = added.kind === "npm" ? h.entries.findIndex((e) => e.kind === "npm" && e.name === specifier.replace(/@[^@]*$/, "")) : -1;
      if (npmAt >= 0) {
        added.name = h.entries[npmAt]!.name;
        added.label = h.entries[npmAt]!.label;
        added.carries = h.entries[npmAt]!.carries;
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
    afterLookChange: () => {
      afterLookChange();
      return Promise.resolve();
    },
  });
  return h;
}

const named = (h: Harness, n: string) => h.calls.filter((c) => c.name === n);

// ── Load: ONE list ────────────────────────────────────────────────────────────

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.entries).toEqual([]);
  expect(ctrl.bundled).toEqual([]);
  expect(ctrl.galleryLooks).toEqual([]);
  expect(ctrl.unlistedExtras).toEqual([]);
  expect(ctrl.validation).toEqual({});
  expect(ctrl.validating).toBe(false);
  expect(ctrl.error).toBeNull();
  expect(ctrl.notice).toBeNull();
  expect(ctrl.busy).toBeNull();
  expect(ctrl.saveStatus).toBe("idle");
  expect(ctrl.importWarnings).toEqual([]);
  expect(ctrl.url).toBe("");
  expect(ctrl.npmName).toBe("");
  expect(ctrl.thumbs).toEqual({});
});

test("loadExtensions populates the list, the bundled catalog, and the validation map keyed by use", async () => {
  const h = make();
  await h.ctrl.loadExtensions();
  expect(h.ctrl.entries).toEqual([LOOK_A, FEATURE]);
  expect(h.ctrl.bundled).toEqual(BUNDLED);
  expect(h.ctrl.validation["markdown-it-mark"]).toEqual({ use: "markdown-it-mark", kind: "bundled", enabled: true, ok: true });
  expect(h.ctrl.validating).toBe(false);
  expect(h.ctrl.error).toBeNull();
});

test("loadExtensions lazy-loads a gallery thumbnail for every listed look and every built-in look, listed or not", async () => {
  const h = make({ entries: [LOOK_A, FEATURE, BROKEN, BUNDLED_LOOK, BOTH] });
  await h.ctrl.loadExtensions();
  await flush();
  expect(h.ctrl.thumbs[LOOK_A.use]).toBe(sampleSrcdoc(":root { --x: 1; }"));
  expect(h.ctrl.thumbs[BUNDLED_LOOK.use]).toBe(sampleSrcdoc(":root { --x: 1; }"));
  // A built-in look shows what it looks like before it is chosen, too.
  expect(h.ctrl.thumbs[BUILTIN_CLEAN.use]).toBe(sampleSrcdoc(":root { --x: 1; }"));
  expect(h.ctrl.thumbs[BUILTIN_ZINE.use]).toBe(sampleSrcdoc(":root { --x: 1; }"));
  // No card, no thumbnail: an extra, a broken entry, a component library.
  expect(h.ctrl.thumbs[FEATURE.use]).toBeUndefined();
  expect(h.ctrl.thumbs[REC_MARK.use]).toBeUndefined();
  expect(h.ctrl.thumbs[BROKEN.use]).toBeUndefined();
  expect(h.ctrl.thumbs[BOTH.use]).toBeUndefined();
  expect(named(h, "readCss").map((c) => c.args[1])).toEqual([LOOK_A.use, BUNDLED_LOOK.use, BUILTIN_CLEAN.use, BUILTIN_ZINE.use]);
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

test("the list is every manifest entry in cascade order, each naming the kinds it carries", async () => {
  const h = make({ entries: [LOOK_A, FEATURE, BOTH, BROKEN] });
  await h.ctrl.loadExtensions();
  expect(h.ctrl.entries.map((e) => [e.use, carriedKinds(e)])).toEqual([
    [LOOK_A.use, ["Look"]],
    [FEATURE.use, ["Extra"]],
    // A component library's styles serve its own markdown: "Styles", not "Look".
    [BOTH.use, ["Extra", "Styles", "Snippets"]],
    // An entry carrying nothing recognizable is still a row, so it is never invisible or un-removable.
    [BROKEN.use, []],
  ]);
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

test("move sends the FULL order with the entry past its neighbour in the list", async () => {
  const h = make({ entries: [LOOK_A, FEATURE, LOOK_B] });
  await h.ctrl.loadExtensions();
  await h.ctrl.move(LOOK_B, -1);
  expect(named(h, "reorder").map((c) => c.args[1])).toEqual([[LOOK_A.use, LOOK_B.use, FEATURE.use]]);
  expect(h.ctrl.entries.map((e) => e.use)).toEqual([LOOK_A.use, LOOK_B.use, FEATURE.use]);
  expect(h.afterLookChange.calls.length).toBe(1);
});

test("moving a markdown-only feature reorders without refreshing Styles+Design", async () => {
  const h = make({ entries: [LOOK_A, FEATURE] });
  await h.ctrl.loadExtensions();
  await h.ctrl.move(FEATURE, -1);
  expect(named(h, "reorder").map((c) => c.args[1])).toEqual([[FEATURE.use, LOOK_A.use]]);
  expect(h.afterLookChange.calls.length).toBe(0);
});

test("move at the edge of the list is a no-op — no host call", async () => {
  const h = make({ entries: [LOOK_A, FEATURE, LOOK_B] });
  await h.ctrl.loadExtensions();
  await h.ctrl.move(LOOK_A, -1);
  await h.ctrl.move(LOOK_B, 1);
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

// ── Add: several ways to name the extension ───────────────────────────────────

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

test("addLocal: a cancelled picker changes nothing; a picked look is listed and refreshes the design settings", async () => {
  const h = make({ entries: [] });
  await h.ctrl.addLocal();
  expect(named(h, "list")).toEqual([]);
  expect(h.ctrl.saveStatus).toBe("idle");

  h.addLocalResult = LOOK_B;
  await h.ctrl.addLocal();
  expect(h.ctrl.entries).toEqual([LOOK_B]);
  expect(h.afterLookChange.calls.length).toBe(1);
  expect(h.ctrl.saveStatus).toBe("saved");
});

test("a component library (markdown and styles) also refreshes the design settings", async () => {
  const h = make({ entries: [LOOK_A] });
  await h.ctrl.loadExtensions();
  h.addLocalResult = BOTH;
  await h.ctrl.addLocal();
  expect(h.ctrl.entries).toEqual([LOOK_A, BOTH]);
  expect(h.afterLookChange.calls.length).toBe(1);
});

// ── #106: file / URL import ───────────────────────────────────────────────────

test("importFile surfaces the host warnings and reloads on success", async () => {
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
  expect(h.ctrl.entries).toEqual([LOOK_B]);
  expect(h.afterLookChange.calls.length).toBe(1);
  expect(h.ctrl.error).toBeNull();
  expect(h.ctrl.busy).toBeNull();
});

test("importFile leaves warnings empty and reloads nothing when the picker is cancelled", async () => {
  const h = make();
  await h.ctrl.importFile();
  expect(h.ctrl.importWarnings).toEqual([]);
  expect(named(h, "list")).toEqual([]);
});

test("importUrl rejects a blank URL without calling the host", async () => {
  const h = make();
  h.ctrl.url = "   ";
  await h.ctrl.importUrl();
  expect(h.ctrl.error).toContain("Enter a web address");
  expect(named(h, "importFromUrl")).toEqual([]);
});

test("importUrl trims, imports, clears the draft, surfaces warnings, and reloads", async () => {
  const h = make({ entries: [] });
  h.ctrl.url = "  https://example.com/theme.css  ";
  await h.ctrl.importUrl();
  expect(named(h, "importFromUrl").map((c) => c.args)).toEqual([["/proj", "https://example.com/theme.css"]]);
  expect(h.ctrl.url).toBe("");
  expect(h.ctrl.importWarnings).toEqual(["No package.json found"]);
  expect(h.ctrl.entries).toEqual([LOOK_B]);
  expect(h.ctrl.error).toBeNull();
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
  expect(named(h, "outdated").map((c) => c.args)).toEqual([["/proj"]]);
  expect(h.ctrl.updates.status).toBe("ready");
  expect(h.ctrl.updateFor(PINNED_DC)).toBe("1.2.0");
  expect(h.ctrl.updateFor(FEATURE)).toBeNull(); // bundled: npm has nothing to say
});

test("checkUpdates surfaces an `ok: false` result as updates.message, not ctrl.error", async () => {
  const h = make({ entries: [PINNED_DC], updatesResult: { ok: false, message: "Looking up dimm-city-components on npm failed." } });
  await h.ctrl.loadExtensions();
  await h.ctrl.checkUpdates();
  expect(h.ctrl.updates).toEqual({ status: "error", checks: [] });
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

test("update and install re-pin in place; the host's warnings still show", async () => {
  const h = make({
    entries: [NPM_LOOK, BUNDLED_LOOK],
    updatesResult: {
      ok: true,
      checks: [{ use: NPM_LOOK.use, name: "house-look", current: "1.0.0", latest: "1.1.0", outdated: true }],
    },
  });
  await h.ctrl.loadExtensions();
  await h.ctrl.checkUpdates();
  h.addWarnings = ["Registry provided legacy SHA-1 integrity."];
  await h.ctrl.update(NPM_LOOK);
  await h.ctrl.install(h.ctrl.entries[0]!);
  expect(named(h, "add").map((c) => c.args[1])).toEqual(["house-look@1.1.0", "house-look@1.1.0"]);
  expect(h.ctrl.entries.map((e) => e.use)).toEqual(["house-look@1.1.0", "academic"]); // still first, re-pinned in place
  expect(h.ctrl.entries[0]!.carries).toEqual(STYLES); // still a look
  expect(h.ctrl.notice).toContain("legacy SHA-1");
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


// ── Install button ───────────────────────────────────────────────────────────

/** A pin whose downloaded copy is missing. */
const MISSING_DC = entry({
  use: "dimm-city-components@1.2.0-alpha.2",
  kind: "npm",
  name: "dimm-city-components",
  version: "1.2.0-alpha.2",
  export: "full",
  carries: MARKDOWN,
  warnings: ["Not installed — run `gutterpress ext add dimm-city-components@1.2.0-alpha.2`."],
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


// ── The Look tab: a gallery of looks, and the extras ─────────────────────────

const ZINE_CARD = { use: "zine", label: "Zine", description: "d", from: null };
const CLEAN = entry({ use: "clean-book", kind: "bundled", label: "Clean Book", carries: STYLES });
const SUB = entry({ use: "markdown-it-sub", kind: "bundled", label: "Subscript", carries: MARKDOWN });

test("galleryLooks: the look in use first, then the built-ins in bundled order, then npm and folder looks, on or off", async () => {
  const house = entry({ use: "../shared/house-style", label: "House style", carries: STYLES });
  const h = make({ entries: [FEATURE, { ...NPM_LOOK, enabled: false }, house] });
  await h.ctrl.loadExtensions();
  expect(h.ctrl.galleryLooks).toEqual([
    { use: house.use, label: "House style", description: "", from: "From a folder" },
    { use: "clean-book", label: "Clean Book", description: "d", from: null },
    ZINE_CARD,
    { use: NPM_LOOK.use, label: "House look", description: "", from: "From npm" },
  ]);
});

test("galleryLooks shows a built-in once: as the ./extensions/<id> copy an older version made of it", async () => {
  const h = make(); // LOOK_A is ./extensions/clean-book
  await h.ctrl.loadExtensions();
  expect(h.ctrl.galleryLooks.map((c) => c.use)).toEqual([LOOK_A.use, "zine"]);
});

test("galleryLooks keeps the order freezeGalleryOrder fixed, so choosing never moves a card", async () => {
  const h = make({ entries: [CLEAN, FEATURE] });
  await h.ctrl.loadExtensions();
  h.ctrl.freezeGalleryOrder();
  await h.ctrl.chooseLook(ZINE_CARD);
  expect(h.ctrl.galleryLooks.map((c) => c.use)).toEqual(["clean-book", "zine"]);
  // The next time the tab opens, the look in use comes first.
  h.ctrl.freezeGalleryOrder();
  expect(h.ctrl.galleryLooks.map((c) => c.use)).toEqual(["zine", "clean-book"]);
});

test("chooseLook: a built-in replaces a built-in at the same place in the list", async () => {
  const h = make({ entries: [FEATURE, CLEAN, SUB] });
  await h.ctrl.loadExtensions();
  await h.ctrl.chooseLook(ZINE_CARD);
  expect(named(h, "add").map((c) => c.args[1])).toEqual(["zine"]);
  expect(named(h, "reorder").map((c) => c.args[1])).toEqual([[FEATURE.use, "zine", "clean-book", SUB.use]]);
  expect(named(h, "remove").map((c) => c.args[1])).toEqual(["clean-book"]);
  expect(h.ctrl.entries.map((e) => e.use)).toEqual([FEATURE.use, "zine", SUB.use]);
  expect(h.afterLookChange.calls.length).toBe(1);
  expect(h.ctrl.saveStatus).toBe("saved");
  expect(h.ctrl.busy).toBeNull();
});

test("chooseLook: an npm look that is replaced is switched off, not removed", async () => {
  const h = make({ entries: [NPM_LOOK, FEATURE] });
  await h.ctrl.loadExtensions();
  await h.ctrl.chooseLook(ZINE_CARD);
  expect(named(h, "remove")).toEqual([]);
  expect(named(h, "setEnabled").map((c) => c.args.slice(1))).toEqual([[NPM_LOOK.use, false]]);
  expect(h.ctrl.entries.map((e) => [e.use, e.enabled])).toEqual([
    ["zine", true],
    [NPM_LOOK.use, false],
    [FEATURE.use, true],
  ]);
});

test("chooseLook: a look already listed but off is switched on in the old look's place", async () => {
  const h = make({ entries: [CLEAN, { ...NPM_LOOK, enabled: false }] });
  await h.ctrl.loadExtensions();
  await h.ctrl.chooseLook({ use: NPM_LOOK.use, label: "House look", description: "", from: "From npm" });
  expect(named(h, "add")).toEqual([]);
  expect(named(h, "setEnabled").map((c) => c.args.slice(1))).toEqual([[NPM_LOOK.use, true]]);
  expect(h.ctrl.entries.map((e) => [e.use, e.enabled])).toEqual([[NPM_LOOK.use, true]]);
});

test("chooseLook on a book with no look adds it and moves nothing", async () => {
  const h = make({ entries: [FEATURE] });
  await h.ctrl.loadExtensions();
  await h.ctrl.chooseLook(ZINE_CARD);
  expect(named(h, "add").map((c) => c.args[1])).toEqual(["zine"]);
  expect(named(h, "reorder")).toEqual([]);
  expect(h.ctrl.enabledLooks.map((e) => e.use)).toEqual(["zine"]);
});

test("chooseLook is refused with two looks on (the Extensions tab's to change), and choosing the look in use does nothing", async () => {
  const h = make({ entries: [CLEAN, LOOK_B] });
  await h.ctrl.loadExtensions();
  await h.ctrl.chooseLook({ use: "academic", label: "Academic", description: "d", from: null });
  const one = make({ entries: [CLEAN] });
  await one.ctrl.loadExtensions();
  await one.ctrl.chooseLook({ use: "clean-book", label: "Clean Book", description: "d", from: null });
  for (const x of [h, one]) {
    expect(x.calls.filter((c) => !["list", "readCss"].includes(c.name))).toEqual([]);
    expect(x.ctrl.saveStatus).toBe("idle");
  }
});

test("a failed chooseLook says the book still uses its look", async () => {
  const h = make({ entries: [CLEAN] });
  await h.ctrl.loadExtensions();
  h.failAdd = true;
  await h.ctrl.chooseLook(ZINE_CARD);
  expect(h.ctrl.error).toBe("Couldn't switch to Zine. Your book still uses Clean Book. add failed");
  expect(h.ctrl.saveStatus).toBe("idle");
  expect(named(h, "remove")).toEqual([]);
});

test("unlistedExtras: the built-in extras the book does not list, whether or not they are on; never a look", async () => {
  const h = make({ entries: [FEATURE, { ...SUB, enabled: false }, CLEAN] });
  await h.ctrl.loadExtensions();
  // Highlight and the switched-off Subscript are rows of the list; the rest is for the Add area.
  expect(h.ctrl.unlistedExtras).toEqual([]);
  const book = make({ entries: [FEATURE, CLEAN] });
  await book.ctrl.loadExtensions();
  expect(book.ctrl.unlistedExtras.map((x) => x.use)).toEqual(["markdown-it-sub"]);
  const none = make({ entries: [] });
  await none.ctrl.loadExtensions();
  expect(none.ctrl.unlistedExtras.map((x) => x.use)).toEqual(["markdown-it-mark", "markdown-it-sub"]);
});

test("addExtra adds the built-in by its bundled name, moves it out of the Add area and into the list; nothing to refresh", async () => {
  const h = make({ entries: [FEATURE] });
  await h.ctrl.loadExtensions();
  await h.ctrl.addExtra(REC_SUB);
  expect(named(h, "add").map((c) => c.args.slice(1))).toEqual([["markdown-it-sub", undefined]]);
  expect(h.ctrl.entries.map((e) => e.use)).toEqual(["markdown-it-mark", "markdown-it-sub"]);
  expect(h.ctrl.unlistedExtras).toEqual([]);
  expect(h.ctrl.saveStatus).toBe("saved");
  expect(h.afterLookChange.calls.length).toBe(0);
});

test("removing a built-in extra from the list offers it in the Add area again", async () => {
  const h = make({ entries: [FEATURE] });
  await h.ctrl.loadExtensions();
  expect(h.ctrl.unlistedExtras.map((x) => x.use)).toEqual(["markdown-it-sub"]);
  await h.ctrl.remove(FEATURE);
  expect(h.ctrl.unlistedExtras.map((x) => x.use)).toEqual(["markdown-it-mark", "markdown-it-sub"]);
});

test("a failed addExtra says why and leaves the list as it was", async () => {
  const h = make({ entries: [FEATURE] });
  await h.ctrl.loadExtensions();
  h.failAdd = true;
  await h.ctrl.addExtra(REC_SUB);
  expect(h.ctrl.error).toBe("add failed");
  expect(h.ctrl.saveStatus).toBe("idle");
  expect(h.ctrl.entries.map((e) => e.use)).toEqual(["markdown-it-mark"]);
});
