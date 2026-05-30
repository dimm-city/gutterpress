import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { copyAssets, resolveAssetDestName } from "./assets";

describe("resolveAssetDestName", () => {
  test("keeps simple paths unchanged", () => {
    expect(resolveAssetDestName("css")).toBe("css");
  });
  test("flattens relative paths to their basename", () => {
    expect(resolveAssetDestName("../dc-design-guide/css")).toBe("css");
  });
});

describe("copyAssets collision detection", () => {
  let root: string;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "assets-test-"));
  });
  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  test("reports a filename overwrite when two asset dirs flatten to the same folder", async () => {
    // Mimic the field-guide layout: local css/index.css and a sibling shared
    // css/index.css both flatten into the staged css/ folder.
    const input = join(root, "book");
    mkdirSync(join(input, "css"), { recursive: true });
    writeFileSync(join(input, "css", "index.css"), "/* local entry */");
    mkdirSync(join(root, "shared", "css"), { recursive: true });
    writeFileSync(join(root, "shared", "css", "index.css"), "/* shared entry */");
    writeFileSync(join(root, "shared", "css", "tokens.css"), "/* tokens */");

    const out = join(root, "out");
    const collisions: Array<Record<string, string>> = [];
    // Shared first, local last → local wins (matches the hardened manifest order).
    await copyAssets(input, out, ["../shared/css", "css"], {
      onCollision: (c) => collisions.push(c),
    });

    expect(collisions).toHaveLength(1);
    expect(collisions[0]).toMatchObject({
      destName: "css",
      fileName: "index.css",
      winnerAsset: "css",
      loserAsset: "../shared/css",
    });
    // The last entry (local) wins on disk, and non-colliding files survive.
    expect(readFileSync(join(out, "css", "index.css"), "utf8")).toBe("/* local entry */");
    expect(existsSync(join(out, "css", "tokens.css"))).toBe(true);
  });

  test("does not report a collision when filenames do not overlap", async () => {
    const input = join(root, "book");
    mkdirSync(join(input, "css"), { recursive: true });
    writeFileSync(join(input, "css", "book.css"), "/* book */");
    mkdirSync(join(root, "shared", "css"), { recursive: true });
    writeFileSync(join(root, "shared", "css", "tokens.css"), "/* tokens */");

    const out = join(root, "out");
    const collisions: unknown[] = [];
    await copyAssets(input, out, ["css", "../shared/css"], {
      onCollision: (c) => collisions.push(c),
    });

    expect(collisions).toHaveLength(0);
    expect(existsSync(join(out, "css", "book.css"))).toBe(true);
    expect(existsSync(join(out, "css", "tokens.css"))).toBe(true);
  });
});
