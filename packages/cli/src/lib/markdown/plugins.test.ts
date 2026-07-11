import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import {
  loadPlugin,
  loadPlugins,
  applyPlugins,
  collectPluginCss,
  __resetPathPluginCacheForTests,
} from "./plugins";
import type { ResolvedPluginConfig } from "../../schema/manifest.types";

const TMP_ROOT = join(process.cwd(), ".tmp", `plugin-tests-${Date.now()}`);

function fixture(name: string, contents: string): string {
  const path = join(TMP_ROOT, name);
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

  describe("loadPlugin (npm package)", () => {
    test("loads from print-md's own dependencies", async () => {
      const loaded = await loadPlugin(
        cfg({ name: "markdown-it-footnote" }),
        TMP_ROOT
      );
      expect(typeof loaded.plugin).toBe("function");
    });

    test("throws clear error when package not found", async () => {
      await expect(
        loadPlugin(cfg({ name: "this-package-does-not-exist-xyz" }), TMP_ROOT)
      ).rejects.toThrow(/not found/);
    });

    test("error message includes install hint", async () => {
      await expect(
        loadPlugin(cfg({ name: "this-package-does-not-exist-xyz" }), TMP_ROOT)
      ).rejects.toThrow(/bun add this-package-does-not-exist-xyz/);
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
    const counterKey = "__pmd_plugin_load_counts__";

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
});
