/**
 * Publish-target choices for the UI (ADR 0008) — the destinations a book is
 * validated against, and what each one needs installed.
 *
 * PWA-clean (§8): a plain data + pure-function module, no lib value import.
 * It deliberately MIRRORS `packages/cli/src/lib/targets.ts`'s registry
 * (`TARGETS[id].label` / `.requiredTools`); the lib stays the authority —
 * an id typo is rejected host-side by `setManifestFields`, and
 * `publish-targets.contract.test.ts` pins these ids/tools against the real
 * registry so the two can't drift.
 *
 * Shared by the new-book wizard and project settings so both surfaces
 * describe a destination the same way.
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
    id: "dtrpg",
    label: "DriveThruRPG (print)",
    description: "Checks the finished PDF against DriveThruRPG's print rules.",
    tools: ["qpdf", "gs"],
  },
  {
    id: "itch",
    label: "itch.io (digital)",
    description: "Checks the finished PDF is well-formed with embedded fonts.",
    tools: [],
  },
];

/** Tool ids whose absence blocks a print-compliant build (for `doctor:getDiagnostics`). */
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
 * nothing is missing. One sentence pair, shared verbatim by both surfaces so
 * the app never says this two different ways.
 */
export function toolGapMessage(missingNeeded: readonly string[]): string | null {
  if (missingNeeded.length === 0) return null;
  const names = missingNeeded.map(toolDisplayName).join(" and ");
  const plural = missingNeeded.length > 1;
  return (
    `${names} ${plural ? "aren't" : "isn't"} installed on this computer, so a ` +
    `print-compliant (PDF/X) file can't be built or verified until ${plural ? "they are" : "it is"}. ` +
    `You can keep this checked and install ${plural ? "them" : "it"} later ` +
    `(see System setup in the Help tab), or uncheck it for now.`
  );
}
