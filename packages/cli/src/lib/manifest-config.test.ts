import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  readManifestFields,
  setManifestFields,
  setActiveStyles,
} from "./manifest-config";

const TMP_ROOT = join(process.cwd(), ".tmp", `manifest-config-tests-${Date.now()}`);

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

describe("manifest-config", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  describe("readManifestFields", () => {
    test("reads the author-facing subset of a full manifest", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        [
          "title: My Book",
          "authors:",
          "  - Ada Lovelace",
          "  - Charles Babbage",
          "preset: dtrpg",
          "styles:",
          "  - themes/zine/theme.css",
          "plugins:",
          "  - markdown-it-mark",
          "source:",
          "  files:",
          "    - chapter-01.md",
          "    - chapter-02.md",
          "",
        ].join("\n"),
      );
      const fields = await readManifestFields(dir);
      expect(fields.title).toBe("My Book");
      expect(fields.authors).toEqual(["Ada Lovelace", "Charles Babbage"]);
      expect(fields.sourceFiles).toEqual(["chapter-01.md", "chapter-02.md"]);
    });

    test("returns {} for a project with no manifest", async () => {
      const dir = projectDir();
      const fields = await readManifestFields(dir);
      expect(fields).toEqual({});
    });

    test("source.files: null round-trips as null", async () => {
      const dir = projectDir();
      writeManifest(dir, ["source:", "  files: null", ""].join("\n"));
      const fields = await readManifestFields(dir);
      expect(fields.sourceFiles).toBeNull();
    });

    // ARCH finding #25: readManifestFields now routes through the shared
    // loadManifestDoc (manifest-doc.ts) instead of re-implementing the
    // resolve+read+parse sequence inline — so it picks up loadManifestDoc's
    // .yml-fallback behavior for free, same as every other reader in this file.
    test("reads from manifest.yml when only that file exists (loadManifestDoc routing)", async () => {
      const dir = projectDir();
      writeFileSync(join(dir, "manifest.yml"), "title: Yml Title\n", "utf8");
      const fields = await readManifestFields(dir);
      expect(fields.title).toBe("Yml Title");
    });
  });

  describe("setManifestFields", () => {
    test("writes title + authors into an empty manifest", async () => {
      const dir = projectDir();
      writeManifest(dir, "");

      const out = await setManifestFields(dir, {
        title: "New Title",
        authors: ["One Author"],
      });
      expect(out.title).toBe("New Title");
      expect(out.authors).toEqual(["One Author"]);

      const onDisk = readManifest(dir);
      expect(onDisk).toContain("title: New Title");
      expect(onDisk).toContain("authors:");
      expect(onDisk).toContain("- One Author");
    });


    test("updates source.files and leaves sibling keys untouched", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        ["preset: book", "source:", "  files:", "    - old.md", ""].join("\n"),
      );

      await setManifestFields(dir, { sourceFiles: ["a.md", "b.md"] });
      const onDisk = readManifest(dir);
      expect(onDisk).toContain("- a.md");
      expect(onDisk).toContain("- b.md");
      expect(onDisk).not.toContain("old.md");
      expect(onDisk).toContain("preset: book");
    });

    test("passing sourceFiles: null deletes the source.files entry", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        ["source:", "  files:", "    - chapter-01.md", ""].join("\n"),
      );

      await setManifestFields(dir, { sourceFiles: null });
      const onDisk = readManifest(dir);
      expect(onDisk).not.toContain("files:");
      expect(onDisk).not.toContain("chapter-01");
    });

    test("passing an empty authors array deletes the authors key", async () => {
      const dir = projectDir();
      writeManifest(dir, ["authors:", "  - x", ""].join("\n"));

      await setManifestFields(dir, { authors: [] });
      const onDisk = readManifest(dir);
      expect(onDisk).not.toContain("authors");
    });

    test("preserves comments and unedited sections on round-trip", async () => {
      const dir = projectDir();
      const original = [
        "# Project configuration",
        "title: Original",
        "styles:",
        "  - styles/book.css",
        "plugins:",
        "  - markdown-it-footnote",
        "",
      ].join("\n");
      writeManifest(dir, original);

      await setManifestFields(dir, { title: "Changed" });
      const onDisk = readManifest(dir);
      expect(onDisk).toContain("# Project configuration");
      expect(onDisk).toContain("title: Changed");
      expect(onDisk).toContain("styles:");
      expect(onDisk).toContain("- styles/book.css");
      expect(onDisk).toContain("plugins:");
      expect(onDisk).toContain("- markdown-it-footnote");
    });

    test("returns the post-write field snapshot", async () => {
      const dir = projectDir();
      writeManifest(dir, "");
      const out = await setManifestFields(dir, { title: "Snapshot" });
      expect(out.title).toBe("Snapshot");
    });

    test("accepts .yml when no .yaml exists", async () => {
      const dir = projectDir();
      writeFileSync(join(dir, "manifest.yml"), "title: Yml One\n", "utf8");

      const out = await setManifestFields(dir, { title: "Yml Two" });
      expect(out.title).toBe("Yml Two");
      // The .yml file is the target (no .yaml was created).
      expect((await import("node:fs")).existsSync(join(dir, "manifest.yaml"))).toBe(false);
    });
  });

  describe("setActiveStyles", () => {
    test("creates the styles list when absent", async () => {
      const dir = projectDir();
      writeManifest(dir, "title: Book\n");

      const out = await setActiveStyles(dir, ["styles/book.css", "themes/zine/theme.css"]);
      expect(out).toEqual(["styles/book.css", "themes/zine/theme.css"]);
      const onDisk = readManifest(dir);
      expect(onDisk).toContain("styles:");
      expect(onDisk).toContain("- styles/book.css");
      expect(onDisk).toContain("- themes/zine/theme.css");
    });

    test("replaces an existing styles list in order", async () => {
      const dir = projectDir();
      writeManifest(
        dir,
        ["styles:", "  - styles/old.css", "  - themes/x/theme.css", ""].join("\n"),
      );

      const out = await setActiveStyles(dir, ["themes/x/theme.css", "styles/print.css"]);
      expect(out).toEqual(["themes/x/theme.css", "styles/print.css"]);
      const onDisk = readManifest(dir);
      // old.css dropped, new order honoured.
      expect(onDisk).not.toContain("old.css");
      expect(onDisk.indexOf("themes/x/theme.css")).toBeLessThan(onDisk.indexOf("styles/print.css"));
    });

    test("deletes the styles key when given an empty list", async () => {
      const dir = projectDir();
      writeManifest(dir, ["styles:", "  - styles/book.css", "title: Book", ""].join("\n"));

      await setActiveStyles(dir, []);
      const onDisk = readManifest(dir);
      expect(onDisk).not.toContain("styles:");
      expect(onDisk).toContain("title: Book");
    });
  });
});