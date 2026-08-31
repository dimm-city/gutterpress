/**
 * SFE-P2c repair round 1 — bridges `gutterpress/render`'s projection
 * diagnostics (`ProjectionDiagnostic`, `editor-projection.ts`'s own D14-
 * aligned category vocabulary) onto the `onDiagnostic` channel every other
 * rejection in this package already uses
 * (`../core/diagnostics.ts`'s `diagnosticForEditRejection`, consumed by
 * `../vscode-adapter/adapter.ts`'s `applyEdit` rejection path).
 *
 * Kept as its own tiny, DOM-free module — like `match.ts`/`plan.ts` — so
 * `tests/gutterpress/projection-diagnostics.test.ts` can exercise it
 * directly under plain `bun:test`, with no risk of pulling in `mount.ts`'s
 * own `createVscodeEditorAdapter` import (which needs a real DOM the
 * moment it is CALLED, not merely imported — see `mount.ts`'s own header).
 *
 * WHY THIS EXISTS (SFE-P2c behavior table, row "Unsupported interior"; G-06:
 * "the safe action available to the author, normally 'Edit in source
 * mode.'"): `editor-projection.ts`'s own module header states its
 * diagnostic category vocabulary "mirrors D14's naming convention ...
 * WITHOUT importing packages/editor" — specifically so it CAN flow through
 * this exact channel once `packages/editor` is ready to consume it.
 * `ProjectionDiagnosticCategory`'s two members
 * (`EDITOR_UNSUPPORTED_PROJECTION`, `EDITOR_PROJECTION_LIMIT`) are both
 * verbatim `DiagnosticCategory` members from D14 (asserted directly in this
 * module's own test, not merely assumed). `mountGutterpressEditor`
 * (`mount.ts`) forwards every `projection.diagnostics` entry through this
 * mapper into `options.onDiagnostic` at mount time, giving a refused
 * plugin-region (or any other projection refusal/limit — an unsupported
 * `layout_`-prefixed token, an oversized document tripping D13's block-count
 * cap, ...) the SAME structured, rule-named "edit in source" affordance
 * `EDITOR_STALE_EDIT`/`EDITOR_READONLY`/`EDITOR_INVALID_RANGE` already
 * deliver for a rejected edit (`diagnosticForEditRejection`).
 *
 * This is a DOCUMENT-LEVEL notice, not a per-block chip — see `match.ts`'s
 * own header, "REFUSED PLUGIN REGIONS", for why a per-block affordance
 * would require exactly the fuzzy text-equality matching G-05 forbids: a
 * refused region carries no VERIFIED boundary this package could anchor a
 * chip to (Lane B could not establish one — that is the definition of
 * refusal). A host that surfaces `onDiagnostic` as a banner/toast/log
 * therefore gets an explicit, rule-named "edit in source" affordance for
 * every refusal in the mounted document, without this package ever
 * guessing a writable range.
 */
import type { Diagnostic } from "../core/index.ts";
import type { ProjectionDiagnostic } from "gutterpress/render";

/** G-06's required safe next action, stated as the structured field a toolbar/banner affordance reads — `reason` already ends with this as prose, but does not populate the field. */
const EDIT_IN_SOURCE_MODE = "Edit in source mode.";

/**
 * `category` passes through unchanged: `ProjectionDiagnosticCategory` is a
 * subset of D14's `DiagnosticCategory` by construction (both string unions
 * share the same literals). `message` is `plugin-origin.ts`'s/
 * `editor-projection.ts`'s own rule-named refusal/limit reason VERBATIM —
 * never rewritten, since every refusal-matrix rule name already lives
 * inside that string (SFE-P2c repair round 1's own finding: a refusal
 * reason must not be discarded in favor of one fixed generic string).
 */
export function diagnosticForProjection(diagnostic: ProjectionDiagnostic): Diagnostic {
  return {
    category: diagnostic.category,
    message: diagnostic.reason,
    safeAction: EDIT_IN_SOURCE_MODE,
  };
}
