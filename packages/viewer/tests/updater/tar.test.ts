import { describe, expect, test } from "bun:test";
import { gzipSync } from "fflate";
import { readTarGz, untar } from "../../electron/updater/tar.ts";

// Build a spec-correct USTAR archive in-memory (the reader ignores the checksum
// field, but we set name/size/typeflag/prefix exactly as `npm pack` does, with
// the `package/` prefix every npm tarball carries).
function tarBlock(name: string, body: Uint8Array, typeFlag = "0"): Uint8Array {
  const header = new Uint8Array(512);
  const enc = new TextEncoder();
  header.set(enc.encode(name.slice(0, 100)), 0);
  // size as zero-padded 11-char octal + NUL at offset 124
  header.set(enc.encode(body.length.toString(8).padStart(11, "0")), 124);
  header[156] = typeFlag.charCodeAt(0);
  const dataLen = Math.ceil(body.length / 512) * 512;
  const data = new Uint8Array(dataLen);
  data.set(body);
  return new Uint8Array([...header, ...data]);
}

function makeTarGz(files: Record<string, string>): Uint8Array {
  const enc = new TextEncoder();
  const blocks: number[] = [];
  for (const [name, contents] of Object.entries(files)) {
    blocks.push(...tarBlock(name, enc.encode(contents)));
  }
  blocks.push(...new Uint8Array(1024)); // two zero blocks = end of archive
  return gzipSync(new Uint8Array(blocks));
}

describe("tar reader for npm tarballs", () => {
  test("strips the package/ prefix and yields regular files", () => {
    const tgz = makeTarGz({
      "package/package.json": '{"name":"@dimm-city/print-md","version":"1.2.3"}',
      "package/dist/index.js": "export const x = 1;",
      "package/ui/index.html": "<!doctype html>",
    });
    const entries = readTarGz(tgz);
    const byName = Object.fromEntries(
      entries.map((e) => [e.name, new TextDecoder().decode(e.data)]),
    );
    expect(Object.keys(byName).sort()).toEqual([
      "dist/index.js",
      "package.json",
      "ui/index.html",
    ]);
    expect(byName["dist/index.js"]).toBe("export const x = 1;");
    expect(byName["package.json"]).toContain('"version":"1.2.3"');
  });

  test("preserves exact bytes for non-trivial sizes (multi-block)", () => {
    const big = "A".repeat(1500); // spans 3 data blocks
    const entries = readTarGz(makeTarGz({ "package/dist/big.txt": big }));
    expect(entries).toHaveLength(1);
    expect(new TextDecoder().decode(entries[0]!.data)).toBe(big);
    expect(entries[0]!.data.length).toBe(1500);
  });

  test("skips directory entries (typeflag 5)", () => {
    const enc = new TextEncoder();
    const blocks = [
      ...tarBlock("package/dist/", new Uint8Array(0), "5"),
      ...tarBlock("package/dist/a.js", enc.encode("a")),
      ...new Uint8Array(1024),
    ];
    const entries = untar(new Uint8Array(blocks));
    expect(entries.map((e) => e.name)).toEqual(["dist/a.js"]);
  });

  test("stops at the end-of-archive zero blocks", () => {
    const tgz = makeTarGz({ "package/only.txt": "x" });
    expect(readTarGz(tgz)).toHaveLength(1);
  });
});
