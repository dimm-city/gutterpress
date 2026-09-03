import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import {
  loadPlugin,
  loadPlugins,
  loadPluginsWithCss,
  applyPlugins,
  collectPluginCss,
  collectPluginStylePaths,
  __resetPathPluginCacheForTests,
} from "./plugins";
import type { ResolvedPluginConfig } from "../../schema/manifest.types";
import { vendoredNpmPluginRoot, VENDOR_RECEIPT_FILE } from "../plugin-vendor";

const TMP_ROOT = join(process.cwd(), ".tmp", `plugin-tests-${Date.now()}`);

function fixture(name: string, contents: string): string {
  const path = join(TMP_ROOT, name);
  writeFileSync(path, contents);
  return path;
}

/** Like {@link fixture}, but creates any needed subdirectories first — used
 * for plugin `styles` (#238) fixtures, which need a REAL subdirectory
 * structure to prove paths resolve relative to the plugin's own module dir,
 * not `TMP_ROOT` (the loader's `baseDir`). */
function nestedFixture(relPath: string, contents: string): string {
  const path = join(TMP_ROOT, relPath);
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, contents);
  return path;
}

function cfg(overrides: Partial<ResolvedPluginConfig>): ResolvedPluginConfig {
  return { priority: 100, options: {}, ...overrides };
}

describe("plugin loader", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });

  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  describe("loadPlugin (file path)", () => {
    test("loads an ESM default-export plugin", async () => {
      fixture(
        "esm-plugin.mjs",
        `export default function plugin(md) {
           md._loaded = true;
         }
         export const metadata = { name: 'esm-plugin', version: '1.2.3' };
        `
      );

      const loaded = await loadPlugin(
        cfg({ path: "esm-plugin.mjs" }),
        TMP_ROOT
      );

      expect(typeof loaded.plugin).toBe("function");
      expect(loaded.metadata?.name).toBe("esm-plugin");
      expect(loaded.metadata?.version).toBe("1.2.3");
    });

    test("loads a plugin with css export", async () => {
      fixture(
        "with-css.mjs",
        `export default function (md) {}
         export const css = '.my-class { color: red; }';
        `
      );

      const loaded = await loadPlugin(cfg({ path: "with-css.mjs" }), TMP_ROOT);
      expect(loaded.css).toBe(".my-class { color: red; }");
    });

    test("throws when path does not exist", async () => {
      await expect(
        loadPlugin(cfg({ path: "./does-not-exist.js" }), TMP_ROOT)
      ).rejects.toThrow(/Plugin file not found/);
    });

    test("error message identifies the failing plugin", async () => {
      await expect(
        loadPlugin(cfg({ path: "./missing.js" }), TMP_ROOT)
      ).rejects.toThrow(/missing\.js/);
    });

    test("throws when plugin has no valid default export", async () => {
      fixture(
        "bad-export.mjs",
        `export const notDefault = 'oops';`
      );

      await expect(
        loadPlugin(cfg({ path: "bad-export.mjs" }), TMP_ROOT)
      ).rejects.toThrow(/does not export a valid plugin function/);
    });

    test("loads an explicitly selected named plugin export", async () => {
      fixture(
        "named-export.mjs",
        `export function full(md) { md.__namedExport = 'full'; }
         export function light(md) { md.__namedExport = 'light'; }
        `,
      );

      const loaded = await loadPlugin(
        cfg({ path: "named-export.mjs", export: "full" }),
        TMP_ROOT,
      );
      const md = new MarkdownIt();
      applyPlugins(md, [loaded]);

      expect((md as MarkdownIt & { __namedExport?: string }).__namedExport).toBe("full");
    });

    test("reports available functions when a selected named export is missing", async () => {
      fixture(
        "missing-named-export.mjs",
        `export function full() {}
         export function light() {}
        `,
      );

      await expect(
        loadPlugin(
          cfg({ path: "missing-named-export.mjs", export: "bare" }),
          TMP_ROOT,
        ),
      ).rejects.toThrow(/named "bare".*full, light/);
    });

    test("throws when neither path nor name is set", async () => {
      await expect(loadPlugin(cfg({}), TMP_ROOT)).rejects.toThrow(
        /must specify either `path` or `name`/
      );
    });

    test("passes options through to plugin", async () => {
      fixture(
        "opts-plugin.mjs",
        `export default function (md, options) {
           md.__opts = options;
         }`
      );

      const loaded = await loadPlugin(
        cfg({ path: "opts-plugin.mjs", options: { foo: "bar" } }),
        TMP_ROOT
      );

      const md = new MarkdownIt();
      applyPlugins(md, [loaded]);
      expect((md as any).__opts).toEqual({ foo: "bar" });
    });
  });

  // #238 — plugin CSS as file paths, resolved relative to the plugin module
  // (not the loader's baseDir), so a plugin's stylesheet enters the SAME
  // pipeline a manifest `styles:` entry does (lint, asset-inline, url()
  // support) instead of being an opaque string.
  describe("loadPlugin styles export (#238)", () => {
    test("resolves declared styles to absolute paths relative to the PLUGIN'S OWN directory", async () => {
      // The plugin lives one level down from TMP_ROOT (the loader's baseDir)
      // so a correct implementation must resolve against the plugin's own
      // directory, not baseDir — resolving against baseDir would 404.
      nestedFixture(
        "styled-plugin/plugin.mjs",
        `export default function (md) {};
         export const styles = ["./styles/a.css", "./styles/b.css"];`,
      );
      nestedFixture("styled-plugin/styles/a.css", ".a { color: red; }");
      nestedFixture("styled-plugin/styles/b.css", ".b { color: blue; }");

      const loaded = await loadPlugin(cfg({ path: "styled-plugin/plugin.mjs" }), TMP_ROOT);

      expect(loaded.styles).toEqual([
        join(TMP_ROOT, "styled-plugin", "styles", "a.css"),
        join(TMP_ROOT, "styled-plugin", "styles", "b.css"),
      ]);
    });

    test("a plugin declaring no styles gets undefined, not an empty array", async () => {
      fixture("no-styles.mjs", `export default function (md) {}`);
      const loaded = await loadPlugin(cfg({ path: "no-styles.mjs" }), TMP_ROOT);
      expect(loaded.styles).toBeUndefined();
    });

    test("throws when a declared stylesheet file does not exist", async () => {
      nestedFixture(
        "missing-style/plugin.mjs",
        `export default function (md) {};
         export const styles = ["./styles/missing.css"];`,
      );

      await expect(
        loadPlugin(cfg({ path: "missing-style/plugin.mjs" }), TMP_ROOT),
      ).rejects.toThrow(/declares stylesheet "\.\/styles\/missing\.css".*no file exists/s);
    });

    test("throws when `styles` is not an array of strings", async () => {
      fixture(
        "bad-styles-shape.mjs",
        `export default function (md) {};
         export const styles = "./not-an-array.css";`,
      );

      await expect(
        loadPlugin(cfg({ path: "bad-styles-shape.mjs" }), TMP_ROOT),
      ).rejects.toThrow(/exports `styles` that is not an array of strings/);
    });

    test("keeps `css` working unchanged alongside a `styles` file export", async () => {
      nestedFixture(
        "both-forms/plugin.mjs",
        `export default function (md) {};
         export const css = '.inline { color: green; }';
         export const styles = ["./extra.css"];`,
      );
      nestedFixture("both-forms/extra.css", ".file { color: purple; }");

      const loaded = await loadPlugin(cfg({ path: "both-forms/plugin.mjs" }), TMP_ROOT);

      expect(loaded.css).toBe(".inline { color: green; }");
      expect(loaded.styles).toEqual([join(TMP_ROOT, "both-forms", "extra.css")]);
    });
  });

  // #240: the loader's role for `markers` is narrow on purpose — read the raw
  // export through unresolved and pass it on, exactly like `css`. The DEEP
  // validation (per-declaration shape, cross-plugin collisions) happens once,
  // centrally, in `markers.js`'s `buildDeclaredMarkerRegistry` — see that
  // file's own test coverage for those. This block only proves the loader's
  // half of the contract: extraction, the top-level shape guard, and that it
  // never resolves anything (unlike `styles`, `markers` carries no paths).
  describe("loadPlugin markers export (#240)", () => {
    test("loads a plugin's declared markers table unresolved", async () => {
      fixture(
        "with-markers.mjs",
        `export default function (md) {};
         export const markers = {
           callout: { tag: 'div', class: 'dc-alert' },
           sidebar: { tag: 'aside', class: 'dc-sidebar' },
         };`,
      );

      const loaded = await loadPlugin(cfg({ path: "with-markers.mjs" }), TMP_ROOT);

      expect(loaded.markers).toEqual({
        callout: { tag: "div", class: "dc-alert" },
        sidebar: { tag: "aside", class: "dc-sidebar" },
      });
    });

    test("a plugin declaring no markers gets undefined, not an empty object", async () => {
      fixture("no-markers.mjs", `export default function (md) {}`);
      const loaded = await loadPlugin(cfg({ path: "no-markers.mjs" }), TMP_ROOT);
      expect(loaded.markers).toBeUndefined();
    });

    test("an explicitly empty markers table normalizes to undefined", async () => {
      fixture(
        "empty-markers.mjs",
        `export default function (md) {};
         export const markers = {};`,
      );
      const loaded = await loadPlugin(cfg({ path: "empty-markers.mjs" }), TMP_ROOT);
      expect(loaded.markers).toBeUndefined();
    });

    test("throws when `markers` is not a plain object", async () => {
      fixture(
        "bad-markers-shape.mjs",
        `export default function (md) {};
         export const markers = ["callout"];`,
      );

      await expect(
        loadPlugin(cfg({ path: "bad-markers-shape.mjs" }), TMP_ROOT),
      ).rejects.toThrow(/exports `markers` that is not a plain object/);
    });

    test("keeps `css`/`styles`/`markers` all working together", async () => {
      nestedFixture(
        "all-forms/plugin.mjs",
        `export default function (md) {};
         export const css = '.inline {}';
         export const styles = ["./extra.css"];
         export const markers = { callout: { class: 'dc-alert' } };`,
      );
      nestedFixture("all-forms/extra.css", ".file {}");

      const loaded = await loadPlugin(cfg({ path: "all-forms/plugin.mjs" }), TMP_ROOT);

      expect(loaded.css).toBe(".inline {}");
      expect(loaded.styles).toEqual([join(TMP_ROOT, "all-forms", "extra.css")]);
      expect(loaded.markers).toEqual({ callout: { class: "dc-alert" } });
    });
  });

  describe("loadPlugin (npm package)", () => {
    test("loads from gutterpress's own dependencies", async () => {
      const loaded = await loadPlugin(
        cfg({ name: "markdown-it-footnote" }),
        TMP_ROOT
      );
      expect(typeof loaded.plugin).toBe("function");
    });

    test("keeps legacy informational version ranges on node_modules resolution", async () => {
      const loaded = await loadPlugin(
        cfg({ name: "markdown-it-footnote", version: "^4.0.0" }),
        TMP_ROOT,
      );
      expect(typeof loaded.plugin).toBe("function");
    });

    test("keeps legacy exact versions on node_modules resolution when no receipt exists", async () => {
      const name = "legacy-exact-plugin-fixture";
      const packageDir = join(TMP_ROOT, "node_modules", name);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({ name, version: "1.2.3", type: "module", exports: "./index.js" }),
      );
      writeFileSync(join(packageDir, "index.js"), "export default function plugin() {}\n");

      const loaded = await loadPlugin(cfg({ name, version: "1.2.3" }), TMP_ROOT);
      expect(typeof loaded.plugin).toBe("function");
    });

    test("does not fall back when a pinned vendor marker is present but invalid", async () => {
      const name = "invalid-receipt-plugin-fixture";
      const packageDir = join(TMP_ROOT, "node_modules", name);
      mkdirSync(packageDir, { recursive: true });
      writeFileSync(
        join(packageDir, "package.json"),
        JSON.stringify({ name, version: "1.2.3", type: "module", exports: "./index.js" }),
      );
      writeFileSync(join(packageDir, "index.js"), "export default function plugin() {}\n");
      const installRoot = vendoredNpmPluginRoot(TMP_ROOT, name, "1.2.3");
      mkdirSync(installRoot, { recursive: true });
      writeFileSync(
        join(installRoot, VENDOR_RECEIPT_FILE),
        JSON.stringify({ schemaVersion: 1 }),
      );

      await expect(loadPlugin(cfg({ name, version: "1.2.3" }), TMP_ROOT)).rejects.toThrow(
        /unsupported vendor receipt schema|failed verification/i,
      );
    });

    test("throws clear error when package not found", async () => {
      await expect(
        loadPlugin(cfg({ name: "this-package-does-not-exist-xyz" }), TMP_ROOT)
      ).rejects.toThrow(/not found/);
    });

    test("error message points to the built-in installer, not an external tool", async () => {
      await expect(
        loadPlugin(cfg({ name: "this-package-does-not-exist-xyz" }), TMP_ROOT)
      ).rejects.toThrow(/Project settings > Plugins > Install npm plugin/);
    });

    // ARCH finding #57 near-miss: a bare filename with a JS extension but no
    // path separator (e.g. `my-plugin.js`, unlike `plugins/my-plugin.js`
    // which isFilePath now catches directly, see manifest.test.ts) still
    // reaches npm resolution and fails. The suggested local-file fix must be
    // a path that could actually work — not the old template's
    // `./plugins/my-plugin.js.js` double-extension nonsense.
    test("near-miss error for a bare '*.js' name suggests a working ./ prefix, not a mangled double extension", async () => {
      let message = "";
      try {
        await loadPlugin(cfg({ name: "my-plugin.js" }), TMP_ROOT);
        throw new Error("expected loadPlugin to reject");
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      expect(message).toContain("path: ./my-plugin.js");
      expect(message).not.toContain("my-plugin.js.js");
    });
  });

  // #241 — a `path` entry may name an EXTENSION FOLDER (a gutterpress.json/
  // theme.json package) instead of a bare JS file. These tests pin the two
  // non-negotiable backward-compat claims from the OTHER direction (a plugin
  // is the degenerate "markdown only" extension) plus the new folder-loading
  // behavior itself; every test above this block is completely unmodified
  // and still exercises the pre-#241 bare-file/npm paths unchanged.
  describe("loadPlugin (extension folder, #241)", () => {
    function writeExtension(
      relDir: string,
      meta: Record<string, unknown>,
      files: Record<string, string> = {},
    ): string {
      const dir = join(TMP_ROOT, relDir);
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "gutterpress.json"), JSON.stringify(meta), "utf8");
      for (const [rel, contents] of Object.entries(files)) {
        const filePath = join(dir, rel);
        mkdirSync(join(filePath, ".."), { recursive: true });
        writeFileSync(filePath, contents, "utf8");
      }
      return dir;
    }

    test("a folder with markdown + styles loads the function AND resolves the styles", async () => {
      const dir = writeExtension(
        "full-extension",
        { name: "Full Extension", markdown: "plugin.js", styles: ["css/a.css"] },
        {
          "plugin.js": "export default function (md) { md.__fullExtension = true; }",
          "css/a.css": ".a { color: red; }",
        },
      );

      const loaded = await loadPlugin(cfg({ path: "full-extension" }), TMP_ROOT);
      expect(loaded.styles).toEqual([join(dir, "css", "a.css")]);

      const md = new MarkdownIt();
      applyPlugins(md, [loaded]);
      expect((md as MarkdownIt & { __fullExtension?: boolean }).__fullExtension).toBe(true);
    });

    test("extension-declared styles are ordered BEFORE the module's own `styles` export", async () => {
      writeExtension(
        "ordered-styles",
        { markdown: "plugin.js", styles: ["ext.css"] },
        {
          "plugin.js": `export default function (md) {};
             export const styles = ["./own.css"];`,
          "ext.css": ".ext {}",
          "own.css": ".own {}",
        },
      );

      const loaded = await loadPlugin(cfg({ path: "ordered-styles" }), TMP_ROOT);
      expect(loaded.styles).toEqual([
        join(TMP_ROOT, "ordered-styles", "ext.css"),
        join(TMP_ROOT, "ordered-styles", "own.css"),
      ]);
    });

    test("engineStyles.native is appended after styles, in the same resolved list", async () => {
      writeExtension(
        "engine-styles",
        { markdown: "plugin.js", styles: ["a.css"], engineStyles: { native: ["native.css"] } },
        { "plugin.js": "export default function (md) {}", "a.css": ".a {}", "native.css": "@page {}" },
      );

      const loaded = await loadPlugin(cfg({ path: "engine-styles" }), TMP_ROOT);
      expect(loaded.styles).toEqual([
        join(TMP_ROOT, "engine-styles", "a.css"),
        join(TMP_ROOT, "engine-styles", "native.css"),
      ]);
    });

    test("a folder with NO markdown field is a styles-only extension: a no-op plugin function, styles still resolved", async () => {
      const dir = writeExtension(
        "styles-only",
        { name: "Styles Only", styles: ["theme.css"] },
        { "theme.css": ":root { --x: 1; }" },
      );

      const loaded = await loadPlugin(cfg({ path: "styles-only" }), TMP_ROOT);
      expect(loaded.styles).toEqual([join(dir, "theme.css")]);
      expect(loaded.metadata?.name).toBe("Styles Only");

      // The plugin function is a harmless no-op — md.use() must not throw.
      const md = new MarkdownIt();
      expect(() => applyPlugins(md, [loaded])).not.toThrow();
    });

    test("a legacy theme.json (no gutterpress.json) is honored identically as a plugin-folder's metadata", async () => {
      // Proves the SAME reader (readExtensionMeta) backs both the theme
      // flow and the plugin-folder flow: a folder using the pre-#241
      // filename works here too, not just in theme-manager.ts.
      const dir = join(TMP_ROOT, "legacy-theme-json-plugin");
      mkdirSync(dir, { recursive: true });
      writeFileSync(
        join(dir, "theme.json"),
        JSON.stringify({ name: "Legacy", markdown: "plugin.js" }),
        "utf8",
      );
      writeFileSync(join(dir, "plugin.js"), "export default function (md) { md.__legacy = true; }");

      const loaded = await loadPlugin(cfg({ path: "legacy-theme-json-plugin" }), TMP_ROOT);
      expect(loaded.metadata?.name).toBe("Legacy");
      const md = new MarkdownIt();
      applyPlugins(md, [loaded]);
      expect((md as MarkdownIt & { __legacy?: boolean }).__legacy).toBe(true);
    });

    test("a folder declaring neither markdown nor styles fails loudly, not silently", async () => {
      // Fail-fast doctrine (CLAUDE.md §5): a `path:` pointed at a folder with
      // no gutterpress.json/theme.json (or one declaring nothing at all) has
      // no observable effect — that is almost certainly an author mistake,
      // not a legitimate degenerate extension, so it must error, not no-op.
      const dir = join(TMP_ROOT, "empty-extension");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "README.txt"), "nothing to see here", "utf8");

      await expect(loadPlugin(cfg({ path: "empty-extension" }), TMP_ROOT)).rejects.toThrow(
        /declares neither `markdown` nor `styles`/,
      );
    });

    test("throws when the declared markdown entry does not exist", async () => {
      writeExtension("missing-markdown", { markdown: "does-not-exist.js" });
      await expect(loadPlugin(cfg({ path: "missing-markdown" }), TMP_ROOT)).rejects.toThrow(
        /does-not-exist\.js.*no file exists/s,
      );
    });

    test("throws when a declared style is missing", async () => {
      writeExtension("missing-style-ext", { styles: ["missing.css"] });
      await expect(loadPlugin(cfg({ path: "missing-style-ext" }), TMP_ROOT)).rejects.toThrow(
        /missing\.css.*no file exists/s,
      );
    });

    test("throws when a declared path escapes the extension folder (containment)", async () => {
      writeExtension("escaping-extension", { markdown: "../../../etc/passwd" });
      await expect(loadPlugin(cfg({ path: "escaping-extension" }), TMP_ROOT)).rejects.toThrow(
        /outside its own folder/,
      );
    });

    test("named export selection (`export:`) works for an extension's markdown module", async () => {
      writeExtension(
        "named-export-ext",
        { markdown: "plugin.js" },
        {
          "plugin.js": `export function full(md) { md.__namedExport = 'full'; }
             export function light(md) { md.__namedExport = 'light'; }`,
        },
      );

      const loaded = await loadPlugin(
        cfg({ path: "named-export-ext", export: "full" }),
        TMP_ROOT,
      );
      const md = new MarkdownIt();
      applyPlugins(md, [loaded]);
      expect((md as MarkdownIt & { __namedExport?: string }).__namedExport).toBe("full");
    });

    test("a bare .js file path is UNCHANGED by this feature — still loads as a plain file, not probed for gutterpress.json", async () => {
      // Backward-compat guard: a sibling gutterpress.json existing NEXT TO a
      // bare-file plugin entry (not a folder path) must have zero effect —
      // the directory-detection branch only triggers when `path` itself
      // resolves to a directory.
      const dir = join(TMP_ROOT, "sibling-metadata");
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, "plugin.js"), "export default function (md) { md.__bare = true; }");
      writeFileSync(
        join(dir, "gutterpress.json"),
        JSON.stringify({ markdown: "some-other-file.js" }),
        "utf8",
      );

      const loaded = await loadPlugin(
        cfg({ path: "sibling-metadata/plugin.js" }),
        TMP_ROOT,
      );
      const md = new MarkdownIt();
      applyPlugins(md, [loaded]);
      expect((md as MarkdownIt & { __bare?: boolean }).__bare).toBe(true);
      expect(loaded.styles).toBeUndefined();
    });
  });

  describe("loadPlugins (multi)", () => {
    test("fails fast on the first invalid plugin", async () => {
      fixture("good.mjs", `export default function (md) {}`);

      await expect(
        loadPlugins(
          [
            cfg({ path: "good.mjs" }),
            cfg({ path: "./bad-does-not-exist.mjs" }),
          ],
          TMP_ROOT
        )
      ).rejects.toThrow(/bad-does-not-exist/);
    });

    test("with onError: skips the bad plugin, keeps the good ones, reports each failure", async () => {
      fixture("ok.mjs", `export default function (md) {}`);

      const failures: Array<{ ref: string; message: string }> = [];
      const loaded = await loadPlugins(
        [
          cfg({ path: "ok.mjs" }),
          cfg({ path: "./missing.mjs" }),
          cfg({ name: "this-package-does-not-exist-xyz" }),
        ],
        TMP_ROOT,
        (ref, err) => failures.push({ ref, message: err.message })
      );

      // The one valid plugin still loads; the two broken entries are skipped.
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.name).toBe("ok.mjs");
      // Every skip is reported loudly (not silent) with its offending ref.
      expect(failures).toHaveLength(2);
      expect(failures.map((f) => f.ref)).toEqual([
        "./missing.mjs",
        "this-package-does-not-exist-xyz",
      ]);
      expect(failures[1]!.message).toMatch(/not found/);
    });

    test("resolves a built-in opt-in plugin by name with NO install", async () => {
      // markdown-it-mark is bundled (BUILTIN_OPTIONAL_PLUGINS) — enabling it
      // must work offline from an empty dir, not require a project install.
      const loaded = await loadPlugins(
        [cfg({ name: "markdown-it-mark" })],
        TMP_ROOT,
      );
      expect(loaded).toHaveLength(1);
      expect(loaded[0]!.name).toBe("markdown-it-mark");
      expect(typeof loaded[0]!.plugin).toBe("function");
    });

    test("loads multiple plugins in order", async () => {
      fixture("p1.mjs", `export default function (md) {}`);
      fixture("p2.mjs", `export default function (md) {}`);

      const loaded = await loadPlugins(
        [cfg({ path: "p1.mjs" }), cfg({ path: "p2.mjs" })],
        TMP_ROOT
      );

      expect(loaded).toHaveLength(2);
      expect(loaded[0]!.name).toBe("p1.mjs");
      expect(loaded[1]!.name).toBe("p2.mjs");
    });
  });

  describe("path-plugin caching (finding #5)", () => {
    // Each ESM module's top-level code runs exactly once per DISTINCT import
    // URL. We use that to observe whether a load actually re-imported the
    // module (URL changed / cache-busted) or reused a cached module (URL
    // unchanged / no import performed) — a counter bumped at module scope
    // increments only on a real fresh import.
    const counterKey = "__gutterpress_plugin_load_counts__";

    beforeEach(() => {
      (globalThis as any)[counterKey] = {};
      __resetPathPluginCacheForTests();
    });

    function pluginSource(id: string, version: number): string {
      return [
        `globalThis[${JSON.stringify(counterKey)}] = globalThis[${JSON.stringify(counterKey)}] || {};`,
        `globalThis[${JSON.stringify(counterKey)}][${JSON.stringify(id)}] = (globalThis[${JSON.stringify(counterKey)}][${JSON.stringify(id)}] || 0) + 1;`,
        `export default function (md) { md.__version = ${version}; }`,
        `export const version = ${version};`,
      ].join("\n");
    }

    function loadCount(id: string): number {
      return ((globalThis as any)[counterKey]?.[id] as number) ?? 0;
    }

    test("modifying a plugin file causes a reload (the stale-plugin bug stays fixed)", async () => {
      const id = "reload-on-change";
      const path = fixture(`${id}.mjs`, pluginSource(id, 1));

      const first = await loadPlugin(cfg({ path: `${id}.mjs` }), TMP_ROOT);
      const md1 = new MarkdownIt();
      applyPlugins(md1, [first]);
      expect((md1 as any).__version).toBe(1);
      expect(loadCount(id)).toBe(1);

      // Rewrite with different content AND force a distinct mtime — some
      // filesystems have coarse mtime granularity, so set it explicitly
      // rather than relying on real-clock drift between writes.
      writeFileSync(path, pluginSource(id, 2));
      const future = new Date(Date.now() + 10_000);
      utimesSync(path, future, future);

      const second = await loadPlugin(cfg({ path: `${id}.mjs` }), TMP_ROOT);
      const md2 = new MarkdownIt();
      applyPlugins(md2, [second]);
      expect((md2 as any).__version).toBe(2);
      // A genuinely fresh import happened — the module body ran again.
      expect(loadCount(id)).toBe(2);
    });

    // ── 2026-07-29 audit: the shadow link must be per-PROCESS ────────────────
    //
    // The hot-reload shadow hard link was named purely from the plugin's mtime,
    // in the plugin's own directory — deterministic, with nothing identifying
    // the process. Two preview processes rendering different books that SHARE
    // one authored plugin (`path: ../../shared/plugins/x.js`, the normative
    // multi-book layout) therefore compute the SAME shadow path. The first
    // link() wins; the loser hits EEXIST and falls through to a plain
    // `import(pluginPath)` — which the never-evicting ESM registry answers with
    // the PRE-EDIT module — and then caches that stale module under the NEW
    // mtime, so it is never retried. The author edits a shared plugin and one of
    // their two open books silently keeps rendering the old one.
    test("an edit still reloads when another process already holds the mtime-named shadow path", async () => {
      const id = "shared-plugin-collision";
      const file = fixture(`${id}.mjs`, pluginSource(id, 1));

      const first = await loadPlugin(cfg({ path: `${id}.mjs` }), TMP_ROOT);
      const md1 = new MarkdownIt();
      applyPlugins(md1, [first]);
      expect((md1 as any).__version).toBe(1);

      // Edit, with an explicit future mtime (coarse-granularity filesystems).
      writeFileSync(file, pluginSource(id, 2));
      const future = new Date(Date.now() + 10_000);
      utimesSync(file, future, future);
      const editedMtime = statSync(file).mtimeMs;

      // Simulate the OTHER process: occupy the mtime-only shadow path that a
      // second preview of the same shared plugin would have claimed.
      const token = String(editedMtime).replace(/\./g, "-");
      const foreignShadow = join(TMP_ROOT, `.${id}.gutterpress-reload-${token}.mjs`);
      writeFileSync(foreignShadow, "// squatted by another preview process\n");

      const squatted: string[] = [foreignShadow];
      try {
        const second = await loadPlugin(cfg({ path: `${id}.mjs` }), TMP_ROOT);
        const md2 = new MarkdownIt();
        applyPlugins(md2, [second]);
        // The edit must be live in THIS process regardless of the other one.
        // (A single collision happens to survive even under the old scheme: the
        // fallback imports the ORIGINAL path, which had never been imported
        // before because the first load went through a shadow link.)
        expect((md2 as any).__version).toBe(2);

        // The second collision is where the old scheme broke. The fallback above
        // put the ORIGINAL path into the ESM registry, which never evicts — so a
        // further edit that collides again gets served the previous module.
        writeFileSync(file, pluginSource(id, 3));
        const later = new Date(Date.now() + 20_000);
        utimesSync(file, later, later);
        const laterToken = String(statSync(file).mtimeMs).replace(/\./g, "-");
        const foreignShadow2 = join(TMP_ROOT, `.${id}.gutterpress-reload-${laterToken}.mjs`);
        writeFileSync(foreignShadow2, "// squatted again\n");
        squatted.push(foreignShadow2);

        const third = await loadPlugin(cfg({ path: `${id}.mjs` }), TMP_ROOT);
        const md3 = new MarkdownIt();
        applyPlugins(md3, [third]);
        expect((md3 as any).__version).toBe(3);
      } finally {
        for (const f of squatted) rmSync(f, { force: true });
      }
    });

    test("re-loading an unchanged plugin file reuses the cached module (no re-import, no unbounded growth)", async () => {
      const id = "cache-hit";
      fixture(`${id}.mjs`, pluginSource(id, 1));

      await loadPlugin(cfg({ path: `${id}.mjs` }), TMP_ROOT);
      await loadPlugin(cfg({ path: `${id}.mjs` }), TMP_ROOT);
      await loadPlugin(cfg({ path: `${id}.mjs` }), TMP_ROOT);

      // The file never changed, so the module body must have run exactly
      // once — three re-imports of an unedited file would be the leak finding
      // #5 describes.
      expect(loadCount(id)).toBe(1);
    });

    test("fail-fast loadPlugins (no onError / build mode) does not cache-bust — a single one-shot load per plugin", async () => {
      const id = "build-mode";
      fixture(`${id}.mjs`, pluginSource(id, 1));

      const loaded = await loadPlugins([cfg({ path: `${id}.mjs` })], TMP_ROOT);
      expect(loaded).toHaveLength(1);
      expect(loadCount(id)).toBe(1);
    });

    test("preview loadPlugins (onError supplied) reloads a changed plugin across renders", async () => {
      const id = "preview-mode";
      const path = fixture(`${id}.mjs`, pluginSource(id, 1));
      const onError = () => {};

      const firstRender = await loadPlugins(
        [cfg({ path: `${id}.mjs` })],
        TMP_ROOT,
        onError
      );
      const md1 = new MarkdownIt();
      applyPlugins(md1, firstRender);
      expect((md1 as any).__version).toBe(1);

      // Unchanged file, second render — must NOT re-import.
      await loadPlugins([cfg({ path: `${id}.mjs` })], TMP_ROOT, onError);
      expect(loadCount(id)).toBe(1);

      // Edit the file, third render — MUST re-import and reflect the edit.
      writeFileSync(path, pluginSource(id, 2));
      const future = new Date(Date.now() + 10_000);
      utimesSync(path, future, future);

      const thirdRender = await loadPlugins(
        [cfg({ path: `${id}.mjs` })],
        TMP_ROOT,
        onError
      );
      const md3 = new MarkdownIt();
      applyPlugins(md3, thirdRender);
      expect((md3 as any).__version).toBe(2);
      expect(loadCount(id)).toBe(2);
    });
  });

  describe("applyPlugins", () => {
    test("propagates plugin apply errors", async () => {
      fixture(
        "throwing.mjs",
        `export default function (md) { throw new Error('boom'); }`
      );

      const loaded = await loadPlugin(
        cfg({ path: "throwing.mjs" }),
        TMP_ROOT
      );

      expect(() => applyPlugins(new MarkdownIt(), [loaded])).toThrow(
        /Failed to apply plugin.*boom/
      );
    });
  });

  describe("collectPluginCss", () => {
    test("concatenates all css exports", async () => {
      fixture(
        "css-a.mjs",
        `export default function () {}; export const css = '.a {}';`
      );
      fixture(
        "css-b.mjs",
        `export default function () {}; export const css = '.b {}';`
      );

      const loaded = await loadPlugins(
        [cfg({ path: "css-a.mjs" }), cfg({ path: "css-b.mjs" })],
        TMP_ROOT
      );

      expect(collectPluginCss(loaded)).toContain(".a {}");
      expect(collectPluginCss(loaded)).toContain(".b {}");
    });

    test("returns empty string when no plugins export css", async () => {
      fixture("no-css.mjs", `export default function () {}`);
      const loaded = await loadPlugins(
        [cfg({ path: "no-css.mjs" })],
        TMP_ROOT
      );
      expect(collectPluginCss(loaded)).toBe("");
    });
  });

  describe("collectPluginStylePaths (#238)", () => {
    test("flattens every plugin's resolved styles, in plugin load order", async () => {
      nestedFixture(
        "collect-a/plugin.mjs",
        `export default function () {}; export const styles = ["./one.css", "./two.css"];`,
      );
      nestedFixture("collect-a/one.css", ".one {}");
      nestedFixture("collect-a/two.css", ".two {}");
      nestedFixture(
        "collect-b/plugin.mjs",
        `export default function () {}; export const styles = ["./three.css"];`,
      );
      nestedFixture("collect-b/three.css", ".three {}");

      const loaded = await loadPlugins(
        [cfg({ path: "collect-a/plugin.mjs" }), cfg({ path: "collect-b/plugin.mjs" })],
        TMP_ROOT,
      );

      expect(collectPluginStylePaths(loaded)).toEqual([
        join(TMP_ROOT, "collect-a", "one.css"),
        join(TMP_ROOT, "collect-a", "two.css"),
        join(TMP_ROOT, "collect-b", "three.css"),
      ]);
    });

    test("returns [] when no loaded plugin declares styles", async () => {
      fixture("no-styles-2.mjs", `export default function () {}`);
      const loaded = await loadPlugins([cfg({ path: "no-styles-2.mjs" })], TMP_ROOT);
      expect(collectPluginStylePaths(loaded)).toEqual([]);
    });
  });

  // ARCH finding #53: the "load plugins -> collectPluginCss" preamble was
  // duplicated between preview/file-watcher.ts's renderBook and
  // build-runner.ts's renderBook, differing ONLY in whether onError was
  // supplied. These characterize the extracted helper against both call
  // shapes so the duplication can be deleted without changing behavior.
  describe("loadPluginsWithCss (ARCH #53)", () => {
    test("undefined configs short-circuits to no plugins, empty css", async () => {
      const result = await loadPluginsWithCss(undefined, TMP_ROOT);
      expect(result.plugins).toBeUndefined();
      expect(result.pluginCss).toBe("");
      expect(result.pluginStylePaths).toEqual([]);
    });

    test("empty configs array short-circuits to no plugins, empty css", async () => {
      const result = await loadPluginsWithCss([], TMP_ROOT);
      expect(result.plugins).toBeUndefined();
      expect(result.pluginCss).toBe("");
      expect(result.pluginStylePaths).toEqual([]);
    });

    test("loads plugins and collects their css in one call", async () => {
      fixture(
        "css-c.mjs",
        `export default function () {}; export const css = '.c {}';`
      );

      const result = await loadPluginsWithCss(
        [cfg({ path: "css-c.mjs" })],
        TMP_ROOT
      );

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins![0]!.name).toBe("css-c.mjs");
      expect(result.pluginCss).toContain(".c {}");
      expect(result.pluginStylePaths).toEqual([]);
    });

    test("#238: also collects resolved plugin styles alongside css", async () => {
      nestedFixture(
        "wcss-plugin/plugin.mjs",
        `export default function () {}; export const styles = ["./comp.css"];`,
      );
      nestedFixture("wcss-plugin/comp.css", ".comp {}");

      const result = await loadPluginsWithCss(
        [cfg({ path: "wcss-plugin/plugin.mjs" })],
        TMP_ROOT,
      );

      expect(result.pluginStylePaths).toEqual([join(TMP_ROOT, "wcss-plugin", "comp.css")]);
    });

    test("fail-fast mode (no onError): a bad plugin aborts the whole load — matches build/export", async () => {
      fixture("good2.mjs", `export default function (md) {}`);

      await expect(
        loadPluginsWithCss(
          [cfg({ path: "good2.mjs" }), cfg({ path: "./bad-does-not-exist.mjs" })],
          TMP_ROOT
        )
      ).rejects.toThrow(/bad-does-not-exist/);
    });

    test("degrade-and-report mode (onError supplied): bad plugin is skipped, good ones still render — matches preview", async () => {
      fixture("ok2.mjs", `export default function (md) {}`);

      const failures: Array<{ ref: string; message: string }> = [];
      const result = await loadPluginsWithCss(
        [cfg({ path: "ok2.mjs" }), cfg({ path: "./missing2.mjs" })],
        TMP_ROOT,
        (ref, err) => failures.push({ ref, message: err.message })
      );

      expect(result.plugins).toHaveLength(1);
      expect(result.plugins![0]!.name).toBe("ok2.mjs");
      expect(failures).toHaveLength(1);
      expect(failures[0]!.ref).toBe("./missing2.mjs");
    });
  });
});
