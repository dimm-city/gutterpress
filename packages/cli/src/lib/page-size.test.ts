import { test, expect } from "bun:test";
import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  formatPageSize,
  pageSizeForChoice,
  readPageSetup,
  readPageSizeFromCss,
  setPageSetup,
  setPageSizeInCss,
} from "./page-size.ts";
import { scaffoldProject } from "./project-scaffold.ts";
import { loadManifest, resolveConfig } from "./manifest.ts";

const LETTER = { width: 612, height: 792 };

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

// ── CSS read / format ──────────────────────────────────────────────────────

test("formatPageSize prints inches when exact and points otherwise", () => {
  expect(formatPageSize(LETTER)).toBe("8.5in 11in");
  expect(formatPageSize({ width: 621, height: 810 })).toBe("8.625in 11.25in");
  expect(formatPageSize({ width: 595, height: 842 })).toBe("595pt 842pt");
});

test("readPageSizeFromCss reads the last plain @page size and ignores named/pseudo pages", () => {
  const css = `
    @page { size: A4; margin: 1in }
    @page :first { size: 1in 1in }
    @page cover { size: 2in 2in }
    @page { size: 6in 9in }
  `;
  expect(readPageSizeFromCss(css)).toEqual({ width: 432, height: 648 });
  expect(readPageSizeFromCss("body { color: red }")).toBeNull();
  expect(readPageSizeFromCss("@page { margin: 1in }")).toBeNull();
  expect(readPageSizeFromCss("@page {")).toBeNull();
});

test("pageSizeForChoice: presets own their size, custom needs a positive trim", () => {
  expect(pageSizeForChoice({ preset: "dtrpg" })).toEqual({ width: 621, height: 810 });
  expect(pageSizeForChoice({ preset: "book", page: LETTER })).toEqual({ width: 432, height: 648 });
  expect(pageSizeForChoice({ preset: "custom", page: LETTER })).toEqual(LETTER);
  expect(() => pageSizeForChoice({ preset: "custom" })).toThrow(/custom page size/);
  expect(() => pageSizeForChoice({ preset: "custom", page: { width: 0, height: 9 } })).toThrow();
  expect(() => pageSizeForChoice({ preset: "a4" as never })).toThrow(/Unknown preset/);
});

// ── CSS rewrite ────────────────────────────────────────────────────────────

test("setPageSizeInCss rewrites the size in place and keeps every other byte", () => {
  const css =
    "/* keep me */\r\nbody   { color: red; }\n\n@page {\n  margin: 0.5in; /* m */\n  size:   6in 9in  !important;\n}\n.x{a:b}";
  const out = setPageSizeInCss(css, LETTER);
  expect(out).toBe(css.replace("6in 9in", "8.5in 11in"));
});

test("setPageSizeInCss leaves the text alone when the size already matches", () => {
  const css = "@page { size: letter; margin: 1in }\n";
  expect(setPageSizeInCss(css, LETTER)).toBe(css);
});

test("setPageSizeInCss only changes the winning plain @page, not named or :first pages", () => {
  const css = "@page :first { size: 1in 1in }\n@page { size: 6in 9in }\n@page cover { size: 2in 2in }\n";
  expect(setPageSizeInCss(css, LETTER)).toBe(
    "@page :first { size: 1in 1in }\n@page { size: 8.5in 11in }\n@page cover { size: 2in 2in }\n",
  );
});

test("setPageSizeInCss adds a minimal @page when none sets a size", () => {
  expect(setPageSizeInCss("", LETTER)).toBe("@page {\n  size: 8.5in 11in;\n}\n");
  expect(setPageSizeInCss("body { margin: 0 }", LETTER)).toBe(
    "body { margin: 0 }\n\n@page {\n  size: 8.5in 11in;\n}\n",
  );
  // A margin-only @page is not a size: a new rule is appended, the old stays.
  expect(setPageSizeInCss("@page { margin: 1in }\n", LETTER)).toBe(
    "@page { margin: 1in }\n\n@page {\n  size: 8.5in 11in;\n}\n",
  );
});

test("setPageSizeInCss refuses CSS that does not parse", () => {
  expect(() => setPageSizeInCss("@page { size: 6in 9in", LETTER)).toThrow();
});

// ── Project read / write ───────────────────────────────────────────────────

test("setPageSetup custom updates the @page size and the manifest bounds together", async () => {
  const css = "/* mine */\n@page { size: 6in 9in; margin: 1in }\np { color: blue }\n";
  const dir = await book(css, ["preset: book"]);
  try {
    const setup = await setPageSetup(dir, { preset: "custom", page: { width: 595, height: 842 } });
    expect(setup.preset).toBe("custom");
    expect(setup.bounds).toEqual({ width: 595, height: 842, tolerance: 0.5 });
    expect(setup.css).toEqual({ width: 595, height: 842, file: "styles/book.css" });

    expect(await readFile(path.join(dir, "styles", "book.css"), "utf8")).toBe(
      css.replace("6in 9in", "595pt 842pt"),
    );
    const manifest = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    expect(manifest).toContain("preset: custom");
    expect(manifest).toMatch(/page:\s+width: 595\s+height: 842/);
    // The manifest and the stylesheet resolve to the same page.
    const config = resolveConfig({}, await loadManifest(dir));
    expect(config.page.width).toBe(595);
    expect(config.page.height).toBe(842);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup to a preset drops a custom page: block and uses the preset's size", async () => {
  const dir = await book("@page { size: 5in 7in }\n", [
    "preset: custom",
    "page:",
    "  width: 360",
    "  height: 504",
    "  tolerance: 2",
  ]);
  try {
    const setup = await setPageSetup(dir, { preset: "dtrpg" });
    expect(setup.preset).toBe("dtrpg");
    expect(setup.bounds).toEqual({ width: 621, height: 810, tolerance: 0.5 });
    expect(await readFile(path.join(dir, "styles", "book.css"), "utf8")).toBe(
      "@page { size: 8.625in 11.25in }\n",
    );
    const manifest = await readFile(path.join(dir, "manifest.yaml"), "utf8");
    expect(manifest).toContain("preset: dtrpg");
    expect(manifest).not.toContain("page:");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup keeps a hand-set tolerance and the manifest's comments", async () => {
  const dir = await book("@page { size: 6in 9in }\n", [
    "# keep this comment",
    "preset: custom",
    "page:",
    "  width: 432",
    "  height: 648",
    "  tolerance: 2",
  ]);
  try {
    const setup = await setPageSetup(dir, { preset: "custom", page: LETTER });
    expect(setup.bounds).toEqual({ ...LETTER, tolerance: 2 });
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toContain("# keep this comment");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup adds an @page rule to the book's own stylesheet when none sets a size", async () => {
  const dir = await book("/** Your book's own styles. */\n", ["preset: book"]);
  try {
    await setPageSetup(dir, { preset: "book" });
    expect(await readFile(path.join(dir, "styles", "book.css"), "utf8")).toBe(
      "/** Your book's own styles. */\n\n@page {\n  size: 6in 9in;\n}\n",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup creates styles/book.css and lists it when the book has no stylesheet", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gutterpress-pagesize-"));
  await writeFile(path.join(dir, "manifest.yaml"), "title: T\npreset: book\n", "utf8");
  try {
    const setup = await setPageSetup(dir, { preset: "custom", page: LETTER });
    expect(setup.css).toEqual({ ...LETTER, file: "styles/book.css" });
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toMatch(/styles:\s+- styles\/book\.css/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("setPageSetup changes nothing when the choice is invalid or the CSS does not parse", async () => {
  const bad = "@page { size: 6in 9in";
  const dir = await book(bad, ["preset: book"]);
  try {
    await expect(setPageSetup(dir, { preset: "custom" })).rejects.toThrow(/custom page size/);
    await expect(setPageSetup(dir, { preset: "dtrpg" })).rejects.toThrow(/CSS error/);
    expect(await readFile(path.join(dir, "styles", "book.css"), "utf8")).toBe(bad);
    expect(await readFile(path.join(dir, "manifest.yaml"), "utf8")).toContain("preset: book");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("readPageSetup reports preset, bounds and the stylesheet size", async () => {
  const dir = await book("@page { size: 5.5in 8.5in }\n", ["preset: book"]);
  try {
    expect(await readPageSetup(dir)).toEqual({
      preset: "book",
      bounds: { width: 432, height: 648, tolerance: 0.5 },
      css: { width: 396, height: 612, file: "styles/book.css" },
    });
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
    expect(setup.css).toBeNull();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("a freshly scaffolded custom book reads back its size and can be resized", async () => {
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
    expect(fresh.css).toBeNull(); // the starter stylesheet sets no size

    const resized = await setPageSetup(projectDir, { preset: "book" });
    expect(resized.preset).toBe("book");
    expect(resized.css).toEqual({ width: 432, height: 648, file: "styles/book.css" });
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
