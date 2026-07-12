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
  readCalls: number;
  writeCalls: Array<{ dir: string; updates: ProjectConfigFields }>;
  failNextWrite: boolean;
}

function make(over: Partial<{ noProject: boolean; fields: ProjectConfigFields }> = {}): Harness {
  const onSaved = spy();
  const onError = spy();
  const h = {
    onSaved,
    onError,
    projectDir: over.noProject ? null : "/proj",
    fields: over.fields ?? { title: "My Book", authors: ["A", "B"], outputFilename: "book.pdf", sourceFiles: ["a.md", "b.md"] },
    readCalls: 0,
    writeCalls: [],
    failNextWrite: false,
  } as Harness;
  h.ctrl = new DetailsSectionController({
    projectDir: () => h.projectDir,
    readManifest: (dir) => {
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
  expect(ctrl.outputDraft).toBe("");
  expect(ctrl.authorsDraft).toEqual([]);
  expect(ctrl.sourceDraft).toBe("");
});

test("loadDetails populates fields and drafts from the manifest", async () => {
  const h = make();
  await h.ctrl.loadDetails();
  expect(h.readCalls).toBe(1);
  expect(h.ctrl.titleDraft).toBe("My Book");
  expect(h.ctrl.outputDraft).toBe("book.pdf");
  expect(h.ctrl.authorsDraft).toEqual(["A", "B"]);
  expect(h.ctrl.sourceDraft).toBe("a.md\nb.md");
});

test("loadDetails no-ops without a project dir", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadDetails();
  expect(h.readCalls).toBe(0);
  expect(h.ctrl.titleDraft).toBe("");
});

test("loadDetails defaults missing manifest fields to empty drafts", async () => {
  const h = make({ fields: {} });
  await h.ctrl.loadDetails();
  expect(h.ctrl.titleDraft).toBe("");
  expect(h.ctrl.outputDraft).toBe("");
  expect(h.ctrl.authorsDraft).toEqual([]);
  expect(h.ctrl.sourceDraft).toBe("");
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

test("saveDetails trims authors/source lines and writes the manifest", async () => {
  const h = make();
  h.ctrl.titleDraft = "  New Title  ";
  h.ctrl.outputDraft = "  out.pdf  ";
  h.ctrl.authorsDraft = ["  Ada ", "", "  Grace"];
  h.ctrl.sourceDraft = " a.md \n\n b.md \n  ";
  await h.ctrl.saveDetails();
  expect(h.writeCalls.length).toBe(1);
  expect(h.writeCalls[0]).toEqual({
    dir: "/proj",
    updates: {
      title: "New Title",
      authors: ["Ada", "Grace"],
      outputFilename: "out.pdf",
      sourceFiles: ["a.md", "b.md"],
    },
  });
  expect(h.ctrl.detailsSaving).toBe(false);
  expect(h.ctrl.detailsError).toBeNull();
  expect(h.onSaved.calls.length).toBe(1);
});

test("saveDetails sends null sourceFiles when the draft has no non-blank lines (the 'all chapters' sentinel)", async () => {
  const h = make();
  h.ctrl.sourceDraft = "   \n  ";
  await h.ctrl.saveDetails();
  expect(h.writeCalls[0].updates.sourceFiles).toBeNull();
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
