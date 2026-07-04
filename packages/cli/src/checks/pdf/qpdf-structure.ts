import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { inspectionFailed } from "../policy";
import { loadPdf, isLoadable } from "../../lib/pdf-inspect";

const check: Check = {
  // Id retained for config/back-compat; implementation is now an in-process
  // parse gate, not `qpdf --check`. This catches PDFs that fail to parse but
  // does NOT validate xref/stream-length integrity the way qpdf did (ADR 0002).
  id: "pdf.structure.qpdf",
  name: "PDF Structure",
  description: "Validates the PDF parses and every page is traversable",
  category: "pdf",
  phase: "post-build",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    const doc = await loadPdf(ctx.pdfPath);
    if (!doc || !(await isLoadable(doc))) {
      return [
        inspectionFailed(
          check.id,
          "PDF could not be fully parsed — possible structural issues.",
          { file: ctx.pdfPath }
        ),
      ];
    }
    return [];
  },
};

registerCheck(check);
export default check;
