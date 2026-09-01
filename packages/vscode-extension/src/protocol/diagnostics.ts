import type { Diagnostic } from "@dimm-city/gutterpress-editor/core";
import type { ProtocolValidationFailure } from "./validate.ts";

/**
 * SFE-P3c Lane A — `Diagnostic` construction for this package's protocol
 * boundary and host-disconnection events. Browser-safe (see `messages.ts`'s
 * header) — used by both `../host/document-gateway.ts` (Node/extension
 * host) and `../webview-host/proxy-document-host.ts` (browser/webview).
 *
 * WHY THIS FILE, NOT `packages/editor/src/core/diagnostics.ts`: that module
 * is outside this lane's write boundary this run ("MUST NOT WRITE:
 * packages/editor/**" — the run spec requires proving the shared mount is
 * host-agnostic, so a genuinely necessary editor-package change is a
 * blocking report, not a lane edit). `Diagnostic` itself is a plain data
 * interface (`{category, message, safeAction?}`) with no required factory
 * — `diagnosticForEditRejection`/`externalReplacementDiagnostic` in that
 * module are convenience constructors, not the only legal way to produce a
 * `Diagnostic`. This file constructs instances directly, reusing the SAME
 * fixed `DiagnosticCategory` vocabulary (D14) via the `Diagnostic` type
 * itself, which is a real, exported, reused type — only the convenience
 * constructor functions are package-local.
 */

/**
 * Maps a protocol-boundary rejection (`../protocol/validate.ts`'s six named
 * `ProtocolRejectionReason` shapes) to the closest EXISTING D14 category.
 *
 * D14's category list has no dedicated "malformed message" entry, and
 * inventing one would mean editing `packages/editor/src/core/diagnostics.ts`
 * — outside this lane's write boundary (see this file's header). The
 * mapping below reuses the CLOSEST fit for each shape rather than adding a
 * category:
 *
 *   - "invalid-range" (non-finite/negative offset, `from > to`) is exactly
 *     what `EDITOR_INVALID_RANGE` already means elsewhere in this system
 *     (`applyEdit`'s own D3 range check) — same category, checked one layer
 *     earlier, at the wire boundary instead of against a live snapshot.
 *   - "oversized-payload" is exactly what `EDITOR_FILE_TOO_LARGE` already
 *     means: too much data for this editor to safely hold.
 *   - "wrong-protocol-version" / "unknown-message-type" / "missing-field" /
 *     "wrong-field-type" all reduce to the SAME practical fact: this
 *     message cannot be safely parsed, so this side of the channel can no
 *     longer trust what it is hearing from the other side.
 *     `EDITOR_HOST_DISCONNECTED` is the closest existing category — same
 *     safe next action ("stop trusting this channel; reload") as a genuine
 *     panel/document disconnection. This is a documented judgment call
 *     (see this run's report) rather than a spec-mandated 1:1 mapping; a
 *     future run may split it out with a decision-record amendment if that
 *     proves too coarse in practice.
 */
export function diagnosticForProtocolRejection(failure: ProtocolValidationFailure): Diagnostic {
  switch (failure.reason) {
    case "invalid-range":
      return {
        category: "EDITOR_INVALID_RANGE",
        message:
          "This change targeted an invalid location, so it was not applied. Reload the current document and reapply your change.",
        safeAction: "Reload and reapply",
      };
    case "oversized-payload":
      return {
        category: "EDITOR_FILE_TOO_LARGE",
        message: "This message was too large for the editor to accept, so it was rejected.",
        safeAction: "Switch to source mode for very large changes",
      };
    case "wrong-protocol-version":
    case "unknown-message-type":
    case "missing-field":
    case "wrong-field-type":
      return {
        category: "EDITOR_HOST_DISCONNECTED",
        message:
          "A message on the editor's host connection could not be understood, so the connection is being treated as lost.",
        safeAction: "Reload the editor",
      };
  }
}

/** Why `DocumentGateway`/`ProxyDocumentHost` transitioned to disconnected —
 *  see each reason's user-facing text below for the distinct safe action. */
export type HostDisconnectReason = "document-closed" | "reply-timeout";

/**
 * `EDITOR_HOST_DISCONNECTED` for an ACTUAL connection-loss event (as
 * opposed to `diagnosticForProtocolRejection`'s malformed-message case
 * above) — D14: "gets its first real producer in this run." Used by
 * `DocumentGateway` (`"document-closed"`, run spec behavior table: "A
 * disposed panel, a closed document ...") and `ProxyDocumentHost`
 * (`"reply-timeout"`, "... or a reply that never arrives").
 */
export function hostDisconnectedDiagnostic(reason: HostDisconnectReason): Diagnostic {
  switch (reason) {
    case "document-closed":
      return {
        category: "EDITOR_HOST_DISCONNECTED",
        message: "The document behind this editor was closed, so it is now read-only.",
        safeAction: "Reopen the file to keep editing",
      };
    case "reply-timeout":
      return {
        category: "EDITOR_HOST_DISCONNECTED",
        message: "The editor did not hear back from its host in time, so it is now read-only.",
        safeAction: "Reload the editor to reconnect",
      };
  }
}

/**
 * D13's rich-mode ceiling diagnostic, sent via `PresentationInputMessage`
 * when `../provider.ts` decides a document must open in source-fallback
 * mode. Message/`safeAction` text intentionally matches
 * `packages/desktop/src/routes/+page.svelte`'s
 * `RICH_MODE_FILE_TOO_LARGE_DIAGNOSTIC` verbatim (same D14 category, same
 * user-facing wording) so the SAME limit reads identically across the
 * desktop and VS Code hosts — not imported from there (D4 forbids this
 * package importing `packages/desktop`; see `../provider.ts`'s own
 * `RICH_MODE_MAX_CONTENT_BYTES` constant for the matching size-limit
 * duplication and its own rationale).
 */
export function fileTooLargeDiagnostic(): Diagnostic {
  return {
    category: "EDITOR_FILE_TOO_LARGE",
    message: "This file is too large for the rich editor. Switch to source mode to keep editing it.",
    safeAction: "Switch to source mode",
  };
}
