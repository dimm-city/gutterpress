import { expect, test } from "bun:test";
import { PDFDocument } from "pdf-lib";
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
