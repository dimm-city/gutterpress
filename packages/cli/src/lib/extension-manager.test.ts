/**
 * #265 — the one extension rail: `extensions:` read/write/toggle/reorder,
 * adding by path (referenced in place), by bundled name, and as a copied
 * built-in look; validation through the one loader; CSS read for previews.
 * npm installs are covered end to end in `npm-plugin-installer.test.ts`
 * (through the same `addExtension`).
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  addBuiltInStyleSet,
  addExtension,
  describeExtension,
  listBuiltInStyleSets,
  listProjectExtensions,
  readExtensionCss,
  removeExtension,
  reorderExtensions,
  setExtensionEnabled,
  validateProjectExtensions,
  BUILT_IN_STYLE_SET_IDS,
  EXTENSIONS_DIR,
  RECOMMENDED_EXTENSIONS,
} from "./extension-manager";
import { BUNDLED_EXTENSIONS } from "./extension-specifier";

const TMP_ROOT = join(process.cwd(), ".tmp", `extension-manager-tests-${Date.now()}`);
let counter = 0;

function projectDir(manifest = "title: Test\n"): string {
  const dir = join(TMP_ROOT, `proj-${counter++}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "manifest.yaml"), manifest, "utf8");
  return dir;
}

function readManifest(dir: string): string {
  return readFileSync(join(dir, "manifest.yaml"), "utf8");
}

/** An extension folder: optional gutterpress.json + files (nested paths allowed). */
function writeExtension(
  root: string,
  rel: string,
  meta: Record<string, unknown> | null,
  files: Record<string, string>,
): string {
  const dir = join(root, rel);
  mkdirSync(dir, { recursive: true });
  if (meta) writeFileSync(join(dir, "gutterpress.json"), JSON.stringify(meta), "utf8");
  for (const [name, body] of Object.entries(files)) {
    mkdirSync(join(dir, name, ".."), { recursive: true });
    writeFileSync(join(dir, name), body, "utf8");
  }
  return dir;
}

const PLUGIN_JS = "export default function (md) { md.__house = true; }\n";

function writeHouse(root: string, rel = "ext/house"): string {
  return writeExtension(
    root,
    rel,
    { name: "House Style", markdown: "plugin.js", styles: ["css/tokens.css", "css/rules.css"], snippets: "snippets" },
    {
      "plugin.js": PLUGIN_JS,
      "css/tokens.css": ":root { --house: 1; }\n",
      "css/rules.css": ".house { color: red; }\n",
      "snippets/box.md": "**{{x}}**\n",
    },
  );
}

describe("extension-manager", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  describe("listProjectExtensions", () => {
    test("returns [] with no list, and describes each kind in manifest order", async () => {
      expect(await listProjectExtensions(projectDir())).toEqual([]);

      const dir = projectDir(
        [
          "title: Test",
          "extensions:",
          "  - ./ext/house",
          "  - ./plugins/bare.js",
          "  - markdown-it-mark",
          "  - markdown-it-footnote",
          "  - some-pkg@1.0.0",
          "  - use: ./missing",
          "    enabled: false",
          "",
        ].join("\n"),
      );
      writeHouse(dir);
      mkdirSync(join(dir, "plugins"), { recursive: true });
      writeFileSync(join(dir, "plugins", "bare.js"), PLUGIN_JS, "utf8");

      const list = await listProjectExtensions(dir);
      expect(list.map((e) => e.use)).toEqual([
        "./ext/house",
        "./plugins/bare.js",
        "markdown-it-mark",
        "markdown-it-footnote",
        "some-pkg@1.0.0",
        "./missing",
      ]);

      const [house, bare, mark, footnote, pinned, missing] = list;
      expect(house).toMatchObject({
        kind: "path",
        label: "House Style",
        enabled: true,
        carries: { markdown: true, styles: true, snippets: true, components: false },
        styles: ["css/tokens.css", "css/rules.css"],
      });
      expect(house!.dir).toBe(join(dir, "ext", "house"));
      expect(bare).toMatchObject({
        kind: "path",
        label: "bare.js",
        carries: { markdown: true, styles: false, snippets: false, components: false },
      });
      expect(bare!.dir).toBeUndefined();
      expect(mark).toMatchObject({ kind: "bundled", label: "Highlight", carries: { markdown: true } });
      expect(footnote).toMatchObject({ kind: "npm", name: "markdown-it-footnote" });
      expect(footnote!.warnings?.join(" ")).toMatch(/Not pinned/);
      expect(pinned).toMatchObject({ kind: "npm", name: "some-pkg", version: "1.0.0" });
      expect(pinned!.warnings?.join(" ")).toMatch(/Not installed/);
      expect(missing).toMatchObject({ kind: "path", enabled: false });
      expect(missing!.warnings?.join(" ")).toMatch(/Not found/);
    });

    test("a metadata-less theme.css folder is a one-sheet look; an unparseable specifier is reported, not thrown", async () => {
      const dir = projectDir(["title: T", "extensions:", "  - ./looks/plain", "  - plugins/oops.js", ""].join("\n"));
      writeExtension(dir, "looks/plain", null, { "theme.css": "body { color: blue; }\n" });

      const [plain, oops] = await listProjectExtensions(dir);
      expect(plain).toMatchObject({
        label: "Plain",
        styles: ["theme.css"],
        carries: { markdown: false, styles: true, snippets: false, components: false },
      });
      expect(oops!.warnings?.join(" ")).toMatch(/write it as "\.\/plugins\/oops\.js"/);
    });

    test("describeExtension matches an npm entry by name regardless of its pin", async () => {
      const dir = projectDir(["title: T", "extensions:", "  - some-pkg@1.0.0", ""].join("\n"));
      expect((await describeExtension(dir, "some-pkg"))?.use).toBe("some-pkg@1.0.0");
      expect(await describeExtension(dir, "other-pkg")).toBeNull();
    });
  });

  describe("addExtension", () => {
    test("a folder inside the project is written as ./<rel>, referenced in place, idempotently", async () => {
      const dir = projectDir();
      const abs = writeHouse(dir);

      const entry = await addExtension(dir, abs);
      expect(entry.use).toBe("./ext/house");
      expect(entry.dir).toBe(abs);
      expect(readManifest(dir)).toContain("extensions:\n  - ./ext/house\n");
      expect(existsSync(join(dir, EXTENSIONS_DIR))).toBe(false); // nothing was copied

      await addExtension(dir, "./ext/house");
      expect((await listProjectExtensions(dir)).map((e) => e.use)).toEqual(["./ext/house"]);
    });

    test("a folder outside the project is written relative to it, starting with ../", async () => {
      const dir = projectDir();
      const shared = writeExtension(
        TMP_ROOT,
        "shared/lib",
        { name: "Shared", styles: ["lib.css"] },
        { "lib.css": ".shared {}\n" },
      );

      const entry = await addExtension(dir, shared);
      expect(entry.use.startsWith("../")).toBe(true);
      expect(entry.dir).toBe(shared);
      expect(entry.carries.styles).toBe(true);
    });

    test("a bare plugin file, an export, and the bundled/npm split", async () => {
      const dir = projectDir();
      mkdirSync(join(dir, "plugins"), { recursive: true });
      writeFileSync(
        join(dir, "plugins", "named.js"),
        "export function attrs(md) { md.__named = true; }\n",
        "utf8",
      );

      const named = await addExtension(dir, "./plugins/named.js", { exportName: "attrs" });
      expect(named).toMatchObject({ use: "./plugins/named.js", export: "attrs", kind: "path" });
      expect(readManifest(dir)).toContain("  - use: ./plugins/named.js\n    export: attrs\n");

      const mark = await addExtension(dir, "markdown-it-mark");
      expect(mark).toMatchObject({ kind: "bundled", use: "markdown-it-mark", label: "Highlight" });
      expect(readManifest(dir)).toContain("  - markdown-it-mark\n");
      await expect(addExtension(dir, "markdown-it-mark", { exportName: "x" })).rejects.toThrow(
        /does not take a named export/,
      );
    });

    test("a missing path, a folder that declares nothing, and a plugin that fails to load are refused", async () => {
      const dir = projectDir();
      await expect(addExtension(dir, "./nope")).rejects.toThrow(/Extension not found/);

      writeExtension(dir, "ext/empty", { name: "Empty" }, {});
      await expect(addExtension(dir, "./ext/empty")).rejects.toThrow(/declares neither/);

      mkdirSync(join(dir, "plugins"), { recursive: true });
      writeFileSync(join(dir, "plugins", "broken.js"), "export default 42;\n", "utf8");
      await expect(addExtension(dir, "./plugins/broken.js")).rejects.toThrow();
      expect(readManifest(dir)).not.toContain("broken.js");
    });
  });

  describe("toggle / reorder / remove", () => {
    test("setExtensionEnabled turns a bare entry into the object form and back", async () => {
      const dir = projectDir();
      writeHouse(dir);
      await addExtension(dir, "./ext/house");

      await setExtensionEnabled(dir, "./ext/house", false);
      expect(readManifest(dir)).toContain("  - use: ./ext/house\n    enabled: false\n");
      expect((await listProjectExtensions(dir))[0]!.enabled).toBe(false);

      await setExtensionEnabled(dir, "./ext/house", true);
      expect(readManifest(dir)).toContain("  - ./ext/house\n");
      expect(readManifest(dir)).not.toContain("use:");

      await expect(setExtensionEnabled(dir, "./ghost", false)).rejects.toThrow(/is not in the manifest/);
    });

    test("reorderExtensions rewrites the list in the given order and refuses a stale one", async () => {
      const dir = projectDir(["title: T", "extensions:", "  - a-ext", "  - b-ext", "  - use: c-ext", "    enabled: false", ""].join("\n"));

      await reorderExtensions(dir, ["c-ext", "a-ext", "b-ext"]);
      expect((await listProjectExtensions(dir)).map((e) => e.use)).toEqual(["c-ext", "a-ext", "b-ext"]);
      expect(readManifest(dir)).toContain("  - use: c-ext\n    enabled: false\n  - a-ext\n  - b-ext\n");

      await expect(reorderExtensions(dir, ["a-ext", "b-ext"])).rejects.toThrow(/exactly once/);
      await expect(reorderExtensions(dir, ["a-ext", "b-ext", "c-ext", "d-ext"])).rejects.toThrow(/exactly once/);
    });

    test("removeExtension drops the entry, deletes an emptied key, and never touches a path folder", async () => {
      const dir = projectDir();
      const abs = writeHouse(dir);
      await addExtension(dir, "./ext/house");

      await removeExtension(dir, "./ext/house");
      expect(readManifest(dir)).not.toContain("extensions:");
      expect(existsSync(abs)).toBe(true);
      await expect(removeExtension(dir, "./ext/house")).rejects.toThrow(/is not in the manifest/);
    });
  });

  describe("built-in looks", () => {
    test("listBuiltInStyleSets names the three looks", async () => {
      const sets = await listBuiltInStyleSets();
      expect(sets.map((s) => s.id)).toEqual([...BUILT_IN_STYLE_SET_IDS]);
      for (const s of sets) expect(s.name.length).toBeGreaterThan(0);
    });

    test("addBuiltInStyleSet copies the look into extensions/<id>/, lists it, and is idempotent", async () => {
      const dir = projectDir();
      const entry = await addBuiltInStyleSet(dir, "zine");
      expect(entry).toMatchObject({
        use: `./${EXTENSIONS_DIR}/zine`,
        kind: "path",
        label: "Zine",
        styles: ["theme.css"],
        carries: { styles: true, markdown: false },
      });
      expect(existsSync(join(dir, EXTENSIONS_DIR, "zine", "theme.css"))).toBe(true);
      expect(await readExtensionCss(dir, "./extensions/zine")).toContain(":root");

      // Edit the copy: it is the author's now, and a second add keeps it.
      writeFileSync(join(dir, EXTENSIONS_DIR, "zine", "theme.css"), ":root { --mine: 1; }\n", "utf8");
      await addBuiltInStyleSet(dir, "zine");
      expect((await listProjectExtensions(dir)).map((e) => e.use)).toEqual(["./extensions/zine"]);
      expect(await readExtensionCss(dir, "./extensions/zine")).toBe(":root { --mine: 1; }\n");

      await expect(addBuiltInStyleSet(dir, "no-such-look")).rejects.toThrow(/Unknown built-in look/);
    });

    test("two looks can be on at once — no exclusivity", async () => {
      const dir = projectDir();
      await addBuiltInStyleSet(dir, "clean-book");
      await addBuiltInStyleSet(dir, "zine");
      const list = await listProjectExtensions(dir);
      expect(list.map((e) => e.use)).toEqual(["./extensions/clean-book", "./extensions/zine"]);
      expect(list.every((e) => e.enabled && e.carries.styles)).toBe(true);
    });
  });

  describe("validateProjectExtensions / readExtensionCss", () => {
    test("load-tests enabled entries only and reports the loader's error per entry", async () => {
      const dir = projectDir(
        ["title: T", "extensions:", "  - ./ext/house", "  - use: ./plugins/off.js", "    enabled: false", "  - ./plugins/nope.js", ""].join("\n"),
      );
      writeHouse(dir);

      const results = await validateProjectExtensions(dir);
      expect(results.map((r) => [r.use, r.enabled, r.ok])).toEqual([
        ["./ext/house", true, true],
        ["./plugins/off.js", false, true],
        ["./plugins/nope.js", true, false],
      ]);
      expect(results[2]!.error).toMatch(/not found/i);
    });

    test("readExtensionCss concatenates the declared sheets in order; a bundled name has none", async () => {
      const dir = projectDir(["title: T", "extensions:", "  - ./ext/house", "  - markdown-it-mark", ""].join("\n"));
      writeHouse(dir);
      expect(await readExtensionCss(dir, "./ext/house")).toBe(
        ":root { --house: 1; }\n\n\n.house { color: red; }\n",
      );
      await expect(readExtensionCss(dir, "markdown-it-mark")).rejects.toThrow(/no stylesheets/);
    });
  });

  test("RECOMMENDED_EXTENSIONS are exactly the bundled names", () => {
    expect(RECOMMENDED_EXTENSIONS.map((r) => r.use).sort()).toEqual([...BUNDLED_EXTENSIONS].sort());
  });
});
