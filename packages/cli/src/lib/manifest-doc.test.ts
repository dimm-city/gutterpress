import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { isSeq, Scalar } from "yaml";
import { resolveManifestPath, loadManifestDoc, ensureSeq, scalarString } from "./manifest-doc";

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

    test("uses manifest.yaml when it exists", () => {
      const dir = projectDir();
      writeFileSync(join(dir, "manifest.yaml"), "title: A\n", "utf8");
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

    test("propagates manifest read errors instead of treating them as an absent file", async () => {
      const dir = projectDir();
      mkdirSync(join(dir, "manifest.yaml"));

      await expect(loadManifestDoc(dir)).rejects.toThrow();
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

    // #239 — theme-manager.ts needs to ensure/mutate the NESTED
    // engineStyles.native seq, auto-vivifying the intermediate `engineStyles`
    // map exactly like a hand-written `engineStyles: { native: [...] }` would.
    describe("nested path key (#239)", () => {
      test("creates the intermediate map AND the seq when neither exists", async () => {
        const dir = projectDir();
        const { doc } = await loadManifestDoc(dir);
        const seq = ensureSeq(doc, ["engineStyles", "native"]);
        expect(isSeq(seq)).toBe(true);
        expect(seq.items).toHaveLength(0);
        expect(doc.getIn(["engineStyles", "native"], true)).toBe(seq);
      });

      test("returns the existing nested seq without disturbing a sibling key", async () => {
        const dir = projectDir();
        writeFileSync(
          join(dir, "manifest.yaml"),
          "engineStyles:\n  paged:\n    - old.css\n  native:\n    - furniture.css\n",
          "utf8",
        );
        const { doc } = await loadManifestDoc(dir);
        const seq = ensureSeq(doc, ["engineStyles", "native"]);
        expect(seq.items).toHaveLength(1);
        expect(doc.getIn(["engineStyles", "native"], true)).toBe(seq);
        // The sibling `paged` key survives untouched.
        const paged = doc.getIn(["engineStyles", "paged"], true);
        expect(isSeq(paged) && paged.items).toHaveLength(1);
      });

      test("a single-element path behaves exactly like the flat-string form", async () => {
        const dir = projectDir();
        const { doc } = await loadManifestDoc(dir);
        const seq = ensureSeq(doc, ["plugins"]);
        expect(isSeq(seq)).toBe(true);
        expect(doc.get("plugins", true)).toBe(seq);
      });
    });
  });

  // ARCH finding #25: scalarString is the ONE shared unwrap helper consumed by
  // both manifest-config.ts (was `unwrapScalar`) and theme-manager.ts (was
  // `styleHrefOf`) instead of two near-duplicate copies.
  describe("scalarString", () => {
    test("unwraps a Scalar node's .value", () => {
      expect(scalarString(new Scalar("styles/book.css"))).toBe("styles/book.css");
    });

    test("passes a raw JS string through unchanged", () => {
      expect(scalarString("themes/zine/theme.css")).toBe("themes/zine/theme.css");
    });

    test("returns null for a Scalar wrapping a non-string value", () => {
      expect(scalarString(new Scalar(42))).toBeNull();
      expect(scalarString(new Scalar(null))).toBeNull();
    });

    test("returns null for null/undefined/non-string primitives", () => {
      expect(scalarString(null)).toBeNull();
      expect(scalarString(undefined)).toBeNull();
      expect(scalarString(42)).toBeNull();
      expect(scalarString(true)).toBeNull();
    });

    test("a seq item read back via doc.get(key, true) round-trips through scalarString", async () => {
      const dir = projectDir();
      writeFileSync(dir + "/manifest.yaml", "styles:\n  - styles/book.css\n", "utf8");
      const { doc } = await loadManifestDoc(dir);
      const seq = ensureSeq(doc, "styles");
      const [item] = seq.items;
      expect(scalarString(item)).toBe("styles/book.css");
    });
  });
});
