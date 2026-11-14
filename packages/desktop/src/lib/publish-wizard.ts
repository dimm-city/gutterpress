/**
 * Pure decisions behind the Publish wizard (PublishWizard.svelte), kept here
 * so they are unit-testable without a Svelte render harness.
 */
import { isPathAtOrUnder } from "./platform/paths";

export type WizardStep =
  | { kind: "format"; label: string }
  | { kind: "choose"; label: string }
  | { kind: "setup"; label: string; cardId: string }
  | { kind: "check"; label: string }
  | { kind: "finish"; label: string };

/**
 * The wizard's steps: Format, Choose, one setup step per online destination,
 * the readiness Check only when the author asked for checks, then Save (a
 * folder on this computer only) or Publish (anywhere else too). The local
 * folder needs no step of its own: it is chosen on the Choose step.
 */
export function wizardSteps(online: { id: string; label: string }[], validate: boolean): WizardStep[] {
  return [
    { kind: "format", label: "Format" },
    { kind: "choose", label: "Choose" },
    ...online.map((c) => ({ kind: "setup" as const, label: c.label, cardId: c.id })),
    ...(validate ? [{ kind: "check" as const, label: "Check" }] : []),
    { kind: "finish", label: online.length > 0 ? "Publish" : "Save" },
  ];
}

/** A path as the author knows it: relative to the book when inside it, else in full. */
export function displayPath(absPath: string, projectDir: string): string {
  if (!projectDir || !isPathAtOrUnder(absPath, projectDir)) return absPath;
  const rel = absPath.slice(projectDir.length).replace(/^[\\/]+/, "").replace(/\\/g, "/");
  return rel || ".";
}

/**
 * Publish-provider notes that tell the reader to run a command-line tool. The
 * desktop runs those checks itself ("Check my book"), so it does not show them.
 */
const COMMAND_LINE_TIPS = new Set(["drivethrurpg/validate-target"]);
export function isCommandLineTip(issueId: string): boolean {
  return COMMAND_LINE_TIPS.has(issueId);
}
