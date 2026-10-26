/**
 * `pdf.print.safe-margins`: text stays `page.safe` inside the trim and an
 * image `page.artSafe` (`page.gutter` at the binding, for both), where the
 * trim is the sheet less the bleed on the top, bottom and OUTSIDE edges, and
 * the outside edge is the right on a recto and the left on a verso. Real small
 * PDFs drawn at known positions, read by the production reader, no mocks.
 *
 * A dtrpg sheet is 621 x 810pt with 9pt of bleed, so the trim is
 *   recto (odd pages):  x 0..612, y 9..801   binding left, outside right
 *   verso (even pages): x 9..621, y 9..801   outside left, binding right
 * and the 36pt text limit sits 36pt inside that; the 18pt art limit 18pt
 * inside it on the top, bottom and outside edges and 36pt at the binding.
 * Text is Courier at 10pt, so "Text" is exactly 24pt wide and its glyph box
 * runs from 2pt below the baseline to 8pt above it. An image is a 1 x 1 PNG
 * drawn at the size given.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, StandardFonts, degrees } from "pdf-lib";
import { resolveConfig } from "../../lib/manifest";
import { getCheckById } from "../registry";
import type { CheckContext } from "../types";
import "./index";

const dir = await mkdtemp(join(tmpdir(), "gutterpress-safemargins-"));
afterAll(() => rm(dir, { recursive: true, force: true }));

const check = getCheckById("pdf.print.safe-margins")!;

/** Text placed with its baseline starting at (x, y), in points from the sheet's bottom-left. */
interface Text {
  x: number;
  y: number;
  text?: string;
  rotate?: number;
}
/** An image of w x h placed with its bottom-left corner at (x, y), in points from the sheet's bottom-left. */
interface Image {
  x: number;
  y: number;
  w: number;
  h: number;
}
type Ink = Text | Image;
const isImage = (ink: Ink): ink is Image => "w" in ink;

/** A 1 x 1 PNG: every image is this, stretched. */
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);

let n = 0;
/** One page per entry; a page with no entries has no content. */
async function pdfOf(pages: Ink[][], size: [number, number] = [621, 810]): Promise<string> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Courier);
  const png = await doc.embedPng(PNG);
  for (const inks of pages) {
    const page = doc.addPage(size);
    for (const ink of inks) {
      if (isImage(ink)) {
        page.drawImage(png, { x: ink.x, y: ink.y, width: ink.w, height: ink.h });
      } else {
        const { x, y, text = "Text", rotate = 0 } = ink;
        page.drawText(text, { x, y, size: 10, font, rotate: degrees(rotate) });
      }
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

test("is a post-build PDF check whose description says it judges text and images, not filled backgrounds", () => {
  expect(check).toMatchObject({ name: "Safe margins", category: "pdf", phase: "post-build" });
  expect(check.description).toContain(
    "Text and images: filled backgrounds and borders are judged in the preview's safe-area overlay",
  );
});

describe("what passes", () => {
  test("text exactly on the limit of every edge, on a recto and on a verso", async () => {
    const pdf = await pdfOf([
      [
        { x: 36, y: 400 }, //  left = binding: box left 36, trim 0
        { x: 552, y: 420 }, // right = outside: box right 576, trim 612
        { x: 300, y: 47 }, //  bottom: box bottom 45, trim 9
        { x: 300, y: 757 }, // top: box top 765, trim 801
      ],
      [
        { x: 45, y: 400 }, //  left = outside: box left 45, trim 9
        { x: 561, y: 420 }, // right = binding: box right 585, trim 621
        { x: 300, y: 47 },
        { x: 300, y: 757 },
      ],
    ]);
    expect(await check.run(ctxFor(pdf))).toEqual([]);
  });

  test("blank pages and runs of spaces, however near the edge", async () => {
    const pdf = await pdfOf([[], [{ x: 2, y: 2, text: "   " }]]);
    expect(await check.run(ctxFor(pdf))).toEqual([]);
  });
});

describe("what fails", () => {
  test("text 0.3in from an outside edge and from a binding edge, naming the page, edge and shortfall", async () => {
    const pdf = await pdfOf([
      [{ x: 566.4, y: 400, text: "Edge" }], // recto: right is outside, box right 590.4, trim 612
      [{ x: 575.4, y: 400, text: "Seam" }], // verso: right is binding, box right 599.4, trim 621
    ]);
    const results = await check.run(ctxFor(pdf));
    expect(results.map((r) => r.message)).toEqual([
      'Page 1: "Edge" is 0.2in too close to the outside edge.',
      'Page 2: "Seam" is 0.2in too close to the binding edge.',
    ]);
    expect(results[0]).toMatchObject({
      severity: "error",
      code: "text-outside-safe-margin",
      file: pdf,
      detail: "DriveThruRPG — Quick Specifications for Print Books: text must stay at least 0.5in inside the trim on every edge.",
      data: { page: 1, edge: "outside", shortfallPt: 14.4 },
    });
    expect(results[1]!.data).toEqual({ page: 2, edge: "binding", shortfallPt: 14.4 });
  });

  test("the bleed is on the top, bottom and outside edges only, and the outside edge swaps sides on a verso", async () => {
    const pdf = await pdfOf([
      [
        { x: 40, y: 400 }, // recto left is the binding edge: 40 inside the trim, fine
        { x: 300, y: 42 }, // bottom: box bottom 40, the trim is at 9, so 31 inside it
      ],
      [{ x: 40, y: 400 }], // verso left is the outside edge: box left 40, the trim is at 9, so 31 inside it
    ]);
    const results = await check.run(ctxFor(pdf));
    expect(results.map((r) => r.data)).toEqual([
      { page: 1, edge: "bottom", shortfallPt: 5 },
      { page: 2, edge: "outside", shortfallPt: 5 },
    ]);

    // With no bleed the trim is the sheet, and the same text is 40 and 40 inside it.
    expect(await check.run(ctxFor(pdf, { preset: "dtrpg", page: { bleed: 0 } }))).toEqual([]);
  });

  test("a gutter raises the binding edge's requirement: text 0.6in from the spine passes `safe` and fails `gutter: 54`", async () => {
    const pdf = await pdfOf([
      [{ x: 43.2, y: 400 }], //   recto, binding left: box left 43.2 inside the trim at 0
      [{ x: 553.8, y: 400 }], //  verso, binding right: box right 577.8, 43.2 inside the trim at 621
    ]);
    // 0.6in clears DriveThruRPG's 0.5in on both pages
    expect(await check.run(ctxFor(pdf))).toEqual([]);
    // but not a 0.75in gutter: 0.15in short at the binding, on a recto and on a verso, and the detail says what each edge needs
    const results = await check.run(ctxFor(pdf, { preset: "dtrpg", page: { gutter: 54 } }));
    expect(results.map((r) => r.message)).toEqual([
      'Page 1: "Text" is 0.15in too close to the binding edge.',
      'Page 2: "Text" is 0.15in too close to the binding edge.',
    ]);
    expect(results[0]).toMatchObject({
      detail:
        "DriveThruRPG — Quick Specifications for Print Books: text must stay at least 0.5in inside the trim, 0.75in at the binding.",
      data: { page: 1, edge: "binding", shortfallPt: 10.8 },
    });
    expect(results[1]!.data).toEqual({ page: 2, edge: "binding", shortfallPt: 10.8 });
  });

  test("the gutter is the binding edge's alone: the outside edges keep `safe`, and a smaller gutter lets text nearer the spine", async () => {
    const outside = await pdfOf([
      [{ x: 544.8, y: 400 }], // recto, outside right: box right 568.8, 43.2 inside the trim at 612
      [{ x: 52.2, y: 400 }], //  verso, outside left: box left 52.2, 43.2 inside the trim at 9
    ]);
    expect(await check.run(ctxFor(outside, { preset: "dtrpg", page: { gutter: 54 } }))).toEqual([]);

    const nearSpine = await pdfOf([[{ x: 20, y: 400 }]]); // recto, binding: box left 20 inside the trim at 0
    expect((await check.run(ctxFor(nearSpine))).map((r) => r.data)).toEqual([{ page: 1, edge: "binding", shortfallPt: 16 }]);
    expect(await check.run(ctxFor(nearSpine, { preset: "dtrpg", page: { gutter: 18 } }))).toEqual([]);
  });

  test("rotated text by the box it covers", async () => {
    // Turned 90°, the text runs up the page and its glyph tops point left: the box is x 22..32.
    const pdf = await pdfOf([[{ x: 30, y: 400, rotate: 90 }]]);
    const [r] = await check.run(ctxFor(pdf));
    expect(r!.data).toEqual({ page: 1, edge: "binding", shortfallPt: 14 });
  });

  test("half a point of rounding slack, and no more", async () => {
    // Boxes starting 35.6 and 35.4 inside a recto's binding edge: 0.4 and 0.6 short of 36.
    const pdf = await pdfOf([[{ x: 35.6, y: 400 }, { x: 35.4, y: 420 }]]);
    const results = await check.run(ctxFor(pdf));
    expect(results.map((r) => r.data)).toEqual([{ page: 1, edge: "binding", shortfallPt: 0.6 }]);
  });

  test("quotes the first 40 characters of the text", async () => {
    const pdf = await pdfOf([[{ x: 20, y: 400, text: `${"a".repeat(40)}bcd` }]]);
    const [r] = await check.run(ctxFor(pdf));
    expect(r!.message).toBe(`Page 1: "${"a".repeat(40)}…" is 0.22in too close to the binding edge.`);
  });

  test("cites page.safe when the preset follows no printer's spec", async () => {
    const pdf = await pdfOf([[{ x: 10, y: 300 }]], [432, 648]);
    const [r] = await check.run(ctxFor(pdf, { preset: "book" }));
    expect(r!.detail).toBe("page.safe: text must stay at least 0.25in inside the trim on every edge.");
  });
});

describe("images, by the art rule", () => {
  // A 2 x 3in image is 144 x 216pt. The art line is 18pt inside the trim on the
  // top, bottom and outside edges and 36pt (the text rule) at the binding.
  const image = (x: number, y: number): Image => ({ x, y, w: 144, h: 216 });

  test("0.3in from an outside edge passes, on a recto and on a verso, as does an image exactly on the art line", async () => {
    const pdf = await pdfOf([
      [image(612 - 21.6 - 144, 300)], // recto, outside right: right edge 21.6 inside the trim at 612
      [image(9 + 21.6, 300)], //          verso, outside left: left edge 21.6 inside the trim at 9
      [image(612 - 18 - 144, 801 - 18 - 216)], // recto: on the line at the right and the top
    ]);
    expect(await check.run(ctxFor(pdf))).toEqual([]);
  });

  test("the same 0.3in from the binding edge fails: art takes the text rule's 0.5in there", async () => {
    const pdf = await pdfOf([
      [image(21.6, 300)], //             recto, binding left: left edge 21.6 inside the trim at 0
      [image(621 - 21.6 - 144, 300)], // verso, binding right: right edge 21.6 inside the trim at 621
    ]);
    const results = await check.run(ctxFor(pdf));
    expect(results.map((r) => r.message)).toEqual([
      "Page 1: a 2.0 x 3.0in image is 0.2in too close to the binding edge.",
      "Page 2: a 2.0 x 3.0in image is 0.2in too close to the binding edge.",
    ]);
    expect(results[0]).toMatchObject({
      severity: "error",
      code: "art-outside-safe-margin",
      file: pdf,
      detail:
        "DriveThruRPG — Quick Specifications for Print Books: art that does not bleed must stay at least 0.25in inside the trim, 0.5in at the binding.",
      data: { page: 1, edge: "binding", shortfallPt: 14.4 },
    });
    expect(results[1]!.data).toEqual({ page: 2, edge: "binding", shortfallPt: 14.4 });
  });

  test("an image that stops in the bleed band fails: it crosses the trim without reaching the sheet's edge", async () => {
    const pdf = await pdfOf([
      [image(615 - 144, 300)], //        recto: right edge at 615, past the trim at 612, 6pt short of the sheet at 621
      [image(300, 805 - 216)], //        verso: top edge at 805, past the trim at 801, 5pt short of the sheet at 810
    ]);
    const results = await check.run(ctxFor(pdf));
    expect(results.map((r) => r.message)).toEqual([
      "Page 1: a 2.0 x 3.0in image ends in the bleed band on the outside edge, 0.08in short of the sheet's edge.",
      "Page 2: a 2.0 x 3.0in image ends in the bleed band on the top edge, 0.07in short of the sheet's edge.",
    ]);
    expect(results[0]).toMatchObject({
      severity: "error",
      code: "art-ends-in-bleed-band",
      file: pdf,
      detail:
        "DriveThruRPG — Quick Specifications for Print Books: art either stays 0.25in inside the trim or bleeds, running past it to the sheet's edge; art that stops between the two can leave a white sliver when the page is cut.",
      data: { page: 1, edge: "outside", shortfallPt: 6 },
    });
    expect(results[1]!.data).toEqual({ page: 2, edge: "top", shortfallPt: 5 });
  });

  test("an image that reaches the sheet's edge is a bleed and passes, as does a full-page plate and one flush to the binding", async () => {
    const pdf = await pdfOf([
      [image(621 - 144, 300)], //          recto: right edge on the sheet's edge, 9pt past the trim
      [{ x: 0, y: 0, w: 621, h: 810 }], // verso: edge to edge
      [image(0, 300)], //                  recto: on the binding edge, where nothing is cut
    ]);
    expect(await check.run(ctxFor(pdf))).toEqual([]);
  });

  test("an image inside every line passes", async () => {
    const pdf = await pdfOf([[image(200, 300)], [image(200, 300)]]);
    expect(await check.run(ctxFor(pdf))).toEqual([]);
  });

  test("where no page.artSafe is set, art follows page.safe on every edge, and the detail cites it", async () => {
    // book: a 432 x 648 sheet with no bleed and a 0.25in rule; the image's right edge is 0.2in inside it
    const pdf = await pdfOf([[image(432 - 14.4 - 144, 200)]], [432, 648]);
    const [r] = await check.run(ctxFor(pdf, { preset: "book" }));
    expect(r).toMatchObject({
      message: "Page 1: a 2.0 x 3.0in image is 0.05in too close to the outside edge.",
      detail: "page.safe: art that does not bleed must stay at least 0.25in inside the trim on every edge.",
      data: { page: 1, edge: "outside", shortfallPt: 3.6 },
    });
  });
});

describe("what it skips", () => {
  test("a book with no page.safe, or a zero one", async () => {
    const pdf = await pdfOf([[{ x: 2, y: 2 }]]);
    const noSafe = { preset: "custom", page: { width: 621, height: 810 } } as const;
    expect(await check.run(ctxFor(pdf, noSafe))).toEqual([]);
    expect(await check.run(ctxFor(pdf, { preset: "dtrpg", page: { safe: 0 } }))).toEqual([]);
  });

  test("a run with no PDF", async () => {
    expect(await check.run({ ...ctxFor("unused"), pdfPath: undefined })).toEqual([]);
  });

  test("an unreadable PDF is an inspection warning, not a pass", async () => {
    const bad = join(dir, "bad.pdf");
    await writeFile(bad, "not a pdf");
    const [r] = await check.run(ctxFor(bad));
    expect(r).toMatchObject({ severity: "warning", code: "inspect-failed" });
  });
});
