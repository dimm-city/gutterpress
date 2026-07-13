import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { getPerPageInkCoverage } from "../../lib/pdf-parse";

const check: Check = {
  id: "pdf.print.ink-coverage",
  name: "Ink Coverage (TAC)",
  description:
    "Checks total area coverage (TAC) against maximum ink limits",
  category: "pdf",
  phase: "post-build",
  requiredTools: ["gs"],
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];
    const inkResult = await getPerPageInkCoverage(ctx.pdfPath);
    if (!inkResult.ok) {
      // Finding #51: a gs failure (crash, corrupt PDF, missing binary, a
      // Windows PATH mismatch) must never look like "0 pages, all fine" — it
      // must surface as a distinct, visible warning so the author knows the
      // book was never actually measured for total ink coverage.
      return [
        {
          checkId: check.id,
          severity: "warning",
          message: "Ink coverage could not be measured",
          file: ctx.pdfPath,
          detail: `Ghostscript inkcov failed, so total ink coverage (TAC) was not checked: ${inkResult.error}`,
          code: "ink-coverage-unmeasured",
          data: { error: inkResult.error },
        },
      ];
    }
    const pages = inkResult.pages;
    const limit = ctx.config.ink.maxTac + ctx.config.ink.tacTolerance;
    const offending = pages
      .filter((p) => p.tac > limit)
      .sort((a, b) => b.tac - a.tac);

    if (offending.length === 0) return [];

    const maxTac = offending[0]!.tac;

    // One finding = one result. The per-page breakdown that used to be emitted
    // as many sibling rows now lives in `detail` (human-readable) and `data`
    // (structured) so the summary layer never re-parses prose.
    const detailLines = [
      "Some pages may have issues with commercial print. Consider lightening dark backgrounds.",
      ...offending
        .slice(0, 5)
        .map(
          (page) =>
            `  Page ${page.page}: C:${page.c.toFixed(1)}% M:${page.m.toFixed(1)}% Y:${page.y.toFixed(1)}% K:${page.k.toFixed(1)}% = ${page.tac.toFixed(1)}% TAC`
        ),
    ];
    if (offending.length > 5) {
      detailLines.push(
        `  ...and ${offending.length - 5} more page(s) over ${ctx.config.ink.maxTac}% TAC`
      );
    }

    return [
      {
        checkId: check.id,
        severity: "warning",
        message: `Total ink coverage too high on ${offending.length} page(s) (max ${maxTac.toFixed(1)}%, recommended <=${ctx.config.ink.maxTac}%)`,
        file: ctx.pdfPath,
        detail: detailLines.join("\n"),
        code: "ink-coverage-exceeded",
        data: {
          maxTac,
          limit: ctx.config.ink.maxTac,
          offendingCount: offending.length,
          pages: offending.map((p) => ({
            page: p.page,
            c: p.c,
            m: p.m,
            y: p.y,
            k: p.k,
            tac: p.tac,
          })),
        },
      },
    ];
  },
};

registerCheck(check);
export default check;
