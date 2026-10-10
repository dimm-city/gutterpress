/**
 * `pdf.print.black-text` and `pdf.print.signature` (#336): the preflight twins
 * of the K-only text rewrite (#331) and the signature/last-page padding (#332).
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

describe("pdf.print.black-text", () => {
  const check = getCheckById("pdf.print.black-text")!;
  const RICH = "0.722 0.675 0.671 0.882 k";
  const text = (colour: string, size: number) => `${colour} BT /F1 ${size} Tf 10 10 Td <01> Tj ET`;

  test("fails on small four-colour black text, naming the pages", async () => {
    const pdf = await pdfOf([text("0 g", 12), text(RICH, 12), text(RICH, 9)]);
    const results = await check.run(ctxFor(pdf));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      severity: "error",
      code: "rich-black-text",
      data: { runs: 2, pages: [2, 3] },
    });
    expect(results[0]!.message).toContain("2, 3");
  });

  test("passes K-only text, and rich text above 24pt", async () => {
    const pdf = await pdfOf([text("0 0 0 1 k", 12), text("0 g", 12), text(RICH, 40), text(RICH, 24.5)]);
    expect(await check.run(ctxFor(pdf))).toEqual([]);
  });

  test("is enabled for k-only builds (the dtrpg default) and not for icc", () => {
    expect(isCheckEnabled(check, resolveConfig({}, { preset: "dtrpg" }))).toBe(true);
    expect(isCheckEnabled(check, resolveConfig({}, { preset: "book" }))).toBe(false);
    expect(isCheckEnabled(check, resolveConfig({}, { preset: "dtrpg", pdfx: { blackText: "icc" } }))).toBe(false);
  });

  test("an unreadable PDF is an inspection warning, not a pass", async () => {
    const bad = join(dir, "bad.pdf");
    await writeFile(bad, "not a pdf");
    const [r] = await check.run(ctxFor(bad));
    expect(r).toMatchObject({ severity: "warning", code: "inspect-failed" });
  });
});

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
