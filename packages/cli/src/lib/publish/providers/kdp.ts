/**
 * Amazon KDP publish provider (#35) — GUIDED.
 *
 * Amazon has no KDP API and has stated no plans to release one; scripting the
 * KDP web UI violates its ToS. Publishing stages a KDP-ready package
 * (interior PDF + listing sheet) and opens the KDP bookshelf with a checklist.
 */
import type {
  PreflightIssue,
  PublishProvider,
  PublishProviderInfo,
  PublishRequest,
} from "../types.ts";
import { stageGuidedPackage } from "./guided.ts";

const KDP_URL = "https://kdp.amazon.com/en_US/bookshelf";

const info: PublishProviderInfo = {
  id: "kdp",
  label: "Amazon KDP",
  kind: "guided",
  format: "pdf",
  description:
    "Prepare a KDP-ready package and open kdp.amazon.com (Amazon has no KDP API; automation violates its ToS).",
  configFields: [],
  credential: { required: false, host: "kdp.amazon.com" },
};

export const kdpProvider: PublishProvider = {
  info,

  async authenticate() {
    return { ok: true as const };
  },

  async preflight(req: PublishRequest): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    if (!req.project.title) {
      issues.push({
        severity: "warning",
        id: "kdp/title-missing",
        message: "The manifest has no title — KDP's book-details form will need one.",
      });
    }
    issues.push({
      severity: "info",
      id: "kdp/print-specs",
      message:
        "KDP print interiors have strict trim/bleed/margin specs. Run `print-md validate --pdf <file>` and compare against your chosen trim size before uploading.",
    });
    return issues;
  },

  async upload(req: PublishRequest) {
    const packageDir = await stageGuidedPackage(req, "kdp", [
      "- **Interior file:** upload as the manuscript in Print options",
      "- **Cover:** KDP requires a separate cover file (use KDP's Cover Calculator for exact dimensions)",
    ]);
    return {
      kind: "guided" as const,
      packageDir,
      openUrl: KDP_URL,
      checklist: [
        "Sign in to kdp.amazon.com and choose “Create” → Paperback (or Kindle eBook).",
        "Fill in book details from LISTING.md (title, authors, description).",
        "Upload the interior PDF from the package folder as the manuscript.",
        "Upload a cover sized with KDP's Cover Calculator.",
        "Use KDP's Print Previewer to verify margins and bleed, then submit for review.",
      ],
      detail:
        "Amazon offers no KDP API, so print-md prepared the package and the checklist for you.",
    };
  },
};
