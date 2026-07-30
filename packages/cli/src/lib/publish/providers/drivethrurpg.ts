/**
 * DriveThruRPG publish provider (#35) — GUIDED.
 *
 * DriveThruRPG has no publisher upload API (its public API is read-only,
 * customer-side). Publishing stages a validated upload package and opens the
 * publisher hub with a checklist. If DTRPG ever ships a publisher API this
 * provider upgrades to kind "api" without changing the author surface.
 */
import type {
  PreflightIssue,
  PublishProvider,
  PublishProviderInfo,
  PublishRequest,
} from "../types.ts";
import { stageGuidedPackage } from "./guided.ts";

const PUBLISHER_HUB_URL = "https://www.drivethrurpg.com/publisher_hub";

const info: PublishProviderInfo = {
  id: "drivethrurpg",
  label: "DriveThruRPG",
  kind: "guided",
  format: "pdf",
  description:
    "Prepare a validated upload package and open the DriveThruRPG publisher hub (DTRPG has no upload API).",
  configFields: [
    {
      key: "productUrl",
      label: "Existing product URL (optional)",
      placeholder: "https://www.drivethrurpg.com/product/…",
    },
  ],
  credential: { required: false, host: "drivethrurpg.com" },
};

export const drivethrurpgProvider: PublishProvider = {
  info,

  async authenticate() {
    return { ok: true as const };
  },

  async preflight(req: PublishRequest): Promise<PreflightIssue[]> {
    const issues: PreflightIssue[] = [];
    if (!req.project.title) {
      issues.push({
        severity: "warning",
        id: "drivethrurpg/title-missing",
        message:
          "The manifest has no title — DriveThruRPG's listing form will need one.",
      });
    }
    issues.push({
      severity: "info",
      id: "drivethrurpg/validate-target",
      message:
        "Tip: run `gutterpress validate --target dtrpg` for DriveThruRPG's print-compliance checks before uploading.",
    });
    return issues;
  },

  async upload(req: PublishRequest) {
    const cfg = req.config as { productUrl?: string };
    const packageDir = await stageGuidedPackage(req, "drivethrurpg", [
      ...(cfg.productUrl ? [`- **Existing product:** ${cfg.productUrl}`] : []),
    ]);
    return {
      kind: "guided" as const,
      packageDir,
      openUrl: cfg.productUrl?.trim() || PUBLISHER_HUB_URL,
      checklist: [
        "Sign in to your DriveThruRPG publisher account.",
        cfg.productUrl
          ? "Open the product's Edit page and upload the new PDF from the package folder."
          : "Choose “Set Up a New Title” and upload the PDF from the package folder.",
        "Copy the title, authors and description from LISTING.md into the listing form.",
        "Set pricing and activate the title when you're ready.",
      ],
      detail:
        "DriveThruRPG has no upload API, so gutterpress prepared the package and the checklist for you.",
    };
  },
};
