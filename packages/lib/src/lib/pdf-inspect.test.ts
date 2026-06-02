/**
 * Integration tests for the in-process PDF reader (unpdf/PDF.js) against a real
 * Chromium-generated PDF fixture. These exercise the pure-JS replacements for
 * Poppler + general qpdf inspection (Phase 2 of ADR 0002).
 *
 * The document is loaded once and shared via pdf-inspect's internal cache, so
 * the expensive operator-list pass is paid a single time across all assertions.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  loadPdf,
  getPageSize,
  getOutlineCount,
  getOpPass,
  isLoadable,
} from "./pdf-inspect";
import type { PDFDocumentProxy } from "unpdf/pdfjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE = join(HERE, "../../../cli/tests/field-guide.pdf");

describe("pdf-inspect (real PDF fixture)", () => {
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
