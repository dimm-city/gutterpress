import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { zipSync, strToU8 } from "fflate";

import {
  isUnsafeZipEntryPath,
  locateThemeRoot,
  classifyThemeCssFindings,
  unexpectedThemeFiles,
  importExtensionFromZip,
  importExtensionFromCssText,
  MAX_THEME_ARCHIVE_BYTES,
} from "./extension-import";
import { ruleSyntax, ruleRemoteUrls, ruleRiskyProps, type PrintSafeWarning } from "./printsafe";
import { listProjectExtensions } from "./extension-manager";

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
    // #241
    test("gutterpress.json itself is a recognized file, not an unexpected one", () => {
      expect(unexpectedThemeFiles(["theme.css", "gutterpress.json"])).toEqual([]);
    });
    test("declaredExtras suppresses an exact declared file (markdown/components)", () => {
      expect(
        unexpectedThemeFiles(["theme.css", "plugin.js"], ["plugin.js"]),
      ).toEqual([]);
      // A file NOT in declaredExtras is still flagged.
      expect(unexpectedThemeFiles(["theme.css", "other.js"], ["plugin.js"])).toEqual([
        "other.js",
      ]);
    });
    test("declaredExtras suppresses everything under a declared folder (snippets)", () => {
      expect(
        unexpectedThemeFiles(
          ["theme.css", "snippets/a.md", "snippets/nested/b.md"],
          ["snippets"],
        ),
      ).toEqual([]);
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
    const { entry, warnings } = await importExtensionFromZip(dir, zip);
    expect(entry.label).toBe("Midnight");
    expect(entry.kind).toBe("path");
    expect(existsSync(join(dir, entry.use, "theme.css"))).toBe(true);
    expect(warnings).toEqual([]);
    const listed = await listProjectExtensions(dir);
    expect(listed.map((e) => e.use)).toContain(entry.use);
  });

  test("imports a zip with a single wrapping folder and copies bundled assets", async () => {
    const dir = projectDir();
    const zip = zipSync({
      "midnight/theme.css": strToU8(CLEAN_CSS),
      "midnight/theme.json": strToU8(JSON.stringify({ name: "Midnight" })),
      "midnight/fonts/body.woff2": strToU8("not-a-real-font"),
    });
    const { entry } = await importExtensionFromZip(dir, zip);
    expect(existsSync(join(dir, entry.use, "theme.css"))).toBe(true);
    expect(existsSync(join(dir, entry.use, "fonts", "body.woff2"))).toBe(true);
  });

  test("rejects a zip with no theme.css", async () => {
    const dir = projectDir();
    const zip = zipSync({ "styles.css": strToU8(CLEAN_CSS) });
    await expect(importExtensionFromZip(dir, zip)).rejects.toThrow(/No theme\.css/);
  });

  test("rejects a zip whose theme.css fails to parse", async () => {
    const dir = projectDir();
    const zip = zipSync({ "theme.css": strToU8("h1 { color: ") });
    await expect(importExtensionFromZip(dir, zip)).rejects.toThrow(/could not be parsed/);
  });

  test("rejects a zip entry with a traversal path", async () => {
    const dir = projectDir();
    const zip = zipSync({ "theme.css": strToU8(CLEAN_CSS), "../evil.txt": strToU8("x") });
    await expect(importExtensionFromZip(dir, zip)).rejects.toThrow(/unsafe path/);
  });

  test("rejects a raw archive over the size cap without unzipping", async () => {
    const dir = projectDir();
    const oversized = new Uint8Array(MAX_THEME_ARCHIVE_BYTES + 1);
    await expect(importExtensionFromZip(dir, oversized)).rejects.toThrow(/too large/);
  });

  test("imports a zip with remote-url css but WARNS (does not reject)", async () => {
    const dir = projectDir();
    const zip = zipSync({
      "theme.css": strToU8('@font-face { src: url("https://fonts.example/x.woff2"); }'),
      "theme.json": strToU8(JSON.stringify({ name: "Remote" })),
    });
    const { entry, warnings } = await importExtensionFromZip(dir, zip);
    expect(entry.label).toBe("Remote");
    expect(warnings.some((w) => w.code === "print-safety")).toBe(true);
  });

  test("warns when theme.json is missing", async () => {
    const dir = projectDir();
    const zip = zipSync({ "theme.css": strToU8(CLEAN_CSS) });
    const { warnings } = await importExtensionFromZip(dir, zip);
    expect(warnings.some((w) => w.code === "no-theme-json")).toBe(true);
  });

  test("imports a bare .css by wrapping it into a theme folder", async () => {
    const dir = projectDir();
    const { entry, warnings } = await importExtensionFromCssText(dir, CLEAN_CSS, "My Sheet");
    expect(entry.label).toBe("My Sheet");
    const css = readFileSync(join(dir, entry.use, "theme.css"), "utf8");
    expect(css).toContain("--accent");
    expect(warnings.some((w) => w.code === "no-theme-json")).toBe(true);
  });

  test("rejects a bare .css that fails to parse", async () => {
    const dir = projectDir();
    await expect(importExtensionFromCssText(dir, "h1 { color: ", "Bad")).rejects.toThrow(
      /could not be parsed/,
    );
  });

  // #239 — theme.json may declare ADDITIONAL sheets beyond the anchor
  // theme.css; every one is validated (exists + print-safe) at import time,
  // exactly like theme.css itself.
  describe("multi-sheet zip validation (#239)", () => {
    test("validates an additional declared sheet exists and is print-safe", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "theme.json": strToU8(
          JSON.stringify({ name: "Layered", styles: ["theme.css", "components.css"] }),
        ),
        "components.css": strToU8("@page { background-blend-mode: multiply; }"),
      });
      const { entry, warnings } = await importExtensionFromZip(dir, zip);
      expect(entry.label).toBe("Layered");
      expect(existsSync(join(dir, entry.use, "components.css"))).toBe(true);
      // The additional sheet's risky print property surfaces as a warning,
      // proving it was actually inspected (not just copied).
      expect(
        warnings.some((w) => w.code === "print-safety" && w.message.includes("components.css")),
      ).toBe(true);
    });

    test("rejects a zip whose theme.json declares a sheet the package doesn't contain", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "theme.json": strToU8(
          JSON.stringify({ name: "Broken", styles: ["theme.css", "missing.css"] }),
        ),
      });
      await expect(importExtensionFromZip(dir, zip)).rejects.toThrow(/missing\.css/);
    });

    test("rejects a zip whose additional declared sheet fails to parse", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "theme.json": strToU8(
          JSON.stringify({ name: "Broken", styles: ["theme.css", "bad.css"] }),
        ),
        "bad.css": strToU8("h1 { color: "),
      });
      await expect(importExtensionFromZip(dir, zip)).rejects.toThrow(/bad\.css could not be parsed/);
    });

    test("a theme.json declaring the removed `engineStyles` field is rejected at import, naming the replacement (#266)", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "theme.json": strToU8(
          JSON.stringify({ name: "Furniture", engineStyles: { native: ["native.css"] } }),
        ),
        "native.css": strToU8("@page { color: red; }"),
      });
      await expect(importExtensionFromZip(dir, zip)).rejects.toThrow(
        /`engineStyles`, which was removed — move its entries to the end of `styles`/,
      );
    });

    test("a theme.json declaring only theme.css (the default) has no extra validation to fail — unchanged behavior", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "theme.json": strToU8(JSON.stringify({ name: "Plain" })),
      });
      const { entry, warnings } = await importExtensionFromZip(dir, zip);
      expect(entry.label).toBe("Plain");
      expect(warnings).toEqual([]);
    });
  });

  // #241 — the metadata file inside a zip package may be gutterpress.json
  // instead of theme.json. The zip-root anchor stays theme.css (unchanged,
  // documented as a known pre-existing gap for a theme.css-free package —
  // see this file's header); only which metadata filename is read once that
  // root is found generalizes.
  describe("gutterpress.json metadata inside a zip package (#241)", () => {
    test("reads name/styles from gutterpress.json instead of theme.json", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "gutterpress.json": strToU8(
          JSON.stringify({ name: "GP Package", styles: ["theme.css", "extra.css"] }),
        ),
        "extra.css": strToU8(".extra {}"),
      });
      const { entry, warnings } = await importExtensionFromZip(dir, zip);
      expect(entry.label).toBe("GP Package");
      expect(entry.carries.styles).toBe(true);
      expect(existsSync(join(dir, entry.use, "extra.css"))).toBe(true);
      // gutterpress.json itself, and the extra sheet it declares, must not
      // trigger a false "unexpected extra files" warning.
      expect(warnings).toEqual([]);
    });

    test("gutterpress.json wins over a sibling theme.json inside the same package", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "theme.json": strToU8(JSON.stringify({ name: "Old" })),
        "gutterpress.json": strToU8(JSON.stringify({ name: "New" })),
      });
      const { entry } = await importExtensionFromZip(dir, zip);
      expect(entry.label).toBe("New");
    });

    test("a declared markdown entry is validated for containment but does not block import, and is not flagged as an unexpected file", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "gutterpress.json": strToU8(
          JSON.stringify({ name: "Full", markdown: "plugin.js" }),
        ),
        "plugin.js": strToU8("export default function (md) {}"),
      });
      const { entry, warnings } = await importExtensionFromZip(dir, zip);
      expect(entry.label).toBe("Full");
      expect(existsSync(join(dir, entry.use, "plugin.js"))).toBe(true);
      expect(warnings.some((w) => w.code === "extra-files")).toBe(false);
    });

    test("rejects a gutterpress.json declaring markdown outside the package", async () => {
      const dir = projectDir();
      const zip = zipSync({
        "theme.css": strToU8(CLEAN_CSS),
        "gutterpress.json": strToU8(
          JSON.stringify({ name: "Sneaky", markdown: "../../../etc/passwd" }),
        ),
      });
      await expect(importExtensionFromZip(dir, zip)).rejects.toThrow(/outside its own folder/);
    });
  });
});
