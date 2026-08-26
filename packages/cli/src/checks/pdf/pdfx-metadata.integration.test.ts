/**
 * End-to-end SUCCESS-PATH coverage for `pdf.print.pdfx-metadata` against REAL
 * qpdf output — the sibling gap to `pdfx-markers.integration.test.ts`.
 *
 * `pdfx-metadata.ts` shells out to the same `qpdf --json=1 --json-key=objects`
 * (pinned for the same qpdf-11+-defaults-to-JSON-v2 reason) and parses the
 * result with `getPdfxMetadataIssues`. Before this file, that invocation had
 * never run for real in the suite either: `policy.test.ts`
 * (`pdfx-metadata: qpdf failure => warning inspect-failed`) only points it at
 * a nonexistent file (the `catch` branch), and `pdfx-structure.test.ts` feeds
 * `getPdfxMetadataIssues` hand-authored object literals, never real qpdf
 * stdout.
 *
 * Builds two minimal in-memory PDFs with pdf-lib's low-level object API — the
 * high-level `PDFDocument` surface has setters for standard Info fields
 * (Title, Producer, ...) but none for the PDF/X DOCINFO extensions
 * (`/GTS_PDFXVersion`, `/GTS_PDFXConformance`, `/Trapped`), so the trailer's
 * `/Info` ref is replaced directly via `context.trailerInfo.Info` — one PDF
 * with all three markers conformant for the default "x1a" flavor
 * (`resolveConfig({}, {}).pdfx.flavor === "x1a"`, confirmed by running it),
 * one with a DOCINFO dict that has neither. The exact result shape asserted
 * below — `[]` for the conformant PDF; three `error` findings in
 * version/conformance/trapped order for the other — was confirmed by running
 * the actual check against actual qpdf 12.3.2 output, not guessed from
 * reading the source.
 *
 * Skip semantics mirror `pdfx-markers.integration.test.ts` /
 * `ghostscript.integration.test.ts`: a missing qpdf on a contributor's
 * machine self-skips with a warning. `ci-preconditions.test.ts`'s qpdf
 * assertion already covers both integration files (it names "the PDF/X
 * success-path suites" generically), so no change was needed there.
 */
import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument, PDFString } from "pdf-lib";
import pdfxMetadataCheck from "./pdfx-metadata";
import { makeCtx } from "../../test-helpers/testkit";
import { findTool } from "../../lib/tool-probe";

const qpdf = await findTool("qpdf");
const testWithQpdf = qpdf ? test : test.skip;

if (!qpdf) {
  console.warn(
    "[pdfx-metadata.integration.test] qpdf unavailable; skipping the real qpdf PDF/X metadata success-path test. Install qpdf or add it to PATH to run it."
  );
}

/**
 * A one-page PDF whose trailer `/Info` dict either does or doesn't carry the
 * PDF/X-1a DOCINFO markers `getPdfxMetadataIssues` requires. The dict is
 * built from scratch and assigned directly to `context.trailerInfo.Info`
 * (bypassing pdf-lib's own auto-populated Info dict) so it contains exactly
 * the fields under test — no incidental Producer/CreationDate noise.
 */
async function makePdf(withMarkers: boolean): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([612, 792]);

  if (withMarkers) {
    const info = doc.context.obj({
      GTS_PDFXVersion: PDFString.of("PDF/X-1a:2001"),
      GTS_PDFXConformance: PDFString.of("PDF/X-1a:2001"),
      Trapped: "False",
    });
    doc.context.trailerInfo.Info = doc.context.register(info);
  }

  return doc.save();
}

testWithQpdf(
  "conformant PDF/X-1a DOCINFO markers produce no findings",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-pdfx-metadata-"));
    try {
      const pdfPath = join(dir, "with-markers.pdf");
      await writeFile(pdfPath, await makePdf(true));

      const results = await pdfxMetadataCheck.run(makeCtx({ pdfPath }));
      expect(results).toEqual([]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);

testWithQpdf(
  "DOCINFO with none of the PDF/X-1a markers produces the three documented findings",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "gutterpress-pdfx-metadata-"));
    try {
      const pdfPath = join(dir, "without-markers.pdf");
      await writeFile(pdfPath, await makePdf(false));

      const results = await pdfxMetadataCheck.run(makeCtx({ pdfPath }));
      expect(results).toEqual([
        {
          checkId: "pdf.print.pdfx-metadata",
          severity: "error",
          message: "DOCINFO is missing /GTS_PDFXVersion.",
          file: pdfPath,
        },
        {
          checkId: "pdf.print.pdfx-metadata",
          severity: "error",
          message: "DOCINFO is missing /GTS_PDFXConformance for PDF/X-1a.",
          file: pdfPath,
        },
        {
          checkId: "pdf.print.pdfx-metadata",
          severity: "error",
          message: "DOCINFO is missing /Trapped (required for PDF/X conformance).",
          file: pdfPath,
        },
      ]);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
);
