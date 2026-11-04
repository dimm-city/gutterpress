import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFName } from "pdf-lib";
import bleedCheck from "./bleed";
import { makeCtx } from "../../test-helpers/testkit";
import { resolveConfig } from "../../lib/manifest";

/** Run the check (dtrpg config) on a PDF built by `build`. */
async function checkDoc(build: (doc: PDFDocument) => void) {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-bleed-"));
  try {
    const doc = await PDFDocument.create();
    build(doc);
    const pdfPath = join(dir, "book.pdf");
    // Object streams, as the plain PDF is saved: the boxes must still be found.
    await writeFile(pdfPath, await doc.save({ useObjectStreams: true }));
    return await bleedCheck.run(makeCtx({ pdfPath, config: resolveConfig({}, { preset: "dtrpg" }) }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** A PDF of 621x810pt sheets whose TrimBoxes are `trims` (one per page, [x, y, w, h]). */
function checkPages(trims: Array<[number, number, number, number] | null>) {
  return checkDoc((doc) => {
    for (const trim of trims) {
      const page = doc.addPage([621, 810]);
      if (trim) page.setTrimBox(...trim);
    }
  });
}

const RECTO: [number, number, number, number] = [0, 9, 612, 792];
const VERSO: [number, number, number, number] = [9, 9, 612, 792];

test("a dtrpg sheet with bleed on the top, bottom and outside edge passes, mirrored per page", async () => {
  expect(await checkPages([RECTO, VERSO, RECTO])).toEqual([]);
});

test("a TrimBox that is the whole sheet has no bleed", async () => {
  const [r] = await checkPages([[0, 0, 621, 810], [0, 0, 621, 810]]);
  expect(r?.severity).toBe("warning");
  expect(r?.message).toBe(
    "Bleed area appears insufficient on 2 page(s) (1, 2). Expected at least 9pt on the top, bottom and outside edge."
  );
});

test("a verso trimmed like a recto has its bleed at the binding edge", async () => {
  const [r] = await checkPages([RECTO, RECTO]);
  expect(r?.message).toContain("on 1 page(s) (2)");
});

test("a sheet with bleed on every side (CSS @page bleed) passes", async () => {
  expect(await checkPages([[9, 9, 603, 792], [9, 9, 603, 792]])).toEqual([]);
});

test("no TrimBox at all cannot be verified", async () => {
  const [r] = await checkPages([null]);
  expect(r?.message).toBe("No TrimBox or BleedBox found. Bleed area cannot be verified.");
});

test("a page with no TrimBox among pages with one is short, and said to be undeclared", async () => {
  const [r] = await checkPages([RECTO, null, RECTO]);
  expect(r?.message).toBe(
    "Bleed area appears insufficient on 1 page(s) (2). Expected at least 9pt on the top, bottom and outside edge. 1 of them declare no TrimBox."
  );
});

test("the bleed is allowed the page-size tolerance (0.5pt), no more", async () => {
  expect(await checkPages([[0, 8.6, 612.4, 792.8]])).toEqual([]);
  expect((await checkPages([[0, 8.4, 612.6, 793.2]]))[0]?.message).toContain("on 1 page(s) (1)");
});

test("the bleed is measured to the BleedBox, not through the slug to the sheet", async () => {
  // A 657 x 846 sheet with an 18pt slug for the marks: BleedBox is the sheet
  // less the slug. A trim 9pt inside the BleedBox on three edges passes; a trim
  // that is the BleedBox has no bleed, although the sheet is 18pt beyond it.
  const slugged = (trim: [number, number, number, number]) =>
    checkDoc((doc) => {
      const page = doc.addPage([657, 846]);
      page.setBleedBox(18, 18, 621, 810);
      page.setTrimBox(...trim);
    });
  expect(await slugged([18, 27, 612, 792])).toEqual([]);
  expect((await slugged([18, 18, 621, 810]))[0]?.message).toContain("on 1 page(s) (1)");
});

test("a MediaBox inherited from the page tree and an indirect TrimBox are read", async () => {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-bleed-"));
  try {
    const doc = await PDFDocument.create();
    const page = doc.addPage([621, 810]);
    page.node.delete(PDFName.of("MediaBox"));
    doc.catalog.Pages().set(PDFName.of("MediaBox"), doc.context.obj([0, 0, 621, 810]));
    page.node.set(PDFName.of("TrimBox"), doc.context.register(doc.context.obj([0, 9, 612, 801])));
    const pdfPath = join(dir, "book.pdf");
    await writeFile(pdfPath, await doc.save({ useObjectStreams: true }));
    // The saved leaf carries neither box directly.
    const saved = (await PDFDocument.load(await Bun.file(pdfPath).bytes())).getPage(0).node;
    expect(saved.get(PDFName.of("MediaBox"))).toBeUndefined();
    expect(saved.get(PDFName.of("TrimBox"))).toBeInstanceOf(Object);
    expect(saved.get(PDFName.of("TrimBox"))?.constructor.name).toBe("PDFRef");

    expect(
      await bleedCheck.run(makeCtx({ pdfPath, config: resolveConfig({}, { preset: "dtrpg" }) }))
    ).toEqual([]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
