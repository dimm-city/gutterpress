import { defineCommand } from "citty";
import { resolve } from "node:path";
import {
  scaffoldProject,
  BUILT_IN_TEMPLATE_IDS,
  PRESET_IDS,
  PRESETS,
  TARGETS,
  TARGET_IDS,
} from "../index.ts";
import type { CreateProjectError, PresetId, ProjectTemplateId } from "../index.ts";
import {
  EXIT_CODES,
  UsageError,
  rejectExtraPositionals,
  rejectUnknownFlags,
} from "../lib/cli-args.ts";
import { isToolAvailable } from "../lib/tool-probe.ts";
import { resolveGhostscript } from "../lib/ghostscript.ts";

/**
 * `gutterpress new` — scaffold a new project from an embedded starter template.
 *
 * A thin front-end over the shared lib's `scaffoldProject` (#25): the same
 * function the desktop wizard calls. Works fully headless — no desktop required.
 *
 *   gutterpress new "My First Book" --preset dtrpg --author "Jane" --dir ~/Books [--no-git]
 */
export const newArgs = {
  name: {
    type: "positional",
    description: "Project name (becomes the title and folder name)",
    required: true,
  },
  preset: {
    type: "string",
    description: `Vendor preset the book is designed for: ${PRESET_IDS.join(", ")} (required; custom also needs --page-width/--page-height)`,
  },
  author: {
    type: "string",
    description: "Author name to record in the project",
  },
  dir: {
    type: "string",
    description: "Parent directory to create the project in (default: current directory)",
  },
  folder: {
    type: "string",
    description: "Folder name to create (default: a slug of the project name)",
  },
  template: {
    type: "string",
    description: `Starter template: ${BUILT_IN_TEMPLATE_IDS.join(", ")} (default: book)`,
  },
  targets: {
    type: "string",
    description: `Publish targets recorded in the manifest (comma-separated: ${TARGET_IDS.join(", ")}; or "none") — default: the preset's`,
  },
  "page-width": {
    type: "string",
    description: "Trim width in points, 72pt = 1in (required with --preset custom; optional override otherwise)",
  },
  "page-height": {
    type: "string",
    description: "Trim height in points, 72pt = 1in (required with --preset custom; optional override otherwise)",
  },
  "page-tolerance": {
    type: "string",
    description: "Allowed trim deviation in points when validating a built PDF (default: 0.5)",
  },
  git: {
    type: "boolean",
    description: "Initialise local version history (default: true; use --no-git to skip)",
    default: true,
  },
} as const;

/** Parse a points flag ("612", "612.5") or exit 2 with a usable message. */
function parsePoints(raw: unknown, flag: string): number | undefined {
  if (typeof raw !== "string" || raw === "") return undefined;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    console.error(`Invalid ${flag} value: "${raw}". Expected a positive number of points (72pt = 1in).`);
    process.exit(EXIT_CODES.USAGE);
  }
  return value;
}

export default defineCommand({
  meta: {
    name: "new",
    description: "Create a new Gutterpress project from a starter template",
  },
  args: newArgs,
  async run({ args, rawArgs }) {
    try {
      rejectUnknownFlags(rawArgs, newArgs, "new");
      rejectExtraPositionals((args as { _: unknown[] })._, 1, "new");
    } catch (error) {
      if (error instanceof UsageError) {
        console.error(error.message);
        process.exit(error.exitCode);
      }
      throw error;
    }

    const name = String(args.name);
    const parentDir = resolve(
      typeof args.dir === "string" && args.dir ? args.dir : process.cwd(),
    );

    let template: ProjectTemplateId | undefined;
    if (typeof args.template === "string" && args.template) {
      if (!(BUILT_IN_TEMPLATE_IDS as readonly string[]).includes(args.template)) {
        console.error(
          `Unknown template "${args.template}". Choose one of: ${BUILT_IN_TEMPLATE_IDS.join(", ")}.`,
        );
        process.exit(EXIT_CODES.USAGE);
      }
      template = args.template as ProjectTemplateId;
    }

    // ADR 0008: creating a book requires choosing the preset it's designed
    // for. Validated here for a first-class CLI message; scaffoldProject
    // enforces the same rule for every caller.
    const preset = typeof args.preset === "string" && args.preset ? args.preset : undefined;
    if (!preset || !(PRESET_IDS as readonly string[]).includes(preset)) {
      console.error(
        preset
          ? `Unknown preset "${preset}". Choose one of: ${PRESET_IDS.join(", ")}.`
          : `A preset is required: --preset <${PRESET_IDS.join("|")}>. ` +
              `Use "dtrpg" for DriveThruRPG print-on-demand, "book" for a neutral 6x9in trade book, ` +
              `or "custom" with --page-width/--page-height (points; 72pt = 1in).`,
      );
      process.exit(EXIT_CODES.USAGE);
    }

    // Publish targets (ADR 0008): recorded explicitly in the new manifest.
    // Omitted = the preset's defaults; "none" = an explicit empty list.
    let targets: string[] | undefined;
    if (typeof args.targets === "string" && args.targets) {
      targets =
        args.targets.trim().toLowerCase() === "none"
          ? []
          : args.targets.split(",").map((s) => s.trim()).filter(Boolean);
      const unknown = targets.filter((id) => !TARGETS[id]);
      if (unknown.length > 0) {
        console.error(
          `Unknown publish target${unknown.length > 1 ? "s" : ""} "${unknown.join('", "')}". ` +
            `Choose from: ${TARGET_IDS.join(", ")} — or "none" for no destination policies.`,
        );
        process.exit(EXIT_CODES.USAGE);
      }
    }

    const pageWidth = parsePoints(args["page-width"], "--page-width");
    const pageHeight = parsePoints(args["page-height"], "--page-height");
    const pageTolerance = parsePoints(args["page-tolerance"], "--page-tolerance");
    const customPage =
      pageWidth !== undefined && pageHeight !== undefined
        ? { width: pageWidth, height: pageHeight, ...(pageTolerance !== undefined ? { tolerance: pageTolerance } : {}) }
        : undefined;
    if (preset === "custom" && !customPage) {
      console.error(
        "The custom preset needs a trim size: --page-width and --page-height in points (72pt = 1in — e.g. US Letter is 612 x 792).",
      );
      process.exit(EXIT_CODES.USAGE);
    }

    try {
      const result = await scaffoldProject({
        name,
        author: typeof args.author === "string" ? args.author : undefined,
        parentDir,
        folderName: typeof args.folder === "string" && args.folder ? args.folder : undefined,
        template,
        preset: preset as PresetId,
        targets,
        customPage,
        versionHistory: args.git === false ? "none" : "local-git",
      });

      const effectiveTargets = targets ?? [...PRESETS[preset as PresetId].defaultTargets];

      console.log(`Created project: ${result.projectDir}`);
      console.log(`  manifest: ${result.manifestPath}`);
      console.log(`  publish targets: ${effectiveTargets.length > 0 ? effectiveTargets.join(", ") : "none"}`);
      console.log(`  start writing in: ${result.openFile}`);
      if (result.versionHistory === "local-git") {
        console.log("  version history: enabled (local snapshots)");
      } else if (result.versionHistoryError) {
        console.log(
          `  version history: not enabled (${result.versionHistoryError})`,
        );
      }

      // A chosen destination whose pipeline tools are missing gets the
      // explanation up front (ADR 0008): the target stays recorded — the
      // author chose it knowingly — but a compliant file can't be produced
      // or verified until the tools are installed.
      const neededTools = [
        ...new Set(effectiveTargets.flatMap((id) => TARGETS[id]?.requiredTools ?? [])),
      ];
      const missingTools: string[] = [];
      for (const tool of neededTools) {
        const found =
          tool === "gs" ? !!(await resolveGhostscript()) : await isToolAvailable(tool);
        if (!found) missingTools.push(tool === "gs" ? "Ghostscript (gs)" : tool);
      }
      if (missingTools.length > 0) {
        const plural = missingTools.length > 1;
        console.log("");
        console.log(
          `  note: ${missingTools.join(" and ")} ${plural ? "are" : "is"} not installed — a ` +
            `print-compliant (PDF/X) file can't be built or verified until ${plural ? "they are" : "it is"}.`,
        );
        console.log(
          "        Install them (User Guide, Chapter 7 — System Setup), or set `targets: []` in",
        );
        console.log(
          "        manifest.yaml to skip destination checks for now.",
        );
      }

      console.log("");
      console.log(`Next: gutterpress preview "${result.projectDir}"`);
    } catch (e) {
      const err = e as CreateProjectError;
      const code = err && typeof err.code === "string" ? err.code : "scaffold-io";
      console.error(`Could not create project: ${err?.message ?? String(e)}`);
      // M47: map onto the one exit-code contract. "target-exists" /
      // "invalid-name" / "parent-not-writable" are all bad-input preconditions
      // the author chose (a usage error, code 2); "scaffold-io" is an
      // operational I/O failure during the scaffold itself (a pipeline
      // failure, code 3) — previously inverted (target-exists got the
      // "pipeline" code 3, everything else including scaffold-io got 2).
      process.exit(code === "scaffold-io" ? EXIT_CODES.PIPELINE : EXIT_CODES.USAGE);
    }
  },
});
