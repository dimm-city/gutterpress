import { expect, test } from "bun:test";
import { DesignSectionController } from "../../src/lib/routes/design-section-controller.svelte";
import type { ProjectStyle } from "../../src/lib/platform/contract";
import type { ProjectExtensionEntry } from "../../src/lib/platform/dtos";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// page-nav-controller.test / export-controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/** Flush the microtask/macrotask queue so `.then()` commit chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

type Spy = { calls: unknown[][] };
const spy = (): ((...a: unknown[]) => void) & Spy => {
  const fn = ((...a: unknown[]) => {
    fn.calls.push(a);
  }) as ((...a: unknown[]) => void) & Spy;
  fn.calls = [];
  return fn;
};

/** In-memory fs double counting reads/writes, so coalescing is observable. */
class FakeFs {
  files = new Map<string, string>();
  reads = 0;
  writes = 0;
  failNextWrite = false;

  readFile = (path: string): Promise<string> => {
    this.reads++;
    return Promise.resolve(this.files.get(path) ?? "");
  };
  writeFile = (path: string, content: string): Promise<{ mtimeMs: number }> => {
    this.writes++;
    if (this.failNextWrite) {
      this.failNextWrite = false;
      return Promise.reject(new Error("disk full"));
    }
    this.files.set(path, content);
    return Promise.resolve({ mtimeMs: 1 });
  };
}

/** Single-slot fake timer: the controller only ever has one flush timer live. */
class FakeTimer {
  pending: (() => void) | null = null;
  set = (fn: () => void): number => {
    this.pending = fn;
    return 1;
  };
  clear = (): void => {
    this.pending = null;
  };
  /** Simulate the debounce window elapsing. */
  fire(): void {
    const fn = this.pending;
    this.pending = null;
    fn?.();
  }
}

const ROOT_CSS = `:root {\n  --heading-color: #cc0000;\n  --body-size: 1rem;\n}\n`;

interface Harness {
  ctrl: DesignSectionController;
  fs: FakeFs;
  timer: FakeTimer;
  onError: ReturnType<typeof spy>;
  setActiveStyles: ReturnType<typeof spy>;
  styles: ProjectStyle[];
  projectDir: string | null;
}

function make(over: Partial<{ cssPath: string; noProject: boolean; css: string }> = {}): Harness {
  const cssPath = over.cssPath ?? "/proj/styles/theme.css";
  const fs = new FakeFs();
  fs.files.set(cssPath, over.css ?? ROOT_CSS);
  const timer = new FakeTimer();
  const onError = spy();
  const setActiveStyles = spy();
  const h = {
    fs,
    timer,
    onError,
    setActiveStyles,
    styles: [{ path: cssPath, displayName: "styles/theme.css", active: true }],
    projectDir: over.noProject ? null : "/proj",
  } as Harness;
  h.ctrl = new DesignSectionController({
    projectDir: () => h.projectDir,
    listStyles: () => Promise.resolve(h.styles),
    listExtensions: () => Promise.resolve([]),
    readCss: () => Promise.reject(new Error("no extensions")),
    readFile: fs.readFile,
    writeFile: fs.writeFile,
    setActiveStyles: (dir, paths) => Promise.resolve(setActiveStyles(dir, paths)),
    onError: (m) => onError(m),
    debounceMs: 250,
    setTimer: timer.set,
    clearTimer: timer.clear,
  });
  return h;
}

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.cssPath).toBeNull();
  expect(ctrl.cssName).toBe("");
  expect(ctrl.tokens).toEqual([]);
  expect(ctrl.designLoading).toBe(false);
  expect(ctrl.designError).toBeNull();
  expect(ctrl.designSaveStatus).toBe("idle");
  expect(ctrl.anyDirty).toBe(false);
});

test("loadDesign resolves the active stylesheet and parses its :root tokens", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  expect(h.ctrl.cssPath).toBe("/proj/styles/theme.css");
  expect(h.ctrl.cssName).toBe("styles/theme.css");
  expect(h.ctrl.designLoading).toBe(false);
  expect(h.ctrl.designError).toBeNull();
  expect(h.ctrl.tokens.map((t) => t.name)).toEqual(["--heading-color", "--body-size"]);
  expect(h.ctrl.colorTokens.map((t) => t.name)).toEqual(["--heading-color"]);
  expect(h.ctrl.sizeTokens.map((t) => t.name)).toEqual(["--body-size"]);
  // Freshly loaded → nothing dirty.
  expect(h.ctrl.anyDirty).toBe(false);
});

test("loadDesign no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadDesign();
  expect(h.ctrl.cssPath).toBeNull();
  expect(h.ctrl.tokens).toEqual([]);
});

test("loadDesign clears cssPath when there are no styles", async () => {
  const h = make();
  h.styles = [];
  await h.ctrl.loadDesign();
  expect(h.ctrl.cssPath).toBeNull();
  expect(h.ctrl.cssName).toBe("");
});

test("setToken marks the section saving and dirty but does not write until the debounce fires", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const t = h.ctrl.colorTokens[0];
  const writesBefore = h.fs.writes;
  h.ctrl.setToken(t, "#00ff00");
  expect(t.value).toBe("#00ff00");
  expect(h.ctrl.isDirty(t)).toBe(true);
  expect(h.ctrl.anyDirty).toBe(true);
  expect(h.ctrl.designSaveStatus).toBe("saving");
  // Debounce hasn't elapsed → no write yet.
  expect(h.fs.writes).toBe(writesBefore);
  // Fire the debounce → single read + write, status flips to saved.
  h.timer.fire();
  await flush();
  expect(h.fs.writes).toBe(writesBefore + 1);
  expect(h.ctrl.designSaveStatus).toBe("saved");
  expect(h.fs.files.get("/proj/styles/theme.css")).toContain("--heading-color: #00ff00;");
});

test("two edits inside one debounce window coalesce into a single read-modify-write", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const color = h.ctrl.colorTokens[0];
  const size = h.ctrl.sizeTokens[0];
  h.fs.reads = 0;
  h.fs.writes = 0;
  h.ctrl.setToken(color, "#123456");
  h.ctrl.setLength(size, "2"); // -> "2rem"
  // Only the latest timer is live; firing it commits BOTH edits at once.
  h.timer.fire();
  await flush();
  expect(h.fs.writes).toBe(1);
  expect(h.fs.reads).toBe(1);
  const out = h.fs.files.get("/proj/styles/theme.css")!;
  expect(out).toContain("--heading-color: #123456;");
  expect(out).toContain("--body-size: 2rem;");
  expect(h.ctrl.designSaveStatus).toBe("saved");
});

test("resetToken reverts a dirty token to its original and schedules a write", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const t = h.ctrl.colorTokens[0];
  h.ctrl.setToken(t, "#00ff00");
  h.timer.fire();
  await flush();
  expect(h.ctrl.isDirty(t)).toBe(true);
  h.ctrl.resetToken(t);
  expect(t.value).toBe("#cc0000");
  h.timer.fire();
  await flush();
  expect(h.ctrl.isDirty(t)).toBe(false);
  expect(h.fs.files.get("/proj/styles/theme.css")).toContain("--heading-color: #cc0000;");
});

test("revertAllTokens restores every dirty token", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  h.ctrl.setToken(h.ctrl.colorTokens[0], "#00ff00");
  h.ctrl.setLength(h.ctrl.sizeTokens[0], "3");
  h.timer.fire();
  await flush();
  expect(h.ctrl.anyDirty).toBe(true);
  h.ctrl.revertAllTokens();
  h.timer.fire();
  await flush();
  expect(h.ctrl.anyDirty).toBe(false);
  const out = h.fs.files.get("/proj/styles/theme.css")!;
  expect(out).toContain("--heading-color: #cc0000;");
  expect(out).toContain("--body-size: 1rem;");
});

test("setLength ignores blank input (no schedule)", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const size = h.ctrl.sizeTokens[0];
  h.ctrl.designSaveStatus = "idle";
  h.ctrl.setLength(size, "   ");
  expect(h.ctrl.designSaveStatus).toBe("idle");
  expect(h.timer.pending).toBeNull();
});

test("a failed write re-queues the batch, surfaces the error in the tab and onError, and drops to idle", async () => {
  const h = make();
  await h.ctrl.loadDesign();
  const t = h.ctrl.colorTokens[0];
  h.fs.failNextWrite = true;
  h.ctrl.setToken(t, "#00ff00");
  expect(await h.ctrl.flushPendingTokenWrites()).toBe(false); // Book setup stays open on the error
  expect(h.ctrl.designSaveError).toBe("Couldn't save your change: disk full");
  expect(h.onError.calls.length).toBe(1);
  expect(String(h.onError.calls[0][0])).toContain("disk full");
  expect(h.ctrl.designSaveStatus).toBe("idle");
  // The batch is re-queued: a later successful flush persists it.
  h.ctrl.flushPendingTokenWrites();
  await flush();
  expect(h.fs.files.get("/proj/styles/theme.css")).toContain("--heading-color: #00ff00;");
});

test("a stylesheet switch during a token-write commit never redirects the old sheet's tokens into the new file (finding #10)", async () => {
  const OLD = "/proj/styles/old.css";
  const NEW = "/proj/styles/new.css";
  const NEW_ORIGINAL = ":root {\n  --heading-color: #0000ff;\n}\n";
  const files = new Map<string, string>([
    [OLD, ":root {\n  --heading-color: #cc0000;\n}\n"],
    [NEW, NEW_ORIGINAL],
  ]);
  const writes: Array<{ path: string; content: string }> = [];

  // A one-shot gate: the NEXT readFile blocks until released, so we can switch
  // the active stylesheet while a commit is parked on its read-before-write.
  let releaseGatedRead: (() => void) | null = null;
  let armGate = false;
  const readFile = (path: string): Promise<string> => {
    const content = files.get(path) ?? "";
    if (armGate) {
      armGate = false;
      return new Promise<string>((resolve) => {
        releaseGatedRead = () => resolve(content);
      });
    }
    return Promise.resolve(content);
  };
  const writeFile = (path: string, content: string): Promise<{ mtimeMs: number }> => {
    writes.push({ path, content });
    files.set(path, content);
    return Promise.resolve({ mtimeMs: 1 });
  };

  const timer = new FakeTimer();
  let styles: ProjectStyle[] = [{ path: OLD, displayName: "old.css", active: true }];
  const ctrl = new DesignSectionController({
    projectDir: () => "/proj",
    listStyles: () => Promise.resolve(styles),
    listExtensions: () => Promise.resolve([]),
    readCss: () => Promise.reject(new Error("no extensions")),
    readFile,
    writeFile,
    setActiveStyles: () => Promise.resolve(),
    onError: () => {},
    debounceMs: 250,
    setTimer: timer.set,
    clearTimer: timer.clear,
  });

  await ctrl.loadDesign(); // cssPath = OLD (this read is ungated)
  expect(ctrl.cssPath).toBe(OLD);
  ctrl.setToken(ctrl.colorTokens[0], "#00ff00"); // schedules a pending write on OLD

  // Fire the debounce with the gate armed: commitPendingTokens reads OLD and
  // parks on the gate, mid read-before-write.
  armGate = true;
  timer.fire();
  await flush();
  expect(releaseGatedRead).not.toBeNull(); // commit is parked on the read

  // Concurrent stylesheet switch while the commit is parked.
  styles = [{ path: NEW, displayName: "new.css", active: true }];
  await ctrl.loadDesign();
  expect(ctrl.cssPath).toBe(NEW);

  // Release the parked read; the commit's write now runs.
  releaseGatedRead!();
  await flush();

  // The write must land on OLD (the captured path), never the newly selected
  // NEW file — and NEW's content must be exactly what loadDesign parsed.
  expect(writes.map((w) => w.path)).toEqual([OLD]);
  expect(files.get(NEW)).toBe(NEW_ORIGINAL);
  expect(files.get(OLD)).toContain("--heading-color: #00ff00;");
});

// ── Theme-curated groups (issue #244) ───────────────────────────────────────
//
// `parseStyleTokens` (unit-tested on its own in style-tokens.test.ts) does the
// annotation scanning; these tests cover what the CONTROLLER does with the
// result — claiming grouped tokens out of the heuristic buckets and exposing
// them, in source order, via `customGroups`.

test("an unannotated stylesheet produces no custom groups (no regression)", async () => {
  const h = make(); // ROOT_CSS carries no annotation comments
  await h.ctrl.loadDesign();
  expect(h.ctrl.customGroups).toEqual([]);
  expect(h.ctrl.colorTokens.map((t) => t.name)).toEqual(["--heading-color"]);
  expect(h.ctrl.sizeTokens.map((t) => t.name)).toEqual(["--body-size"]);
});

test("customGroups buckets @group-annotated tokens in first-seen order and excludes them from the heuristic getters", async () => {
  const css = [
    ":root {",
    "  /* @group Colors */",
    "  --color-accent: #2b4c7e;",
    "  /* @group Typography */",
    "  --font-body: Georgia, serif;",
    "  /* @group Colors */",
    "  --color-secondary: #112233;",
    "  --plain-size: 1rem;", // no annotation — stays heuristic
    "}",
  ].join("\n");
  const h = make({ css });
  await h.ctrl.loadDesign();

  expect(h.ctrl.customGroups.map((g) => g.name)).toEqual(["Colors", "Typography"]);
  expect(h.ctrl.customGroups[0]!.tokens.map((t) => t.name)).toEqual([
    "--color-accent",
    "--color-secondary",
  ]);
  expect(h.ctrl.customGroups[1]!.tokens.map((t) => t.name)).toEqual(["--font-body"]);

  // Claimed by a custom group -> not also duplicated into the heuristic buckets.
  expect(h.ctrl.colorTokens).toEqual([]);
  expect(h.ctrl.fontTokens).toEqual([]);
  // The unannotated token still falls through to its heuristic bucket.
  expect(h.ctrl.sizeTokens.map((t) => t.name)).toEqual(["--plain-size"]);
});

test("fontTokens is a controller getter that also respects @group exclusion", async () => {
  const css = `:root {\n  --font-body: Georgia, serif;\n  --font-display: Impact, sans-serif;\n}\n`;
  const h = make({ css });
  await h.ctrl.loadDesign();
  expect(h.ctrl.fontTokens.map((t) => t.name)).toEqual(["--font-body", "--font-display"]);
});

test("@internal tokens never reach the controller's tokens list", async () => {
  const css = [
    ":root {",
    "  --color-accent: #2b4c7e;",
    "  /* @internal */",
    "  --dc-skill-tab-shape: polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%);",
    "}",
  ].join("\n");
  const h = make({ css });
  await h.ctrl.loadDesign();
  expect(h.ctrl.tokens.map((t) => t.name)).toEqual(["--color-accent"]);
});

test("a stylesheet that is entirely @internal tokens loads as empty (the panel's 'no settings yet' state)", async () => {
  const css = `:root {\n  /* @internal */\n  --dc-skill-tab-shape: polygon(0 0, 1px 1px);\n}\n`;
  const h = make({ css });
  await h.ctrl.loadDesign();
  expect(h.ctrl.tokens).toEqual([]);
  expect(h.ctrl.designError).toBeNull();
});

// ── Every enabled look's tokens, written to the book's own stylesheet ────────
//
// The panel shows the `:root` tokens of every ENABLED extension that carries
// styles — bundled, npm or path alike, read through `readCss` in cascade
// order — overlaid with the book's active stylesheet, which loads last and
// wins. An edit lands in that book stylesheet only; a look's files are never
// written.

const STYLES_ONLY = { markdown: false, styles: true, snippets: false, components: false };
const BOOK = "/proj/styles/book.css";

function look(over: Partial<ProjectExtensionEntry> & { use: string }): ProjectExtensionEntry {
  return { kind: "path", name: over.use, enabled: true, label: over.use, carries: STYLES_ONLY, ...over };
}

const CLEAN_BOOK = look({ use: "clean-book", kind: "bundled" });
const HOUSE = look({ use: "./extensions/house", dir: "/proj/extensions/house" });
const FROM_NPM = look({ use: "@acme/look@1.0.0", kind: "npm", name: "@acme/look", version: "1.0.0" });

/** A book with looks: `css` maps each look's `use` to what `readCss` returns;
 *  a null `bookCss` is a book with no stylesheet of its own yet. */
function lookHarness(extensions: ProjectExtensionEntry[], css: Record<string, string>, bookCss: string | null) {
  const fs = new FakeFs();
  if (bookCss !== null) fs.files.set(BOOK, bookCss);
  const timer = new FakeTimer();
  const readCssCalls: string[] = [];
  const written: string[] = [];
  const setActive: string[][] = [];
  const ctrl = new DesignSectionController({
    projectDir: () => "/proj",
    listStyles: () =>
      Promise.resolve(bookCss === null ? [] : [{ path: BOOK, displayName: "styles/book.css", active: true }]),
    listExtensions: () => Promise.resolve(extensions),
    readCss: (_dir, use) => {
      readCssCalls.push(use);
      return use in css ? Promise.resolve(css[use]!) : Promise.reject(new Error(`no stylesheets for ${use}`));
    },
    readFile: fs.readFile,
    writeFile: (path, content) => {
      written.push(path);
      return fs.writeFile(path, content);
    },
    setActiveStyles: (_dir, paths) => {
      setActive.push(paths);
      return Promise.resolve();
    },
    setTimer: timer.set,
    clearTimer: timer.clear,
  });
  return { ctrl, fs, timer, readCssCalls, written, setActive };
}

const tokenValues = (ctrl: DesignSectionController) => Object.fromEntries(ctrl.tokens.map((t) => [t.name, t.value]));

test("loadDesign shows the tokens of every enabled look — bundled, npm and path — in cascade order", async () => {
  const h = lookHarness(
    [CLEAN_BOOK, FROM_NPM, HOUSE],
    {
      "clean-book": ":root { --color-accent: #2b4c7e; --fs-body: 11pt; }",
      "@acme/look@1.0.0": ":root { --acme-rule: 1px; }",
      "./extensions/house": ":root { --house-tint: #eee; }",
    },
    "/* Your book's own styles. */\n",
  );
  await h.ctrl.loadDesign();
  expect(h.readCssCalls).toEqual(["clean-book", "@acme/look@1.0.0", "./extensions/house"]);
  expect(h.ctrl.tokens.map((t) => t.name)).toEqual(["--color-accent", "--fs-body", "--acme-rule", "--house-tint"]);
  // The panel names the sheet it writes: the book's own, never a look's.
  expect(h.ctrl.cssPath).toBe(BOOK);
  expect(h.ctrl.cssName).toBe("styles/book.css");
  expect(h.ctrl.anyDirty).toBe(false);
});

test("a later look wins a duplicate token, and the book's own sheet wins over every look", async () => {
  const h = lookHarness(
    [CLEAN_BOOK, HOUSE],
    {
      "clean-book": ":root {\n  /* @group Brand */\n  --color-accent: #2b4c7e;\n  --fs-body: 11pt;\n  --leading: 1.55;\n}",
      "./extensions/house": ":root { --color-accent: #7b2f8a; --fs-body: 12pt; }",
    },
    ":root {\n  --fs-body: 10.5pt;\n  --book-only: 2;\n}\n",
  );
  await h.ctrl.loadDesign();
  expect(tokenValues(h.ctrl)).toEqual({
    "--color-accent": "#7b2f8a",
    "--fs-body": "10.5pt",
    "--leading": "1.55",
    "--book-only": "2",
  });
  // A token keeps the place and the group its first declaration gave it.
  expect(h.ctrl.tokens.map((t) => t.name)).toEqual(["--color-accent", "--fs-body", "--leading", "--book-only"]);
  expect(h.ctrl.customGroups.map((g) => [g.name, g.tokens.map((t) => t.name)])).toEqual([["Brand", ["--color-accent"]]]);
});

test("disabled looks and extensions that carry no styles contribute nothing", async () => {
  const h = lookHarness(
    [
      { ...HOUSE, enabled: false },
      look({ use: "markdown-it-mark", kind: "bundled", carries: { ...STYLES_ONLY, styles: false, markdown: true } }),
      CLEAN_BOOK,
    ],
    { "clean-book": ":root { --color-accent: #2b4c7e; }", "./extensions/house": ":root { --house-tint: #eee; }" },
    "",
  );
  await h.ctrl.loadDesign();
  expect(h.readCssCalls).toEqual(["clean-book"]);
  expect(h.ctrl.tokens.map((t) => t.name)).toEqual(["--color-accent"]);
});

test("a look whose CSS can't be read (a missing folder) is skipped; the rest still load", async () => {
  const h = lookHarness([HOUSE, CLEAN_BOOK], { "clean-book": ":root { --color-accent: #2b4c7e; }" }, "");
  await h.ctrl.loadDesign();
  expect(h.ctrl.designError).toBeNull();
  expect(h.ctrl.tokens.map((t) => t.name)).toEqual(["--color-accent"]);
});

test("editing a look's token adds it to the book's :root block — the look's CSS is never written", async () => {
  const BOOK_CSS = "/* Your book's own styles. */\n:root {\n  --book-only: 2;\n}\n";
  const h = lookHarness([CLEAN_BOOK], { "clean-book": ":root { --color-accent: #2b4c7e; --book-only: 1; }" }, BOOK_CSS);
  await h.ctrl.loadDesign();
  h.ctrl.setToken(h.ctrl.colorTokens[0]!, "#7b2f8a");
  h.timer.fire();
  await flush();
  expect(h.written).toEqual([BOOK]);
  expect(h.fs.files.get(BOOK)).toBe("/* Your book's own styles. */\n:root {\n  --color-accent: #7b2f8a;\n  --book-only: 2;\n}\n");
  expect(h.ctrl.designSaveStatus).toBe("saved");
});

test("editing a token the book already declares updates that declaration in place", async () => {
  const h = lookHarness([CLEAN_BOOK], { "clean-book": ":root { --fs-body: 11pt; }" }, ":root {\n  --fs-body: 10.5pt;\n}\n");
  await h.ctrl.loadDesign();
  h.ctrl.setLength(h.ctrl.sizeTokens[0]!, "12");
  h.timer.fire();
  await flush();
  expect(h.written).toEqual([BOOK]);
  expect(h.fs.files.get(BOOK)).toBe(":root {\n  --fs-body: 12pt;\n}\n");
});

test("a book sheet with no :root block gets one, after the starter comment", async () => {
  const STARTER = "/**\n * Your book's own styles.\n */\n";
  const h = lookHarness([CLEAN_BOOK], { "clean-book": ":root { --color-accent: #2b4c7e; }" }, STARTER);
  await h.ctrl.loadDesign();
  h.ctrl.setToken(h.ctrl.colorTokens[0]!, "#112233");
  h.timer.fire();
  await flush();
  expect(h.written).toEqual([BOOK]);
  expect(h.fs.files.get(BOOK)).toBe(`${STARTER}:root {\n  --color-accent: #112233;\n}\n`);
});

// Revert is an undo: a token only a look declares must not end up pinned in
// the book's sheet at the look's value, or a later look change never shows.

test("reverting a look's token takes the book's declaration out again — the sheet is byte-identical", async () => {
  const STARTER = "/* mine */\n";
  const h = lookHarness([CLEAN_BOOK], { "clean-book": ":root { --color-accent: #2b4c7e; --fs-body: 11pt; }" }, STARTER);
  await h.ctrl.loadDesign();
  h.ctrl.setToken(h.ctrl.colorTokens[0]!, "#ff0000");
  h.ctrl.setLength(h.ctrl.sizeTokens[0]!, "12");
  h.timer.fire();
  await flush();
  expect(h.fs.files.get(BOOK)).toBe(`${STARTER}:root {\n  --fs-body: 12pt;\n  --color-accent: #ff0000;\n}\n`);
  h.ctrl.revertAllTokens();
  expect(tokenValues(h.ctrl)).toEqual({ "--color-accent": "#2b4c7e", "--fs-body": "11pt" });
  expect(h.ctrl.anyDirty).toBe(false);
  h.timer.fire();
  await flush();
  expect(h.written).toEqual([BOOK, BOOK]);
  expect(h.fs.files.get(BOOK)).toBe(STARTER);
  expect(h.ctrl.designSaveStatus).toBe("saved");
});

test("reverting a token the book declares puts the book's own value back", async () => {
  const BOOK_CSS = ":root {\n  --color-accent: #7b2f8a;\n}\n";
  const h = lookHarness([CLEAN_BOOK], { "clean-book": ":root { --color-accent: #2b4c7e; }" }, BOOK_CSS);
  await h.ctrl.loadDesign();
  const accent = h.ctrl.colorTokens[0]!;
  h.ctrl.setToken(accent, "#ff0000");
  h.timer.fire();
  await flush();
  h.ctrl.resetToken(accent);
  expect(accent.value).toBe("#7b2f8a");
  h.timer.fire();
  await flush();
  expect(h.written).toEqual([BOOK, BOOK]);
  expect(h.fs.files.get(BOOK)).toBe(BOOK_CSS);
});

test("an edit after a revert in the same debounce window wins over the queued removal", async () => {
  const h = lookHarness([CLEAN_BOOK], { "clean-book": ":root { --color-accent: #2b4c7e; }" }, "");
  await h.ctrl.loadDesign();
  const accent = h.ctrl.colorTokens[0]!;
  h.ctrl.setToken(accent, "#ff0000");
  h.ctrl.resetToken(accent);
  h.ctrl.setToken(accent, "#00ff00");
  h.timer.fire();
  await flush();
  expect(h.written).toEqual([BOOK]);
  expect(h.fs.files.get(BOOK)).toBe(":root {\n  --color-accent: #00ff00;\n}\n");
});

test("lookLabels names the enabled styles-carrying entries after load, in cascade order", async () => {
  const h = lookHarness(
    [look({ ...CLEAN_BOOK, label: "Clean book" }), { ...HOUSE, enabled: false }, look({ use: "markdown-it-mark", kind: "bundled", label: "Highlight", carries: { ...STYLES_ONLY, styles: false, markdown: true } }), look({ ...FROM_NPM, label: "Acme look" })],
    { "clean-book": ":root { --color-accent: #2b4c7e; }", "@acme/look@1.0.0": ":root { --acme-rule: 1px; }" },
    "",
  );
  expect(h.ctrl.lookLabels).toEqual([]);
  await h.ctrl.loadDesign();
  expect(h.ctrl.lookLabels).toEqual(["Clean book", "Acme look"]);
});

// A book override of a look's token written in an earlier session is clean
// (not dirty) after a fresh load, yet the author must still be able to drop
// it: "Use the look's value" removes the book's declaration.

test("a book override of a look token shows as overriding after a fresh load and is not dirty", async () => {
  const h = lookHarness(
    [CLEAN_BOOK],
    { "clean-book": ":root { --color-accent: #2b4c7e; --fs-body: 11pt; }" },
    ":root {\n  --color-accent: #7b2f8a;\n  --book-only: 2;\n}\n",
  );
  await h.ctrl.loadDesign();
  const accent = h.ctrl.tokens.find((t) => t.name === "--color-accent")!;
  const body = h.ctrl.tokens.find((t) => t.name === "--fs-body")!;
  const own = h.ctrl.tokens.find((t) => t.name === "--book-only")!;
  expect(h.ctrl.isDirty(accent)).toBe(false);
  expect(h.ctrl.overridesLook(accent)).toBe(true);
  expect(h.ctrl.lookValue(accent)).toBe("#2b4c7e");
  // A look token the book leaves alone, and a token only the book declares, offer nothing.
  expect(h.ctrl.overridesLook(body)).toBe(false);
  expect(h.ctrl.overridesLook(own)).toBe(false);
  expect(h.ctrl.lookValue(own)).toBeUndefined();
  expect(h.ctrl.anyDirty).toBe(false);
});

test("resetToken on an overriding token removes the declaration from the book sheet and the row stops overriding", async () => {
  const h = lookHarness(
    [CLEAN_BOOK],
    { "clean-book": ":root { --color-accent: #2b4c7e; }" },
    ":root {\n  --color-accent: #7b2f8a;\n  --book-only: 2;\n}\n",
  );
  await h.ctrl.loadDesign();
  const accent = h.ctrl.tokens.find((t) => t.name === "--color-accent")!;
  h.ctrl.resetToken(accent);
  expect(accent.value).toBe("#2b4c7e");
  expect(h.ctrl.overridesLook(accent)).toBe(false);
  expect(h.ctrl.isDirty(accent)).toBe(false);
  h.timer.fire();
  await flush();
  expect(h.written).toEqual([BOOK]);
  expect(h.fs.files.get(BOOK)).toBe(":root {\n  --book-only: 2;\n}\n");
  expect(h.ctrl.designSaveStatus).toBe("saved");
  // Editing it again from here is an ordinary edit; its reset removes the declaration again.
  h.ctrl.setToken(accent, "#ff0000");
  expect(h.ctrl.isDirty(accent)).toBe(true);
  h.ctrl.resetToken(accent);
  expect(accent.value).toBe("#2b4c7e");
  h.timer.fire();
  await flush();
  expect(h.fs.files.get(BOOK)).toBe(":root {\n  --book-only: 2;\n}\n");
});

test("revertAllTokens leaves stored overrides alone (it undoes this session only)", async () => {
  const h = lookHarness(
    [CLEAN_BOOK],
    { "clean-book": ":root { --color-accent: #2b4c7e; --fs-body: 11pt; }" },
    ":root {\n  --color-accent: #7b2f8a;\n}\n",
  );
  await h.ctrl.loadDesign();
  const body = h.ctrl.tokens.find((t) => t.name === "--fs-body")!;
  h.ctrl.setLength(body, "12");
  h.ctrl.revertAllTokens();
  expect(h.ctrl.anyDirty).toBe(false);
  h.timer.fire();
  await flush();
  const accent = h.ctrl.tokens.find((t) => t.name === "--color-accent")!;
  expect(accent.value).toBe("#7b2f8a");
  expect(h.ctrl.overridesLook(accent)).toBe(true);
  expect(h.fs.files.get(BOOK)).toBe(":root {\n  --color-accent: #7b2f8a;\n}\n");
});

test("loadDesign tolerates a failing extension list — the book's own tokens still load", async () => {
  const ctrl = new DesignSectionController({
    projectDir: () => "/proj",
    listStyles: () => Promise.resolve([{ path: BOOK, displayName: "styles/book.css", active: true }]),
    listExtensions: () => Promise.reject(new Error("no manifest")),
    readCss: () => Promise.reject(new Error("unreachable")),
    readFile: () => Promise.resolve(":root { --c: 3; }\n"),
    writeFile: () => Promise.resolve(undefined),
    setActiveStyles: () => Promise.resolve(),
  });
  await ctrl.loadDesign();
  expect(ctrl.cssPath).toBe(BOOK);
  expect(ctrl.tokens.map((t) => t.name)).toEqual(["--c"]);
  expect(ctrl.designError).toBeNull();
});

// ── The Look tab: six brand settings, a live sample, a stylesheet on demand ──

const CLEAN_CSS =
  ":root { --color-ink: #1a1a1a; --color-accent: #2b4c7e; --font-body: Georgia, serif; --font-display: Georgia, serif; --fs-body: 11pt; --leading: 1.55; --space-md: 1rem; }";

test("brandTokens are the six brand settings a look or the book declares, in the Look tab's order", async () => {
  const h = lookHarness([CLEAN_BOOK], { "clean-book": CLEAN_CSS }, "");
  await h.ctrl.loadDesign();
  expect(h.ctrl.brandTokens.map((t) => t.name)).toEqual([
    "--font-body",
    "--font-display",
    "--fs-body",
    "--leading",
    "--color-ink",
    "--color-accent",
  ]);
  // A look that declares none of them has no quick settings.
  const other = lookHarness([HOUSE], { "./extensions/house": ":root { --house-tint: #eee; }" }, "");
  await other.ctrl.loadDesign();
  expect(other.ctrl.brandTokens).toEqual([]);
});

test("brandOverridden: the book sets a brand setting a look also sets, or one was changed here", async () => {
  const plain = lookHarness([CLEAN_BOOK], { "clean-book": CLEAN_CSS }, ":root {\n  --space-md: 2rem;\n}\n");
  await plain.ctrl.loadDesign();
  expect(plain.ctrl.brandOverridden).toBe(false); // the book's own token is not a brand setting
  plain.ctrl.setToken(plain.ctrl.brandTokens[4]!, "#000000");
  expect(plain.ctrl.brandOverridden).toBe(true);

  const stored = lookHarness([CLEAN_BOOK], { "clean-book": CLEAN_CSS }, ":root {\n  --color-accent: #c0392b;\n}\n");
  await stored.ctrl.loadDesign();
  expect(stored.ctrl.brandOverridden).toBe(true);
});

test("resetBrand puts the look's brand settings back and takes the book's declarations of them out", async () => {
  const h = lookHarness(
    [CLEAN_BOOK],
    { "clean-book": CLEAN_CSS },
    ":root {\n  --color-accent: #c0392b;\n  --space-md: 2rem;\n}\n",
  );
  await h.ctrl.loadDesign();
  h.ctrl.setLength(h.ctrl.brandTokens.find((t) => t.name === "--fs-body")!, "12");
  h.ctrl.resetBrand();
  expect(tokenValues(h.ctrl)).toMatchObject({ "--color-accent": "#2b4c7e", "--fs-body": "11pt", "--space-md": "2rem" });
  expect(h.ctrl.brandOverridden).toBe(false);
  expect(h.ctrl.anyDirty).toBe(false);
  h.timer.fire();
  await flush();
  // Only the brand settings went; the book's other token stays.
  expect(h.fs.files.get(BOOK)).toBe(":root {\n  --space-md: 2rem;\n}\n");
});

test("sampleDoc is the enabled looks' CSS with the current values on top, and follows an edit", async () => {
  const h = lookHarness([CLEAN_BOOK], { "clean-book": CLEAN_CSS }, "");
  await h.ctrl.loadDesign();
  expect(h.ctrl.sampleDoc).toContain(CLEAN_CSS);
  expect(h.ctrl.sampleDoc).toContain("--color-accent:#2b4c7e;");
  h.ctrl.setToken(h.ctrl.brandTokens.find((t) => t.name === "--color-accent")!, "#c0392b");
  expect(h.ctrl.sampleDoc).toContain("--color-accent:#c0392b;");
});

test("a book with no stylesheet still shows its look's settings; the first edit creates styles/book.css and lists it", async () => {
  const h = lookHarness([CLEAN_BOOK], { "clean-book": CLEAN_CSS }, null);
  await h.ctrl.loadDesign();
  expect(h.ctrl.cssPath).toBeNull();
  expect(h.ctrl.brandTokens.length).toBe(6);
  h.ctrl.setToken(h.ctrl.brandTokens.find((t) => t.name === "--color-accent")!, "#c0392b");
  h.timer.fire();
  await flush();
  expect(h.setActive).toEqual([["styles/book.css"]]);
  expect(h.written).toEqual([BOOK, BOOK]); // created, then the edit
  expect(h.fs.files.get(BOOK)).toBe(":root {\n  --color-accent: #c0392b;\n}\n");
  expect(h.ctrl.cssPath).toBe(BOOK);
  expect(h.ctrl.cssName).toBe("styles/book.css");
  expect(h.ctrl.designSaveStatus).toBe("saved");
  // Once there is one, it is the one: nothing more is created.
  expect(await h.ctrl.ensureStylesheet()).toBe(BOOK);
  expect(h.setActive.length).toBe(1);
});
