/**
 * Integration tests for the in-process PDF reader (unpdf/PDF.js) against a real
 * Chromium-generated PDF fixture. These exercise the pure-JS replacements for
 * Poppler + general qpdf inspection (Phase 2 of ADR 0002).
 *
 * The document is loaded once and shared via pdf-inspect's internal cache, so
 * the expensive operator-list pass is paid a single time across all assertions.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { existsSync } from "node:fs";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPdf,
  clearPdfCache,
  pendingGraceDestroyCount,
  getPageSize,
  getOutlineCount,
  getOpPass,
  isLoadable,
} from "./pdf-inspect";
import type { PDFDocumentProxy } from "unpdf/pdfjs";

const HERE = dirname(fileURLToPath(import.meta.url));
// Large (135 MB), Chromium-generated, and gitignored — present on dev machines,
// absent in CI. The rich integration suite below runs only when it exists; the
// synthetic pdf-lib suite further down always runs (CI baseline coverage).
const FIXTURE = join(HERE, "../../../cli/tests/field-guide.pdf");
const HAS_FIXTURE = existsSync(FIXTURE);

if (!HAS_FIXTURE) {
  console.warn(
    `[pdf-inspect.test] fixture not found (${FIXTURE}); skipping real-PDF suite`
  );
}

describe.skipIf(!HAS_FIXTURE)("pdf-inspect (real PDF fixture)", () => {
  let doc: PDFDocumentProxy;

  beforeAll(async () => {
    doc = (await loadPdf(FIXTURE))!;
    // Warm the operator-list pass (≈6s on this 330-page fixture) once so the
    // individual assertions below stay well under bun's default test timeout.
    await getOpPass(doc);
  }, 60_000);

  test("loads the document and reports page count", () => {
    expect(doc).toBeTruthy();
    expect(doc.numPages).toBe(330);
  });

  test("loadPdf returns the same cached instance for the same path", async () => {
    const again = await loadPdf(FIXTURE);
    expect(again).toBe(doc);
  });

  test("loadPdf returns null for a missing file", async () => {
    expect(await loadPdf(join(HERE, "does-not-exist.pdf"))).toBeNull();
  });

  test("page size is reported in points (US Letter)", async () => {
    const page = await doc.getPage(1);
    const { w, h } = getPageSize(page);
    expect(Math.round(w)).toBe(612);
    expect(Math.round(h)).toBe(792);
  });

  test("reads the outline (bookmark) tree", async () => {
    expect(await getOutlineCount(doc)).toBeGreaterThan(0);
  });

  test("enumerates fonts and detects them as embedded (Chromium output)", async () => {
    const { fonts } = await getOpPass(doc);
    expect(fonts.length).toBeGreaterThan(0);
    // Chromium subsets + embeds every font.
    expect(fonts.every((f) => f.embedded)).toBe(true);
  });

  test("builds a per-page image inventory with placed sizes", async () => {
    const { imagesByPage } = await getOpPass(doc);
    expect(imagesByPage.size).toBeGreaterThan(0);
    for (const imgs of imagesByPage.values()) {
      for (const img of imgs) {
        expect(img.placedW).toBeGreaterThan(0);
        expect(img.placedH).toBeGreaterThan(0);
      }
    }
  });

  test("structural parse gate passes for a valid PDF", async () => {
    expect(await isLoadable(doc)).toBe(true);
  });
});

// Synthetic PDF generated in-test with pdf-lib (a runtime dep) — no large
// fixture or external tools needed, so this runs everywhere including CI.
// Covers the loader, page-size, structural gate, and the no-outline path.
describe("pdf-inspect (synthetic pdf-lib document)", () => {
  let dir: string;
  let pdfPath: string;

  beforeAll(async () => {
    const { PDFDocument } = await import("pdf-lib");
    const docu = await PDFDocument.create();
    docu.addPage([612, 792]); // US Letter, points
    docu.addPage([612, 792]);
    const bytes = await docu.save();
    dir = await mkdtemp(join(tmpdir(), "print-md-pdfinspect-"));
    pdfPath = join(dir, "synthetic.pdf");
    await writeFile(pdfPath, bytes);
  });

  test("loads and reports page count", async () => {
    const doc = await loadPdf(pdfPath);
    expect(doc).toBeTruthy();
    expect(doc!.numPages).toBe(2);
  });

  test("reports page size in points", async () => {
    const doc = (await loadPdf(pdfPath))!;
    const { w, h } = getPageSize(await doc.getPage(1));
    expect(Math.round(w)).toBe(612);
    expect(Math.round(h)).toBe(792);
  });

  test("no outline → count 0; structural gate passes", async () => {
    const doc = (await loadPdf(pdfPath))!;
    expect(await getOutlineCount(doc)).toBe(0);
    expect(await isLoadable(doc)).toBe(true);
  });

  test("loadPdf returns null for a missing file", async () => {
    expect(await loadPdf(join(dir, "nope.pdf"))).toBeNull();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });
});

// Cache-bounding behavior: LRU eviction defers destruction by a grace period
// (so a mid-check reader isn't killed), but clearPdfCache — the run-boundary
// reclaim — must destroy grace-held evicted documents immediately, not leave
// them (and their timers) alive for up to a minute.
describe("pdf-inspect cache eviction + clearPdfCache", () => {
  let dir: string;
  const paths: string[] = [];

  beforeAll(async () => {
    const { PDFDocument } = await import("pdf-lib");
    const docu = await PDFDocument.create();
    docu.addPage([612, 792]);
    const bytes = await docu.save();
    dir = await mkdtemp(join(tmpdir(), "print-md-pdfcache-"));
    // DOC_CACHE_MAX (8) + 1 distinct paths, so loading them all evicts one.
    for (let i = 0; i < 9; i++) {
      const p = join(dir, `doc-${i}.pdf`);
      await writeFile(p, bytes);
      paths.push(p);
    }
  });

  afterAll(async () => {
    clearPdfCache();
    await rm(dir, { recursive: true, force: true });
  });

  test("clearPdfCache destroys grace-held evicted documents immediately", async () => {
    clearPdfCache(); // isolate from documents cached by earlier suites
    const first = (await loadPdf(paths[0]!))!;
    let destroyed = false;
    const origDestroy = first.destroy.bind(first);
    first.destroy = () => {
      destroyed = true;
      return origDestroy();
    };

    // Load the remaining 8 distinct paths → paths[0] becomes the LRU evictee.
    for (let i = 1; i < paths.length; i++) {
      expect(await loadPdf(paths[i]!)).toBeTruthy();
    }
    await new Promise((r) => setTimeout(r, 20));
    // Eviction alone must NOT destroy it yet — the grace period protects a
    // reader that obtained the proxy just before the eviction.
    expect(destroyed).toBe(false);
    expect(pendingGraceDestroyCount()).toBe(1);

    // The run-boundary reclaim must cancel the grace timer and destroy the
    // evicted document too, not only the 8 still in the cache map.
    clearPdfCache();
    await new Promise((r) => setTimeout(r, 20));
    expect(destroyed).toBe(true);
    expect(pendingGraceDestroyCount()).toBe(0); // no live timers left behind
  });
});
