import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";

const check: Check = {
  id: "pdf.print.black-text",
  name: "Black Text",
  description:
    "Warns when text at or below 24pt is painted in a dark four-colour mix (black, or a near-black colour such as a dark brown)",
  category: "pdf",
  phase: "post-build",
  // Only a build that asked for K-only black text (`pdfx.blackText: k-only`, the
  // dtrpg default) has anything to assert.
  enabledWhen: (config) => config.pdfx.blackText === "k-only",
  async run(ctx: CheckContext): Promise<CheckResult[]> {
    if (!ctx.pdfPath) return [];

    try {
      const { findRichBlackText, LARGE_TEXT_PT } = await import("../../lib/black-text-gray");
      const found = await findRichBlackText(await readFile(ctx.pdfPath));
      if (found.runs === 0) return [];
      return [
        finding(check.id, {
          severity: "warning",
          message: `Dark four-colour text at ${LARGE_TEXT_PT}pt or smaller on page(s) ${found.pages.join(", ")}.`,
          file: ctx.pdfPath,
          detail:
            "Small text printed with all four inks can look fuzzy if the plates are slightly out of register, " +
            "which is why print vendors such as DriveThruRPG want small black text on the black plate alone. " +
            "`pdfx.blackText: k-only` already does that for near-black text; this text is either a dark " +
            "colour (for example a dark brown, which keeps its colour) or painted in a way the build cannot " +
            "rewrite (an image or a pattern). To print it on the black plate, make the text black (#000). " +
            "If the colour is intended, set `lint.rules: { pdf.print.black-text: off }` in manifest.yaml.",
          code: "rich-black-text",
          data: { runs: found.runs, pages: found.pages },
        }),
      ];
    } catch {
      return [
        inspectionFailed(check.id, "Could not inspect the PDF's text colours.", {
          file: ctx.pdfPath,
        }),
      ];
    }
  },
};

registerCheck(check);
export default check;
