import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  listBuiltInThemes,
  resolveBuiltInTheme,
  applyTheme,
  getActiveTheme,
  importThemeFromFolder,
  importThemeFromUrl,
  listProjectThemes,
  removeProjectTheme,
  readThemeCss,
  THEMES_DIR,
} from "./theme-manager";

const TMP_ROOT = join(process.cwd(), ".tmp", `theme-manager-tests-${Date.now()}`);

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

describe("theme-manager", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  describe("listBuiltInThemes", () => {
    test("ships at least 3 built-in themes, each with parsed metadata", async () => {
      const themes = await listBuiltInThemes();
      expect(themes.length).toBeGreaterThanOrEqual(3);
      for (const t of themes) {
        expect(typeof t.id).toBe("string");
        expect(t.id.length).toBeGreaterThan(0);
        expect(typeof t.name).toBe("string");
        expect(t.name.length).toBeGreaterThan(0);
        expect(typeof t.description).toBe("string");
        expect(t.kind).toBe("builtin");
      }
      // The four documented starter themes are present.
      const ids = themes.map((t) => t.id);
      expect(ids).toContain("clean-book");
      expect(ids).toContain("ttrpg-supplement");
      expect(ids).toContain("zine");
      expect(ids).toContain("technical-doc");
    });
  });

  describe("resolveBuiltInTheme", () => {
    test("each built-in theme resolves to a real theme.css + parsed theme.json", async () => {
      const themes = await listBuiltInThemes();
      for (const t of themes) {
        const resolved = await resolveBuiltInTheme(t.id);
        expect(existsSync(resolved.cssPath)).toBe(true);
        const css = readFileSync(resolved.cssPath, "utf8");
        expect(css.length).toBeGreaterThan(0);
        expect(css).toContain(":root");
        expect(resolved.info.name.length).toBeGreaterThan(0);
      }
    });

    test("throws for an unknown theme id", async () => {
      await expect(resolveBuiltInTheme("does-not-exist")).rejects.toThrow();
    });
  });

  describe("applyTheme + getActiveTheme", () => {
    test("applying a built-in theme copies its CSS in and wires the manifest", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));

      const result = await applyTheme(dir, { kind: "builtin", id: "clean-book" });

      // CSS copied into the project's themes/ folder.
      const copied = join(dir, THEMES_DIR, "clean-book", "theme.css");
      expect(existsSync(copied)).toBe(true);

      // Manifest references the copied theme css in styles.
      const manifest = readManifest(dir);
      expect(manifest).toContain(`${THEMES_DIR}/clean-book/theme.css`);

      // The result reports the new active id.
      expect(result.id).toBe("clean-book");

      // getActiveTheme reflects it.
      const active = await getActiveTheme(dir);
      expect(active?.id).toBe("clean-book");
    });

    test("applying a second theme replaces the previous active theme in the manifest", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));

      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      await applyTheme(dir, { kind: "builtin", id: "zine" });

      const active = await getActiveTheme(dir);
      expect(active?.id).toBe("zine");

      const manifest = readManifest(dir);
      expect(manifest).toContain(`${THEMES_DIR}/zine/theme.css`);
      // The previous theme's style link is no longer the active one.
      const styleLines = manifest
        .split("\n")
        .filter((l) => l.includes(`${THEMES_DIR}/`) && l.includes("theme.css"));
      expect(styleLines.some((l) => l.includes("zine"))).toBe(true);
    });

    test("preserves a project's own non-theme stylesheet entries", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        ["title: Test", "styles:", "  - styles/main.css", ""].join("\n"),
      );
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      const manifest = readManifest(dir);
      expect(manifest).toContain("styles/main.css");
      expect(manifest).toContain(`${THEMES_DIR}/clean-book/theme.css`);
    });

    test("getActiveTheme returns null when no theme is applied", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      expect(await getActiveTheme(dir)).toBeNull();
    });
  });

  describe("importThemeFromFolder", () => {
    test("copies a theme folder into the project and registers it", async () => {
      const dir = projectDir();
      const srcDir = join(TMP_ROOT, "ext-theme");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "theme.css"), ":root { --x: 1; }\n", "utf8");
      writeFileSync(
        join(srcDir, "theme.json"),
        JSON.stringify({ name: "My Theme", description: "Mine" }),
        "utf8",
      );

      const info = await importThemeFromFolder(dir, srcDir);
      expect(info.kind).toBe("project");
      expect(info.name).toBe("My Theme");

      const themes = await listProjectThemes(dir);
      expect(themes.find((t) => t.id === info.id)).toBeTruthy();
      expect(existsSync(join(dir, THEMES_DIR, info.id, "theme.css"))).toBe(true);
    });

    test("synthesises metadata when theme.json is absent", async () => {
      const dir = projectDir();
      const srcDir = join(TMP_ROOT, "bare-theme");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "theme.css"), ":root { --y: 2; }\n", "utf8");

      const info = await importThemeFromFolder(dir, srcDir);
      expect(info.name.length).toBeGreaterThan(0);
      expect(existsSync(join(dir, THEMES_DIR, info.id, "theme.css"))).toBe(true);
    });

    test("rejects a folder without a theme.css", async () => {
      const dir = projectDir();
      const srcDir = join(TMP_ROOT, "no-css");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(join(srcDir, "readme.txt"), "nope", "utf8");
      await expect(importThemeFromFolder(dir, srcDir)).rejects.toThrow();
    });
  });

  describe("importThemeFromUrl", () => {
    const realFetch = globalThis.fetch;
    afterEach(() => {
      globalThis.fetch = realFetch;
    });

    test("imports raw CSS from a .css URL and registers a theme", async () => {
      const dir = projectDir();
      globalThis.fetch = (async () =>
        new Response(":root { --from-url: 1; }\n", {
          status: 200,
          headers: { "content-type": "text/css" },
        })) as unknown as typeof fetch;

      const info = await importThemeFromUrl(dir, "https://example.com/cool.css");
      expect(info.kind).toBe("project");
      const css = readFileSync(
        join(dir, THEMES_DIR, info.id, "theme.css"),
        "utf8",
      );
      expect(css).toContain("--from-url");

      const themes = await listProjectThemes(dir);
      expect(themes.find((t) => t.id === info.id)).toBeTruthy();
    });

    test("uses theme.json from a theme-folder URL (base + theme.json + theme.css)", async () => {
      const dir = projectDir();
      globalThis.fetch = (async (input: string | URL) => {
        const url = String(input);
        if (url.endsWith("theme.json")) {
          return new Response(JSON.stringify({ name: "URL Theme" }), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        if (url.endsWith("theme.css")) {
          return new Response(":root { --url-folder: 1; }\n", {
            status: 200,
            headers: { "content-type": "text/css" },
          });
        }
        return new Response("", { status: 404 });
      }) as unknown as typeof fetch;

      const info = await importThemeFromUrl(dir, "https://example.com/themes/cool/");
      expect(info.name).toBe("URL Theme");
      const css = readFileSync(
        join(dir, THEMES_DIR, info.id, "theme.css"),
        "utf8",
      );
      expect(css).toContain("--url-folder");
    });

    test("throws when the URL fetch fails", async () => {
      const dir = projectDir();
      globalThis.fetch = (async () =>
        new Response("not found", { status: 404 })) as unknown as typeof fetch;
      await expect(
        importThemeFromUrl(dir, "https://example.com/missing.css"),
      ).rejects.toThrow();
    });
  });

  describe("listProjectThemes", () => {
    test("returns [] when there is no themes/ folder", async () => {
      const dir = projectDir();
      expect(await listProjectThemes(dir)).toEqual([]);
    });

    test("lists applied/imported themes under the project themes/ folder", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      const themes = await listProjectThemes(dir);
      expect(themes.map((t) => t.id)).toContain("clean-book");
    });
  });

  describe("path-traversal hardening (no-data-loss mandate)", () => {
    test("removeProjectTheme rejects a traversal id instead of rm -rf-ing it", async () => {
      const dir = projectDir();
      for (const bad of ["../../etc", "..", "a/b", "foo/../bar", "/abs"]) {
        await expect(removeProjectTheme(dir, bad)).rejects.toThrow(/invalid theme id/i);
      }
    });
    test("applyTheme (project) and readThemeCss reject a traversal id", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await expect(applyTheme(dir, { kind: "project", id: "../x" })).rejects.toThrow(
        /invalid theme id/i,
      );
      await expect(
        readThemeCss(dir, { kind: "project", id: "../../secret" }),
      ).rejects.toThrow(/invalid theme id/i);
    });
    test("importThemeFromUrl rejects non-http(s) schemes (no file:// local read)", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await expect(importThemeFromUrl(dir, "file:///etc/hostname")).rejects.toThrow(
        /http\(s\)|invalid theme url/i,
      );
    });
  });
});
