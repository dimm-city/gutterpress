/**
 * D14 — Diagnostics and failure taxonomy.
 *
 * Category names are STABLE and VERBATIM from
 * docs/plans/source-first-editor-enterprise-refactor.md (D14). Do not
 * rename, remove, or invent additional categories outside this list without
 * an explicit decision-record amendment — desktop, VS Code, and every later
 * run key off these exact strings.
 */
export const DIAGNOSTIC_CATEGORIES = [
  "EDITOR_STALE_EDIT",
  "EDITOR_INVALID_RANGE",
  "EDITOR_READONLY",
  "EDITOR_FILE_TOO_LARGE",
  "EDITOR_UNSUPPORTED_PROJECTION",
  "EDITOR_PROJECTION_LIMIT",
  "EDITOR_PLUGIN_UNTRUSTED",
  "EDITOR_PLUGIN_LOAD_FAILED",
  "EDITOR_CUSTOM_VIEW_UNAVAILABLE",
  "EDITOR_HOST_DISCONNECTED",
  "EDITOR_EXTERNAL_REPLACEMENT",
] as const;

export type DiagnosticCategory = (typeof DIAGNOSTIC_CATEGORIES)[number];

/**
 * A stable, structured diagnostic. D14: "User-facing messages state the
 * safe next action" — `message` must therefore describe what the author or
 * host can safely do next, not merely name the failure. `safeAction` is an
 * optional short imperative summary (e.g. for a toolbar/status-bar
 * affordance) distinct from the full `message`.
 */
export interface Diagnostic {
  readonly category: DiagnosticCategory;
  readonly message: string;
  readonly safeAction?: string;
}

/**
 * Maps an `ApplyEditResult` rejection reason (D3) to its D14 diagnostic.
 * This is the ONLY place that pairing is defined, so every host surfaces
 * the same category and message for the same rejection (SFE-P1a behavior
 * table: stale -> EDITOR_STALE_EDIT, readonly -> EDITOR_READONLY,
 * invalid-range -> EDITOR_INVALID_RANGE).
 */
export function diagnosticForEditRejection(
  reason: "stale" | "readonly" | "invalid-range",
): Diagnostic {
  switch (reason) {
    case "stale":
      return {
        category: "EDITOR_STALE_EDIT",
        message:
          "This change was based on an outdated version of the document. Reload the current document and reapply your change.",
        safeAction: "Reload and reapply",
      };
    case "readonly":
      return {
        category: "EDITOR_READONLY",
        message:
          "This document is read-only right now, so the change was not applied. Switch to an editable mode to make changes.",
        safeAction: "Switch to editable mode",
      };
    case "invalid-range":
      return {
        category: "EDITOR_INVALID_RANGE",
        message:
          "This change targeted a location outside the current document, so it was not applied. Reload the current document and reapply your change.",
        safeAction: "Reload and reapply",
      };
  }
}

/**
 * Informational diagnostic accompanying every host-originated external
 * replacement (`EditorDocumentHost.replaceExternal`, D7/D3: "Host-originated
 * replacements include the complete authoritative snapshot"). This is NOT a
 * rejection — it documents that the view now reflects out-of-band content,
 * which is expected and safe. D15: never include document text in a
 * diagnostic message.
 */
export function externalReplacementDiagnostic(): Diagnostic {
  return {
    category: "EDITOR_EXTERNAL_REPLACEMENT",
    message:
      "The document changed outside this editor. The current view now reflects the latest version.",
  };
}
