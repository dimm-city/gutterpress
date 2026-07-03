import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isSeq } from "yaml";
import { resolveManifestPath, loadManifestDoc, ensureSeq } from "./manifest-doc";

const TMP_ROOT = join(process.cwd(), ".tmp", `manifest-doc-tests-${Date.now()}`);

let counter = 0;
function projectDir(): string {
  const dir = join(TMP_ROOT, `proj-${counter++}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("manifest-doc", () => {
  beforeEach(() => {
    mkdirSync(TMP_ROOT, { recursive: true });
  });
  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  describe("resolveManifestPath", () => {
    test("defaults to manifest.yaml when neither file exists", () => {
      const dir = projectDir();
      expect(resolveManifestPath(dir)).toBe(join(dir, "manifest.yaml"));
    });

    test("prefers .yml only when .yaml is absent and .yml exists", () => {
      const dir = projectDir();
      writeFileSync(join(dir, "manifest.yml"), "title: X\n", "utf8");
      expect(resolveManifestPath(dir)).toBe(join(dir, "manifest.yml"));
    });

    test("prefers manifest.yaml when both exist", () => {
      const dir = projectDir();
      writeFileSync(join(dir, "manifest.yaml"), "title: A\n", "utf8");
      writeFileSync(join(dir, "manifest.yml"), "title: B\n", "utf8");
      expect(resolveManifestPath(dir)).toBe(join(dir, "manifest.yaml"));
    });
  });

  describe("loadManifestDoc", () => {
    test("returns an empty (but parseable) doc when no manifest exists", async () => {
      const dir = projectDir();
      const { doc, file } = await loadManifestDoc(dir);
      expect(file).toBe(join(dir, "manifest.yaml"));
      expect(doc.get("title")).toBeUndefined();
    });

    test("parses an existing manifest, preserving comments on round-trip", async () => {
      const dir = projectDir();
      writeFileSync(
        join(dir, "manifest.yaml"),
        "# hello\ntitle: My Book\n",
        "utf8",
      );
      const { doc, file } = await loadManifestDoc(dir);
      expect(file).toBe(join(dir, "manifest.yaml"));
      expect(doc.get("title")).toBe("My Book");
      expect(doc.toString()).toContain("# hello");
    });

    test("loads the .yml file when it is the only one present", async () => {
      const dir = projectDir();
      writeFileSync(join(dir, "manifest.yml"), "title: Y\n", "utf8");
      const { doc, file } = await loadManifestDoc(dir);
      expect(file).toBe(join(dir, "manifest.yml"));
      expect(doc.get("title")).toBe("Y");
    });
  });

  describe("ensureSeq", () => {
    test("creates and attaches an empty seq under the key when missing", async () => {
      const dir = projectDir();
      const { doc } = await loadManifestDoc(dir);
      const seq = ensureSeq(doc, "plugins");
      expect(isSeq(seq)).toBe(true);
      expect(seq.items).toHaveLength(0);
      // The created seq is attached to the doc (same node returned again).
      expect(doc.get("plugins", true)).toBe(seq);
    });

    test("returns the existing seq when the key already holds one", async () => {
      const dir = projectDir();
      writeFileSync(
        join(dir, "manifest.yaml"),
        "styles:\n  - a.css\n  - b.css\n",
        "utf8",
      );
      const { doc } = await loadManifestDoc(dir);
      const seq = ensureSeq(doc, "styles");
      expect(seq.items).toHaveLength(2);
      expect(doc.get("styles", true)).toBe(seq);
    });
  });
});
