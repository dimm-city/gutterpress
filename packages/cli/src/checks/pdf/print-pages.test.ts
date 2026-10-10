/**
 * `pdf.print.signature` (#336): the preflight twin of the signature/last-page
 * padding (#332).
 * Real small PDFs, no mocks — the checks read them with the production readers.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import { resolveConfig } from "../../lib/manifest";
import { getCheckById } from "../registry";
import { isCheckEnabled } from "../policy";
import type { CheckContext } from "../types";
import "./index";

const dir = await mkdtemp(join(tmpdir(), "gutterpress-printpages-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

let n = 0;
/** One page per entry: a content stream, or null for a page with no content at all. */
async function pdfOf(pages: (string | null)[]): Promise<string> {
  const doc = await PDFDocument.create();
  for (const content of pages) {
    const page = doc.addPage([100, 100]);
    if (content !== null) {
      page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(content)));
    }
  }
  const file = join(dir, `t${n++}.pdf`);
  await writeFile(file, await doc.save());
  return file;
}

const ctxFor = (pdfPath: string, manifest: Parameters<typeof resolveConfig>[1] = { preset: "dtrpg" }): CheckContext => ({
  config: resolveConfig({}, manifest),
  inputDir: dir,
  outputDir: dir,
  pdfPath,
});

const INK = "0 0 10 10 re f";

describe("pdf.print.signature", () => {
  const check = getCheckById("pdf.print.signature")!;
  const pages = (count: number, blankLast: boolean) =>
    Array.from({ length: count }, (_, i) => (blankLast && i === count - 1 ? null : INK));

  test("passes k × signature − 1 pages, even when the last page has content", async () => {
    expect(await check.run(ctxFor(await pdfOf(pages(11, false))))).toEqual([]);
  });

  test("passes a multiple of the signature that ends on a page with no marks", async () => {
    expect(await check.run(ctxFor(await pdfOf(pages(12, true))))).toEqual([]);
    // content that paints nothing (a clip and state only) is still no marks
    const clipOnly = [INK, INK, INK, "q 0 0 50 50 re W n Q 1 0 0 1 5 5 cm"];
    expect(await check.run(ctxFor(await pdfOf(clipOnly)))).toEqual([]);
  });

  test("fails a page count that is neither", async () => {
    const [r] = await check.run(ctxFor(await pdfOf(pages(10, true))));
    expect(r).toMatchObject({ severity: "error", code: "signature-page-count", data: { pages: 10, signature: 4 } });
  });

  test("fails a full multiple whose last page has content", async () => {
    const [r] = await check.run(ctxFor(await pdfOf(pages(12, false))));
    expect(r).toMatchObject({ severity: "error", code: "signature-last-page", data: { pages: 12, signature: 4 } });
  });

  test("a book that did not reserve the last page only needs the page count", async () => {
    const config = { preset: "dtrpg", print: { reserveLastPage: false } } as const;
    expect(await check.run(ctxFor(await pdfOf(pages(12, false)), config))).toEqual([]);
    const [r] = await check.run(ctxFor(await pdfOf(pages(10, false)), config));
    expect(r?.code).toBe("signature-page-count");
  });

  test("follows the configured signature", async () => {
    const six = { preset: "dtrpg", print: { signature: 6 } } as const;
    expect(await check.run(ctxFor(await pdfOf(pages(10, false)), six))).toHaveLength(1); // 10 ≠ 6k, 6k − 1
    expect(await check.run(ctxFor(await pdfOf(pages(11, false)), six))).toEqual([]); // 12 − 1
  });

  test("is enabled only when there is a signature to honour", () => {
    expect(isCheckEnabled(check, resolveConfig({}, { preset: "dtrpg" }))).toBe(true);
    expect(isCheckEnabled(check, resolveConfig({}, { preset: "book" }))).toBe(false);
  });
});
