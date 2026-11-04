/**
 * Unit tests for pdf-parse.ts's Ghostscript-backed ink coverage reader.
 * `getPerPageInkCoverage` must return a discriminated result
 * (`{ ok: true, pages }` | `{ ok: false, error }`) instead of swallowing every
 * gs failure (crash, corrupt PDF, missing binary) into an indistinguishable
 * empty array — which previously made the ink-coverage check silently PASS a
 * book that was never actually measured. It reports each page's HEAVIEST
 * pixel, which is what total area coverage means, not the page's mean.
 *
 * `./exec`'s `execCapture` is spied on (not `mock.module`-replaced) so this
 * never spawns a real `gs` process; the spy writes the raster files a real
 * `gs -sDEVICE=pamcmyk32` would. It is restored in `afterEach` so it never
 * leaks into other test files sharing this bun test run.
 */
import { test, expect, spyOn, afterEach } from "bun:test";
import { writeFile } from "node:fs/promises";
import * as execMod from "./exec.ts";
import * as ghostscriptMod from "./ghostscript.ts";
import { getPerPageInkCoverage, maxInkOfPam } from "./pdf-parse.ts";

afterEach(() => {
  (execMod.execCapture as unknown as { mockRestore?: () => void }).mockRestore?.();
  (ghostscriptMod.resolveGhostscript as unknown as { mockRestore?: () => void }).mockRestore?.();
});

function resolveWindowsGhostscript(): void {
  spyOn(ghostscriptMod, "resolveGhostscript").mockResolvedValue(
    "C:\\Program Files\\gs\\gs10.06.0\\bin\\gswin64c.exe"
  );
}

/**
 * A `pamcmyk32` page: 10x10 pixels, white, with `patch` CMYK (0–255) painted
 * on its first `count` pixels.
 */
function pam(patch: [number, number, number, number] = [0, 0, 0, 0], count = 0): Uint8Array {
  const header = Buffer.from(
    "P7\nWIDTH 10\nHEIGHT 10\nDEPTH 4\nMAXVAL 255\nTUPLTYPE CMYK\nENDHDR\n",
    "latin1"
  );
  const pixels = new Uint8Array(10 * 10 * 4);
  for (let i = 0; i < count; i++) pixels.set(patch, i * 4);
  return new Uint8Array([...header, ...pixels]);
}

/** Make the spied `gs` write these pages where the call asked for them. */
function ghostscriptWrites(pages: Uint8Array[], stderr = "") {
  return spyOn(execMod, "execCapture").mockImplementation(async (_cmd, args) => {
    const target = args.find((a) => a.startsWith("-sOutputFile="))!.slice("-sOutputFile=".length);
    for (const [i, page] of pages.entries()) await writeFile(target.replace("%d", String(i + 1)), page);
    return { stdout: "", stderr };
  });
}

test("maxInkOfPam reports the heaviest pixel, not the page mean", () => {
  // A 400% patch on 10% of a white page: mean 40%, TAC 400%.
  const page = maxInkOfPam(pam([255, 255, 255, 255], 10));
  expect(page).toEqual({ c: 100, m: 100, y: 100, k: 100, tac: 400 });

  const rich = maxInkOfPam(pam([120, 107, 102, 255], 1));
  expect(rich.k).toBe(100);
  expect(rich.tac).toBeCloseTo(((120 + 107 + 102 + 255) / 255) * 100);
});

test("maxInkOfPam refuses a raster that is not 4-channel CMYK", () => {
  expect(() => maxInkOfPam(Buffer.from("P6\n10 10\n255\n"))).toThrow("CMYK");
});

test("getPerPageInkCoverage returns ok:true with each page's heaviest spot", async () => {
  resolveWindowsGhostscript();
  const exec = ghostscriptWrites([pam(), pam([255, 255, 255, 255], 10)]);

  const result = await getPerPageInkCoverage("/fake/book.pdf");

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok:true");
  expect(result.pages).toEqual([
    { page: 1, c: 0, m: 0, y: 0, k: 0, tac: 0 },
    { page: 2, c: 100, m: 100, y: 100, k: 100, tac: 400 },
  ]);
  expect(exec.mock.calls[0]?.[0]).toBe(
    "C:\\Program Files\\gs\\gs10.06.0\\bin\\gswin64c.exe"
  );
  expect(exec.mock.calls[0]?.[1]).toEqual(expect.arrayContaining(["-sDEVICE=pamcmyk32", "-r72"]));
});

test("getPerPageInkCoverage returns ok:false with the error message when gs fails", async () => {
  resolveWindowsGhostscript();
  spyOn(execMod, "execCapture").mockImplementation(async () => {
    throw new Error("spawn gs ENOENT");
  });

  const result = await getPerPageInkCoverage("/fake/book.pdf");

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected ok:false");
  expect(result.error).toContain("ENOENT");
});

test("getPerPageInkCoverage returns ok:false (not an empty ok:true) when gs exits non-zero", async () => {
  resolveWindowsGhostscript();
  spyOn(execMod, "execCapture").mockImplementation(async () => {
    throw new Error("gs -sDEVICE=pamcmyk32 ... exited 1");
  });

  const result = await getPerPageInkCoverage("/fake/corrupt.pdf");

  // Returning [] here would be indistinguishable from a legitimately empty
  // (0-page) PDF — a silent pass. This MUST be a distinguishable failure,
  // not a same-shape empty success.
  expect(result).not.toEqual({ ok: true, pages: [] });
  expect(result.ok).toBe(false);
});

test("getPerPageInkCoverage returns ok:false when gs exits 0 but writes no page", async () => {
  resolveWindowsGhostscript();
  ghostscriptWrites([], "GPL Ghostscript 10.02.1: Unrecoverable error, exit code 1\n");

  const result = await getPerPageInkCoverage("/fake/book.pdf");

  // Exit 0 with nothing measured must read as "unmeasured", never as
  // "0 pages, all fine" (#419).
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected ok:false");
  expect(result.error).toContain("Unrecoverable error");
});
