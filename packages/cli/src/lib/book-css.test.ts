/**
 * #454: Book setup's design settings read the book's stylesheet as the build
 * assembles it — a plugin's `css` export, every extension file and every
 * `styles:` sheet, each tagged with where it comes from — and write with a
 * postcss edit of the book's own sheets.
 */
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { bookTokenEdits, readBookCss } from "./book-css";
import { loadManifestWithPath, resolveConfig } from "./manifest";
import { loadPluginsWithCss } from "./markdown/plugins";
import { renderChapters } from "./markdown/index";
import { resolveChromiumExecutable } from "./chromium";
import { launchChromium } from "../engine/shared/cdp.ts";

const TMP_ROOT = join(process.cwd(), ".tmp", `book-css-${Date.now()}`);
const chromium = await resolveChromiumExecutable();
let counter = 0;
let dir: string;

const write = (rel: string, text: string): void => {
  mkdirSync(join(dir, rel, ".."), { recursive: true });
  writeFileSync(join(dir, rel), text, "utf8");
};

const MANIFEST = [
  "title: Tokens",
  "preset: book",
  "extensions:",
  "  - clean-book",
  "  - ./ext/house",
  "styles:",
  "  - styles/book.css",
  "  - styles/late.css",
  "",
].join("\n");

beforeEach(() => {
  dir = join(TMP_ROOT, `proj-${counter++}`);
  write("manifest.yaml", MANIFEST);
  write("chapter.md", "# Hi\n\nBody.\n");
  // A folder extension with a stylesheet file AND a `css` export.
  write(
    "ext/house/package.json",
    JSON.stringify({ name: "house", main: "plugin.js", gutterpress: { styles: ["css/house.css"] } }),
  );
  write(
    "ext/house/plugin.js",
    'export default function () {}\nexport const css = ":root { --plugin-tint: #abcdef; --color-accent: #7b2f8a; }";\n',
  );
  write("ext/house/css/house.css", ":root {\n  /* @label House rule */\n  --house-rule: 1px;\n}\n");
  write("styles/book.css", ":root {\n  --fs-body: 10.5pt;\n}\n");
  write("styles/late.css", "/* loads last */\n:root {\n  --color-accent: #c0392b;\n  --late-only: 2;\n}\n");
  // A stylesheet the book does not list: the build never links it.
  write("styles/unused.css", ":root {\n  --unused: 1;\n}\n");
});

afterEach(() => {
  rmSync(TMP_ROOT, { recursive: true, force: true });
});

describe("readBookCss", () => {
  test("every chunk is tagged with its origin, in the build's order", async () => {
    const { chunks } = await readBookCss(dir);
    const origins = chunks.filter((c) => c.origin.kind !== "core").map((c) => c.origin);
    expect(origins).toEqual([
      { kind: "extension", name: "clean-book", layer: "ext.clean-book" },
      { kind: "extension", name: "house", layer: "ext.house", file: "ext/house/css/house.css" },
      { kind: "extension", name: "house", layer: "ext.house" },
      { kind: "book", file: "styles/book.css" },
      { kind: "book", file: "styles/late.css" },
    ]);
    // Core comes first and last (its layers, then the manifest's page geometry).
    expect(chunks[0]!.origin.kind).toBe("core");
    expect(chunks.at(-1)!.origin.kind).toBe("core");
    // A sheet the book does not list is not part of it.
    expect(chunks.some((c) => c.css.includes("--unused"))).toBe(false);
  });

  test("a plugin's css export is visible, in its extension's layer", async () => {
    const { chunks } = await readBookCss(dir);
    const plugin = chunks.find((c) => c.origin.kind === "extension" && c.origin.name === "house" && !c.origin.file)!;
    expect(plugin.tokens).toEqual([
      { name: "--plugin-tint", value: "#abcdef", layer: "ext.house" },
      { name: "--color-accent", value: "#7b2f8a", layer: "ext.house" },
    ]);
    const file = chunks.find((c) => c.origin.kind === "extension" && c.origin.file)!;
    expect(file.tokens).toEqual([{ name: "--house-rule", value: "1px", label: "House rule", layer: "ext.house" }]);
  });

  test("the second book sheet's :root is visible, unlayered", async () => {
    const { chunks } = await readBookCss(dir);
    const late = chunks.find((c) => c.origin.kind === "book" && c.origin.file === "styles/late.css")!;
    expect(late.tokens).toEqual([
      { name: "--color-accent", value: "#c0392b" },
      { name: "--late-only", value: "2" },
    ]);
  });

  test("a disabled extension, and one that cannot load, contribute nothing; the rest still load", async () => {
    write(
      "manifest.yaml",
      MANIFEST.replace("  - ./ext/house\n", "  - use: ./ext/house\n    enabled: false\n  - ./ext/missing\n"),
    );
    const { chunks } = await readBookCss(dir);
    expect(chunks.filter((c) => c.origin.kind === "extension").map((c) => c.origin)).toEqual([
      { kind: "extension", name: "clean-book", layer: "ext.clean-book" },
    ]);
  });

  (chromium ? test : test.skip)(
    "joined, the chunks give every custom property the value the built book computes",
    async () => {
      const { chunks } = await readBookCss(dir);
      const config = resolveConfig({}, (await loadManifestWithPath(dir)).manifest);
      const { plugins, pluginStyles } = await loadPluginsWithCss(config.extensions, dir);
      const html = await renderChapters(dir, { styles: config.styles, files: ["chapter.md"], plugins, pluginStyles });
      const names = [...new Set(chunks.flatMap((c) => c.tokens.map((t) => t.name)))];
      const browser = await launchChromium();
      try {
        const valuesOf = async (doc: string): Promise<Record<string, string>> => {
          const page = await browser.newPage();
          try {
            await page.setContent(doc);
            return await page.evaluate<Record<string, string>>(
              `(() => { const s = getComputedStyle(document.documentElement); return Object.fromEntries(${JSON.stringify(names)}.map((n) => [n, s.getPropertyValue(n).trim()])); })()`,
            );
          } finally {
            await page.close();
          }
        };
        const joined = await valuesOf(`<!DOCTYPE html><style>${chunks.map((c) => c.css).join("\n\n")}</style><p>x</p>`);
        expect(joined).toEqual(await valuesOf(html));
        // The later book sheet wins over the plugin's css export and the first sheet.
        expect(joined["--color-accent"]).toBe("#c0392b");
        expect(joined["--plugin-tint"]).toBe("#abcdef");
      } finally {
        await browser.close();
      }
    },
    60000,
  );
});

describe("bookTokenEdits", () => {
  const BOOK = () => join(dir, "styles", "book.css");
  const LATE = () => join(dir, "styles", "late.css");

  test("a token the second sheet declares is changed there, in place; the first sheet is not touched", async () => {
    const edits = await bookTokenEdits(dir, BOOK(), [{ name: "--color-accent", value: "#112233" }]);
    expect(edits).toEqual([
      { path: LATE(), content: "/* loads last */\n:root {\n  --color-accent: #112233;\n  --late-only: 2;\n}\n" },
    ]);
  });

  test("a token no book sheet declares goes into the target's :root; a removal leaves no trace", async () => {
    const [edit] = await bookTokenEdits(dir, BOOK(), [{ name: "--plugin-tint", value: "#000000" }]);
    expect(edit).toEqual({ path: BOOK(), content: ":root {\n  --plugin-tint: #000000;\n  --fs-body: 10.5pt;\n}\n" });
    writeFileSync(edit!.path, edit!.content, "utf8");
    const [undo] = await bookTokenEdits(dir, BOOK(), [{ name: "--plugin-tint", value: null }]);
    expect(undo).toEqual({ path: BOOK(), content: ":root {\n  --fs-body: 10.5pt;\n}\n" });
  });

  test("only the book's own sheets are written: a target the build does not use is refused, nothing is read from it", async () => {
    await expect(bookTokenEdits(dir, join(dir, "styles", "unused.css"), [{ name: "--a", value: "1" }])).rejects.toThrow(
      "styles/unused.css is not one of the book's stylesheets.",
    );
    expect(await bookTokenEdits(dir, BOOK(), [{ name: "--unused", value: "2" }])).toEqual([
      { path: BOOK(), content: ":root {\n  --unused: 2;\n  --fs-body: 10.5pt;\n}\n" },
    ]);
    expect(readFileSync(join(dir, "styles", "unused.css"), "utf8")).toBe(":root {\n  --unused: 1;\n}\n");
  });

  test("a sheet postcss cannot parse is named in the error, and nothing is returned to write", async () => {
    write("styles/late.css", ":root {\n  --a: 1;\n");
    await expect(bookTokenEdits(dir, BOOK(), [{ name: "--a", value: "2" }])).rejects.toThrow(
      "Couldn't read styles/late.css (line 1): Unclosed block.",
    );
  });
});
