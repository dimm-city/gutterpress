import { expect, test } from "bun:test";
import { DetailsSectionController } from "../../src/lib/routes/details-section-controller.svelte";
import type { PageMargin, PageSetup, PageSizeChoice, ProjectConfigFields } from "../../src/lib/api";

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

/** Flush the microtask queue so a `void flushPendingSave()` settles. */
const settle = () => new Promise((r) => setTimeout(r, 0));

/** The book template's margins (clean-book's old values), recorded in the manifest. */
const BOOK_MARGINS: PageMargin = { top: 61.2, bottom: 61.2, inside: 54, outside: 54 };
/** The engine's 1in, for a book that sets none and whose stylesheets set none. */
const INCH: PageMargin = { top: 72, bottom: 72, inside: 72, outside: 72 };

const BOOK_SETUP: PageSetup = {
  preset: "book",
  bounds: { width: 432, height: 648, tolerance: 0.5 },
  margins: BOOK_MARGINS,
  marginsFrom: "manifest",
};

interface Harness {
  ctrl: DetailsSectionController;
  onError: ReturnType<typeof spy>;
  projectDir: string | null;
  fields: ProjectConfigFields;
  allFiles: string[];
  readCalls: number;
  listCalls: number;
  writeCalls: Array<{ dir: string; updates: ProjectConfigFields }>;
  pageWrites: PageSizeChoice[];
  /** What `readPageSetup` answers (null = the fake rejects: no page-size control). */
  pageSetup: PageSetup | null;
  failNextWrite: boolean;
  failList: boolean;
  /** When set, the next `writeManifest` parks until released (for the in-flight test). */
  gateNextWrite: boolean;
  releaseWrite: (() => void) | null;
  /** When set, `readPageSetup` waits for it (a load still in progress). */
  holdPageRead: Promise<void> | null;
  /** When set, `writePageSetup` waits for it (a page write in flight). */
  holdPageWrite: Promise<void> | null;
  /** When set, the next `writePageSetup` rejects. */
  failNextPageWrite: boolean;
}

function make(
  over: Partial<{ noProject: boolean; fields: ProjectConfigFields; allFiles: string[]; pageSetup: PageSetup | null }> = {},
): Harness {
  const onError = spy();
  const h = {
    onError,
    projectDir: over.noProject ? null : "/proj",
    fields: over.fields ?? { title: "My Book", authors: ["A", "B"], sourceFiles: ["a.md", "b.md"] },
    allFiles: over.allFiles ?? ["a.md", "b.md", "c.md"],
    readCalls: 0,
    listCalls: 0,
    writeCalls: [],
    pageWrites: [],
    pageSetup: over.pageSetup === undefined ? BOOK_SETUP : over.pageSetup,
    failNextWrite: false,
    failList: false,
    gateNextWrite: false,
    releaseWrite: null,
    holdPageRead: null,
    holdPageWrite: null,
    failNextPageWrite: false,
  } as Harness;
  h.ctrl = new DetailsSectionController({
    projectDir: () => h.projectDir,
    readManifest: () => {
      h.readCalls++;
      return Promise.resolve(h.fields);
    },
    writeManifest: async (dir, updates) => {
      h.writeCalls.push({ dir, updates });
      if (h.gateNextWrite) {
        h.gateNextWrite = false;
        await new Promise<void>((resolve) => {
          h.releaseWrite = resolve;
        });
      }
      if (h.failNextWrite) {
        h.failNextWrite = false;
        throw new Error("disk full");
      }
      const out = { ...h.fields, ...updates };
      h.fields = out;
      return out;
    },
    listMarkdownFiles: () => {
      h.listCalls++;
      if (h.failList) return Promise.reject(new Error("scan failed"));
      return Promise.resolve(h.allFiles);
    },
    readPageSetup: async () => {
      if (h.holdPageRead) await h.holdPageRead;
      if (!h.pageSetup) throw new Error("nope");
      return h.pageSetup;
    },
    writePageSetup: async (_d, choice) => {
      h.pageWrites.push(choice);
      if (h.holdPageWrite) await h.holdPageWrite;
      if (h.failNextPageWrite) {
        h.failNextPageWrite = false;
        throw new Error("read-only folder");
      }
      const page = choice.page ?? (choice.preset === "dtrpg" ? { width: 621, height: 810 } : { width: 432, height: 648 });
      // The lib: margins given are recorded; otherwise what was recorded stays.
      const before = h.pageSetup ?? BOOK_SETUP;
      h.pageSetup = {
        preset: choice.preset,
        bounds: { ...page, tolerance: 0.5 },
        margins: choice.margins ?? before.margins,
        marginsFrom: choice.margins ? "manifest" : before.marginsFrom,
      };
      return h.pageSetup;
    },
    onError: (m) => onError(m),
  });
  return h;
}

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.fields).toEqual({});
  expect(ctrl.detailsSaveStatus).toBe("idle");
  expect(ctrl.detailsError).toBeNull();
  expect(ctrl.titleDraft).toBe("");
  expect(ctrl.authorsDraft).toEqual([]);
  expect(ctrl.sourceFiles).toEqual([]);
});

test("loadDetails populates fields, drafts, and the chapters list (manifest order first, extras excluded)", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  expect(h.readCalls).toBe(1);
  expect(h.listCalls).toBe(1);
  expect(h.ctrl.titleDraft).toBe("My Book");
  expect(h.ctrl.authorsDraft).toEqual(["A", "B"]);
  expect(h.ctrl.sourceFiles).toEqual([
    { path: "a.md", included: true },
    { path: "b.md", included: true },
    { path: "c.md", included: false },
  ]);
  expect(h.ctrl.detailsSaveStatus).toBe("idle");
});

test("loadDetails no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadDetails();
  expect(h.readCalls).toBe(0);
  expect(h.ctrl.titleDraft).toBe("");
});

test("loadDetails with a blank manifest includes every file in natural order", async () => {
  const h = make({ fields: {}, allFiles: ["10-end.md", "2-start.md"] });
  await h.ctrl.loadDetails();
  expect(h.ctrl.titleDraft).toBe("");
  expect(h.ctrl.sourceFiles).toEqual([
    { path: "2-start.md", included: true },
    { path: "10-end.md", included: true },
  ]);
});

test("loadDetails survives a failed file scan: manifest entries stay editable, not flagged missing", async () => {
  const h = make();
  h.failList = true;
  await h.ctrl.loadDetails();
  expect(h.ctrl.detailsError).toBeNull();
  expect(h.ctrl.sourceFiles).toEqual([
    { path: "a.md", included: true },
    { path: "b.md", included: true },
  ]);
});

test("after a failed scan, a chapter edit writes the explicit list — it never collapses to the all-files sentinel", async () => {
  const h = make();
  h.failList = true;
  await h.ctrl.loadDetails();
  h.ctrl.moveSourceFile(1, 0);
  await settle();
  // The manifest listed [a.md, b.md] explicitly; with the universe unknown a
  // null here could silently widen the book to unseen files.
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ sourceFiles: ["b.md", "a.md"] }]);
});

test("addAuthor/setAuthor/removeAuthor mutate the drafts array", () => {
  const h = make();
  h.ctrl.addAuthor();
  expect(h.ctrl.authorsDraft).toEqual([""]);
  h.ctrl.setAuthor(0, "Ada");
  expect(h.ctrl.authorsDraft).toEqual(["Ada"]);
  h.ctrl.addAuthor();
  h.ctrl.setAuthor(1, "Grace");
  expect(h.ctrl.authorsDraft).toEqual(["Ada", "Grace"]);
  h.ctrl.removeAuthor(0);
  expect(h.ctrl.authorsDraft).toEqual(["Grace"]);
});

test("moveSourceFile / setSourceIncluded drive the list model", async () => {
  const h = make({ fields: {} });
  await h.ctrl.loadDetails();
  h.ctrl.moveSourceFile(2, 0);
  expect(h.ctrl.sourceFiles.map((e) => e.path)).toEqual(["c.md", "a.md", "b.md"]);
  h.ctrl.setSourceIncluded(1, false);
  expect(h.ctrl.sourceFiles[1]).toEqual({ path: "a.md", included: false });
});

// ── Saves as you go: write only what changed ──────────────────────────────────

test("a title change writes only { title }, trimmed, and the badge reads saved", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.titleDraft = "  New Title  ";
  await h.ctrl.flushPendingSave();
  expect(h.writeCalls).toEqual([{ dir: "/proj", updates: { title: "New Title" } }]);
  expect(h.ctrl.fields.title).toBe("New Title");
  expect(h.ctrl.detailsSaveStatus).toBe("saved");
  expect(h.ctrl.detailsError).toBeNull();
  expect(h.pageWrites).toEqual([]);
});

test("author edits write only { authors }, trimmed, empty rows dropped; adding an empty row writes nothing", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.addAuthor();
  await settle();
  expect(h.writeCalls).toEqual([]);
  h.ctrl.setAuthor(2, "  Grace ");
  await h.ctrl.flushPendingSave();
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ authors: ["A", "B", "Grace"] }]);
  h.ctrl.removeAuthor(0);
  await settle();
  expect(h.writeCalls.map((w) => w.updates).at(-1)).toEqual({ authors: ["B", "Grace"] });
});

test("an unchanged flush writes nothing and leaves the badge idle", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.titleDraft = " My Book ";
  expect(await h.ctrl.flushPendingSave()).toBe(true); // nothing to save: the panel may close
  expect(h.writeCalls).toEqual([]);
  expect(h.pageWrites).toEqual([]);
  expect(h.ctrl.detailsSaveStatus).toBe("idle");
});

test("a flush while the book is still loading writes nothing — never the not-yet-loaded chapter list", async () => {
  // A scaffolded book: one chapter, listed explicitly.
  const h = make({ fields: { title: "T", sourceFiles: ["chapter-01.md"] }, allFiles: ["chapter-01.md"] });
  let release!: () => void;
  h.holdPageRead = new Promise<void>((r) => (release = r));
  const loading = h.ctrl.loadDetails();
  await settle(); // the manifest is read; the page size is not
  expect(await h.ctrl.flushPendingSave()).toBe(true);
  expect(h.writeCalls).toEqual([]);
  release();
  await loading;
  await h.ctrl.flushPendingSave();
  expect(h.writeCalls).toEqual([]);
  expect(h.ctrl.sourceFiles).toEqual([{ path: "chapter-01.md", included: true }]);
});

test("an untouched flush never rewrites an explicit chapter list that equals natural order (every scaffolded book)", async () => {
  const h = make({ fields: { title: "My Book", sourceFiles: ["a.md", "b.md", "c.md"] } });
  await h.ctrl.loadDetails();
  await h.ctrl.flushPendingSave();
  expect(h.writeCalls).toEqual([]);
  expect(h.ctrl.detailsSaveStatus).toBe("idle");
});

test("a flush after the host moved to another book writes nothing there", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.titleDraft = "Typed into book A";
  h.projectDir = "/other-book";
  await h.ctrl.flushPendingSave();
  expect(h.writeCalls).toEqual([]);
  expect(h.ctrl.detailsSaveStatus).toBe("idle");
});

test("a chapter reorder is persisted at once as an explicit ordered list; the all-files default is the null sentinel", async () => {
  const h = make({ fields: {} });
  await h.ctrl.loadDetails();
  h.ctrl.moveSourceFile(2, 0);
  await settle();
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ sourceFiles: ["c.md", "a.md", "b.md"] }]);
  h.ctrl.moveSourceFile(0, 2);
  await settle();
  expect(h.writeCalls.map((w) => w.updates).at(-1)).toEqual({ sourceFiles: null });
});

test("unticking a chapter writes the included list", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.setSourceIncluded(1, false);
  await settle();
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ sourceFiles: ["a.md"] }]);
});

test("flushPendingSave no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  h.ctrl.titleDraft = "x";
  await h.ctrl.flushPendingSave();
  expect(h.writeCalls.length).toBe(0);
});

test("a failed save keeps the drafts, surfaces detailsError + onError, and drops the badge to idle", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.failNextWrite = true;
  h.ctrl.titleDraft = "Kept";
  expect(await h.ctrl.flushPendingSave()).toBe(false); // the panel stays open on the error
  expect(h.ctrl.detailsSaveStatus).toBe("idle");
  expect(h.ctrl.detailsError).toContain("disk full");
  expect(h.onError.calls.length).toBe(1);
  expect(String(h.onError.calls[0][0])).toContain("disk full");
  expect(h.ctrl.titleDraft).toBe("Kept");
  // A retry writes the same change.
  expect(await h.ctrl.flushPendingSave()).toBe(true);
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ title: "Kept" }, { title: "Kept" }]);
  expect(h.ctrl.detailsSaveStatus).toBe("saved");
});

test("a flush during an in-flight save runs after it and sees its result (no lost update)", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.gateNextWrite = true;
  h.ctrl.titleDraft = "First";
  const first = h.ctrl.flushPendingSave();
  await settle();
  expect(h.releaseWrite).not.toBeNull(); // parked on the write
  h.ctrl.titleDraft = "Second";
  const second = h.ctrl.flushPendingSave();
  h.releaseWrite!();
  await Promise.all([first, second]);
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ title: "First" }, { title: "Second" }]);
  expect(h.ctrl.fields.title).toBe("Second");
});

// ── Publish targets (ADR 0008) ────────────────────────────────────────────

test("loadDetails seeds the target draft from the manifest", async () => {
  const h = make({ fields: { targets: ["dtrpg"] } });
  await h.ctrl.loadDetails();
  expect(h.ctrl.targetsDraft).toEqual(["dtrpg"]);
});

test("toggling a target writes only { targets }, empty included", async () => {
  const h = make({ fields: { title: "T", targets: ["dtrpg"] } });
  await h.ctrl.loadDetails();
  h.ctrl.toggleTarget("itch");
  await settle();
  expect(h.ctrl.targetsDraft).toEqual(["dtrpg", "itch"]);
  h.ctrl.toggleTarget("dtrpg");
  h.ctrl.toggleTarget("itch");
  await settle();
  expect(h.ctrl.targetsDraft).toEqual([]);
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ targets: ["dtrpg", "itch"] }, { targets: [] }]);
});

test("a book with no targets: key and preset dtrpg shows DriveThruRPG checked, and a title change writes no targets", async () => {
  const h = make({
    fields: { title: "T" },
    pageSetup: { preset: "dtrpg", bounds: { width: 621, height: 810, tolerance: 0.5 }, margins: INCH, marginsFrom: "default" },
  });
  await h.ctrl.loadDetails();
  expect(h.ctrl.targetsDraft).toEqual(["dtrpg"]);
  h.ctrl.titleDraft = "Renamed";
  await h.ctrl.flushPendingSave();
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ title: "Renamed" }]);
});

test("changing the preset on a book with no targets: key reseeds the default targets; once touched they are the author's", async () => {
  const h = make({ fields: { title: "T" } }); // BOOK_SETUP: preset book, no targets
  await h.ctrl.loadDetails();
  expect(h.ctrl.targetsDraft).toEqual([]);
  h.ctrl.setPreset("dtrpg");
  await settle();
  expect(h.ctrl.targetsDraft).toEqual(["dtrpg"]);
  // The preset change wrote the page size, never the (still implicit) targets.
  expect(h.pageWrites).toEqual([{ preset: "dtrpg" }]);
  expect(h.writeCalls).toEqual([]);
  h.ctrl.toggleTarget("dtrpg");
  await settle();
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ targets: [] }]);
  h.ctrl.setPreset("book");
  await settle();
  expect(h.ctrl.targetsDraft).toEqual([]);
  h.ctrl.setPreset("dtrpg");
  await settle();
  expect(h.ctrl.targetsDraft).toEqual([]); // explicit now: the preset no longer reseeds
});

// ── Page size (#357) ─────────────────────────────────────────────────────────

test("loadDetails reads the page size and the margins (in inches) back into the drafts", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  expect(h.ctrl.presetDraft).toBe("book");
  expect(h.ctrl.sizeChoice).toBe("trade");
  expect(h.ctrl.marginDrafts).toEqual({ top: "0.85", bottom: "0.85", inside: "0.75", outside: "0.75" });
  expect(h.ctrl.pageDirty).toBe(false);
  expect(h.ctrl.marginsIncomplete).toBe(false);

  const odd = make({
    pageSetup: { preset: "custom", bounds: { width: 360, height: 504, tolerance: 0.5 }, margins: INCH, marginsFrom: "default" },
  });
  await odd.ctrl.loadDetails();
  expect(odd.ctrl.presetDraft).toBe("custom");
  expect(odd.ctrl.sizeChoice).toBe("custom");
  expect([odd.ctrl.widthIn, odd.ctrl.heightIn]).toEqual(["5", "7"]);
});

test("choosing another preset writes the page size once, and nothing else", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.setPreset("dtrpg");
  await settle();
  expect(h.pageWrites).toEqual([{ preset: "dtrpg" }]);
  expect(h.writeCalls).toEqual([]);
  expect(h.ctrl.pageSetup?.preset).toBe("dtrpg");
  expect(h.ctrl.pageDirty).toBe(false);
  expect(h.ctrl.detailsSaveStatus).toBe("saved");
});

test("a title change never writes the page geometry, and margins the author did not touch are never sent", async () => {
  const h = make({ pageSetup: { ...BOOK_SETUP, margins: INCH, marginsFrom: "stylesheet" } });
  await h.ctrl.loadDetails();
  expect(h.ctrl.pageDirty).toBe(false);
  h.ctrl.titleDraft = "Renamed";
  await h.ctrl.flushPendingSave();
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ title: "Renamed" }]);
  expect(h.pageWrites).toEqual([]);
  // A preset change writes the preset alone: the stylesheet's margins stay the stylesheet's.
  h.ctrl.setPreset("dtrpg");
  await settle();
  expect(h.pageWrites).toEqual([{ preset: "dtrpg" }]);
  expect(h.ctrl.pageSetup?.marginsFrom).toBe("stylesheet");
});

// ── Margins ──────────────────────────────────────────────────────────────────

test("a margin typed in inches is recorded in points with the current preset, once its field reports change", async () => {
  const h = make({ pageSetup: { ...BOOK_SETUP, margins: INCH, marginsFrom: "default" } });
  await h.ctrl.loadDetails();
  expect(h.ctrl.marginDrafts).toEqual({ top: "1", bottom: "1", inside: "1", outside: "1" });
  h.ctrl.marginDrafts.inside = "1.25";
  h.ctrl.touchMargins();
  await (h.ctrl.touchMargins(), h.ctrl.flushPendingSave());
  expect(h.pageWrites).toEqual([{ preset: "book", margins: { top: 72, bottom: 72, inside: 90, outside: 72 } }]);
  expect(h.writeCalls).toEqual([]);
  expect(h.ctrl.pageSetup?.marginsFrom).toBe("manifest");
  expect(h.ctrl.pageDirty).toBe(false);
  expect(h.ctrl.detailsSaveStatus).toBe("saved");
  // Retyping the recorded value is not a change.
  h.ctrl.marginDrafts.inside = "1.25";
  await (h.ctrl.touchMargins(), h.ctrl.flushPendingSave());
  expect(h.pageWrites).toHaveLength(1);
});

test("a custom size and the margins travel together; an incomplete margin holds the page write and saves the rest", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.setPreset("custom");
  await settle();
  h.pageWrites.length = 0;
  h.ctrl.marginDrafts.top = "";
  h.ctrl.touchMargins();
  h.ctrl.titleDraft = "Renamed";
  await (h.ctrl.touchMargins(), h.ctrl.flushPendingSave());
  expect(h.ctrl.marginsIncomplete).toBe(true);
  expect(h.ctrl.detailsError).toBeNull();
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ title: "Renamed" }]);
  expect(h.pageWrites).toEqual([]);
  h.ctrl.marginDrafts.top = "0.5";
  h.ctrl.sizeChoice = "a4";
  await (h.ctrl.touchPage(), h.ctrl.flushPendingSave());
  expect(h.pageWrites).toEqual([
    { preset: "custom", page: { width: 595, height: 842 }, margins: { ...BOOK_MARGINS, top: 36 } },
  ]);
  expect(h.ctrl.marginsIncomplete).toBe(false);
});

test("a negative or non-numeric margin counts as incomplete, never as zero", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.marginDrafts.outside = "-1";
  h.ctrl.touchMargins();
  await (h.ctrl.touchMargins(), h.ctrl.flushPendingSave());
  expect(h.ctrl.marginsIncomplete).toBe(true);
  expect(h.pageWrites).toEqual([]);
  h.ctrl.marginDrafts.outside = "0";
  await (h.ctrl.touchMargins(), h.ctrl.flushPendingSave());
  expect(h.pageWrites).toEqual([{ preset: "book", margins: { ...BOOK_MARGINS, outside: 0 } }]);
});

test("margins typed and not yet committed (Escape before the fields' change) are saved by the close flush", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.marginDrafts.top = "1";
  h.ctrl.touchMargins();
  h.ctrl.marginDrafts.bottom = "1";
  h.ctrl.touchMargins();
  await h.ctrl.flushPendingSave(); // close: no `change` ever fired
  expect(h.pageWrites).toEqual([{ preset: "book", margins: { ...BOOK_MARGINS, top: 72, bottom: 72 } }]);
});

test("a failed margin write keeps the typed margins pending, and the next flush retries them", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.failNextPageWrite = true;
  h.ctrl.marginDrafts.top = "1";
  h.ctrl.touchMargins();
  expect(await (h.ctrl.touchMargins(), h.ctrl.flushPendingSave())).toBe(false);
  expect(h.ctrl.detailsError).toContain("read-only folder");
  expect(h.ctrl.marginDrafts.top).toBe("1");
  expect(h.ctrl.pageSetup?.margins).toEqual(BOOK_MARGINS);
  expect(await h.ctrl.flushPendingSave()).toBe(true);
  expect(h.pageWrites.map((w) => w.margins)).toEqual([
    { ...BOOK_MARGINS, top: 72 },
    { ...BOOK_MARGINS, top: 72 },
  ]);
  expect(h.ctrl.detailsSaveStatus).toBe("saved");
});

test("a custom size is sent in points, from a named size or typed inches, when its fields report change", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.setPreset("custom");
  await settle();
  // Trade (the recorded 6 x 9 in) under the custom preset is a preset change only.
  expect(h.pageWrites).toEqual([{ preset: "custom", page: { width: 432, height: 648 } }]);
  h.ctrl.sizeChoice = "a4";
  await (h.ctrl.touchPage(), h.ctrl.flushPendingSave());
  h.ctrl.sizeChoice = "custom";
  h.ctrl.widthIn = "7.25";
  h.ctrl.heightIn = "10";
  await (h.ctrl.touchPage(), h.ctrl.flushPendingSave());
  expect(h.pageWrites.slice(1)).toEqual([
    { preset: "custom", page: { width: 595, height: 842 } },
    { preset: "custom", page: { width: 522, height: 720 } },
  ]);
});

test("an incomplete custom size saves the other fields and skips the page write until it is complete", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.setPreset("custom");
  await settle();
  h.pageWrites.length = 0;
  h.ctrl.sizeChoice = "custom";
  h.ctrl.widthIn = "";
  h.ctrl.heightIn = "9";
  h.ctrl.titleDraft = "Renamed";
  await (h.ctrl.touchPage(), h.ctrl.flushPendingSave());
  expect(h.ctrl.pageIncomplete).toBe(true);
  expect(h.ctrl.detailsError).toBeNull();
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ title: "Renamed" }]);
  expect(h.pageWrites).toEqual([]);
  // Filling in the width completes it; the pending page write happens now.
  h.ctrl.widthIn = "7";
  await (h.ctrl.touchPage(), h.ctrl.flushPendingSave());
  expect(h.pageWrites).toEqual([{ preset: "custom", page: { width: 504, height: 648 } }]);
});

test("a custom size typed and not yet committed (Escape before the fields' change) is saved by the close flush", async () => {
  const h = make({
    pageSetup: { preset: "custom", bounds: { width: 360, height: 504, tolerance: 0.5 }, margins: INCH, marginsFrom: "default" },
  });
  await h.ctrl.loadDetails();
  // What the view does on each keystroke: the bound value, then `input`.
  h.ctrl.sizeChoice = "custom";
  h.ctrl.touchPage();
  h.ctrl.widthIn = "7";
  h.ctrl.touchPage();
  h.ctrl.heightIn = "9";
  h.ctrl.touchPage();
  h.ctrl.titleDraft = "Z2";
  await h.ctrl.flushPendingSave(); // close: no `change` ever fired
  expect(h.writeCalls.map((w) => w.updates)).toEqual([{ title: "Z2" }]);
  expect(h.pageWrites).toEqual([{ preset: "custom", page: { width: 504, height: 648 } }]);
});

test("a size typed while the previous size is being written stays as typed, and the close flush writes it", async () => {
  const h = make({
    pageSetup: { preset: "custom", bounds: { width: 360, height: 504, tolerance: 0.5 }, margins: INCH, marginsFrom: "default" },
  });
  await h.ctrl.loadDetails();
  let release!: () => void;
  h.holdPageWrite = new Promise<void>((r) => (release = r));
  h.ctrl.sizeChoice = "custom";
  h.ctrl.widthIn = "7";
  const widthCommit = (h.ctrl.touchPage(), h.ctrl.flushPendingSave()); // Tab out of Width: its `change`
  await settle();
  h.ctrl.heightIn = "9"; // typed into Height before that write returns
  h.ctrl.touchPage();
  release();
  await widthCommit;
  expect(h.ctrl.heightIn).toBe("9");
  h.holdPageWrite = null;
  await h.ctrl.flushPendingSave(); // Escape
  expect(h.pageWrites).toEqual([
    { preset: "custom", page: { width: 504, height: 504 } },
    { preset: "custom", page: { width: 504, height: 648 } },
  ]);
});

test("a failed page-size read leaves the control out and details still load", async () => {
  const h = make({ pageSetup: null });
  await h.ctrl.loadDetails();
  expect(h.ctrl.detailsError).toBeNull();
  expect(h.ctrl.pageSetup).toBeNull();
  expect(h.ctrl.titleDraft).toBe("My Book");
});
