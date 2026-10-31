import { expect, test } from "bun:test";
import { StylesSectionController } from "../../src/lib/routes/styles-section-controller.svelte";
import type { ProjectStyle } from "../../src/lib/platform/dtos";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests (same shim as the other section-controller tests).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

const sheet = (displayName: string, active: boolean): ProjectStyle => ({ path: `/proj/${displayName}`, displayName, active });
const BASE = sheet("styles/book.css", true);
const PRINT = sheet("styles/print.css", true);
const EXTRA = sheet("css/extra.css", false);
const SHARED = sheet("../shared/styles/house.css", false);

interface Harness {
  ctrl: StylesSectionController;
  /** The manifest's `styles:` as the fake host holds it. */
  manifest: string[];
  /** Every other file on disk the book could use. */
  others: ProjectStyle[];
  calls: Array<{ name: string; args: unknown[] }>;
  failWrite: boolean;
  afterChange: number;
}

/** A host that answers `listStyles` the way the lib does: the manifest's sheets first, in order, then the rest. */
function make(over: Partial<{ used: ProjectStyle[]; others: ProjectStyle[]; noProject: boolean }> = {}): Harness {
  const used = over.used ?? [BASE];
  const h = {
    manifest: used.map((s) => s.displayName),
    others: [...(over.others ?? [EXTRA]), ...used],
    calls: [],
    failWrite: false,
    afterChange: 0,
  } as unknown as Harness;
  const everything = () => h.others.map((s) => ({ ...s, active: h.manifest.includes(s.displayName) }));
  h.ctrl = new StylesSectionController({
    projectDir: () => (over.noProject ? null : "/proj"),
    listStyles: () => {
      h.calls.push({ name: "listStyles", args: [] });
      const all = everything();
      return Promise.resolve([...h.manifest.map((n) => all.find((s) => s.displayName === n)!), ...all.filter((s) => !s.active)]);
    },
    setActiveStyles: (dir, paths) => {
      h.calls.push({ name: "setActiveStyles", args: [dir, paths] });
      if (h.failWrite) return Promise.reject(new Error("disk full"));
      h.manifest = paths;
      return Promise.resolve(paths);
    },
    createStylesheet: () => {
      h.calls.push({ name: "createStylesheet", args: [] });
      h.others = [...h.others, BASE];
      h.manifest = [BASE.displayName];
      return Promise.resolve(BASE.path);
    },
    afterChange: () => {
      h.afterChange++;
      return Promise.resolve();
    },
  });
  return h;
}

const written = (h: Harness) => h.calls.filter((c) => c.name === "setActiveStyles").map((c) => c.args[1]);

test("initial state, and loadStyles splits the book's sheets into the ones it uses (in order) and the ones it could add", async () => {
  const h = make({ used: [BASE, PRINT], others: [EXTRA, SHARED] });
  expect(h.ctrl.styles).toEqual([]);
  expect(h.ctrl.error).toBeNull();
  expect(h.ctrl.busy).toBe(false);
  expect(h.ctrl.saveStatus).toBe("idle");
  await h.ctrl.loadStyles();
  expect(h.ctrl.used.map((s) => s.displayName)).toEqual(["styles/book.css", "styles/print.css"]);
  expect(h.ctrl.unused.map((s) => s.displayName)).toEqual(["css/extra.css", "../shared/styles/house.css"]);
});

test("loadStyles does nothing without a project", async () => {
  const h = make({ noProject: true });
  await h.ctrl.loadStyles();
  expect(h.calls).toEqual([]);
});

test("move rewrites the whole styles list with the sheet swapped with its neighbour, then reloads and refreshes the design settings", async () => {
  const h = make({ used: [BASE, PRINT] });
  await h.ctrl.loadStyles();
  await h.ctrl.move(PRINT, -1);
  expect(written(h)).toEqual([["styles/print.css", "styles/book.css"]]);
  expect(h.ctrl.used.map((s) => s.displayName)).toEqual(["styles/print.css", "styles/book.css"]);
  expect(h.afterChange).toBe(1);
  expect(h.ctrl.saveStatus).toBe("saved");
  expect(h.ctrl.busy).toBe(false);
  await h.ctrl.move(PRINT, 1);
  expect(h.ctrl.used.map((s) => s.displayName)).toEqual(["styles/book.css", "styles/print.css"]);
});

test("move past either end of the list writes nothing", async () => {
  const h = make({ used: [BASE, PRINT] });
  await h.ctrl.loadStyles();
  await h.ctrl.move(BASE, -1);
  await h.ctrl.move(PRINT, 1);
  expect(written(h)).toEqual([]);
  expect(h.ctrl.saveStatus).toBe("idle");
});

test("remove takes a sheet off styles: and leaves the file where it was, offering it to add again", async () => {
  const h = make({ used: [BASE, PRINT], others: [] });
  await h.ctrl.loadStyles();
  await h.ctrl.remove(BASE);
  expect(written(h)).toEqual([["styles/print.css"]]);
  expect(h.ctrl.used.map((s) => s.displayName)).toEqual(["styles/print.css"]);
  expect(h.ctrl.unused.map((s) => s.displayName)).toEqual(["styles/book.css"]);
  expect(h.afterChange).toBe(1);
});

test("the last stylesheet cannot be removed: the book would fall back to it anyway", async () => {
  const h = make({ used: [BASE] });
  await h.ctrl.loadStyles();
  await h.ctrl.remove(BASE);
  expect(written(h)).toEqual([]);
  expect(h.ctrl.used.map((s) => s.displayName)).toEqual(["styles/book.css"]);
});

test("add puts a sheet of the book (or a shared one) last, where it wins", async () => {
  const h = make({ used: [BASE], others: [EXTRA, SHARED] });
  await h.ctrl.loadStyles();
  await h.ctrl.add(EXTRA);
  await h.ctrl.add(SHARED);
  expect(written(h)).toEqual([
    ["styles/book.css", "css/extra.css"],
    ["styles/book.css", "css/extra.css", "../shared/styles/house.css"],
  ]);
  expect(h.ctrl.unused).toEqual([]);
});

test("create gives a book with no stylesheet styles/book.css (the design controller's path) and lists it", async () => {
  const h = make({ used: [], others: [] });
  await h.ctrl.loadStyles();
  expect(h.ctrl.used).toEqual([]);
  await h.ctrl.create();
  expect(h.calls.filter((c) => c.name === "createStylesheet").length).toBe(1);
  expect(h.ctrl.used.map((s) => s.displayName)).toEqual(["styles/book.css"]);
  expect(h.afterChange).toBe(1);
  expect(h.ctrl.saveStatus).toBe("saved");
});

test("a failed write says why, leaves the list as it was and does not refresh the design settings", async () => {
  const h = make({ used: [BASE, PRINT] });
  await h.ctrl.loadStyles();
  h.failWrite = true;
  await h.ctrl.move(PRINT, -1);
  expect(h.ctrl.error).toBe("disk full");
  expect(h.ctrl.saveStatus).toBe("idle");
  expect(h.ctrl.busy).toBe(false);
  expect(h.ctrl.used.map((s) => s.displayName)).toEqual(["styles/book.css", "styles/print.css"]);
  expect(h.afterChange).toBe(0);
  // The next action starts clean.
  h.failWrite = false;
  await h.ctrl.move(PRINT, -1);
  expect(h.ctrl.error).toBeNull();
  expect(h.ctrl.saveStatus).toBe("saved");
});

test("an action is refused while another is in flight", async () => {
  const h = make({ used: [BASE, PRINT], others: [EXTRA] });
  await h.ctrl.loadStyles();
  await Promise.all([h.ctrl.move(PRINT, -1), h.ctrl.add(EXTRA)]);
  expect(written(h)).toEqual([["styles/print.css", "styles/book.css"]]);
});
