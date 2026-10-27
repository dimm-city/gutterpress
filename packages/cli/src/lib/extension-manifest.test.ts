/**
 * #241/#276 — `extension-manifest.ts` is the metadata reader + resolver the
 * extension package format is built on, and that format is the standard
 * `package.json`. These tests pin the shared contract directly:
 * `readExtensionMeta`'s npm-fields + `gutterpress`-block mapping,
 * `extensionEntry`'s `gutterpress.markdown ?? main` rule,
 * `assertExtensionContained`'s write-boundary guard over every declared
 * field, and `resolveExtension`'s absolute-path resolution built on
 * `resolveDeclaredStyles`.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  EXTENSION_MANIFEST_FILENAME,
  readExtensionMeta,
  extensionStyleList,
  extensionEntry,
  extensionCarries,
  assertExtensionContained,
  assertPublishOnly,
  assertSupportsThisGutterpress,
  resolveExtension,
} from "./extension-manifest";
import { PACKAGE_VERSION } from "./version";

const TMP_ROOT = join(process.cwd(), ".tmp", `extension-manifest-tests-${Date.now()}`);

let counter = 0;
function extDir(): string {
  const dir = join(TMP_ROOT, `ext-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("extension-manifest", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  describe("filenames", () => {
    test("package.json is the one manifest filename", () => {
      expect(EXTENSION_MANIFEST_FILENAME).toBe("package.json");
    });
  });

  /** Write a package.json into a fresh extension folder. */
  function pkgDir(pkg: unknown): string {
    const dir = extDir();
    writeFileSync(join(dir, "package.json"), JSON.stringify(pkg), "utf8");
    return dir;
  }

  describe("readExtensionMeta", () => {
    test("reads npm's own fields as-is", async () => {
      const meta = await readExtensionMeta(
        pkgDir({
          name: "field-notes",
          description: "Notes in the margin",
          author: "Ada",
          keywords: ["gutterpress", "markdown-it-plugin"],
          main: "plugin.js",
        }),
      );
      expect(meta).toEqual({
        name: "field-notes",
        description: "Notes in the margin",
        author: "Ada",
        keywords: ["gutterpress", "markdown-it-plugin"],
        main: "plugin.js",
      });
    });

    test("author may be npm's object form — its `name` is used", async () => {
      const meta = await readExtensionMeta(
        pkgDir({ name: "x", author: { name: "Ada Lovelace", email: "ada@example.com" } }),
      );
      expect(meta.author).toBe("Ada Lovelace");
    });

    test("every Gutterpress-specific field comes from the `gutterpress` block", async () => {
      const meta = await readExtensionMeta(
        pkgDir({
          name: "look",
          gutterpress: {
            styles: ["a.css", "b.css"],
            markdown: "lib/plugin.js",
            snippets: "snippets",
            components: "components.yaml",
            preview: "preview.png",
            // Read by nothing since the Design tab reads every enabled look's
            // `:root`; a package that still declares it loads with it dropped.
            tokensFile: "../tokens.css",
          },
        }),
      );
      expect(meta).not.toHaveProperty("tokensFile");
      expect(meta.styles).toEqual(["a.css", "b.css"]);
      expect(meta.markdown).toBe("lib/plugin.js");
      expect(meta.snippets).toBe("snippets");
      expect(meta.components).toBe("components.yaml");
      expect(meta.preview).toBe("preview.png");
    });

    test("a top-level `styles` key is NOT a declaration — only the gutterpress block is", async () => {
      const meta = await readExtensionMeta(pkgDir({ name: "x", styles: ["sneaky.css"] }));
      expect(meta.styles).toBeUndefined();
    });

    test("a plain markdown-it plugin package needs no gutterpress key at all", async () => {
      const meta = await readExtensionMeta(pkgDir({ name: "markdown-it-mark", main: "index.js" }));
      expect(meta.main).toBe("index.js");
      expect(meta.styles).toBeUndefined();
      expect(extensionCarries(meta)).toEqual({
        markdown: true,
        styles: false,
        snippets: false,
        components: false,
        publish: false,
      });
    });

    // #381 (experimental) — a publishing plugin's `main` is its publish
    // module, never a markdown-it entry.
    test("`gutterpress.publish: true` marks a publishing plugin whose `main` is not a markdown entry (#381)", async () => {
      const meta = await readExtensionMeta(
        pkgDir({ name: "gp-publish-x", main: "index.js", gutterpress: { publish: true } }),
      );
      expect(meta.publish).toBe(true);
      expect(extensionEntry(meta)).toBeUndefined();
      expect(extensionCarries(meta)).toEqual({
        markdown: false,
        styles: false,
        snippets: false,
        components: false,
        publish: true,
      });
    });

    test("only a literal `true` is a publish flag (#381)", async () => {
      for (const publish of ["true", 1, "./publish.js", {}]) {
        const meta = await readExtensionMeta(
          pkgDir({ name: "not-a-publisher", main: "index.js", gutterpress: { publish } }),
        );
        expect(meta.publish).toBeUndefined();
        expect(extensionEntry(meta)).toBe("index.js");
      }
    });

    test("returns {} for a folder with no package.json", async () => {
      expect(await readExtensionMeta(extDir())).toEqual({});
    });

    test("returns {} for unparseable JSON rather than throwing", async () => {
      const dir = extDir();
      writeFileSync(join(dir, "package.json"), "{ not json", "utf8");
      expect(await readExtensionMeta(dir)).toEqual({});
    });

    test("a stale gutterpress.json/theme.json is not read", async () => {
      const dir = extDir();
      writeFileSync(join(dir, "gutterpress.json"), JSON.stringify({ name: "Old" }), "utf8");
      writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "Older" }), "utf8");
      expect(await readExtensionMeta(dir)).toEqual({});
    });
  });

  describe("extensionEntry", () => {
    test("npm's `main` is the markdown-it entry of a folder extension", () => {
      expect(extensionEntry({ main: "plugin.js" })).toBe("plugin.js");
    });
    test("an explicit gutterpress.markdown overrides `main`", () => {
      expect(extensionEntry({ main: "index.js", markdown: "gutterpress-plugin.js" })).toBe(
        "gutterpress-plugin.js",
      );
    });
    test("neither declared is no markdown behaviour (a look)", () => {
      expect(extensionEntry({ styles: ["theme.css"] })).toBeUndefined();
    });
  });

  describe("extensionStyleList", () => {
    test("styles absent/empty means NO declared styles — no theme.css default", () => {
      // A look declares `gutterpress.styles`; there is no implicit theme.css.
      expect(extensionStyleList({})).toEqual([]);
      expect(extensionStyleList({ styles: [] })).toEqual([]);
      expect(extensionStyleList({ styles: ["a.css", "b.css"] })).toEqual(["a.css", "b.css"]);
    });
  });

  describe("assertExtensionContained", () => {
    test("allows a fully-contained declaration across every field", () => {
      expect(() =>
        assertExtensionContained({
          styles: ["css/tokens.css"],
          markdown: "plugin.js",
          components: "components.yaml",
          snippets: "snippets",
        }),
      ).not.toThrow();
    });

    // #381 (experimental) — a publisher's `main` is no markdown entry, but
    // the publish path imports it, so it must stay inside the folder too.
    test("rejects a publishing plugin whose `main` escapes its folder (#381)", () => {
      expect(() => assertExtensionContained({ publish: true, main: "../outside.js" })).toThrow(
        /outside its own folder/,
      );
      expect(() => assertExtensionContained({ publish: true, main: "lib/index.js" })).not.toThrow();
    });

    // #381 — one rule for both load paths: a publisher declares nothing the
    // renderer would load. Its `main` is its publish module, so it's fine.
    test("assertPublishOnly refuses a publisher that also declares renderer-side fields, and only then (#381)", () => {
      expect(() => assertPublishOnly({ publish: true, main: "index.js" }, "x")).not.toThrow();
      expect(() => assertPublishOnly({ main: "index.js", styles: ["a.css"] }, "x")).not.toThrow();
      expect(() => assertPublishOnly({ publish: true, main: "index.js", styles: ["a.css"] }, "x")).toThrow(
        /Publishing plugin "x" also declares styles — a package is a publisher or a markdown plugin, not both/,
      );
      expect(() =>
        assertPublishOnly({ publish: true, markdown: "md.js", components: "components.yaml", snippets: "snippets" }, "x"),
      ).toThrow(/also declares markdown, components, snippets/);
    });

    test("rejects a traversal or absolute path in EACH new field individually", () => {
      expect(() => assertExtensionContained({ markdown: "../outside.js" })).toThrow(
        /outside its own folder/,
      );
      expect(() => assertExtensionContained({ markdown: "/etc/passwd" })).toThrow(
        /outside its own folder/,
      );
      expect(() => assertExtensionContained({ components: "../../catalog.yaml" })).toThrow(
        /outside its own folder/,
      );
      expect(() => assertExtensionContained({ snippets: "../shared-snippets" })).toThrow(
        /outside its own folder/,
      );
    });

    test("the thrown message names the offending declared value", () => {
      expect(() => assertExtensionContained({ markdown: "../evil.js" })).toThrow(
        /"\.\.\/evil\.js"/,
      );
    });

    test("rejects the removed `engineStyles` field, naming the replacement (#266)", () => {
      const stale = {
        styles: ["css/a.css"],
        engineStyles: { native: ["css/native.css"] },
      } as Parameters<typeof assertExtensionContained>[0];
      expect(() => assertExtensionContained(stale)).toThrow(
        /`engineStyles`, which was removed — move its entries to the end of `styles`/,
      );
    });
  });

  describe("resolveExtension", () => {
    test("resolves the folder's entry (`main`) and styles to absolute existence-checked paths", () => {
      const dir = extDir();
      writeFileSync(join(dir, "plugin.js"), "export default function () {}", "utf8");
      mkdirSync(join(dir, "css"), { recursive: true });
      writeFileSync(join(dir, "css", "a.css"), ".a {}", "utf8");

      const resolved = resolveExtension(
        dir,
        {
          main: "plugin.js",
          styles: ["css/a.css"],
        },
        "Plugin \"demo\"",
      );

      expect(resolved.markdown).toBe(join(dir, "plugin.js"));
      expect(resolved.styles).toEqual([join(dir, "css", "a.css")]);
    });

    test("an extension declaring nothing resolves to an empty object", () => {
      const dir = extDir();
      expect(resolveExtension(dir, {}, "Plugin \"demo\"")).toEqual({});
    });

    test("throws naming the field's declared path when markdown is missing", () => {
      const dir = extDir();
      expect(() => resolveExtension(dir, { markdown: "missing.js" }, 'Plugin "demo"')).toThrow(
        /Plugin "demo" declares stylesheet "missing\.js".*no file exists/s,
      );
    });

    test("resolves components and snippets, parsed and validated but otherwise unused (#240/#242 defer the semantics)", () => {
      const dir = extDir();
      writeFileSync(join(dir, "components.yaml"), "components: []", "utf8");
      mkdirSync(join(dir, "snippets"), { recursive: true });
      writeFileSync(join(dir, "snippets", "example.md"), "# Example", "utf8");

      const resolved = resolveExtension(
        dir,
        { components: "components.yaml", snippets: "snippets" },
        'Plugin "demo"',
      );
      expect(resolved.components).toBe(join(dir, "components.yaml"));
      expect(resolved.snippets).toBe(join(dir, "snippets"));
    });
  });

  describe("engines.gutterpress", () => {
    test("is read from npm's engines field", async () => {
      const meta = await readExtensionMeta(pkgDir({ name: "x", engines: { gutterpress: ">=0.11.20-alpha.3" } }));
      expect(meta.gutterpressRange).toBe(">=0.11.20-alpha.3");
    });

    test("loads when absent or satisfied, prereleases included", () => {
      expect(() => assertSupportsThisGutterpress({}, "x")).not.toThrow();
      expect(() => assertSupportsThisGutterpress({ gutterpressRange: `>=${PACKAGE_VERSION}` }, "x")).not.toThrow();
      expect(() => assertSupportsThisGutterpress({ gutterpressRange: ">=0.0.1" }, "x")).not.toThrow();
    });

    test("refuses a Gutterpress outside the range, naming both versions", () => {
      expect(() => assertSupportsThisGutterpress({ gutterpressRange: ">=999.0.0" }, "gp-x")).toThrow(
        `Extension "gp-x" needs Gutterpress >=999.0.0 (its package.json engines.gutterpress); this is Gutterpress ${PACKAGE_VERSION}.`,
      );
    });

    test("refuses an invalid range", () => {
      expect(() => assertSupportsThisGutterpress({ gutterpressRange: "not a range" }, "gp-x")).toThrow(/invalid engines\.gutterpress/);
    });
  });
});
