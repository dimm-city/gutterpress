import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listProjectPlugins,
  setPluginEnabled,
  addLocalPlugin,
  addNpmPlugin,
  validateProjectPlugins,
  RECOMMENDED_PLUGINS,
} from "./plugin-manager";

const TMP_ROOT = join(process.cwd(), ".tmp", `plugin-manager-tests-${Date.now()}`);

let counter = 0;
function projectDir(): string {
  const dir = join(TMP_ROOT, `proj-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

function writeManifest(dir: string, body: string): void {
  writeFileSync(join(dir, "manifest.yaml"), body, "utf8");
}

function readManifest(dir: string): string {
  return readFileSync(join(dir, "manifest.yaml"), "utf8");
}

describe("plugin-manager", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  describe("listProjectPlugins", () => {
    test("returns [] when no manifest exists", async () => {
      const dir = projectDir();
      const list = await listProjectPlugins(dir);
      expect(list).toEqual([]);
    });

    test("lists string-form and object-form plugins, defaulting enabled=true", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        [
          "title: Test",
          "plugins:",
          "  - markdown-it-footnote",
          "  - ./plugins/local.js",
          "  - name: markdown-it-deflist",
          "    enabled: false",
          "",
        ].join("\n"),
      );
      const list = await listProjectPlugins(dir);
      expect(list).toHaveLength(3);

      const footnote = list.find((p) => p.ref === "markdown-it-footnote")!;
      expect(footnote.kind).toBe("npm");
      expect(footnote.enabled).toBe(true);

      const local = list.find((p) => p.ref === "./plugins/local.js")!;
      expect(local.kind).toBe("local");
      expect(local.enabled).toBe(true);

      const deflist = list.find((p) => p.ref === "markdown-it-deflist")!;
      expect(deflist.kind).toBe("npm");
      expect(deflist.enabled).toBe(false);
    });
  });

  describe("setPluginEnabled", () => {
    test("disabling a string-form plugin rewrites it as an object with enabled:false", async () => {
      const dir = projectDir();
      writeManifest(dir, ["plugins:", "  - markdown-it-footnote", ""].join("\n"));

      await setPluginEnabled(dir, "markdown-it-footnote", false);

      const list = await listProjectPlugins(dir);
      expect(list).toHaveLength(1);
      expect(list[0]!.ref).toBe("markdown-it-footnote");
      expect(list[0]!.enabled).toBe(false);
    });

    test("round-trips: disable then re-enable", async () => {
      const dir = projectDir();
      writeManifest(dir, ["plugins:", "  - markdown-it-footnote", ""].join("\n"));

      await setPluginEnabled(dir, "markdown-it-footnote", false);
      expect((await listProjectPlugins(dir))[0]!.enabled).toBe(false);

      await setPluginEnabled(dir, "markdown-it-footnote", true);
      const list = await listProjectPlugins(dir);
      expect(list[0]!.enabled).toBe(true);
    });

    test("toggling a local-path plugin by its path works", async () => {
      const dir = projectDir();
      writeManifest(dir, ["plugins:", "  - ./plugins/local.js", ""].join("\n"));
      await setPluginEnabled(dir, "./plugins/local.js", false);
      const list = await listProjectPlugins(dir);
      expect(list[0]!.enabled).toBe(false);
    });

    test("throws when the plugin ref is not present", async () => {
      const dir = projectDir();
      writeManifest(dir, ["plugins:", "  - markdown-it-footnote", ""].join("\n"));
      await expect(setPluginEnabled(dir, "not-there", false)).rejects.toThrow();
    });
  });

  describe("addNpmPlugin", () => {
    test("adds an npm plugin entry to the manifest", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));

      await addNpmPlugin(dir, "markdown-it-footnote");

      const list = await listProjectPlugins(dir);
      expect(list).toHaveLength(1);
      expect(list[0]!.ref).toBe("markdown-it-footnote");
      expect(list[0]!.kind).toBe("npm");
      expect(list[0]!.enabled).toBe(true);
    });

    test("creates a manifest with a plugins list when none exists", async () => {
      const dir = projectDir();
      await addNpmPlugin(dir, "markdown-it-sub");
      expect(existsSync(join(dir, "manifest.yaml"))).toBe(true);
      const list = await listProjectPlugins(dir);
      expect(list.map((p) => p.ref)).toContain("markdown-it-sub");
    });

    test("is idempotent — adding the same npm plugin twice does not duplicate", async () => {
      const dir = projectDir();
      await addNpmPlugin(dir, "markdown-it-footnote");
      await addNpmPlugin(dir, "markdown-it-footnote");
      const list = await listProjectPlugins(dir);
      expect(list.filter((p) => p.ref === "markdown-it-footnote")).toHaveLength(1);
    });
  });

  describe("addLocalPlugin", () => {
    test("copies the source file into the project's plugins/ folder and adds a manifest entry", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));

      const srcDir = join(TMP_ROOT, "external");
      mkdirSync(srcDir, { recursive: true });
      const srcFile = join(srcDir, "my-plugin.js");
      writeFileSync(srcFile, "export default function (md) {}\n", "utf8");

      const result = await addLocalPlugin(dir, srcFile);

      expect(existsSync(join(dir, "plugins", "my-plugin.js"))).toBe(true);
      expect(result.path).toBe("./plugins/my-plugin.js");

      const list = await listProjectPlugins(dir);
      const entry = list.find((p) => p.ref === "./plugins/my-plugin.js")!;
      expect(entry.kind).toBe("local");
      expect(entry.enabled).toBe(true);
    });

    test("copies a plugin folder (directory) into plugins/", async () => {
      const dir = projectDir();
      const srcDir = join(TMP_ROOT, "ext-folder");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "index.js"), "export default function (md) {}\n", "utf8");

      const result = await addLocalPlugin(dir, srcDir);
      expect(existsSync(join(dir, "plugins", "ext-folder", "index.js"))).toBe(true);
      expect(result.path).toContain("./plugins/ext-folder");
    });

    test("rejects a source that does not exist", async () => {
      const dir = projectDir();
      await expect(addLocalPlugin(dir, join(TMP_ROOT, "nope.js"))).rejects.toThrow();
    });
  });

  describe("validateProjectPlugins", () => {
    test("reports a good local plugin as ok=true", async () => {
      const dir = projectDir();
      mkdirSync(join(dir, "plugins"), { recursive: true });
      writeFileSync(
        join(dir, "plugins", "good.mjs"),
        "export default function plugin(md) { md._ok = true; }\n",
        "utf8",
      );
      writeManifest(dir, ["plugins:", "  - ./plugins/good.mjs", ""].join("\n"));

      const results = await validateProjectPlugins(dir);
      expect(results).toHaveLength(1);
      expect(results[0]!.ref).toBe("./plugins/good.mjs");
      expect(results[0]!.ok).toBe(true);
      expect(results[0]!.error).toBeUndefined();
    });

    test("reports a missing local plugin as ok=false with an error (does not throw)", async () => {
      const dir = projectDir();
      writeManifest(dir, ["plugins:", "  - ./plugins/missing.js", ""].join("\n"));

      const results = await validateProjectPlugins(dir);
      expect(results).toHaveLength(1);
      expect(results[0]!.ok).toBe(false);
      expect(typeof results[0]!.error).toBe("string");
      expect(results[0]!.error!.length).toBeGreaterThan(0);
    });

    test("reports an unresolvable npm plugin as ok=false (not installed)", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        ["plugins:", "  - markdown-it-this-package-does-not-exist-xyz", ""].join("\n"),
      );
      const results = await validateProjectPlugins(dir);
      expect(results[0]!.ok).toBe(false);
      expect(results[0]!.error).toBeDefined();
    });

    test("skips disabled plugins (reports them as disabled, not loaded)", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        [
          "plugins:",
          "  - name: ./plugins/missing.js",
          "    enabled: false",
          "",
        ].join("\n"),
      );
      const results = await validateProjectPlugins(dir);
      expect(results).toHaveLength(1);
      expect(results[0]!.enabled).toBe(false);
      // disabled plugins are not load-tested, so ok stays true (nothing failed)
      expect(results[0]!.ok).toBe(true);
    });

    test("validates a mix and reports each independently", async () => {
      const dir = projectDir();
      mkdirSync(join(dir, "plugins"), { recursive: true });
      writeFileSync(
        join(dir, "plugins", "good.mjs"),
        "export default function (md) {}\n",
        "utf8",
      );
      writeManifest(
        dir,
        [
          "plugins:",
          "  - ./plugins/good.mjs",
          "  - ./plugins/bad.mjs",
          "",
        ].join("\n"),
      );
      const results = await validateProjectPlugins(dir);
      expect(results.find((r) => r.ref === "./plugins/good.mjs")!.ok).toBe(true);
      expect(results.find((r) => r.ref === "./plugins/bad.mjs")!.ok).toBe(false);
    });
  });

  describe("RECOMMENDED_PLUGINS", () => {
    test("has at least 5 real markdown-it plugins with name + description", () => {
      expect(RECOMMENDED_PLUGINS.length).toBeGreaterThanOrEqual(5);
      for (const p of RECOMMENDED_PLUGINS) {
        expect(typeof p.name).toBe("string");
        expect(p.name).toMatch(/^markdown-it/);
        expect(typeof p.description).toBe("string");
        expect(p.description.length).toBeGreaterThan(0);
      }
    });
  });
});
