import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "pdf-lib";
import bleedCheck from "./bleed";
import { makeCtx } from "../../test-helpers/testkit";
import { resolveConfig } from "../../lib/manifest";

/** A PDF of 621x810pt sheets whose TrimBoxes are `trims` (one per page, [x, y, w, h]). */
async function checkPages(trims: Array<[number, number, number, number] | null>) {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-bleed-"));
  try {
    const doc = await PDFDocument.create();
    for (const trim of trims) {
      const page = doc.addPage([621, 810]);
      if (trim) page.setTrimBox(...trim);
    }
    const pdfPath = join(dir, "book.pdf");
    // Object streams, as the plain PDF is saved: the boxes must still be found.
    await writeFile(pdfPath, await doc.save({ useObjectStreams: true }));
    return await bleedCheck.run(makeCtx({ pdfPath, config: resolveConfig({}, { preset: "dtrpg" }) }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
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
