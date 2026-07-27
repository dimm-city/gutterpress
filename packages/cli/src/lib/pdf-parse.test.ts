/**
 * Unit tests for pdf-parse.ts's Ghostscript-backed ink coverage reader
 * (finding #51): `getPerPageInkCoverage` must return a discriminated result
 * (`{ ok: true, pages }` | `{ ok: false, error }`) instead of swallowing every
 * gs failure (crash, corrupt PDF, missing binary) into an indistinguishable
 * empty array — which previously made the ink-coverage check silently PASS a
 * book that was never actually measured.
 *
 * `./exec`'s `execCapture` is spied on (not `mock.module`-replaced) so this
 * never spawns a real `gs` process, and the spy is restored in `afterEach` so
 * it never leaks into other test files sharing this bun test run.
 */
import { test, expect, spyOn, afterEach } from "bun:test";
import * as execMod from "./exec.ts";
import * as ghostscriptMod from "./ghostscript.ts";
import { getPerPageInkCoverage, parseInkCov } from "./pdf-parse.ts";

afterEach(() => {
  (execMod.execCapture as unknown as { mockRestore?: () => void }).mockRestore?.();
  (ghostscriptMod.resolveGhostscript as unknown as { mockRestore?: () => void }).mockRestore?.();
});

function resolveWindowsGhostscript(): void {
  spyOn(ghostscriptMod, "resolveGhostscript").mockResolvedValue(
    "C:\\Program Files\\gs\\gs10.06.0\\bin\\gswin64c.exe"
  );
}

const SAMPLE_INKCOV_OUTPUT =
  "   0.10000   0.20000   0.30000   0.05000 CMYK OK\n" +
  "   0.50000   0.60000   0.70000   0.80000 CMYK OK\n";

test("parseInkCov extracts CMYK + sum per page from raw gs inkcov output", () => {
  const pages = parseInkCov(SAMPLE_INKCOV_OUTPUT);
  expect(pages).toHaveLength(2);
  expect(pages[0]!.c).toBeCloseTo(0.1);
  expect(pages[0]!.m).toBeCloseTo(0.2);
  expect(pages[0]!.y).toBeCloseTo(0.3);
  expect(pages[0]!.k).toBeCloseTo(0.05);
  expect(pages[0]!.sum).toBeCloseTo(0.65);
  expect(pages[1]!.c).toBeCloseTo(0.5);
  expect(pages[1]!.sum).toBeCloseTo(2.6);
});

test("getPerPageInkCoverage returns ok:true with percentage-scaled pages on success", async () => {
  resolveWindowsGhostscript();
  const exec = spyOn(execMod, "execCapture").mockImplementation(async () => ({
    stdout: SAMPLE_INKCOV_OUTPUT,
    stderr: "",
  }));

  const result = await getPerPageInkCoverage("/fake/book.pdf");

  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("expected ok:true");
  expect(result.pages).toHaveLength(2);
  expect(result.pages[0]).toMatchObject({ page: 1, c: 10, m: 20, y: 30, k: 5 });
  expect(result.pages[0]!.tac).toBeCloseTo(65);
  expect(result.pages[1]).toMatchObject({ page: 2, c: 50, m: 60, y: 70, k: 80 });
  expect(result.pages[1]!.tac).toBeCloseTo(260);
  expect(exec.mock.calls[0]?.[0]).toBe(
    "C:\\Program Files\\gs\\gs10.06.0\\bin\\gswin64c.exe"
  );
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
    throw new Error("gs -sDEVICE=inkcov ... exited 1");
  });

  const result = await getPerPageInkCoverage("/fake/corrupt.pdf");

  // The old behavior returned [] here — indistinguishable from a
  // legitimately empty (0-page) PDF. That silent pass is exactly what
  // finding #51 flags: this MUST be a distinguishable failure, not a
  // same-shape empty success.
  expect(result).not.toEqual({ ok: true, pages: [] });
  expect(result.ok).toBe(false);
});
