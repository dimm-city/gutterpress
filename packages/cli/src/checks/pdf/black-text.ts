import { readFile } from "node:fs/promises";
import { registerCheck } from "../registry";
import type { Check, CheckContext, CheckResult } from "../types";
import { finding, inspectionFailed } from "../policy";

const check: Check = {
  id: "pdf.print.black-text",
  name: "Black Text",
  description:
    "Fails when text at or below 24pt is painted in four-colour near-black (DriveThruRPG wants it on the black plate alone)",
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
          severity: "error",
          message: `Four-colour black text at ${LARGE_TEXT_PT}pt or smaller on page(s) ${found.pages.join(", ")}.`,
          file: ctx.pdfPath,
          detail:
            "Print vendors such as DriveThruRPG want small black text on the black plate alone (100% K); " +
            "four-colour black misregisters and looks fuzzy. Build with `pdfx.blackText: k-only`. " +
            "If it is already set, this text is painted in a way the build cannot rewrite " +
            "(an image, a pattern, or a colour space other than DeviceRGB).",
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
