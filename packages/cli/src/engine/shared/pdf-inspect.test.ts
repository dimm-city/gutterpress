/**
 * `printScale` reads the scale Chromium printed the page area at off the
 * content streams (#470). The streams below are the operator skeletons of
 * real Chromium prints — matrices, clips and group nesting kept, drawing
 * removed — so the reader is pinned without a browser.
 */
import { describe, expect, test } from "bun:test";
import { PDFDocument, PDFName } from "pdf-lib";
import { printScale } from "./pdf-inspect.ts";

async function pdf(...pages: string[]): Promise<PDFDocument> {
  const doc = await PDFDocument.create();
  for (const content of pages) {
    const page = doc.addPage([612, 792]);
    page.node.set(PDFName.of("Contents"), doc.context.register(doc.context.flateStream(content)));
  }
  return doc;
}

/** A page area: clipped to its content box, then drawn under `s 0 0 s`. */
const area = (s: string, x = 300, y = 300) =>
  `q\n${x} ${y} 1950 2700 re\nW* n\nq\n${s} 0 0 ${s} ${x} ${y} cm\nBT\nET\nQ\nQ\n`;
const PROLOGUE = ".23999999 0 0 -.23999999 0 792 cm\n";
/** The page box — background and margin boxes — drawn first, never shrunk. */
const PAGE_BOX = "q\n3.125 0 0 3.125 0 0 cm\n0 0 816 1056 re\nf\nQ\n";

describe("printScale", () => {
  test("an unshrunk print reads 1", async () => {
    expect(printScale(await pdf(PROLOGUE + area("3.125")))).toBe(1);
  });

  test("a shrunk print reads the page area's scale, not the page box's", async () => {
    // examples/academic-paper before #470: a 624px column laid out 624.031px wide.
    const doc = await pdf(PROLOGUE + PAGE_BOX + area("3.1248436"));
    expect(printScale(doc)).toBeCloseTo(624 / 624.03125, 6);
  });

  test("a zero-margin page reads its page area at the sheet's origin", async () => {
    const doc = await pdf(PROLOGUE + PAGE_BOX + area("3.1248491", 0, 0));
    expect(printScale(doc)).toBeCloseTo(648 / 648.03125, 6);
  });

  test("an element's own clip and transform drawn first do not count", async () => {
    // docs/fixtures/gp-image-positioning p4: an image scaled 1.8x inside its
    // own clip comes before the page area; an image's flipped matrix after it.
    const page =
      PROLOGUE +
      PAGE_BOX +
      "q\n225 225 675 900 re\nW* n\nq\n5.625 0 0 5.625 225 225 cm\nQ\nQ\n" +
      "q\n300 300 1950 2700 re\nW* n\nq\n406.25 0 0 -540.625 1168.75 1246.875 cm\n/X5 Do\nQ\n" +
      "q\n3.125 0 0 3.125 300 -6525 cm\nQ\nQ\n";
    expect(printScale(await pdf(page))).toBe(1);
  });

  test("one page read wrong is outvoted by the others", async () => {
    // A uniformly scaled drawing at the column's left edge, first on its page.
    const scaledFirst =
      PROLOGUE + "q\n300 300 1950 2700 re\nW* n\nq\n1.5625 0 0 1.5625 300 300 cm\nQ\nQ\n";
    const doc = await pdf(scaledFirst, PROLOGUE + area("3.125"), PROLOGUE + area("3.125"));
    expect(printScale(doc)).toBe(1);
  });

  test("a print with no page area clip makes no claim", async () => {
    expect(printScale(await pdf(PROLOGUE + PAGE_BOX))).toBeNull();
    expect(printScale(await pdf("q\n1 0 0 1 0 0 cm\nQ\n"))).toBeNull();
  });
});
