import { expect, test } from "bun:test";
import { PDFDict, PDFDocument, PDFName, PDFRawStream, PDFString, type PDFRef } from "pdf-lib";

import { shrinkForScreen } from "./screen-pdf.ts";

/** A one-page book drawing three pictures, one of them twice. */
async function book(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.catalog.set(PDFName.of("Lang"), PDFString.of("en"));
  const page = doc.addPage([612, 792]);
  const ctx = doc.context;
  const image = (w: number, h: number, n: 1 | 3, extra: Record<string, unknown> = {}): PDFRef => {
    const px = new Uint8Array(w * h * n);
    for (let i = 0; i < px.length; i++) px[i] = (i * 7) % 251;
    return ctx.register(
      ctx.flateStream(px, {
        Type: "XObject",
        Subtype: "Image",
        Width: w,
        Height: h,
        ColorSpace: n === 3 ? "DeviceRGB" : "DeviceGray",
        BitsPerComponent: 8,
        ...extra,
      }),
    );
  };
  const mask = image(1000, 500, 1);
  const art = page.node.newXObject("Art", image(1000, 500, 3, { SMask: mask })).decodeText();
  const small = page.node.newXObject("Small", image(100, 50, 3)).decodeText();
  const gray = page.node.newXObject("Gray", image(1000, 1000, 1)).decodeText();
  // Art at 1in and 2in wide; Small at 1in (100 ppi); Gray at 1in.
  const content = [
    `q 72 0 0 36 0 0 cm /${art} Do Q`,
    `q 144 0 0 72 100 100 cm /${art} Do Q`,
    `q 72 0 0 36 300 300 cm /${small} Do Q`,
    `q 72 0 0 72 400 400 cm /${gray} Do Q`,
  ].join("\n");
  page.node.set(PDFName.of("Contents"), ctx.register(ctx.flateStream(content)));
  return doc.save();
}

test("pictures are kept at 200 ppi of the largest size they are drawn at, as JPEG where they are colour", async () => {
  const before = await book();
  const after = await shrinkForScreen(before);
  const doc = await PDFDocument.load(after);
  const xo = doc.getPage(0).node.Resources()!.lookupMaybe(PDFName.of("XObject"), PDFDict)!;
  const img = (name: string) =>
    doc.context.lookup(xo.entries().find(([k]) => k.decodeText().startsWith(name))![1]) as PDFRawStream;
  const facts = (s: PDFRawStream) => [
    String(s.dict.get(PDFName.of("Filter"))),
    Number(String(s.dict.get(PDFName.of("Width")))),
    Number(String(s.dict.get(PDFName.of("Height")))),
  ];

  // Drawn 2in wide at most: 400 x 200 px; its soft mask follows it.
  expect(facts(img("Art"))).toEqual(["/DCTDecode", 400, 200]);
  expect(facts(doc.context.lookup(img("Art").dict.get(PDFName.of("SMask"))) as PDFRawStream)).toEqual(["/FlateDecode", 400, 200]);
  // Already below 200 ppi: no pixels are taken away.
  expect(facts(img("Small"))).toEqual(["/DCTDecode", 100, 50]);
  // A grey picture stays lossless (a JPEG would carry three channels).
  expect(facts(img("Gray"))).toEqual(["/FlateDecode", 200, 200]);
  // Nothing but the pictures changes.
  expect(String(doc.catalog.get(PDFName.of("Lang")))).toBe("(en)");
});
