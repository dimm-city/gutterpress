import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import MarkdownIt from "markdown-it";
import {
  loadPlugin,
  loadPlugins,
  applyPlugins,
  collectPluginCss,
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
