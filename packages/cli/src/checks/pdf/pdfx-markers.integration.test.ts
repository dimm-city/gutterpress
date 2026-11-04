/**
 * End-to-end SUCCESS-PATH coverage for `pdf.print.pdfx-markers` against REAL
 * qpdf output.
 *
 * Nothing else exercises this: `policy.test.ts` (`pdfx-markers: qpdf failure
 * => warning inspect-failed`) only points the check at a nonexistent file, so
 * it only ever hits the `catch` branch — real qpdf never runs. And
 * `pdfx-structure.test.ts` feeds the parser hand-authored object literals
 * that were never validated against what qpdf actually prints. The check's
 * `--json=1 --json-key=objects` invocation (pinned because qpdf 11+ defaults
 * to JSON v2, where `--json-key=objects` is rejected) has therefore never
 * been run for real in this suite — a qpdf upgrade that changes that shape
 * would silently stop finding PDF/X problems while CI stayed green.
 *
 * Builds two minimal in-memory PDFs with pdf-lib's low-level object API (the
 * high-level `PDFDocument` surface has no OutputIntents helper) — one with a
 * conformant `/OutputIntents` entry in the Catalog, one without — and runs
 * the real, registered check (real `execCapture`, real qpdf binary) against
 * both. The exact result shape asserted below (`[]` for the conformant PDF;
 * one `error` finding with the literal missing-array message for the other)
 * was confirmed by running the actual check against actual qpdf 12.3.2
 * output, not guessed from reading the source.
 *
 * Skip semantics mirror `ghostscript.integration.test.ts`: a missing qpdf on
 * a contributor's machine self-skips with a warning. `ci-preconditions.test.ts`
 * closes the silent-skip hole for CI, the same way it already does for
 * Chromium and Ghostscript.
 */
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFile } from "node:fs/promises";
import { PDFDocument, PDFName, PDFString } from "pdf-lib";
import { getAssetPath } from "../../lib/embedded-assets";
import pdfxMarkersCheck from "./pdfx-markers";
import { makeCtx } from "../../test-helpers/testkit";
import { findTool } from "../../lib/tool-probe";

const qpdf = await findTool("qpdf");
const testWithQpdf = qpdf ? test : test.skip;

if (!qpdf) {
  console.warn(
    "[pdfx-markers.integration.test] qpdf unavailable; skipping the real qpdf PDF/X success-path test. Install qpdf or add it to PATH to run it."
  );
}

/**
 * A two-page PDF whose Catalog either does or doesn't carry a conformant
 * `/OutputIntents` entry — `Type`/`S`/`DestOutputProfile` as an indirect
 * reference to a real registered object, exactly what
 * `getPdfxOutputIntentIssues` requires.
 */
async function makePdf(
  withIntent: boolean,
  crpc1?: { identifier: string }
): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);

  if (withIntent) {
    const profile = crpc1
      ? await readFile(await getAssetPath("profiles/CGATS21_CRPC1.icc"))
      : new Uint8Array([0, 1, 2, 3]);
    const destOutputProfileRef = doc.context.register(
      doc.context.flateStream(profile, { N: crpc1 ? 4 : 3 })
    );
    const outputIntentRef = doc.context.register(
      doc.context.obj({
        Type: "OutputIntent",
        S: "GTS_PDFX",
        ...(crpc1 ? { OutputConditionIdentifier: PDFString.of(crpc1.identifier) } : {}),
        DestOutputProfile: destOutputProfileRef,
      })
    );
    doc.catalog.set(
      PDFName.of("OutputIntents"),
      doc.context.obj([outputIntentRef])
    );
  }

  return doc.save();
}

testWithQpdf(
  "a Catalog with a conformant /OutputIntents entry produces no findings",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-pdfx-markers-"));
    try {
      const pdfPath = join(dir, "with-intent.pdf");
      await writeFile(pdfPath, await makePdf(true));

      const results = await pdfxMarkersCheck.run(makeCtx({ pdfPath }));
      expect(results).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

testWithQpdf(
  "a Catalog with no /OutputIntents produces the documented missing-marker finding",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-pdfx-markers-"));
    try {
      const pdfPath = join(dir, "without-intent.pdf");
      await writeFile(pdfPath, await makePdf(false));

      const results = await pdfxMarkersCheck.run(makeCtx({ pdfPath }));
      expect(results).toEqual([
        {
          checkId: "pdf.print.pdfx-markers",
          severity: "error",
          message: "Catalog is missing a non-empty /OutputIntents array.",
          file: pdfPath,
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

testWithQpdf(
  "the OutputConditionIdentifier must name the embedded CRPC1 profile's condition",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-pdfx-markers-"));
    try {
      const right = join(dir, "crpc1.pdf");
      await writeFile(right, await makePdf(true, { identifier: "CGATS21-2-CRPC1" }));
      expect(await pdfxMarkersCheck.run(makeCtx({ pdfPath: right }))).toEqual([]);

      // SWOP's registry name, which x1a builds used to write over a CRPC1 profile.
      const wrong = join(dir, "swop-name.pdf");
      await writeFile(wrong, await makePdf(true, { identifier: "CGATS TR 001" }));
      expect(await pdfxMarkersCheck.run(makeCtx({ pdfPath: wrong }))).toEqual([
        {
          checkId: "pdf.print.pdfx-markers",
          severity: "error",
          message:
            "/OutputConditionIdentifier (CGATS TR 001) does not name the embedded profile's printing condition (CGATS21-2-CRPC1).",
          file: wrong,
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  30_000
);
