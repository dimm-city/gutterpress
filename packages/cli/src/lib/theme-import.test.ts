import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";

import {
  isUnsafeZipEntryPath,
  locateThemeRoot,
  classifyThemeCssFindings,
  unexpectedThemeFiles,
  importThemeFromZip,
  importThemeFromCssText,
  MAX_THEME_ARCHIVE_BYTES,
} from "./theme-import";
import { ruleSyntax, ruleRemoteUrls, ruleRiskyProps, type PrintSafeWarning } from "./printsafe";
import { listProjectThemes, THEMES_DIR } from "./theme-manager";

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("theme-import pure helpers", () => {
  describe("isUnsafeZipEntryPath", () => {
    test("accepts ordinary relative paths", () => {
      expect(isUnsafeZipEntryPath("theme.css")).toBe(false);
      expect(isUnsafeZipEntryPath("my-theme/theme.css")).toBe(false);
      expect(isUnsafeZipEntryPath("my-theme/fonts/body.woff2")).toBe(false);
    });
    test("rejects traversal, absolute, and drive paths", () => {
      expect(isUnsafeZipEntryPath("../evil.css")).toBe(true);
      expect(isUnsafeZipEntryPath("a/../../evil")).toBe(true);
      expect(isUnsafeZipEntryPath("/etc/passwd")).toBe(true);
      expect(isUnsafeZipEntryPath("C:\\Windows\\x")).toBe(true);
      expect(isUnsafeZipEntryPath("..\\evil")).toBe(true);
      expect(isUnsafeZipEntryPath("")).toBe(true);
    });
  });

  describe("locateThemeRoot", () => {
    test("finds theme.css at the archive root", () => {
      expect(locateThemeRoot(["theme.css", "theme.json"])).toBe("");
    });
    test("finds theme.css one folder down", () => {
      expect(locateThemeRoot(["my-theme/theme.css", "my-theme/theme.json"])).toBe("my-theme");
    });
    test("returns null when there is no theme.css", () => {
      expect(locateThemeRoot(["styles.css", "readme.md"])).toBeNull();
    });
    test("returns null when nested too deep", () => {
      expect(locateThemeRoot(["a/b/theme.css"])).toBeNull();
    });
    test("returns null when two folders both hold a theme.css (ambiguous)", () => {
      expect(locateThemeRoot(["a/theme.css", "b/theme.css"])).toBeNull();
    });
  });

  describe("classifyThemeCssFindings", () => {
    const finding = (rule: string, severity: "error" | "warning"): PrintSafeWarning => ({
      rule, severity, message: `${rule} msg`, line: 1, column: 1,
    });
    test("a syntax error rejects the import", () => {
      const { reject, warnings } = classifyThemeCssFindings([finding(ruleSyntax, "error")]);
      expect(reject?.rule).toBe(ruleSyntax);
      expect(warnings).toEqual([]);
    });
    test("remote-url + risky effects warn but do not reject", () => {
      const { reject, warnings } = classifyThemeCssFindings([
        finding(ruleRemoteUrls, "error"),
        finding(ruleRiskyProps, "warning"),
      ]);
      expect(reject).toBeNull();
      expect(warnings.map((w) => w.rule)).toEqual([ruleRemoteUrls, ruleRiskyProps]);
    });
    test("clean css yields no reject and no warnings", () => {
      const { reject, warnings } = classifyThemeCssFindings([]);
      expect(reject).toBeNull();
      expect(warnings).toEqual([]);
    });
  });

  describe("unexpectedThemeFiles", () => {
    test("passes through the known files and recognized assets", () => {
      expect(
        unexpectedThemeFiles(["theme.css", "theme.json", "fonts/body.woff2", "art/cover.png"]),
      ).toEqual([]);
    });
    test("flags files that aren't a stylesheet or common asset", () => {
      expect(unexpectedThemeFiles(["theme.css", "notes.md", "install.sh"])).toEqual([
        "notes.md",
        "install.sh",
      ]);
    });
  });
});

// ── Host pipeline ─────────────────────────────────────────────────────────────

const TMP_ROOT = join(process.cwd(), ".tmp", `theme-import-tests-${Date.now()}`);
let counter = 0;
function projectDir(): string {
  const dir = join(TMP_ROOT, `proj-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

const CLEAN_CSS = ":root { --accent: #036; } h1 { color: var(--accent); }";

describe("theme-import host pipeline", () => {
  beforeEach(() => mkdirSync(TMP_ROOT, { recursive: true }));
  afterEach(() => rmSync(TMP_ROOT, { recursive: true, force: true }));

  test("imports a zip with theme.css at the root", async () => {
    const dir = projectDir();
    const zip = zipSync({
      "theme.css": strToU8(CLEAN_CSS),
      "theme.json": strToU8(JSON.stringify({ name: "Midnight" })),
    });
    const { theme, warnings } = await importThemeFromZip(dir, zip);
    expect(theme.name).toBe("Midnight");
    expect(theme.kind).toBe("project");
    expect(existsSync(join(dir, THEMES_DIR, theme.id, "theme.css"))).toBe(true);
    expect(warnings).toEqual([]);
    const listed = await listProjectThemes(dir);
    expect(listed.map((t) => t.id)).toContain(theme.id);
  });

  test("imports a zip with a single wrapping folder and copies bundled assets", async () => {
    const dir = projectDir();
    const zip = zipSync({
      "midnight/theme.css": strToU8(CLEAN_CSS),
      "midnight/theme.json": strToU8(JSON.stringify({ name: "Midnight" })),
      "midnight/fonts/body.woff2": strToU8("not-a-real-font"),
    });
    const { theme } = await importThemeFromZip(dir, zip);
    expect(existsSync(join(dir, THEMES_DIR, theme.id, "theme.css"))).toBe(true);
    expect(existsSync(join(dir, THEMES_DIR, theme.id, "fonts", "body.woff2"))).toBe(true);
  });

  test("rejects a zip with no theme.css", async () => {
    const dir = projectDir();
    const zip = zipSync({ "styles.css": strToU8(CLEAN_CSS) });
    await expect(importThemeFromZip(dir, zip)).rejects.toThrow(/No theme\.css/);
  });

  test("rejects a zip whose theme.css fails to parse", async () => {
    const dir = projectDir();
    const zip = zipSync({ "theme.css": strToU8("h1 { color: ") });
    await expect(importThemeFromZip(dir, zip)).rejects.toThrow(/could not be parsed/);
  });

  test("rejects a zip entry with a traversal path", async () => {
    const dir = projectDir();
    const zip = zipSync({ "theme.css": strToU8(CLEAN_CSS), "../evil.txt": strToU8("x") });
    await expect(importThemeFromZip(dir, zip)).rejects.toThrow(/unsafe path/);
  });

  test("rejects a raw archive over the size cap without unzipping", async () => {
    const dir = projectDir();
    const oversized = new Uint8Array(MAX_THEME_ARCHIVE_BYTES + 1);
    await expect(importThemeFromZip(dir, oversized)).rejects.toThrow(/too large/);
  });

  test("imports a zip with remote-url css but WARNS (does not reject)", async () => {
    const dir = projectDir();
    const zip = zipSync({
      "theme.css": strToU8('@font-face { src: url("https://fonts.example/x.woff2"); }'),
      "theme.json": strToU8(JSON.stringify({ name: "Remote" })),
    });
    const { theme, warnings } = await importThemeFromZip(dir, zip);
    expect(theme.name).toBe("Remote");
    expect(warnings.some((w) => w.code === "print-safety")).toBe(true);
  });

  test("warns when theme.json is missing", async () => {
    const dir = projectDir();
    const zip = zipSync({ "theme.css": strToU8(CLEAN_CSS) });
    const { warnings } = await importThemeFromZip(dir, zip);
    expect(warnings.some((w) => w.code === "no-theme-json")).toBe(true);
  });

  test("imports a bare .css by wrapping it into a theme folder", async () => {
    const dir = projectDir();
    const { theme, warnings } = await importThemeFromCssText(dir, CLEAN_CSS, "My Sheet");
    expect(theme.name).toBe("My Sheet");
    const css = readFileSync(join(dir, THEMES_DIR, theme.id, "theme.css"), "utf8");
    expect(css).toContain("--accent");
    expect(warnings.some((w) => w.code === "no-theme-json")).toBe(true);
  });

  test("rejects a bare .css that fails to parse", async () => {
    const dir = projectDir();
    await expect(importThemeFromCssText(dir, "h1 { color: ", "Bad")).rejects.toThrow(
      /could not be parsed/,
    );
  });
});
