/**
 * SFE-P3c Lane B — user-facing text for each command precondition refusal
 * (D14: "fails with a SPECIFIC diagnostic when its precondition is absent
 * ... no generic 'failed'"). Shared by `build.ts`/`preview.ts` (both need a
 * Gutterpress project) — `open-source.ts` has its own, unrelated
 * precondition (an active Gutterpress editor tab), described locally there.
 */
import type { ProjectResolutionFailureReason } from "../project/discover.ts";

export function describeNoProjectFailure(reason: ProjectResolutionFailureReason): string {
  switch (reason) {
    case "no-workspace":
      return (
        "Gutterpress: no folder is open. Open a folder or workspace containing a Gutterpress " +
        "project (a manifest.yaml file), then run this command again."
      );
    case "ambiguous-workspace":
      return (
        "Gutterpress: more than one folder is open and none matches the active editor. Open a " +
        "file inside your Gutterpress project folder, then run this command again."
      );
    case "no-manifest":
      return (
        "Gutterpress: no Gutterpress project found here — looked for manifest.yaml. Add one to " +
        "make this folder a Gutterpress project, or open a different folder."
      );
  }
}
