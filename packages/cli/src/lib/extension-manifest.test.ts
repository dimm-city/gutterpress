/**
 * #241 — `extension-manifest.ts` is the metadata reader + resolver the
 * unified extension package format is built on. These tests pin the shared
 * contract directly: `readExtensionMeta`'s gutterpress.json-then-theme.json
 * fallback, `assertExtensionContained`'s write-boundary guard over every
 * declared field, and `resolveExtension`'s absolute-path resolution built on
 * `resolveDeclaredStyles`.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import {
  EXTENSION_MANIFEST_FILENAME,
  LEGACY_THEME_MANIFEST_FILENAME,
  readExtensionMeta,
  extensionStyleList,
  extensionEngineStyleList,
  assertExtensionContained,
  resolveExtension,
} from "./extension-manifest";

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
    test("gutterpress.json is the unified format's filename", () => {
      expect(EXTENSION_MANIFEST_FILENAME).toBe("gutterpress.json");
    });
    test("theme.json is still the recognized legacy filename", () => {
      expect(LEGACY_THEME_MANIFEST_FILENAME).toBe("theme.json");
    });
  });

  describe("readExtensionMeta", () => {
    test("reads theme.json when there is no gutterpress.json (backward compat)", async () => {
      const dir = extDir();
      writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "Legacy Theme" }), "utf8");
      const meta = await readExtensionMeta(dir);
      expect(meta.name).toBe("Legacy Theme");
      expect(meta.markdown).toBeUndefined();
    });

    test("prefers gutterpress.json over a sibling theme.json", async () => {
      const dir = extDir();
      writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "Old" }), "utf8");
      writeFileSync(join(dir, "gutterpress.json"), JSON.stringify({ name: "New" }), "utf8");
      const meta = await readExtensionMeta(dir);
      expect(meta.name).toBe("New");
    });

    test("reads a gutterpress.json-only folder (no theme.json at all)", async () => {
      const dir = extDir();
      writeFileSync(
        join(dir, "gutterpress.json"),
        JSON.stringify({ name: "Pure Extension", markdown: "plugin.js" }),
        "utf8",
      );
      const meta = await readExtensionMeta(dir);
      expect(meta.name).toBe("Pure Extension");
      expect(meta.markdown).toBe("plugin.js");
    });

    test("returns {} for a folder with neither file", async () => {
      const dir = extDir();
      expect(await readExtensionMeta(dir)).toEqual({});
    });

    test("returns {} for unparseable JSON rather than throwing", async () => {
      const dir = extDir();
      writeFileSync(join(dir, "gutterpress.json"), "{ not json", "utf8");
      expect(await readExtensionMeta(dir)).toEqual({});
    });

    test("a broken gutterpress.json does not fall back to a sibling theme.json", async () => {
      const dir = extDir();
      writeFileSync(join(dir, "theme.json"), JSON.stringify({ name: "Should not win" }), "utf8");
      writeFileSync(join(dir, "gutterpress.json"), "{ not json", "utf8");
      expect(await readExtensionMeta(dir)).toEqual({});
    });
  });

  describe("extensionStyleList / extensionEngineStyleList", () => {
    test("styles absent/empty means NO declared styles — no theme.css default", () => {
      // Unlike theme-manager.ts's themeStyleList, the generic extension list
      // does not default to ["theme.css"] — a markdown-only extension has no
      // reason to require a stylesheet it never declared.
      expect(extensionStyleList({})).toEqual([]);
      expect(extensionStyleList({ styles: [] })).toEqual([]);
      expect(extensionStyleList({ styles: ["a.css", "b.css"] })).toEqual(["a.css", "b.css"]);
    });

    test("engineStyles.native absent/malformed normalizes to []", () => {
      expect(extensionEngineStyleList({})).toEqual([]);
      expect(extensionEngineStyleList({ engineStyles: {} })).toEqual([]);
      expect(
        extensionEngineStyleList({ engineStyles: { native: ["x.css"] } }),
      ).toEqual(["x.css"]);
    });
  });

  describe("assertExtensionContained", () => {
    test("allows a fully-contained declaration across every field", () => {
      expect(() =>
        assertExtensionContained({
          styles: ["css/tokens.css"],
          engineStyles: { native: ["css/native.css"] },
          markdown: "plugin.js",
          components: "components.yaml",
          snippets: "snippets",
          tokensFile: "css/tokens.css",
        }),
      ).not.toThrow();
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
      expect(() => assertExtensionContained({ tokensFile: "../tokens.css" })).toThrow(
        /outside its own folder/,
      );
    });

    test("the thrown message names the offending declared value", () => {
      expect(() => assertExtensionContained({ markdown: "../evil.js" })).toThrow(
        /"\.\.\/evil\.js"/,
      );
    });
  });

  describe("resolveExtension", () => {
    test("resolves markdown, styles, and engineStyles to absolute existence-checked paths", () => {
      const dir = extDir();
      writeFileSync(join(dir, "plugin.js"), "export default function () {}", "utf8");
      mkdirSync(join(dir, "css"), { recursive: true });
      writeFileSync(join(dir, "css", "a.css"), ".a {}", "utf8");
      writeFileSync(join(dir, "css", "native.css"), "@page {}", "utf8");

      const resolved = resolveExtension(
        dir,
        {
          markdown: "plugin.js",
          styles: ["css/a.css"],
          engineStyles: { native: ["css/native.css"] },
        },
        "Plugin \"demo\"",
      );

      expect(resolved.markdown).toBe(join(dir, "plugin.js"));
      expect(resolved.styles).toEqual([join(dir, "css", "a.css")]);
      expect(resolved.engineStyles).toEqual([join(dir, "css", "native.css")]);
    });

    test("an extension declaring nothing resolves to an empty object", () => {
      const dir = extDir();
      expect(resolveExtension(dir, {}, "Plugin \"demo\"")).toEqual({});
    });

    test("tokensFile passes through as declared — advisory, not existence-checked", () => {
      const dir = extDir();
      // Deliberately does NOT create css/missing-tokens.css.
      const resolved = resolveExtension(dir, { tokensFile: "css/missing-tokens.css" }, "Plugin \"demo\"");
      expect(resolved.tokensFile).toBe("css/missing-tokens.css");
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
});
