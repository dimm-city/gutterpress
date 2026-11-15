/**
 * The new-book wizard's starting targets (ADR 0008), like `gutterpress new
 * --targets`: the stores a new book can start with, and what each one needs
 * installed. A book's targets are changed afterwards in Publish → Targets,
 * which lists every target the lib knows (ADR 0012).
 *
 * PWA-clean (§8): a plain data + pure-function module, no lib value import.
 * It deliberately MIRRORS `packages/cli/src/lib/targets.ts`'s registry
 * (`TARGETS[id].label` / `.requiredTools`); the lib stays the authority —
 * an id typo is rejected host-side by `scaffoldProject`, and
 * `publish-targets.contract.test.ts` pins these ids/tools against the real
 * registry so the two can't drift.
 */

export interface PublishTargetChoice {
  id: string;
  /** Writer-facing name, including whether it's a print or digital release. */
  label: string;
  /** One line on what checking against this destination actually does. */
  description: string;
  /** External tools this destination's pipeline needs (`qpdf`, `gs`). */
  tools: string[];
}

export const PUBLISH_TARGET_CHOICES: PublishTargetChoice[] = [
  {
    id: "drivethrurpg-print",
    label: "DriveThruRPG (print)",
    description: "Checks the finished PDF against DriveThruRPG's print rules.",
    tools: ["qpdf", "gs"],
  },
  {
    id: "drivethrurpg-digital",
    label: "DriveThruRPG (digital)",
    description: "Checks the finished PDF is well-formed with embedded fonts.",
    tools: [],
  },
  {
    id: "itch",
    label: "itch.io (digital)",
    description: "Checks the finished PDF is well-formed with embedded fonts.",
    tools: [],
  },
];

/**
 * The targets a book designed for a preset validates against by default
 * (mirrors the lib presets' `defaultTargets`: dtrpg → [drivethrurpg-print]; else none).
 */
export function defaultTargetsFor(preset: string | null): string[] {
  return preset === "dtrpg" ? ["drivethrurpg-print"] : [];
}

/** Tool ids whose absence blocks a print-compliant build (for `/api/doctor`). */
export const PRINT_TOOL_IDS = ["qpdf", "gs"];

/** Writer-facing tool name — `gs` means nothing to a non-technical author. */
export function toolDisplayName(id: string): string {
  return id === "gs" ? "Ghostscript" : id;
}

/**
 * The tools a SELECTED destination needs that are missing on this computer.
 * Empty when nothing selected needs anything (itch alone), or when every
 * needed tool is present.
 */
export function missingToolsForTargets(
  selected: readonly string[],
  missingTools: readonly string[],
): string[] {
  const needed = new Set(
    PUBLISH_TARGET_CHOICES.filter((c) => selected.includes(c.id)).flatMap((c) => c.tools),
  );
  return [...needed].filter((t) => missingTools.includes(t));
}

/**
 * The "you can't produce a compliant file yet" explanation, or null when
 * nothing is missing.
 */
export function toolGapMessage(missingNeeded: readonly string[]): string | null {
  if (missingNeeded.length === 0) return null;
  const names = missingNeeded.map(toolDisplayName).join(" and ");
  const plural = missingNeeded.length > 1;
  return (
    `${names} ${plural ? "aren't" : "isn't"} installed on this computer, so a ` +
    `print-ready (PDF/X) file can't be built or verified until ${plural ? "they are" : "it is"}. ` +
    `You can keep this checked and install ${plural ? "them" : "it"} later ` +
    `(see Troubleshooting → Diagnostics), or uncheck it for now.`
  );
}
