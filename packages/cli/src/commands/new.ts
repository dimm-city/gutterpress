import { defineCommand } from "citty";
import { resolve } from "node:path";
import {
  scaffoldProject,
  scaffoldExtension,
  BUILT_IN_TEMPLATE_IDS,
  EXTENSION_KINDS,
  PRESET_IDS,
  PRESETS,
  TARGETS,
  TARGET_IDS,
} from "../index.ts";
import type {
  CreateProjectError,
  ExtensionKind,
  PresetId,
  ProjectTemplateId,
} from "../index.ts";
import {
  EXIT_CODES,
  UsageError,
  rejectExtraPositionals,
  rejectUnknownFlags,
} from "../lib/cli-args.ts";
import { isToolAvailable } from "../lib/tool-probe.ts";
import { resolveGhostscript } from "../lib/ghostscript.ts";

/**
 * `gutterpress new` — scaffold a new book, plugin or theme from an embedded
 * starter template.
 *
 * A thin front-end over the shared lib (CLAUDE.md §7: one implementation, two
 * front-ends). `--kind` picks WHICH scaffolder runs:
 *
 *   book (default) → `scaffoldProject`   (#25, the same call the desktop
 *                                         wizard makes)
 *   plugin | theme → `scaffoldExtension` (#245 / #233)
 *
 *   gutterpress new "My First Book" --preset dtrpg --author "Jane" --dir ~/Books [--no-git]
 *   gutterpress new "Field Notes" --kind plugin --prefix fn-
 *   gutterpress new "House Style" --kind theme
 *
 * WHY ONE COMMAND AND NOT THREE. All three create a new folder from an
 * embedded template with the same never-overwrite contract, the same error
 * type and the same `--dir`/`--folder`/`--author` handling; splitting them
 * would duplicate that surface three ways to avoid one flag.
 *
 * WHY THE OTHER FLAGS ARE REJECTED RATHER THAN IGNORED. `--preset` (and the
 * trim/target/template flags under it) describe a BOOK — a plugin has no trim
 * size and no publish destination. An extension scaffold silently ignoring
 * `--preset dtrpg` would leave an author believing they had chosen something.
 * The check reads raw argv, so a flag's DEFAULT never trips it: only a flag
 * the author actually typed does.
 */
export const newArgs = {
  name: {
    type: "positional",
    description: "Name (becomes the title/package name and the folder name)",
    required: true,
  },
  kind: {
    type: "string",
    description: `What to create: book (default), ${EXTENSION_KINDS.join(", ")}`,
  },
  prefix: {
    type: "string",
    description:
      "Class/custom-property prefix an extension claims (default: its slug, e.g. \"field-notes-\"); --kind plugin|theme only",
  },
  description: {
    type: "string",
    description: "One-line description recorded in the extension's metadata; --kind plugin|theme only",
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

/**
 * The long-flag names actually present in argv, kebab-normalized and with a
 * `--no-` prefix stripped.
 *
 * Reads raw argv rather than citty's parsed object because that object cannot
 * distinguish "the author passed --git" from "--git defaults to true". Run
 * AFTER {@link rejectUnknownFlags}, which has already rejected an unknown
 * option and a value-taking option with no value — so a dash-prefixed token
 * reaching here is a real flag, not somebody's `--author --preset` mistake.
 */
function flagsPassed(rawArgs: readonly string[]): Set<string> {
  const seen = new Set<string>();
  for (const token of rawArgs) {
    if (token === "--") break;
    if (!token.startsWith("--") || token.length <= 2) continue;
    const equalsAt = token.indexOf("=");
    let name = equalsAt === -1 ? token.slice(2) : token.slice(2, equalsAt);
    name = name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
    if (name.startsWith("no-")) name = name.slice(3);
    seen.add(name);
  }
  return seen;
}

/** Flags that only mean something for a book, and only for an extension. */
const BOOK_ONLY_FLAGS = [
  "preset",
  "targets",
  "template",
  "page-width",
  "page-height",
  "page-tolerance",
  "git",
] as const;
const EXTENSION_ONLY_FLAGS = ["prefix", "description"] as const;

/** Exit 2 naming every flag that does not apply to the chosen `--kind`. */
function rejectFlagsForKind(
  rawArgs: readonly string[],
  kind: "book" | ExtensionKind,
): void {
  const passed = flagsPassed(rawArgs);
  const inapplicable = (kind === "book" ? EXTENSION_ONLY_FLAGS : BOOK_ONLY_FLAGS).filter((f) =>
    passed.has(f),
  );
  if (inapplicable.length === 0) return;

  const list = inapplicable.map((f) => `--${f}`).join(", ");
  console.error(
    kind === "book"
      ? `${list} ${inapplicable.length > 1 ? "are" : "is"} only meaningful for an extension. ` +
          `Add --kind ${EXTENSION_KINDS.join(" or --kind ")}, or drop ${inapplicable.length > 1 ? "them" : "it"}.`
      : `${list} ${inapplicable.length > 1 ? "describe a book, not" : "describes a book, not"} a ${kind}. ` +
          `A ${kind} has no trim size, publish target or starter template — drop ${inapplicable.length > 1 ? "them" : "it"}.`,
  );
  process.exit(EXIT_CODES.USAGE);
}

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

/** Optional string arg, or undefined when absent/empty. */
function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

/**
 * `--kind plugin|theme`: create an extension starter package and print how to
 * use it. Split out of `run()` so the book path reads exactly as it did.
 */
async function runExtensionScaffold(
  kind: ExtensionKind,
  name: string,
  parentDir: string,
  args: Record<string, unknown>,
): Promise<void> {
  try {
    const result = await scaffoldExtension({
      name,
      kind,
      parentDir,
      folderName: optionalString(args.folder),
      prefix: optionalString(args.prefix),
      author: optionalString(args.author),
      description: optionalString(args.description),
    });

    console.log(`Created ${kind}: ${result.extensionDir}`);
    console.log(`  metadata: ${result.manifestPath}`);
    console.log(`  class prefix: ${result.prefix}`);
    console.log(`  files: ${result.files.length}`);
    console.log(`  start editing in: ${result.openFile}`);
    console.log("");

    if (kind === "plugin") {
      // The one devDependency is markdown-it, so the fixture test renders
      // through the same parser a real book uses.
      console.log("Next: check it still works —");
      console.log(`  cd ${result.slug} && bun install && bun test`);
      console.log("");
      console.log("      then load it from a book's manifest.yaml:");
      console.log("        plugins:");
      console.log(`          - path: plugins/${result.slug}`);
      console.log("");
      console.log(
        "      (point `path` at the FOLDER, not plugin.js — that is what makes",
      );
      console.log(
        "       Gutterpress read gutterpress.json and pick up the stylesheet too.)",
      );
    } else {
      // `theme import`/`apply` take the project directory as their SECOND
      // POSITIONAL, not a --dir flag (see commands/theme.ts's `dirArg`).
      console.log("Next: install it into a book —");
      console.log(`  gutterpress theme import ${result.extensionDir} <book>`);
      console.log(`  gutterpress theme apply ${result.slug} <book>`);
      console.log("");
      console.log(
        "      Each stylesheet opens with the OWNS / MUST NOT CONTAIN header that",
      );
      console.log("      says which rules belong in it. Start with styles/tokens.css.");
    }
  } catch (e) {
    const err = e as CreateProjectError;
    const code = err && typeof err.code === "string" ? err.code : "scaffold-io";
    console.error(`Could not create ${kind}: ${err?.message ?? String(e)}`);
    // Same mapping the book path uses (M47): `scaffold-io` is an operational
    // failure (3); every other code is a precondition the author chose (2).
    process.exit(code === "scaffold-io" ? EXIT_CODES.PIPELINE : EXIT_CODES.USAGE);
  }
}

export default defineCommand({
  meta: {
    name: "new",
    description: "Create a new Gutterpress book, plugin or theme from a starter template",
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

    // `--kind` chooses the scaffolder. Absent = book, the behavior this
    // command has always had.
    const rawKind = typeof args.kind === "string" && args.kind ? args.kind : "book";
    if (rawKind !== "book" && !(EXTENSION_KINDS as readonly string[]).includes(rawKind)) {
      console.error(
        `Unknown kind "${rawKind}". Choose one of: book, ${EXTENSION_KINDS.join(", ")}.`,
      );
      process.exit(EXIT_CODES.USAGE);
    }
    const kind = rawKind as "book" | ExtensionKind;
    rejectFlagsForKind(rawArgs, kind);

    if (kind !== "book") {
      await runExtensionScaffold(kind, name, parentDir, args);
      return;
    }

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
