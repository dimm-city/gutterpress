/**
 * DriveThruRPG publish providers (#35, ADR 0012) — GUIDED.
 *
 * DriveThruRPG sells a title as print, as a digital download, or both, and
 * each takes a different file: print-on-demand needs PDF/X, a download is a
 * plain PDF. So there are two targets, `drivethrurpg-print` and
 * `drivethrurpg-digital`; the registry (`../../targets.ts`) says which file
 * and which rules each one has. Delivery is the same for both.
 *
 * DriveThruRPG has no publisher upload API (its public API is read-only,
 * customer-side). Publishing stages an upload package and opens the publisher
 * hub with a checklist. If DTRPG ever ships a publisher API these upgrade to
 * kind "api" without changing the author surface.
 */
import type {
  PreflightIssue,
  PublishProvider,
  PublishProviderInfo,
  PublishRequest,
} from "../types.ts";
import { targetInfo } from "../target-info.ts";
import { stageGuidedPackage } from "./guided.ts";

const PUBLISHER_HUB_URL = "https://www.drivethrurpg.com/publisher_hub";

type DriveThruRpgEdition = "print" | "digital";

const WORDS: Record<DriveThruRpgEdition, { description: string; file: string; upload: string }> = {
  print: {
    description:
      "Prepare the print-ready PDF/X as an upload package and open the DriveThruRPG publisher hub (DTRPG has no upload API).",
    file: "print-ready PDF/X",
    upload: "Under Book Printing, upload the interior PDF from the package folder for your print title.",
  },
  digital: {
    description:
      "Prepare the PDF as an upload package and open the DriveThruRPG publisher hub (DTRPG has no upload API).",
    file: "PDF",
    upload: "Upload the PDF from the package folder as the title's digital file.",
  },
};

function drivethrurpgProvider(edition: DriveThruRpgEdition): PublishProvider {
  const words = WORDS[edition];
  const info: PublishProviderInfo = {
    ...targetInfo(`drivethrurpg-${edition}`),
    kind: "guided",
    description: words.description,
    configFields: [
      {
        key: "productUrl",
        label: "Existing product URL (optional)",
        placeholder: "https://www.drivethrurpg.com/product/…",
      },
    ],
    credential: { required: false, host: "drivethrurpg.com" },
  };

  return {
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
        message: `Tip: run \`gutterpress validate --target ${info.id}\` for DriveThruRPG's ${edition} checks before uploading.`,
      });
      return issues;
    },

    async upload(req: PublishRequest) {
      const cfg = req.config as { productUrl?: string };
      // A package folder per target, so the print and digital files of one
      // title never overwrite each other.
      const packageDir = await stageGuidedPackage(req, info.id, [
        ...(cfg.productUrl ? [`- **Existing product:** ${cfg.productUrl}`] : []),
      ]);
      return {
        kind: "guided" as const,
        packageDir,
        openUrl: cfg.productUrl?.trim() || PUBLISHER_HUB_URL,
        checklist: [
          "Sign in to your DriveThruRPG publisher account.",
          cfg.productUrl
            ? `Open the product's Edit page. ${words.upload}`
            : `Choose “Set Up a New Title”. ${words.upload}`,
          "Copy the title, authors and description from LISTING.md into the listing form.",
          "Set pricing and activate the title when you're ready.",
        ],
        detail: `DriveThruRPG has no upload API, so gutterpress prepared the ${words.file} package and the checklist for you.`,
      };
    },
  };
}

export const drivethrurpgPrintProvider = drivethrurpgProvider("print");
export const drivethrurpgDigitalProvider = drivethrurpgProvider("digital");
