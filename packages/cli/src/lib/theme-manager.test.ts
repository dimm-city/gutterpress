import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assertThemeSheetsContained,
  listBuiltInThemes,
  resolveBuiltInTheme,
  applyTheme,
  getActiveTheme,
  importThemeFromFolder,
  importThemeFromUrl,
  listProjectThemes,
  removeProjectTheme,
  readThemeCss,
  getPreviousTheme,
  revertTheme,
  themeStyleList,
  THEMES_DIR,
  themeEngineStyleList,
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
      // The three documented starter themes are present.
      const ids = themes.map((t) => t.id);
      expect(ids).toContain("clean-book");
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

    // `styles:` order IS the cascade order (asset-inline.ts inlines the entries
    // in sequence), so a theme that lands AFTER the project's own stylesheets
    // silently defeats every override the author wrote at equal specificity.
    test("inserts the first theme ahead of the project's own stylesheets", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        ["title: Test", "styles:", "  - styles/book.css", ""].join("\n"),
      );
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });

      const lines = readManifest(dir).split("\n");
      const themeIndex = lines.findIndex((l) =>
        l.includes(`${THEMES_DIR}/clean-book/theme.css`),
      );
      const bookIndex = lines.findIndex((l) => l.includes("styles/book.css"));
      expect(themeIndex).toBeGreaterThan(-1);
      expect(themeIndex).toBeLessThan(bookIndex);
    });

    test("switching themes keeps the outgoing theme's cascade position", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        [
          "title: Test",
          "styles:",
          "  - styles/reset.css",
          `  - ${THEMES_DIR}/clean-book/theme.css`,
          "  - styles/book.css",
          "",
        ].join("\n"),
      );
      // The theme folder must exist for getActiveTheme to accept it.
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      await applyTheme(dir, { kind: "builtin", id: "zine" });

      const entries = readManifest(dir)
        .split("\n")
        .filter((l) => l.trim().startsWith("- "))
        .map((l) => l.trim().slice(2));
      expect(entries).toEqual([
        "styles/reset.css",
        `${THEMES_DIR}/zine/theme.css`,
        "styles/book.css",
      ]);
    });

    test("getActiveTheme returns null when no theme is applied", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      expect(await getActiveTheme(dir)).toBeNull();
    });

    // ARCH finding #25: setActiveThemeStyle now writes via the shared
    // writeManifestDoc (manifest-doc.ts) instead of a bespoke
    // `mkdir(projectDir) + writeFile`. Prove the project-dir-creation behavior
    // survived the swap by NOT pre-creating the directory (unlike `projectDir()`,
    // which always mkdir's up front).
    test("applying a theme creates a not-yet-existing project directory (writeManifestDoc's mkdir)", async () => {
      const dir = join(TMP_ROOT, `not-yet-created-${counter++}`);
      expect(existsSync(dir)).toBe(false);

      const result = await applyTheme(dir, { kind: "builtin", id: "clean-book" });

      expect(existsSync(join(dir, "manifest.yaml"))).toBe(true);
      expect(result.id).toBe("clean-book");
      expect(readManifest(dir)).toContain(`${THEMES_DIR}/clean-book/theme.css`);
    });

    // UX review M6: re-applying a built-in must never clobber an existing
    // project copy of the same theme — that copy's theme.css is exactly the
    // file the Design panel writes customizations into.
    describe("non-destructive re-apply of a built-in (M6)", () => {
      test("re-applying a built-in theme does not overwrite an already-customized project copy", async () => {
        const dir = projectDir();
        writeManifest(dir, ["title: Test", ""].join("\n"));

        await applyTheme(dir, { kind: "builtin", id: "clean-book" });
        const customizedPath = join(dir, THEMES_DIR, "clean-book", "theme.css");
        const customized = ":root { --custom-token: hotpink; } /* design panel edit */\n";
        writeFileSync(customizedPath, customized, "utf8");

        const result = await applyTheme(dir, { kind: "builtin", id: "clean-book" });

        // The original, customized copy is untouched byte-for-byte.
        expect(readFileSync(customizedPath, "utf8")).toBe(customized);
        // A fresh id was used instead of clobbering the existing one.
        expect(result.id).not.toBe("clean-book");
        expect(existsSync(join(dir, THEMES_DIR, result.id, "theme.css"))).toBe(true);
      });

      test("the fresh copy becomes the active theme, wired via its own id", async () => {
        const dir = projectDir();
        writeManifest(dir, ["title: Test", ""].join("\n"));

        await applyTheme(dir, { kind: "builtin", id: "clean-book" });
        writeFileSync(
          join(dir, THEMES_DIR, "clean-book", "theme.css"),
          ":root { --custom-token: hotpink; }\n",
          "utf8",
        );
        const result = await applyTheme(dir, { kind: "builtin", id: "clean-book" });

        const active = await getActiveTheme(dir);
        expect(active?.id).toBe(result.id);
        expect(readManifest(dir)).toContain(`${THEMES_DIR}/${result.id}/theme.css`);
        // The old (still-customized) theme's style entry was removed, not left
        // dangling alongside the new one.
        expect(readManifest(dir)).not.toContain(`${THEMES_DIR}/clean-book/theme.css`);
      });

      test("re-applying a built-in that has never been copied into the project still uses the plain id (no gratuitous suffix)", async () => {
        const dir = projectDir();
        writeManifest(dir, ["title: Test", ""].join("\n"));

        const result = await applyTheme(dir, { kind: "builtin", id: "zine" });

        expect(result.id).toBe("zine");
      });

      test("a third re-apply after two customized copies picks a still-fresh id", async () => {
        const dir = projectDir();
        writeManifest(dir, ["title: Test", ""].join("\n"));

        const first = await applyTheme(dir, { kind: "builtin", id: "clean-book" });
        writeFileSync(
          join(dir, THEMES_DIR, first.id, "theme.css"),
          ":root { --v: 1; }\n",
          "utf8",
        );
        const second = await applyTheme(dir, { kind: "builtin", id: "clean-book" });
        writeFileSync(
          join(dir, THEMES_DIR, second.id, "theme.css"),
          ":root { --v: 2; }\n",
          "utf8",
        );
        const third = await applyTheme(dir, { kind: "builtin", id: "clean-book" });

        expect(new Set([first.id, second.id, third.id]).size).toBe(3);
        expect(
          readFileSync(join(dir, THEMES_DIR, first.id, "theme.css"), "utf8"),
        ).toContain("--v: 1");
        expect(
          readFileSync(join(dir, THEMES_DIR, second.id, "theme.css"), "utf8"),
        ).toContain("--v: 2");
      });
    });
  });

  // #239 — a theme is no longer capped at exactly one stylesheet.
  describe("multi-sheet themes (#239)", () => {
    test("themeStyleList defaults to [\"theme.css\"] when styles is absent or empty", () => {
      expect(themeStyleList({})).toEqual(["theme.css"]);
      expect(themeStyleList({ styles: [] })).toEqual(["theme.css"]);
      expect(themeStyleList({ styles: ["a.css", "b.css"] })).toEqual(["a.css", "b.css"]);
    });

    // #241: the containment guard is now the extension-generic
    // assertExtensionContained (re-exported under this theme-only name), so
    // the message it throws is format-agnostic ("its own folder", not "the
    // theme folder") — the behavior pinned here (reject traversal/absolute,
    // allow a contained relative path) is unchanged.
    test("a declared sheet outside the theme folder is rejected at the write boundary", () => {
      expect(() => assertThemeSheetsContained({ styles: ["../outside.css"] })).toThrow(
        /outside its own folder/,
      );
      expect(() => assertThemeSheetsContained({ styles: ["/etc/passwd"] })).toThrow(
        /outside its own folder/,
      );
      expect(() =>
        assertThemeSheetsContained({ engineStyles: { native: ["css/../../x.css"] } }),
      ).toThrow(/outside its own folder/);
      expect(() => assertThemeSheetsContained({ styles: ["css/tokens.css"] })).not.toThrow();
    });

    // The read paths must NOT inherit that throw: one hand-edited theme.json
    // cannot be allowed to take down listing every theme, or the Design
    // panel's own getActiveTheme call.
    test("a theme with an escaping path still lists and reads — only apply/import reject it", async () => {
      const dir = projectDir();
      const themeDir = join(dir, THEMES_DIR, "sneaky");
      mkdirSync(themeDir, { recursive: true });
      writeFileSync(join(themeDir, "theme.css"), ":root { --x: 1; }\n", "utf8");
      writeFileSync(
        join(themeDir, "theme.json"),
        JSON.stringify({ name: "Sneaky", styles: ["../../../etc/passwd"] }),
        "utf8",
      );
      expect(themeStyleList({ styles: ["../outside.css"] })).toEqual(["../outside.css"]);
      await expect(listProjectThemes(dir)).resolves.toBeInstanceOf(Array);
      await expect(getActiveTheme(dir)).resolves.toBeDefined();
      await expect(
        applyTheme(dir, { kind: "project", id: "sneaky" }),
      ).rejects.toThrow(/outside its own folder/);
    });

    function writeMultiSheetTheme(dir: string, id: string, opts: { engineStyles?: string[] } = {}): void {
      const themeDir = join(dir, THEMES_DIR, id);
      mkdirSync(join(themeDir, "css"), { recursive: true });
      writeFileSync(join(themeDir, "css", "tokens.css"), ":root { --token: 1; }\n", "utf8");
      writeFileSync(join(themeDir, "css", "components.css"), ".component { color: blue; }\n", "utf8");
      const meta: Record<string, unknown> = {
        name: `Multi ${id}`,
        styles: ["css/tokens.css", "css/components.css"],
      };
      if (opts.engineStyles) {
        writeFileSync(join(themeDir, "css", "native.css"), "@page { color: green; }\n", "utf8");
        meta.engineStyles = { native: opts.engineStyles };
      }
      writeFileSync(join(themeDir, "theme.json"), JSON.stringify(meta), "utf8");
    }

    test("a theme with NO theme.css at all (only theme.json styles[]) can be listed and applied", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeMultiSheetTheme(dir, "multi");
      expect(existsSync(join(dir, THEMES_DIR, "multi", "theme.css"))).toBe(false);

      const listed = await listProjectThemes(dir);
      expect(listed.map((t) => t.id)).toContain("multi");
      expect(listed.find((t) => t.id === "multi")?.styles).toEqual([
        "css/tokens.css",
        "css/components.css",
      ]);

      const applied = await applyTheme(dir, { kind: "project", id: "multi" });
      expect(applied.id).toBe("multi");

      const manifest = readManifest(dir);
      expect(manifest).toContain(`${THEMES_DIR}/multi/css/tokens.css`);
      expect(manifest).toContain(`${THEMES_DIR}/multi/css/components.css`);

      const active = await getActiveTheme(dir);
      expect(active?.id).toBe("multi");
      expect(active?.styles).toEqual(["css/tokens.css", "css/components.css"]);
    });

    describe("tokensFile (#239)", () => {
      test("defaults to theme.css for a legacy single-sheet theme (built-in) with no tokensFile declared", async () => {
        const resolved = await resolveBuiltInTheme("clean-book");
        expect(resolved.info.tokensFile).toBe("theme.css");
        const listed = await listBuiltInThemes();
        for (const t of listed) expect(t.tokensFile).toBe("theme.css");
      });

      test("defaults to the PRIMARY declared sheet for a multi-sheet theme with no tokensFile declared", async () => {
        const dir = projectDir();
        writeManifest(dir, ["title: Test", ""].join("\n"));
        writeMultiSheetTheme(dir, "multi");

        const listed = await listProjectThemes(dir);
        expect(listed.find((t) => t.id === "multi")?.tokensFile).toBe("css/tokens.css");

        const applied = await applyTheme(dir, { kind: "project", id: "multi" });
        expect(applied.tokensFile).toBe("css/tokens.css");
        const active = await getActiveTheme(dir);
        expect(active?.tokensFile).toBe("css/tokens.css");
      });

      test("an explicit tokensFile declaration wins over the primary-sheet default", async () => {
        const dir = projectDir();
        const themeDir = join(dir, THEMES_DIR, "annotated");
        mkdirSync(join(themeDir, "css"), { recursive: true });
        writeFileSync(join(themeDir, "css", "tokens.css"), ":root { --token: 1; }\n", "utf8");
        writeFileSync(join(themeDir, "css", "identity.css"), ":root { --brand: blue; }\n", "utf8");
        writeFileSync(
          join(themeDir, "theme.json"),
          JSON.stringify({
            name: "Annotated",
            styles: ["css/tokens.css"],
            tokensFile: "css/identity.css",
          }),
          "utf8",
        );

        const listed = await listProjectThemes(dir);
        expect(listed.find((t) => t.id === "annotated")?.tokensFile).toBe("css/identity.css");
      });
    });

    test("both sheets land as a CONTIGUOUS block, in declared order, at the FRONT for a project's first theme", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        ["title: Test", "styles:", "  - styles/reset.css", "  - styles/book.css", ""].join("\n"),
      );
      writeMultiSheetTheme(dir, "multi");
      await applyTheme(dir, { kind: "project", id: "multi" });

      const entries = readManifest(dir)
        .split("\n")
        .filter((l) => l.trim().startsWith("- "))
        .map((l) => l.trim().slice(2));
      // Mirrors the existing single-sheet "inserts the first theme ahead of
      // the project's own stylesheets" behavior — a theme is the BASE layer,
      // so a project's first theme (multi-sheet or not) goes at the front.
      expect(entries).toEqual([
        `${THEMES_DIR}/multi/css/tokens.css`,
        `${THEMES_DIR}/multi/css/components.css`,
        "styles/reset.css",
        "styles/book.css",
      ]);
    });

    test("both sheets land as a CONTIGUOUS block at the OUTGOING theme's position when replacing one", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        [
          "title: Test",
          "styles:",
          "  - styles/reset.css",
          `  - ${THEMES_DIR}/clean-book/theme.css`,
          "  - styles/book.css",
          "",
        ].join("\n"),
      );
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      writeMultiSheetTheme(dir, "multi");
      await applyTheme(dir, { kind: "project", id: "multi" });

      const entries = readManifest(dir)
        .split("\n")
        .filter((l) => l.trim().startsWith("- "))
        .map((l) => l.trim().slice(2));
      expect(entries).toEqual([
        "styles/reset.css",
        `${THEMES_DIR}/multi/css/tokens.css`,
        `${THEMES_DIR}/multi/css/components.css`,
        "styles/book.css",
      ]);
    });

    test("switching FROM a multi-sheet theme removes its ENTIRE block, not just one entry", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeMultiSheetTheme(dir, "multi");
      await applyTheme(dir, { kind: "project", id: "multi" });
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });

      const manifest = readManifest(dir);
      expect(manifest).not.toContain(`${THEMES_DIR}/multi/`);
      expect(manifest).toContain(`${THEMES_DIR}/clean-book/theme.css`);
      const active = await getActiveTheme(dir);
      expect(active?.id).toBe("clean-book");
    });

    test("switching TO a multi-sheet theme removes a single-sheet predecessor's one entry", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      writeMultiSheetTheme(dir, "multi");
      await applyTheme(dir, { kind: "project", id: "multi" });

      const manifest = readManifest(dir);
      expect(manifest).not.toContain(`${THEMES_DIR}/clean-book/`);
      expect(manifest).toContain(`${THEMES_DIR}/multi/css/tokens.css`);
    });

    test("engineStyles.native: applying a theme with engine sheets appends them; single-sheet themes never touch engineStyles at all", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));

      // A plain single-sheet apply must not create an engineStyles scaffold.
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      expect(readManifest(dir)).not.toContain("engineStyles");

      writeMultiSheetTheme(dir, "furniture", { engineStyles: ["css/native.css"] });
      await applyTheme(dir, { kind: "project", id: "furniture" });

      const manifest = readManifest(dir);
      expect(manifest).toContain("engineStyles");
      expect(manifest).toContain(`${THEMES_DIR}/furniture/css/native.css`);
    });

    test("engineStyles.native: removing/switching away from a theme with engine sheets cleans them up", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeMultiSheetTheme(dir, "furniture", { engineStyles: ["css/native.css"] });
      await applyTheme(dir, { kind: "project", id: "furniture" });
      expect(readManifest(dir)).toContain(`${THEMES_DIR}/furniture/css/native.css`);

      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      const manifest = readManifest(dir);
      expect(manifest).not.toContain(`${THEMES_DIR}/furniture/`);
    });

    test("removeProjectTheme drops the theme's ENTIRE styles + engineStyles block", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeMultiSheetTheme(dir, "furniture", { engineStyles: ["css/native.css"] });
      await applyTheme(dir, { kind: "project", id: "furniture" });

      await removeProjectTheme(dir, "furniture");

      const manifest = readManifest(dir);
      expect(manifest).not.toContain(`${THEMES_DIR}/furniture/`);
      expect(await getActiveTheme(dir)).toBeNull();
    });

    test("readThemeCss concatenates every declared sheet, in order", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeMultiSheetTheme(dir, "multi");

      const css = await readThemeCss(dir, { kind: "project", id: "multi" });
      expect(css.indexOf("--token")).toBeGreaterThan(-1);
      expect(css.indexOf(".component")).toBeGreaterThan(-1);
      expect(css.indexOf("--token")).toBeLessThan(css.indexOf(".component"));
    });

    test("importThemeFromFolder accepts a folder with no theme.css when theme.json declares styles[]", async () => {
      const dir = projectDir();
      const srcDir = join(TMP_ROOT, "multi-src");
      mkdirSync(join(srcDir, "css"), { recursive: true });
      writeFileSync(join(srcDir, "css", "base.css"), ":root { --a: 1; }\n", "utf8");
      writeFileSync(
        join(srcDir, "theme.json"),
        JSON.stringify({ name: "Multi Source", styles: ["css/base.css"] }),
        "utf8",
      );

      const info = await importThemeFromFolder(dir, srcDir);
      expect(info.name).toBe("Multi Source");
      expect(info.styles).toEqual(["css/base.css"]);
      expect(existsSync(join(dir, THEMES_DIR, info.id, "css", "base.css"))).toBe(true);
    });

    test("importThemeFromFolder still rejects a folder missing its declared primary sheet", async () => {
      const dir = projectDir();
      const srcDir = join(TMP_ROOT, "multi-missing");
      mkdirSync(srcDir, { recursive: true });
      writeFileSync(
        join(srcDir, "theme.json"),
        JSON.stringify({ name: "Broken", styles: ["css/missing.css"] }),
        "utf8",
      );

      await expect(importThemeFromFolder(dir, srcDir)).rejects.toThrow(/css\/missing\.css/);
    });

    // #239 / shared resolver — importThemeFromFolder is the DIRECT desktop
    // folder-picker import path (api/theme/import-from-folder): it has no
    // theme-import.ts zip/css-text validation pass in front of it, so it must
    // catch a missing SECONDARY or engine sheet itself, not just the primary.
    test("importThemeFromFolder rejects a folder whose SECONDARY declared sheet is missing, before copying anything", async () => {
      const dir = projectDir();
      const srcDir = join(TMP_ROOT, "multi-secondary-missing");
      mkdirSync(join(srcDir, "css"), { recursive: true });
      writeFileSync(join(srcDir, "css", "tokens.css"), ":root { --a: 1; }\n", "utf8");
      writeFileSync(
        join(srcDir, "theme.json"),
        JSON.stringify({ name: "Broken", styles: ["css/tokens.css", "css/missing.css"] }),
        "utf8",
      );

      await expect(importThemeFromFolder(dir, srcDir)).rejects.toThrow(/css\/missing\.css/);
      // Fail-fast means fail BEFORE any fs mutation — nothing was copied.
      expect(existsSync(join(dir, THEMES_DIR))).toBe(false);
    });

    test("importThemeFromFolder rejects a folder whose declared engineStyles.native sheet is missing", async () => {
      const dir = projectDir();
      const srcDir = join(TMP_ROOT, "multi-engine-missing");
      mkdirSync(join(srcDir, "css"), { recursive: true });
      writeFileSync(join(srcDir, "css", "tokens.css"), ":root { --a: 1; }\n", "utf8");
      writeFileSync(
        join(srcDir, "theme.json"),
        JSON.stringify({
          name: "Broken",
          styles: ["css/tokens.css"],
          engineStyles: { native: ["css/native-missing.css"] },
        }),
        "utf8",
      );

      await expect(importThemeFromFolder(dir, srcDir)).rejects.toThrow(/native-missing\.css/);
    });

    test("applyTheme (project) rejects when a SECONDARY declared sheet has gone missing since import", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeMultiSheetTheme(dir, "multi"); // declares css/tokens.css + css/components.css
      // Simulate drift: the secondary sheet vanishes after the folder exists
      // (hand-edited theme.json, a half-finished manual copy, etc.).
      rmSync(join(dir, THEMES_DIR, "multi", "css", "components.css"));

      await expect(applyTheme(dir, { kind: "project", id: "multi" })).rejects.toThrow(
        /components\.css/,
      );
    });

    test("applyTheme (project) rejects when a declared engineStyles.native sheet is missing", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeMultiSheetTheme(dir, "furniture", { engineStyles: ["css/native.css"] });
      rmSync(join(dir, THEMES_DIR, "furniture", "css", "native.css"));

      await expect(applyTheme(dir, { kind: "project", id: "furniture" })).rejects.toThrow(
        /native\.css/,
      );
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
      ).rejects.toThrow(
        "Failed to fetch https://example.com/missing.css (HTTP 404).",
      );
    });

    test("runs each request under an abortable deadline (no hang on a stall)", async () => {
      const dir = projectDir();
      // Without a signal wired through fetch, a stalled connection has
      // NOTHING to abort it — the theme import would hang forever.
      let seenSignal: unknown;
      globalThis.fetch = (async (_input: unknown, init?: RequestInit) => {
        seenSignal = init?.signal;
        return new Response(":root { --x: 1; }\n", { status: 200 });
      }) as unknown as typeof fetch;
      await importThemeFromUrl(dir, "https://example.com/cool.css");
      expect(seenSignal).toBeInstanceOf(AbortSignal);
    });

    test("maps a fired deadline and an offline failure to friendly copy", async () => {
      const dir = projectDir();
      globalThis.fetch = (async () => {
        throw new DOMException("The operation timed out.", "TimeoutError");
      }) as unknown as typeof fetch;
      await expect(
        importThemeFromUrl(dir, "https://example.com/slow.css"),
      ).rejects.toThrow(
        "Fetching https://example.com/slow.css timed out. Check your connection and try again.",
      );

      globalThis.fetch = (async () => {
        throw new TypeError("fetch failed");
      }) as unknown as typeof fetch;
      await expect(
        importThemeFromUrl(dir, "https://example.com/gone.css"),
      ).rejects.toThrow(
        "Couldn't reach https://example.com/gone.css. Check your connection and try again.",
      );
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

    // Characterization: a theme folder with no name in theme.json falls back to
    // prettify(id). Locks the prettify behaviour so the shared-helper move keeps
    // the same user-visible name.
    test("names a theme by prettifying its id when theme.json has no name", async () => {
      const dir = projectDir();
      const themeDir = join(dir, THEMES_DIR, "my_neat-theme");
      mkdirSync(themeDir, { recursive: true });
      writeFileSync(join(themeDir, "theme.css"), ":root { --z: 3; }\n", "utf8");
      const themes = await listProjectThemes(dir);
      const found = themes.find((t) => t.id === "my_neat-theme");
      expect(found?.name).toBe("My neat theme");
    });
  });

  describe("previous theme + revert (#106)", () => {
    test("no previous theme is recorded on the first apply", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      expect(await getPreviousTheme(dir)).toBeNull();
    });

    test("applying a second theme records the first as previous", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      await applyTheme(dir, { kind: "builtin", id: "zine" });
      const prev = await getPreviousTheme(dir);
      expect(prev?.id).toBe("clean-book");
    });

    test("revertTheme re-applies the previous theme and toggles back", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      await applyTheme(dir, { kind: "builtin", id: "zine" });

      const reverted = await revertTheme(dir);
      expect(reverted.id).toBe("clean-book");
      expect((await getActiveTheme(dir))?.id).toBe("clean-book");
      // Revert is a toggle: the previous is now the theme we reverted FROM.
      expect((await getPreviousTheme(dir))?.id).toBe("zine");

      const back = await revertTheme(dir);
      expect(back.id).toBe("zine");
      expect((await getActiveTheme(dir))?.id).toBe("zine");
    });

    test("revertTheme throws when there is no previous theme", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      await expect(revertTheme(dir)).rejects.toThrow(/no previous theme/i);
    });

    test("removing the previous theme clears the revert target", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      await applyTheme(dir, { kind: "builtin", id: "zine" });
      expect((await getPreviousTheme(dir))?.id).toBe("clean-book");
      await removeProjectTheme(dir, "clean-book");
      expect(await getPreviousTheme(dir)).toBeNull();
    });

    test("rejects a traversal id stored in themePrevious before reading it", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", 'themePrevious: "../../other"', ""].join("\n"));
      await expect(getPreviousTheme(dir)).rejects.toThrow(/invalid theme id/i);
    });
  });

  // #241 — a theme is the "styles only" case of the unified extension
  // package format: its metadata file may now be named `gutterpress.json`
  // instead of `theme.json`. The two non-negotiable claims:
  //   1. "an existing theme.css + theme.json folder loads completely
  //      unchanged" — already pinned by EVERY test above this block (all
  //      unmodified, all still green): none of them ever gained a
  //      gutterpress.json, so they exercise exactly the fallback path this
  //      section's tests exercise directly.
  //   2. "the theme verbs keep working on the extension format" — the
  //      NEW capability these tests prove: before #241, `readThemeMeta` only
  //      ever looked at `theme.json`, so every test below would have failed
  //      (a gutterpress.json-only folder would have listed/applied with
  //      completely empty metadata, since the real file was never read).
  describe("gutterpress.json extension format (#241)", () => {
    function writeGutterpressJsonTheme(
      dir: string,
      id: string,
      meta: Record<string, unknown>,
    ): void {
      const themeDir = join(dir, THEMES_DIR, id);
      mkdirSync(join(themeDir, "css"), { recursive: true });
      writeFileSync(join(themeDir, "css", "tokens.css"), ":root { --token: 1; }\n", "utf8");
      writeFileSync(join(themeDir, "gutterpress.json"), JSON.stringify(meta), "utf8");
    }

    test("listProjectThemes recognizes a gutterpress.json-only theme folder (no theme.json at all)", async () => {
      const dir = projectDir();
      writeGutterpressJsonTheme(dir, "gp-theme", { name: "GP Theme", styles: ["css/tokens.css"] });
      expect(existsSync(join(dir, THEMES_DIR, "gp-theme", "theme.json"))).toBe(false);

      const listed = await listProjectThemes(dir);
      const found = listed.find((t) => t.id === "gp-theme");
      expect(found?.name).toBe("GP Theme");
      expect(found?.styles).toEqual(["css/tokens.css"]);
    });

    test("applyTheme wires a gutterpress.json-formatted theme's styles exactly like a theme.json one", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeGutterpressJsonTheme(dir, "gp-theme", { name: "GP Theme", styles: ["css/tokens.css"] });

      const applied = await applyTheme(dir, { kind: "project", id: "gp-theme" });
      expect(applied.styles).toEqual(["css/tokens.css"]);
      expect(readManifest(dir)).toContain(`${THEMES_DIR}/gp-theme/css/tokens.css`);

      const active = await getActiveTheme(dir);
      expect(active?.id).toBe("gp-theme");
      expect(active?.name).toBe("GP Theme");
    });

    test("getPreviousTheme / revertTheme / readThemeCss / removeProjectTheme all recognize gutterpress.json", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      await applyTheme(dir, { kind: "builtin", id: "clean-book" });
      writeGutterpressJsonTheme(dir, "gp-theme", { name: "GP Theme", styles: ["css/tokens.css"] });
      await applyTheme(dir, { kind: "project", id: "gp-theme" });

      const previous = await getPreviousTheme(dir);
      expect(previous?.id).toBe("clean-book");

      const css = await readThemeCss(dir, { kind: "project", id: "gp-theme" });
      expect(css).toContain("--token");

      const reverted = await revertTheme(dir);
      expect(reverted.id).toBe("clean-book");

      await applyTheme(dir, { kind: "project", id: "gp-theme" });
      await removeProjectTheme(dir, "gp-theme");
      expect(await getActiveTheme(dir)).toBeNull();
      expect(existsSync(join(dir, THEMES_DIR, "gp-theme"))).toBe(false);
    });

    test("gutterpress.json wins over a sibling theme.json in the same folder", async () => {
      const dir = projectDir();
      const themeDir = join(dir, THEMES_DIR, "both-files");
      mkdirSync(themeDir, { recursive: true });
      writeFileSync(join(themeDir, "theme.css"), ":root { --old: 1; }\n", "utf8");
      writeFileSync(join(themeDir, "theme.json"), JSON.stringify({ name: "Old Name" }), "utf8");
      writeFileSync(join(themeDir, "gutterpress.json"), JSON.stringify({ name: "New Name" }), "utf8");

      const listed = await listProjectThemes(dir);
      expect(listed.find((t) => t.id === "both-files")?.name).toBe("New Name");
    });

    test("ThemeInfo exposes markdown/components/snippets as informational metadata", async () => {
      const dir = projectDir();
      writeGutterpressJsonTheme(dir, "rich-ext", {
        name: "Rich Extension",
        styles: ["css/tokens.css"],
        markdown: "plugin.js",
        components: "components.yaml",
        snippets: "snippets",
      });
      writeFileSync(
        join(dir, THEMES_DIR, "rich-ext", "plugin.js"),
        "export default function (md) {}",
        "utf8",
      );

      const listed = await listProjectThemes(dir);
      const found = listed.find((t) => t.id === "rich-ext");
      expect(found?.markdown).toBe("plugin.js");
      expect(found?.components).toBe("components.yaml");
      expect(found?.snippets).toBe("snippets");
    });

    // Deliberate scope boundary (see this file's header comment): the theme
    // verbs parse-and-expose `markdown` (test above) but never wire it into
    // the manifest's `plugins:` list. An extension with both halves installs
    // as a plugin instead (`gutterpress plugin add <folder>`,
    // `markdown/plugins.ts`'s `loadExtensionFromDir`), which DOES resolve and
    // apply this same field.
    test("applying a theme whose gutterpress.json declares markdown does NOT wire a plugins: entry", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeGutterpressJsonTheme(dir, "with-markdown", {
        name: "With Markdown",
        styles: ["css/tokens.css"],
        markdown: "plugin.js",
      });
      writeFileSync(
        join(dir, THEMES_DIR, "with-markdown", "plugin.js"),
        "export default function (md) {}",
        "utf8",
      );

      await applyTheme(dir, { kind: "project", id: "with-markdown" });
      expect(readManifest(dir)).not.toContain("plugins:");
    });

    test("applyTheme rejects a gutterpress.json declaring markdown outside the theme folder", async () => {
      const dir = projectDir();
      writeManifest(dir, ["title: Test", ""].join("\n"));
      writeGutterpressJsonTheme(dir, "sneaky-markdown", {
        name: "Sneaky",
        markdown: "../../../etc/passwd",
      });

      await expect(
        applyTheme(dir, { kind: "project", id: "sneaky-markdown" }),
      ).rejects.toThrow(/outside its own folder/);
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
