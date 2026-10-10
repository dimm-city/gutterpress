import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";
import { loadPdf, pageHasMarks } from "../../lib/pdf-inspect";
import { lastPageMode } from "../../engine/shared/synthesis";

const check: Check = {
  id: "pdf.print.signature",
  name: "Signature",
  description:
    "Fails when the interior's page count does not fit the print signature (a multiple of it ending on a blank page, or one short of a multiple)",
  category: "pdf",
  phase: "post-build",
  // With no signature (1) there is no page-count rule to assert.
  enabledWhen: (config) => config.print.signature > 1,
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const doc = await loadPdf(ctx.pdfPath);
    if (!doc) {
      return [inspectionFailed(check.id, "Could not parse the PDF's page count.", { file: ctx.pdfPath })];
    }

    const size = ctx.config.print.signature;
    const pages = doc.numPages;
    // `k × signature − 1`: the printer adds the last page itself.
    if ((pages + 1) % size === 0) return [];

    const data = { pages, signature: size };
    if (pages % size !== 0) {
      return [
        finding(check.id, {
          severity: "error",
          message: `Page count ${pages} does not fit a signature of ${size}: it must be a multiple of ${size}, or one short of one.`,
          file: ctx.pdfPath,
          detail: "Set `print.signature` in the manifest and rebuild; the build pads the interior for you.",
          code: "signature-page-count",
          data,
        }),
      ];
    }

    // A full multiple is only enough if the printer can use the last page — and
    // only a book that asked for it (`lastPage`/`reserveLastPage`) needs one.
    if (!lastPageMode(ctx.config.print)) return [];
    try {
      if (!(await pageHasMarks(doc, pages))) return [];
    } catch {
      return [inspectionFailed(check.id, "Could not read the last page.", { file: ctx.pdfPath })];
    }
    return [
      finding(check.id, {
        severity: "error",
        message: `The last page (${pages}) has content, but the printer needs it blank for its own information.`,
        file: ctx.pdfPath,
        detail:
          "The build adds that page for you (`print.lastPage: blank`, or `short-by-one` to stop a page short of a multiple " +
          `of ${size} and let the printer add it). Check that the interior was built with this manifest, and that nothing in it ` +
          "forces content onto the final page.",
        code: "signature-last-page",
        data,
      }),
    ];
  },
};

registerCheck(check);
export default check;
