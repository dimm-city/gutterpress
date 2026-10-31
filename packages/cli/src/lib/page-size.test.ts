import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { pageSizeForChoice, readPageSetup, setPageSetup } from "./page-size.ts";
import { formatPageSize } from "../engine/shared/print-area.ts";
import { scaffoldProject } from "./project-scaffold.ts";
import { loadManifest, resolveConfig } from "./manifest.ts";

const LETTER = { width: 612, height: 792 };
const INCH = { top: 72, bottom: 72, inside: 72, outside: 72 };

async function book(css: string | null, manifest: string[] = []): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-pagesize-"));
  await mkdir(path.join(dir, "styles"), { recursive: true });
  if (css !== null) await writeFile(path.join(dir, "styles", "book.css"), css, "utf8");
  await writeFile(
    path.join(dir, "manifest.yaml"),
    ["title: T", "styles:", "  - styles/book.css", ...manifest, ""].join("\n"),
    "utf8",
  );
  return dir;
}

const manifestOf = (dir: string) => readFile(path.join(dir, "manifest.yaml"), "utf8");

test("formatPageSize prints inches when exact and points otherwise", () => {
  expect(formatPageSize(LETTER)).toBe("8.5in 11in");
  expect(formatPageSize({ width: 621, height: 810 })).toBe("8.625in 11.25in");
  expect(formatPageSize({ width: 595, height: 842 })).toBe("595pt 842pt");
});

test("pageSizeForChoice: presets own their size, custom needs a positive trim", () => {
  expect(pageSizeForChoice({ preset: "dtrpg" })).toEqual({ width: 621, height: 810 });
  expect(pageSizeForChoice({ preset: "book", page: LETTER })).toEqual({ width: 432, height: 648 });
  expect(pageSizeForChoice({ preset: "custom", page: LETTER })).toEqual(LETTER);
  expect(() => pageSizeForChoice({ preset: "custom" })).toThrow(/custom page size/);
  expect(() => pageSizeForChoice({ preset: "custom", page: { width: 0, height: 9 } })).toThrow();
  expect(() => pageSizeForChoice({ preset: "a4" as never })).toThrow(/Unknown preset/);
});

// ── Read ───────────────────────────────────────────────────────────────────

test("readPageSetup reports the preset, the bounds and the manifest's margins", async () => {
  const dir = await book("@page { size: 5.5in 8.5in; margin: 0.4in }\n", [
    "preset: book",
    "page:",
    "  margin:",
    "    top: 61.2",
    "    bottom: 61.2",
    "    inside: 54",
    "    outside: 54",
  ]);
  try {
    // The stylesheet's size and margin are not consulted: the manifest decides.
    // What the stylesheet would give is reported too, for the way back.
    expect(await readPageSetup(dir)).toEqual({
      preset: "book",
      bounds: { width: 432, height: 648, tolerance: 0.5 },
      margins: { top: 61.2, bottom: 61.2, inside: 54, outside: 54 },
      marginsFrom: "manifest",
      fallbackMarginsFrom: "stylesheet",
      presetSizeOverridden: false,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("without page.margin the margins are the stylesheets' — a right-hand page's, inside at its left — else the engine's 1in", async () => {
  const mirrored = await book(
    "@page { margin: 1in }\n@page :left { margin: 0.5in 0.9in 0.6in 0.7in }\n@page :right { margin: 0.5in 0.7in 0.6in 0.9in }\n",
    ["preset: book"],
  );
  const plain = await book("@page { margin: 0.5in 0.75in }\n", ["preset: book"]);
  const none = await book("body { color: red }\n", ["preset: book"]);
  try {
    expect(await readPageSetup(mirrored)).toMatchObject({
      margins: { top: 36, bottom: 43.2, inside: 64.8, outside: 50.4 },
      marginsFrom: "stylesheet",
    });
    expect(await readPageSetup(plain)).toMatchObject({
      margins: { top: 36, bottom: 36, inside: 54, outside: 54 },
      marginsFrom: "stylesheet",
    });
    expect(await readPageSetup(none)).toMatchObject({ margins: INCH, marginsFrom: "default", fallbackMarginsFrom: "default" });
  } finally {
    for (const dir of [mirrored, plain, none]) await rm(dir, { recursive: true, force: true });
  }
});

test("a bundled look's margins are read too, and a partial page.margin does not count as the manifest's", async () => {
  // The bundled looks set no @page margin, so a book that lists one and sets
  // none itself prints with the default; the book's own sheet still wins.
  const dir = await book("", ["preset: book", "extensions:", "  - clean-book", "page:", "  margin:", "    top: 10"]);
  try {
    expect(await readPageSetup(dir)).toMatchObject({ margins: INCH, marginsFrom: "default" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readPageSetup defaults an undeclared preset to dtrpg and flags an unknown one", async () => {
  const dir = await book("", []);
  try {
    expect((await readPageSetup(dir)).preset).toBe("dtrpg");
    await writeFile(path.join(dir, "manifest.yaml"), "title: T\npreset: a4\n", "utf8");
    const setup = await readPageSetup(dir);
    expect(setup.preset).toBeNull();
    expect(setup.bounds).toBeNull();
    expect(setup.marginsFrom).toBe("default");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ── Write ──────────────────────────────────────────────────────────────────

test("setPageSetup custom writes the manifest bounds and never touches a stylesheet", async () => {
  const css = "/* mine */\n@page { size: 6in 9in; margin: 1in }\np { color: blue }\n";
  const dir = await book(css, ["preset: book"]);
  try {
    const setup = await setPageSetup(dir, { size: { preset: "custom", page: { width: 595, height: 842 } } });
    expect(setup.preset).toBe("custom");
    expect(setup.bounds).toEqual({ width: 595, height: 842, tolerance: 0.5 });
    expect(await readFile(path.join(dir, "styles", "book.css"), "utf8")).toBe(css);
    const manifest = await manifestOf(dir);
    expect(manifest).toContain("preset: custom");
    expect(manifest).toMatch(/page:\s+width: 595\s+height: 842/);
    const config = resolveConfig({}, await loadManifest(dir));
    expect(config.page.width).toBe(595);
    expect(config.page.height).toBe(842);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup to a preset drops a custom page: block and uses the preset's size", async () => {
  const dir = await book("", ["preset: custom", "page:", "  width: 360", "  height: 504", "  tolerance: 2"]);
  try {
    const setup = await setPageSetup(dir, { size: { preset: "dtrpg" } });
    expect(setup.preset).toBe("dtrpg");
    // The tolerance is the page-size check's option now (#483), not part of
    // the size, so it outlives the size it was written beside.
    expect(setup.bounds).toEqual({ width: 621, height: 810, tolerance: 2 });
    const manifest = await manifestOf(dir);
    expect(manifest).toContain("preset: dtrpg");
    expect(manifest).not.toContain("page:");
    expect(manifest).toContain("checks:\n  pdf.print.page-size:\n    tolerance: 2\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup writes the margins it is given, keeps them across a preset change, and leaves them alone otherwise", async () => {
  const dir = await book("", ["preset: book"]);
  try {
    const withMargins = await setPageSetup(dir, {
      size: { preset: "book" },
      margins: { top: 61.2, bottom: 61.2, inside: 54, outside: 50 },
    });
    expect(withMargins).toMatchObject({
      margins: { top: 61.2, bottom: 61.2, inside: 54, outside: 50 },
      marginsFrom: "manifest",
    });
    expect(await manifestOf(dir)).toMatch(
      /page:\s+margin:\s+top: 61\.2\s+bottom: 61\.2\s+inside: 54\s+outside: 50\s/,
    );
    // A preset change without margins keeps the recorded ones.
    const asDtrpg = await setPageSetup(dir, { size: { preset: "dtrpg" } });
    expect(asDtrpg.bounds).toEqual({ width: 621, height: 810, tolerance: 0.5 });
    expect(asDtrpg.margins).toEqual({ top: 61.2, bottom: 61.2, inside: 54, outside: 50 });
    // The resolved config carries them, so the assembly prints with them.
    expect(resolveConfig({}, await loadManifest(dir)).page.margin).toEqual({
      top: 61.2,
      bottom: 61.2,
      inside: 54,
      outside: 50,
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup keeps the page: block's print-area keys across a size change and a preset round trip", async () => {
  const dir = await book("", [
    "preset: custom",
    "page:",
    "  width: 360",
    "  height: 504",
    "  bleed: 9",
    "  safe: 36",
    "  artSafe: 18",
    "  gutter: 54",
  ]);
  try {
    await setPageSetup(dir, { size: { preset: "custom", page: LETTER } });
    expect(await manifestOf(dir)).toMatch(
      /page:\s+width: 612\s+height: 792\s+bleed: 9\s+safe: 36\s+artSafe: 18\s+gutter: 54\s/,
    );
    await setPageSetup(dir, { size: { preset: "dtrpg" } });
    const asPreset = await manifestOf(dir);
    expect(asPreset).toMatch(/page:\s+bleed: 9\s+safe: 36\s+artSafe: 18\s+gutter: 54\s/);
    expect(asPreset).not.toMatch(/width:|height:|tolerance:/);
    expect((await readPageSetup(dir)).bounds).toEqual({ width: 621, height: 810, tolerance: 0.5 });
    await setPageSetup(dir, { size: { preset: "custom", page: LETTER } });
    expect(await manifestOf(dir)).toMatch(
      /page:\s+bleed: 9\s+safe: 36\s+artSafe: 18\s+gutter: 54\s+width: 612\s+height: 792\s/,
    );
    expect(resolveConfig({}, await loadManifest(dir)).page.gutter).toBe(54);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup treats an empty page: key as no block", async () => {
  const dir = await book("", ["preset: custom", "page:"]);
  const manifest = path.join(dir, "manifest.yaml");
  try {
    await setPageSetup(dir, { size: { preset: "custom", page: LETTER } });
    expect(await readFile(manifest, "utf8")).toMatch(/page:\s+width: 612\s+height: 792\s/);
    await writeFile(manifest, "title: T\nstyles:\n  - styles/book.css\npreset: custom\npage:\n", "utf8");
    await setPageSetup(dir, { size: { preset: "book" } });
    expect(await readFile(manifest, "utf8")).not.toContain("page:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup writes an older book's tolerance as the page-size check's option and keeps the manifest's comments (#483)", async () => {
  const dir = await book("", ["# keep this comment", "preset: custom", "page:", "  width: 432", "  height: 648", "  tolerance: 2"]);
  try {
    const setup = await setPageSetup(dir, { size: { preset: "custom", page: LETTER } });
    expect(setup.bounds).toEqual({ ...LETTER, tolerance: 2 });
    const manifest = await manifestOf(dir);
    expect(manifest).toContain("# keep this comment");
    expect(manifest).toContain("page:\n  width: 612\n  height: 792\n");
    expect(manifest).toContain("checks:\n  pdf.print.page-size:\n    tolerance: 2\n");
    expect(resolveConfig({}, await loadManifest(dir)).page.tolerance).toBe(2);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup takes 0.11.22's call shape, a size choice, instead of doing nothing (#483)", async () => {
  const dir = await book("", ["preset: custom", "page:", "  width: 360", "  height: 504"]);
  try {
    // 0.11.22: setPageSetup(dir, { preset, page? }).
    const asBook = await setPageSetup(dir, { preset: "book" });
    expect(asBook.preset).toBe("book");
    expect(asBook.bounds).toEqual({ width: 432, height: 648, tolerance: 0.5 });
    expect(await manifestOf(dir)).toContain("preset: book");
    const asLetter = await setPageSetup(dir, { preset: "custom", page: LETTER });
    expect(asLetter.bounds).toEqual({ ...LETTER, tolerance: 0.5 });
    // Anything else is refused, never a silent no-op.
    await expect(setPageSetup(dir, { kind: "preset" } as never)).rejects.toThrow(/setPageSetup takes \{ size/);
    await expect(setPageSetup(dir, null as never)).rejects.toThrow(/setPageSetup takes/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup changes nothing when the change is invalid", async () => {
  const dir = await book("", ["preset: book"]);
  try {
    await expect(setPageSetup(dir, { size: { preset: "custom" } })).rejects.toThrow(/custom page size/);
    await expect(
      setPageSetup(dir, { size: { preset: "book" }, margins: { top: -1, bottom: 72, inside: 72, outside: 72 } }),
    ).rejects.toThrow(/all four edges/);
    await expect(
      setPageSetup(dir, { margins: { top: 72, bottom: 72, inside: 216, outside: 216 } }),
    ).rejects.toThrow(/no room for text/);
    expect(await manifestOf(dir)).toBe("title: T\nstyles:\n  - styles/book.css\npreset: book\n");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("margins alone leave the size as recorded: a preset's page: override and a custom trim to the point", async () => {
  const letterBook = await book("", ["preset: book", "page:", "  width: 612", "  height: 792"]);
  const odd = await book("", ["preset: custom", "page:", "  width: 595.28", "  height: 841.89"]);
  const sizeless = await book("", ["preset: custom"]);
  try {
    // Validated against the recorded Letter (612pt wide), not the preset's 432.
    const margins = { top: 72, bottom: 72, inside: 220, outside: 220 };
    const setup = await setPageSetup(letterBook, { margins });
    expect(setup).toMatchObject({
      preset: "book",
      bounds: { width: 612, height: 792, tolerance: 0.5 },
      margins,
      marginsFrom: "manifest",
      presetSizeOverridden: true, // the preset's size is overridden: Details says so (#440)
    });
    expect((await readPageSetup(odd)).presetSizeOverridden).toBe(false); // custom has no size to override
    expect(await manifestOf(letterBook)).toMatch(
      /preset: book\s+page:\s+width: 612\s+height: 792\s+margin:\s+top: 72\s+bottom: 72\s+inside: 220\s+outside: 220\s/,
    );
    await setPageSetup(odd, { margins: { top: 72, bottom: 72, inside: 72, outside: 72 } });
    expect(await manifestOf(odd)).toMatch(/width: 595\.28\s+height: 841\.89\s+margin:/);
    await expect(setPageSetup(sizeless, { margins })).rejects.toThrow(/Choose a page size/);
    expect(await manifestOf(sizeless)).toBe("title: T\nstyles:\n  - styles/book.css\npreset: custom\n");
  } finally {
    for (const dir of [letterBook, odd, sizeless]) await rm(dir, { recursive: true, force: true });
  }
});

test("margins: null removes page.margin and nothing else; the stylesheets' margins apply again (#439)", async () => {
  const dir = await book("@page { margin: 0.5in }\n", [
    "preset: book",
    "page:",
    "  safe: 18",
    "  margin:",
    "    top: 72",
    "    bottom: 72",
    "    inside: 72",
    "    outside: 72",
  ]);
  const only = await book("", ["preset: book", "page:", "  margin:", "    top: 72", "    bottom: 72", "    inside: 72", "    outside: 72"]);
  try {
    const setup = await setPageSetup(dir, { margins: null });
    expect(setup).toMatchObject({ margins: { top: 36, bottom: 36, inside: 36, outside: 36 }, marginsFrom: "stylesheet" });
    expect(await manifestOf(dir)).toMatch(/page:\s+safe: 18\s*$/);
    expect(await manifestOf(dir)).not.toContain("margin:");
    // A page: block that held only the margins goes with them; the default is what is left.
    expect(await setPageSetup(only, { margins: null })).toMatchObject({ margins: INCH, marginsFrom: "default" });
    expect(await manifestOf(only)).toBe("title: T\nstyles:\n  - styles/book.css\npreset: book\n");
  } finally {
    for (const d of [dir, only]) await rm(d, { recursive: true, force: true });
  }
});

test("a freshly scaffolded book reads back its template's size and margins and can be resized", async () => {
  const parent = await mkdtemp(path.join(tmpdir(), "gutterpress-pagesize-"));
  try {
    const { projectDir } = await scaffoldProject({
      name: "Sized",
      parentDir: parent,
      preset: "custom",
      customPage: LETTER,
      versionHistory: "none",
    });
    const fresh = await readPageSetup(projectDir);
    expect(fresh.preset).toBe("custom");
    expect(fresh.bounds).toEqual({ ...LETTER, tolerance: 0.5 });
    // The book template's margins (clean-book's old values), from the manifest.
    expect(fresh).toMatchObject({
      margins: { top: 61.2, bottom: 61.2, inside: 54, outside: 54 },
      marginsFrom: "manifest",
    });

    const resized = await setPageSetup(projectDir, { size: { preset: "book" } });
    expect(resized.preset).toBe("book");
    expect(resized.bounds).toEqual({ width: 432, height: 648, tolerance: 0.5 });
    expect(resized.margins).toEqual(fresh.margins);
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
