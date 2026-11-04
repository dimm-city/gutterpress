/**
 * Unit tests for pdf-parse.ts's Ghostscript-backed ink coverage reader.
 * `getPerPageInkCoverage` must return a discriminated result
 * (`{ ok: true, pages }` | `{ ok: false, error }`) instead of swallowing every
 * gs failure (crash, corrupt PDF, missing binary, a page it did not render)
 * into an indistinguishable empty array — which previously made the
 * ink-coverage check silently PASS a book that was never actually measured.
 * It reports each page's HEAVIEST pixel, which is what total area coverage
 * means, not the page's mean.
 *
 * `./exec`'s `execCapture` is spied on (not `mock.module`-replaced) so this
 * never spawns a real `gs` process; the spy writes the raster files a real
 * `gs -sDEVICE=pamcmyk32` would for the page range it was asked for. It is
 * restored in `afterEach` so it never leaks into other test files sharing this
 * bun test run. The PDFs are real (pdf-lib), since the reader counts their
 * pages to know what Ghostscript owes it.
 */
import { test, expect, spyOn, afterEach } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import * as execMod from "./exec.ts";
import * as ghostscriptMod from "./ghostscript.ts";
import { getPerPageInkCoverage, hasOutputIntent, maxInkOfPam } from "./pdf-parse.ts";

const dirs: string[] = [];

afterEach(async () => {
  (execMod.execCapture as unknown as { mockRestore?: () => void }).mockRestore?.();
  (ghostscriptMod.resolveGhostscript as unknown as { mockRestore?: () => void }).mockRestore?.();
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});

function resolveWindowsGhostscript(): void {
  spyOn(ghostscriptMod, "resolveGhostscript").mockResolvedValue(
    "C:\\Program Files\\gs\\gs10.06.0\\bin\\gswin64c.exe"
  );
}

/** A real PDF of `pages` letter pages, with a (bare) OutputIntents entry unless `pdfx` is false. */
async function book(pages: number, pdfx = true): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-tac-test-"));
  dirs.push(dir);
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) doc.addPage([612, 792]);
  if (pdfx) doc.catalog.set(PDFName.of("OutputIntents"), doc.context.obj([]));
  const path = join(dir, "book.pdf");
  await writeFile(path, await doc.save());
  return path;
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

/** A PAM with the given header and `bytes` of pixel data. */
function pamWith(header: string, bytes: number): Uint8Array {
  return new Uint8Array([...Buffer.from(header, "latin1"), ...new Uint8Array(bytes)]);
}

/**
 * Make the spied `gs` write these pages (the book's, 1-based) where the call
 * asked for them: the pages of the `-dFirstPage`..`-dLastPage` range it was
 * given, numbered from 1 within the run, as Ghostscript numbers them.
 */
function ghostscriptWrites(pages: Uint8Array[], stderr = "") {
  return spyOn(execMod, "execCapture").mockImplementation(async (_cmd, args) => {
    const flag = (name: string) => args.find((a) => a.startsWith(`-${name}=`))!.slice(name.length + 2);
    const target = flag("sOutputFile");
    const first = Number(flag("dFirstPage"));
    const last = Number(flag("dLastPage"));
    for (let page = first; page <= last; page++) {
      const raster = pages[page - 1];
      if (raster) await writeFile(target.replace("%d", String(page - first + 1)), raster);
    }
    return { stdout: "", stderr };
  });
}

test("maxInkOfPam reports the heaviest pixel, not the page mean", () => {
  expect(maxInkOfPam(pam())).toEqual({ c: 0, m: 0, y: 0, k: 0, tac: 0 });
  const page = maxInkOfPam(pam([255, 255, 255, 255], 10));
  expect(page.tac).toBe(400); // a tenth of the page at 400%: the mean would say 40
  expect(page).toEqual({ c: 100, m: 100, y: 100, k: 100, tac: 400 });
  const rich = maxInkOfPam(pam([120, 107, 102, 255], 1));
  expect(rich.tac).toBeCloseTo(((120 + 107 + 102 + 255) / 255) * 100, 5);
  expect(rich.k).toBe(100);
});

test("maxInkOfPam refuses a raster that is not 8-bit 4-channel CMYK, or is cut short", () => {
  expect(() => maxInkOfPam(Buffer.from("P6\n10 10\n255\n"))).toThrow("CMYK");
  const header = (depth: number, maxval: number, tupltype: string, width = 10) =>
    `P7\nWIDTH ${width}\nHEIGHT 10\nDEPTH ${depth}\nMAXVAL ${maxval}\nTUPLTYPE ${tupltype}\nENDHDR\n`;
  expect(() => maxInkOfPam(pamWith(header(3, 255, "RGB"), 300))).toThrow("CMYK");
  expect(() => maxInkOfPam(pamWith(header(4, 255, "RGB_ALPHA"), 400))).toThrow("CMYK");
  expect(() => maxInkOfPam(pamWith(header(4, 65535, "CMYK"), 800))).toThrow("8-bit");
  expect(() => maxInkOfPam(pamWith(header(4, 255, "CMYK", 0), 0))).toThrow("CMYK");
  expect(() => maxInkOfPam(pamWith(header(4, 255, "CMYK"), 399))).toThrow("truncated");
  expect(maxInkOfPam(pamWith(header(4, 255, "CMYK"), 400)).tac).toBe(0);
});

test("getPerPageInkCoverage returns ok:true with each page's heaviest spot", async () => {
  resolveWindowsGhostscript();
  const exec = ghostscriptWrites([pam(), pam([255, 255, 255, 255], 10)]);

  const result = await getPerPageInkCoverage(await book(2));

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok:true");
  expect(result.pages).toEqual([
    { page: 1, c: 0, m: 0, y: 0, k: 0, tac: 0 },
    { page: 2, c: 100, m: 100, y: 100, k: 100, tac: 400 },
  ]);
  expect(exec).toHaveBeenCalledTimes(1);
  expect(exec.mock.calls[0]?.[0]).toBe(
    "C:\\Program Files\\gs\\gs10.06.0\\bin\\gswin64c.exe"
  );
  expect(exec.mock.calls[0]?.[1]).toEqual(
    expect.arrayContaining(["-sDEVICE=pamcmyk32", "-r72", "-dFirstPage=1", "-dLastPage=2"])
  );
});

test("getPerPageInkCoverage renders in runs of 32 pages and removes its rasters", async () => {
  resolveWindowsGhostscript();
  const exec = ghostscriptWrites(Array.from({ length: 70 }, () => pam([0, 0, 0, 128], 1)));

  const result = await getPerPageInkCoverage(await book(70));

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok:true");
  expect(result.pages.map((p) => p.page)).toEqual(Array.from({ length: 70 }, (_, i) => i + 1));
  expect(result.pages.every((p) => p.tac > 50 && p.tac < 51)).toBe(true);
  const ranges = exec.mock.calls.map(([, args]) =>
    args.filter((a) => a.startsWith("-dFirstPage=") || a.startsWith("-dLastPage=")).join(" ")
  );
  expect(ranges).toEqual([
    "-dFirstPage=1 -dLastPage=32",
    "-dFirstPage=33 -dLastPage=64",
    "-dFirstPage=65 -dLastPage=70",
  ]);
  const output = exec.mock.calls[0]![1].find((a) => a.startsWith("-sOutputFile="))!;
  expect(existsSync(dirname(output.slice("-sOutputFile=".length)))).toBe(false);
});

test("getPerPageInkCoverage returns ok:false with the error message when gs fails", async () => {
  resolveWindowsGhostscript();
  spyOn(execMod, "execCapture").mockImplementation(async () => {
    throw new Error("spawn gs ENOENT");
  });

  const result = await getPerPageInkCoverage(await book(1));

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected ok:false");
  expect(result.error).toContain("ENOENT");
});

test("getPerPageInkCoverage returns ok:false (not an empty ok:true) when gs exits non-zero", async () => {
  resolveWindowsGhostscript();
  spyOn(execMod, "execCapture").mockImplementation(async () => {
    throw new Error("gs -sDEVICE=pamcmyk32 ... exited 1");
  });

  const result = await getPerPageInkCoverage(await book(1));

  // Returning [] here would be indistinguishable from a legitimately empty
  // (0-page) PDF — a silent pass. This MUST be a distinguishable failure,
  // not a same-shape empty success.
  expect(result).not.toEqual({ ok: true, pages: [] });
  expect(result.ok).toBe(false);
});

test("getPerPageInkCoverage returns ok:false when gs exits 0 but writes no page", async () => {
  resolveWindowsGhostscript();
  ghostscriptWrites([], "GPL Ghostscript 10.02.1: Unrecoverable error, exit code 1\n");

  const result = await getPerPageInkCoverage(await book(1));

  // Exit 0 with nothing measured must read as "unmeasured", never as
  // "0 pages, all fine" (#419).
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected ok:false");
  expect(result.error).toContain("rendered 0 of 1 pages");
  expect(result.error).toContain("Unrecoverable error");
});

test("getPerPageInkCoverage returns ok:false when gs renders fewer pages than the PDF has", async () => {
  resolveWindowsGhostscript();
  ghostscriptWrites([pam(), pam()], "   **** Error: Page 3 could not be drawn\n");

  const result = await getPerPageInkCoverage(await book(3));

  // Two measured pages and a missing third would otherwise pass as a two-page book.
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected ok:false");
  expect(result.error).toBe("Ghostscript rendered 2 of 3 pages: **** Error: Page 3 could not be drawn");
});

test("getPerPageInkCoverage returns ok:false for a file that is not a PDF", async () => {
  resolveWindowsGhostscript();
  const exec = ghostscriptWrites([pam()]);
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-tac-test-"));
  dirs.push(dir);
  const notPdf = join(dir, "book.pdf");
  await writeFile(notPdf, "not a pdf");

  const result = await getPerPageInkCoverage(notPdf);

  expect(result.ok).toBe(false);
  expect(exec).not.toHaveBeenCalled();
});

test("hasOutputIntent tells a PDF/X file (an OutputIntents entry) from a plain one", async () => {
  expect(await hasOutputIntent(await book(1))).toBe(true);
  expect(await hasOutputIntent(await book(1, false))).toBe(false);
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-tac-test-"));
  dirs.push(dir);
  await writeFile(join(dir, "x.pdf"), "not a pdf");
  await expect(hasOutputIntent(join(dir, "x.pdf"))).rejects.toThrow();
});
