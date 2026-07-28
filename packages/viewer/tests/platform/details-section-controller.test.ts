import { expect, test } from "bun:test";
import { DetailsSectionController } from "../../src/lib/routes/details-section-controller.svelte";
import type { ProjectConfigFields } from "../../src/lib/api";

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

interface Harness {
  ctrl: DetailsSectionController;
  onSaved: ReturnType<typeof spy>;
  onError: ReturnType<typeof spy>;
  projectDir: string | null;
  fields: ProjectConfigFields;
  allFiles: string[];
  readCalls: number;
  listCalls: number;
  writeCalls: Array<{ dir: string; updates: ProjectConfigFields }>;
  failNextWrite: boolean;
  failList: boolean;
}

function make(
  over: Partial<{ noProject: boolean; fields: ProjectConfigFields; allFiles: string[] }> = {},
): Harness {
  const onSaved = spy();
  const onError = spy();
  const h = {
    onSaved,
    onError,
    projectDir: over.noProject ? null : "/proj",
    fields: over.fields ?? { title: "My Book", authors: ["A", "B"], sourceFiles: ["a.md", "b.md"] },
    allFiles: over.allFiles ?? ["a.md", "b.md", "c.md"],
    readCalls: 0,
    listCalls: 0,
    writeCalls: [],
    failNextWrite: false,
    failList: false,
  } as Harness;
  h.ctrl = new DetailsSectionController({
    projectDir: () => h.projectDir,
    readManifest: () => {
      h.readCalls++;
      return Promise.resolve(h.fields);
    },
    writeManifest: (dir, updates) => {
      h.writeCalls.push({ dir, updates });
      if (h.failNextWrite) {
        h.failNextWrite = false;
        return Promise.reject(new Error("disk full"));
      }
      const out = { ...h.fields, ...updates };
      h.fields = out;
      return Promise.resolve(out);
    },
    listMarkdownFiles: () => {
      h.listCalls++;
      if (h.failList) return Promise.reject(new Error("scan failed"));
      return Promise.resolve(h.allFiles);
    },
    onSaved: () => onSaved(),
    onError: (m) => onError(m),
  });
  return h;
}

test("initial public rune state matches the panel defaults", () => {
  const { ctrl } = make();
  expect(ctrl.fields).toEqual({});
  expect(ctrl.detailsSaving).toBe(false);
  expect(ctrl.detailsError).toBeNull();
  expect(ctrl.titleDraft).toBe("");
  expect(ctrl.authorsDraft).toEqual([]);
  expect(ctrl.sourceFiles).toEqual([]);
});

test("loadDetails populates fields, drafts, and the source-files list (manifest order first, extras excluded)", async () => {
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

test("after a failed scan, saving preserves the explicit list — it never collapses to the all-files sentinel", async () => {
  const h = make();
  h.failList = true;
  await h.ctrl.loadDetails();
  await h.ctrl.saveDetails();
  // The manifest listed [a.md, b.md] explicitly; with the universe unknown a
  // null here could silently widen the book to unseen files.
  expect(h.writeCalls[0]!.updates.sourceFiles).toEqual(["a.md", "b.md"]);
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

test("saveDetails trims authors and writes the ordered included source files", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  h.ctrl.titleDraft = "  New Title  ";
  h.ctrl.authorsDraft = ["  Ada ", "", "  Grace"];
  await h.ctrl.saveDetails();
  expect(h.writeCalls.length).toBe(1);
  expect(h.writeCalls[0]).toEqual({
    dir: "/proj",
    updates: {
      title: "New Title",
      authors: ["Ada", "Grace"],
      // a.md + b.md included (manifest), c.md excluded → explicit list.
      sourceFiles: ["a.md", "b.md"],
    },
  });
  expect(h.ctrl.detailsSaving).toBe(false);
  expect(h.ctrl.detailsError).toBeNull();
  expect(h.onSaved.calls.length).toBe(1);
});

test("saveDetails sends null sourceFiles when everything is included in natural order (the 'all chapters' sentinel)", async () => {
  const h = make({ fields: {} });
  await h.ctrl.loadDetails();
  await h.ctrl.saveDetails();
  expect(h.writeCalls[0]!.updates.sourceFiles).toBeNull();
});

test("a reorder is persisted as an explicit ordered list", async () => {
  const h = make({ fields: {} });
  await h.ctrl.loadDetails();
  h.ctrl.moveSourceFile(2, 0);
  await h.ctrl.saveDetails();
  expect(h.writeCalls[0]!.updates.sourceFiles).toEqual(["c.md", "a.md", "b.md"]);
});

test("saveDetails no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.saveDetails();
  expect(h.writeCalls.length).toBe(0);
});

test("a failed save surfaces detailsError + onError and clears detailsSaving", async () => {
  const h = make();
  h.failNextWrite = true;
  await h.ctrl.saveDetails();
  expect(h.ctrl.detailsSaving).toBe(false);
  expect(h.ctrl.detailsError).toContain("disk full");
  expect(h.onError.calls.length).toBe(1);
  expect(String(h.onError.calls[0][0])).toContain("disk full");
  expect(h.onSaved.calls.length).toBe(0);
});
