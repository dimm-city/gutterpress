import { expect, test } from "bun:test";
import { PDFArray, PDFDocument, PDFName, PDFNumber } from "pdf-lib";
import { postprocess } from "./postprocess.ts";
import type { PageTrim } from "./tier2.ts";
import type { LastPageMode } from "../shared/synthesis.ts";

const geometry: PageTrim = {
  trim: { width: 612, height: 792 },
  media: { width: 612, height: 792 },
  bleed: 0,
  slug: 0,
  marks: [],
};

/** Build a PDF whose pages each carry a content stream (a drawn rectangle). */
async function contentPdf(pages: number): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  for (let i = 0; i < pages; i++) {
    const p = doc.addPage([612, 792]);
    p.drawRectangle({ x: 10, y: 10, width: 100, height: 100 });
  }
  return doc.save();
}

async function hasContent(bytes: Uint8Array, index: number): Promise<boolean> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPage(index).node.Contents() !== undefined;
}

async function run(pages: number, extra: { signature?: number; lastPage?: LastPageMode }) {
  const r = await postprocess(await contentPdf(pages), { geometry, ...extra });
  return r;
}

test("lastPage blank: content already a signature multiple gets a full signature of blanks", async () => {
  const r = await run(228, { signature: 4, lastPage: "blank" });
  expect(r.pageCount).toBe(232);
  expect(r.padded).toBe(4);
  expect(await hasContent(r.bytes, 227)).toBe(true);
  for (let i = 228; i < 232; i++) expect(await hasContent(r.bytes, i)).toBe(false);
});

test("lastPage blank: normal padding already ends on a blank page", async () => {
  const r = await run(229, { signature: 4, lastPage: "blank" });
  expect(r.pageCount).toBe(232);
  expect(r.padded).toBe(3);
  expect(await hasContent(r.bytes, 228)).toBe(true);
  expect(await hasContent(r.bytes, 231)).toBe(false);
});

test("no lastPage: an already-aligned book is unchanged", async () => {
  const r = await run(228, { signature: 4 });
  expect(r.pageCount).toBe(228);
  expect(r.padded).toBe(0);
  expect(await hasContent(r.bytes, 227)).toBe(true);
});

test("lastPage blank with signature 1 appends exactly one blank page", async () => {
  const r = await run(10, { signature: 1, lastPage: "blank" });
  expect(r.pageCount).toBe(11);
  expect(await hasContent(r.bytes, 9)).toBe(true);
  expect(await hasContent(r.bytes, 10)).toBe(false);
});

test("lastPage short-by-one: stops one page short of a multiple, so the printer adds the last page", async () => {
  const r = await run(228, { signature: 4, lastPage: "short-by-one" });
  expect(r.pageCount).toBe(231);
  expect(r.padded).toBe(3);
  expect(await hasContent(r.bytes, 227)).toBe(true);
  expect(await hasContent(r.bytes, 230)).toBe(false);
});

test("lastPage short-by-one: a book already k × signature − 1 long is unchanged", async () => {
  const r = await run(231, { signature: 4, lastPage: "short-by-one" });
  expect(r.pageCount).toBe(231);
  expect(r.padded).toBe(0);
  expect(await hasContent(r.bytes, 230)).toBe(true);
});

/** Page `index`'s box, as [x0, y0, x1, y1]. */
async function boxOf(bytes: Uint8Array, index: number, name: string): Promise<number[]> {
  const doc = await PDFDocument.load(bytes);
  const box = doc.getPage(index).node.lookup(PDFName.of(name), PDFArray);
  return box.asArray().map((n) => (n as PDFNumber).asNumber());
}

test("printBleed: the TrimBox leaves the binding edge alone and mirrors by page parity; BleedBox is the sheet", async () => {
  // dtrpg: an 8.625 x 11.25in sheet with 9pt of bleed on the top, bottom and outer edge.
  const sheet: PageTrim = { ...geometry, trim: { width: 621, height: 810 }, media: { width: 621, height: 810 } };
  const r = await postprocess(await contentPdf(3), { geometry: sheet, printBleed: 9 });
  // Page 1 is a recto: the binding is its left edge.
  expect(await boxOf(r.bytes, 0, "TrimBox")).toEqual([0, 9, 612, 801]);
  expect(await boxOf(r.bytes, 1, "TrimBox")).toEqual([9, 9, 621, 801]);
  expect(await boxOf(r.bytes, 2, "TrimBox")).toEqual([0, 9, 612, 801]);
  for (const i of [0, 1, 2]) expect(await boxOf(r.bytes, i, "BleedBox")).toEqual([0, 0, 621, 810]);
  expect(r.boxes.trim).toEqual([0, 9, 612, 801]);
});

test("no bleed anywhere: the TrimBox is the sheet", async () => {
  const r = await postprocess(await contentPdf(1), { geometry, printBleed: 0 });
  expect(await boxOf(r.bytes, 0, "TrimBox")).toEqual([0, 0, 612, 792]);
});

test("a CSS @page bleed wins over printBleed: symmetric trim inside the grown sheet", async () => {
  const grown: PageTrim = { trim: { width: 612, height: 792 }, media: { width: 630, height: 810 }, bleed: 9, slug: 0, marks: [] };
  const r = await postprocess(await contentPdf(2), { geometry: grown, printBleed: 9 });
  for (const i of [0, 1]) expect(await boxOf(r.bytes, i, "TrimBox")).toEqual([9, 9, 621, 801]);
});
