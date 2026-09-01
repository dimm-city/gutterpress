import {
  DIAGNOSTIC_CATEGORIES,
  EDITOR_PROTOCOL_VERSION,
  validateDocumentSnapshot,
  validateSourceEdit,
  type Diagnostic,
  type DiagnosticCategory,
  type SourceEdit,
} from "@dimm-city/gutterpress-editor/core";
import {
  HOST_TO_WEBVIEW_MESSAGE_TYPES,
  WEBVIEW_TO_HOST_MESSAGE_TYPES,
  type HostToWebviewMessage,
  type ProjectionPluginError,
  type WebviewToHostMessage,
} from "./messages.ts";
import type { GutterpressProjection } from "gutterpress/render";

/**
 * SFE-P3c Lane A — runtime validators for the host<->webview protocol
 * (D3/D12: "All protocol messages are runtime validated at process/webview
 * boundaries" / "every message payload is untrusted and runtime
 * validated"). Browser-safe by construction (see `messages.ts`'s header);
 * `../host/document-gateway.ts` and `../webview-host/proxy-document-host.ts`
 * both validate every INBOUND message through this module before trusting
 * any field — never a coerced value, never a partial application.
 *
 * REUSE, not duplication (run spec DETAILS #1: "REUSE its helpers rather
 * than duplicating them"): `validateSourceEdit`/`validateDocumentSnapshot`
 * from `@dimm-city/gutterpress-editor/core` are the single source of truth
 * for the D3 `SourceEdit`/`DocumentSnapshot` SHAPE rules (missing field,
 * wrong type, non-finite/NaN offset, accessor/prototype-pollution defense);
 * this module calls them directly rather than re-deriving those rules. It
 * adds exactly two things those helpers do not cover, by their own design:
 * the wire ENVELOPE (`type`/`protocolVersion`) every message needs, and the
 * `from <= to` / non-negative RANGE-RELATIONSHIP check
 * `validateSourceEdit`'s own header explicitly defers to a snapshot-aware
 * caller (`from > to` is checkable without a snapshot; `to <= text.length`
 * is not, and stays `applyEdit`'s job downstream).
 */

/**
 * The SPECIFIC rejection shape identified (run spec behavior table,
 * "Malformed/hostile messages" row: "A wrong version, unknown type, missing
 * field, wrong type, non-finite or negative offset, or oversized payload is
 * rejected with the specific D14 category"). This six-member union IS the
 * "specific" classification; `diagnostics.ts`'s
 * `diagnosticForProtocolRejection` maps each reason to the closest EXISTING
 * D14 category — see that file's header for why no new category is minted
 * (`packages/editor/src/core/diagnostics.ts` is outside this lane's write
 * boundary, and D14's category list is fixed without a decision-record
 * amendment).
 */
export type ProtocolRejectionReason =
  | "wrong-protocol-version"
  | "unknown-message-type"
  | "missing-field"
  | "wrong-field-type"
  | "invalid-range"
  | "oversized-payload";

export interface ProtocolValidationFailure {
  readonly reason: ProtocolRejectionReason;
  readonly errors: readonly string[];
}

export type ProtocolValidationResult<T> =
  | { readonly valid: true; readonly value: T }
  | { readonly valid: false; readonly failure: ProtocolValidationFailure };

/**
 * Generic wire-level payload-size backstop — deliberately independent of
 * D13's business rule (`RICH_MODE_MAX_CONTENT_BYTES` in `../provider.ts`, a
 * Node-side, UTF-8-byte-accurate ceiling this module CANNOT reuse: it must
 * stay `Buffer`-free to remain browser-safe, per this package's
 * webview-purity rule). Measured in UTF-16 code units (`.length` — D1's own
 * offset unit) and set generously above D13's 2 MiB-of-UTF-8-bytes ceiling
 * so this backstop never rejects anything D13 would still allow through —
 * it exists purely to stop one malformed/hostile message from carrying an
 * unbounded string, not to enforce the real rich-mode size policy.
 */
const MAX_MESSAGE_STRING_LENGTH = 4 * 1024 * 1024;

/** Sentinel returned by `ownField` when the named property is an accessor
 *  (never invoked — see the doc comment below). */
const ACCESSOR: unique symbol = Symbol("vscode-extension-protocol-validate-accessor-rejected");

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Reads an OWN property by exact key via its property descriptor, exactly
 * mirroring `packages/editor/src/core/validate.ts`'s `ownField` defense
 * (prototype-pollution safe via `Object.getOwnPropertyDescriptor`, accessor
 * properties rejected rather than invoked — closes the same TOCTOU gap that
 * module's header describes). Reimplemented locally because `ownField` is
 * private to that module (not exported); the actual D3 SHAPE rules it backs
 * — where the real duplication risk would matter — are reused directly via
 * `validateSourceEdit`/`validateDocumentSnapshot` below, not re-derived.
 */
function ownField(obj: object, key: string): unknown {
  const descriptor = Object.getOwnPropertyDescriptor(obj, key);
  if (!descriptor) return undefined;
  if (descriptor.get || descriptor.set) return ACCESSOR;
  return descriptor.value;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function fail(
  reason: ProtocolRejectionReason,
  errors: readonly string[],
): { readonly valid: false; readonly failure: ProtocolValidationFailure } {
  return { valid: false, failure: { reason, errors } };
}

/**
 * Envelope check shared by both directions: plain object, a `type` drawn
 * from `allowedTypes`, and `protocolVersion` exactly `EDITOR_PROTOCOL_VERSION`.
 * Returns the validated `{type, protocolVersion}` pair so callers can
 * dispatch on `type` next without re-reading it unsafely.
 */
function validateEnvelope(
  message: unknown,
  allowedTypes: readonly string[],
): ProtocolValidationResult<{ readonly type: string; readonly protocolVersion: number }> {
  if (!isPlainObject(message)) {
    return fail("wrong-field-type", [`expected a plain object, got "${describeType(message)}"`]);
  }

  const type = ownField(message, "type");
  if (type === undefined) return fail("missing-field", ['missing required field "type"']);
  if (type === ACCESSOR) return fail("wrong-field-type", ['"type" must be a plain data property, not an accessor']);
  if (typeof type !== "string") return fail("wrong-field-type", ['"type" must be a string']);
  if (!allowedTypes.includes(type)) return fail("unknown-message-type", [`unknown message type "${type}"`]);

  const protocolVersion = ownField(message, "protocolVersion");
  if (protocolVersion === undefined) {
    return fail("missing-field", ['missing required field "protocolVersion"']);
  }
  if (protocolVersion === ACCESSOR) {
    return fail("wrong-field-type", ['"protocolVersion" must be a plain data property, not an accessor']);
  }
  if (typeof protocolVersion !== "number" || !Number.isFinite(protocolVersion)) {
    return fail("wrong-field-type", ['"protocolVersion" must be a finite number']);
  }
  if (protocolVersion !== EDITOR_PROTOCOL_VERSION) {
    return fail("wrong-protocol-version", [
      `protocolVersion ${protocolVersion} does not match EDITOR_PROTOCOL_VERSION ${EDITOR_PROTOCOL_VERSION}`,
    ]);
  }

  return { valid: true, value: { type, protocolVersion } };
}

/**
 * The `from <= to` / non-negative layer `validateSourceEdit` explicitly
 * does not cover (its own header: "Does NOT re-validate the D3 range rule
 * ... that requires a snapshot"). This layer needs no snapshot — unlike
 * `to <= text.length`, which stays deferred to wherever a real snapshot
 * exists (`applyEdit` from `@dimm-city/gutterpress-editor/core`, which both
 * `DocumentGateway` and `ProxyDocumentHost` already call downstream of this
 * validator).
 */
function validateEditRangeRelationship(edit: SourceEdit): readonly string[] {
  const errors: string[] = [];
  if (edit.from < 0) errors.push('"from" must not be negative');
  if (edit.to < 0) errors.push('"to" must not be negative');
  if (edit.from > edit.to) errors.push('"from" must not be greater than "to"');
  return errors;
}

/** Validates a nested `Diagnostic` payload (`diagnostic-report`,
 *  `presentation-input`, `disconnect`): `category` must be one of D14's
 *  fixed `DIAGNOSTIC_CATEGORIES`, `message` a string, `safeAction` an
 *  optional string. */
function validateDiagnostic(value: unknown): ProtocolValidationResult<Diagnostic> {
  if (!isPlainObject(value)) {
    return fail("wrong-field-type", [`"diagnostic" must be a plain object, got "${describeType(value)}"`]);
  }

  const category = ownField(value, "category");
  const message = ownField(value, "message");
  const safeAction = ownField(value, "safeAction");
  const errors: string[] = [];

  if (category === ACCESSOR) {
    errors.push('"diagnostic.category" must be a plain data property, not an accessor');
  } else if (typeof category !== "string" || !(DIAGNOSTIC_CATEGORIES as readonly string[]).includes(category)) {
    errors.push('"diagnostic.category" must be one of the D14 diagnostic categories');
  }

  if (message === ACCESSOR) {
    errors.push('"diagnostic.message" must be a plain data property, not an accessor');
  } else if (typeof message !== "string") {
    errors.push('"diagnostic.message" must be a string');
  }

  if (safeAction !== undefined) {
    if (safeAction === ACCESSOR) {
      errors.push('"diagnostic.safeAction" must be a plain data property, not an accessor');
    } else if (typeof safeAction !== "string") {
      errors.push('"diagnostic.safeAction" must be a string');
    }
  }

  if (errors.length > 0) {
    // A malformed nested diagnostic has no seventh dedicated reason among
    // the six named in this module's header — "wrong-field-type" is the
    // closest fit (the nested value's fields are the wrong shape).
    return fail("wrong-field-type", errors);
  }

  if ((message as string).length > MAX_MESSAGE_STRING_LENGTH) {
    return fail("oversized-payload", [
      `"diagnostic.message" exceeds the ${MAX_MESSAGE_STRING_LENGTH}-character wire ceiling`,
    ]);
  }

  return {
    valid: true,
    value: {
      category: category as DiagnosticCategory,
      message: message as string,
      ...(safeAction !== undefined ? { safeAction: safeAction as string } : {}),
    },
  };
}

// ── Webview -> Host ─────────────────────────────────────────────────────

/** Validates an inbound message on the HOST side (`../host/document-gateway.ts`
 *  / `../provider.ts`): `ready`, `apply-edit`, or `diagnostic-report`. */
export function validateWebviewToHostMessage(message: unknown): ProtocolValidationResult<WebviewToHostMessage> {
  const envelope = validateEnvelope(message, WEBVIEW_TO_HOST_MESSAGE_TYPES);
  if (!envelope.valid) return envelope;
  const obj = message as Record<string, unknown>;
  const { type, protocolVersion } = envelope.value;

  if (type === "ready") {
    return { valid: true, value: { type: "ready", protocolVersion } };
  }

  if (type === "apply-edit") {
    const editField = ownField(obj, "edit");
    if (editField === undefined) return fail("missing-field", ['missing required field "edit"']);
    if (editField === ACCESSOR) {
      return fail("wrong-field-type", ['"edit" must be a plain data property, not an accessor']);
    }
    const editResult = validateSourceEdit(editField);
    if (!editResult.valid) return fail("wrong-field-type", editResult.errors);

    const rangeErrors = validateEditRangeRelationship(editResult.value);
    if (rangeErrors.length > 0) return fail("invalid-range", rangeErrors);

    if (editResult.value.insert.length > MAX_MESSAGE_STRING_LENGTH) {
      return fail("oversized-payload", [`"insert" exceeds the ${MAX_MESSAGE_STRING_LENGTH}-character wire ceiling`]);
    }

    return { valid: true, value: { type: "apply-edit", protocolVersion, edit: editResult.value } };
  }

  if (type === "diagnostic-report") {
    const diagnosticField = ownField(obj, "diagnostic");
    if (diagnosticField === undefined) return fail("missing-field", ['missing required field "diagnostic"']);
    if (diagnosticField === ACCESSOR) {
      return fail("wrong-field-type", ['"diagnostic" must be a plain data property, not an accessor']);
    }
    const diagnosticResult = validateDiagnostic(diagnosticField);
    if (!diagnosticResult.valid) return diagnosticResult;
    return {
      valid: true,
      value: { type: "diagnostic-report", protocolVersion, diagnostic: diagnosticResult.value },
    };
  }

  // Unreachable: validateEnvelope already restricted `type` to
  // WEBVIEW_TO_HOST_MESSAGE_TYPES, and every member is handled above.
  return fail("unknown-message-type", [`unknown message type "${type}"`]);
}

/**
 * Mirrors `gutterpress/render`'s `PROJECTION_SCHEMA_VERSION` (currently `1`)
 * — NOT imported as a value: this file stays type-only + primitive checks by
 * design (see `messages.ts`'s header — "no VALUE import of any kind"), and
 * every other browser-facing consumer of `gutterpress/render` in this
 * codebase (`packages/editor/src/gutterpress/*.ts`) type-imports it too,
 * never as a value. A schema bump is a D1 decision-record amendment
 * regardless, so this literal moving out of lockstep with the real constant
 * is already a documented, deliberate-change scenario, not a silent-drift
 * risk.
 */
const KNOWN_PROJECTION_SCHEMA_VERSION = 1;

/**
 * SHALLOW, top-level structural check for `ProjectionMessage.projection` —
 * deliberately not a deep per-block validator. No runtime validator for the
 * full `GutterpressProjection` shape (every `ProjectedBlock` kind variant,
 * `GeneratedView`, `ProjectionDiagnostic`) exists anywhere in this codebase
 * today, including on the desktop, which consumes the identical type over
 * Electron IPC without one — the type's actual definition and invariants
 * (D6, D13's caps) are owned and already enforced by `createEditorProjection`
 * itself (`packages/cli/src/lib/markdown/editor-projection.ts`, outside this
 * package's write boundary this run). Deep-validating its own output a
 * second time here would be exactly the "hand-rolled scanner next to the
 * real parser" P3e's ruling warns against. This layer exists only to catch
 * a message that is not shaped like a projection AT ALL (missing/wrong-type
 * top-level fields) — the same rejection shapes the behavior table asks
 * for ("missing field, wrong type") — while trusting the host's own
 * production pipeline for everything nested inside `blocks`/`generated`/
 * `diagnostics`.
 */
function validateProjectionShape(value: unknown): ProtocolValidationResult<GutterpressProjection> {
  if (!isPlainObject(value)) {
    return fail("wrong-field-type", [`"projection" must be a plain object, got "${describeType(value)}"`]);
  }

  const schemaVersion = ownField(value, "schemaVersion");
  const sourceVersion = ownField(value, "sourceVersion");
  const blocks = ownField(value, "blocks");
  const generated = ownField(value, "generated");
  const diagnostics = ownField(value, "diagnostics");
  const errors: string[] = [];

  if (schemaVersion !== KNOWN_PROJECTION_SCHEMA_VERSION) {
    errors.push(`"projection.schemaVersion" must be ${KNOWN_PROJECTION_SCHEMA_VERSION}`);
  }
  if (typeof sourceVersion !== "number" || !Number.isFinite(sourceVersion)) {
    errors.push('"projection.sourceVersion" must be a finite number');
  }
  if (!Array.isArray(blocks)) errors.push('"projection.blocks" must be an array');
  if (!Array.isArray(generated)) errors.push('"projection.generated" must be an array');
  if (!Array.isArray(diagnostics)) errors.push('"projection.diagnostics" must be an array');

  if (errors.length > 0) return fail("wrong-field-type", errors);
  return { valid: true, value: value as unknown as GutterpressProjection };
}

/** Validates `ProjectionMessage.pluginErrors`: an array of plain
 *  `{pluginRef: string, message: string}` records. */
function validateProjectionPluginErrors(value: unknown): ProtocolValidationResult<readonly ProjectionPluginError[]> {
  if (!Array.isArray(value)) {
    return fail("wrong-field-type", [`"pluginErrors" must be an array, got "${describeType(value)}"`]);
  }
  const result: ProjectionPluginError[] = [];
  for (let i = 0; i < value.length; i++) {
    const entry = value[i];
    if (!isPlainObject(entry)) {
      return fail("wrong-field-type", [`"pluginErrors[${i}]" must be a plain object`]);
    }
    const pluginRef = ownField(entry, "pluginRef");
    const message = ownField(entry, "message");
    if (typeof pluginRef !== "string") {
      return fail("wrong-field-type", [`"pluginErrors[${i}].pluginRef" must be a string`]);
    }
    if (typeof message !== "string") {
      return fail("wrong-field-type", [`"pluginErrors[${i}].message" must be a string`]);
    }
    result.push({ pluginRef, message });
  }
  return { valid: true, value: result };
}

// ── Host -> Webview ──────────────────────────────────────────────────────

/** Validates an inbound message on the WEBVIEW side
 *  (`../webview-host/proxy-document-host.ts`): `snapshot`, `trust-state`,
 *  `presentation-input`, or `disconnect`. */
export function validateHostToWebviewMessage(message: unknown): ProtocolValidationResult<HostToWebviewMessage> {
  const envelope = validateEnvelope(message, HOST_TO_WEBVIEW_MESSAGE_TYPES);
  if (!envelope.valid) return envelope;
  const obj = message as Record<string, unknown>;
  const { type, protocolVersion } = envelope.value;

  if (type === "snapshot") {
    const snapshotField = ownField(obj, "snapshot");
    if (snapshotField === undefined) return fail("missing-field", ['missing required field "snapshot"']);
    if (snapshotField === ACCESSOR) {
      return fail("wrong-field-type", ['"snapshot" must be a plain data property, not an accessor']);
    }
    const snapshotResult = validateDocumentSnapshot(snapshotField);
    if (!snapshotResult.valid) return fail("wrong-field-type", snapshotResult.errors);
    if (snapshotResult.value.text.length > MAX_MESSAGE_STRING_LENGTH) {
      return fail("oversized-payload", [
        `"snapshot.text" exceeds the ${MAX_MESSAGE_STRING_LENGTH}-character wire ceiling`,
      ]);
    }
    return { valid: true, value: { type: "snapshot", protocolVersion, snapshot: snapshotResult.value } };
  }

  if (type === "trust-state") {
    const trusted = ownField(obj, "trusted");
    if (trusted === undefined) return fail("missing-field", ['missing required field "trusted"']);
    if (trusted === ACCESSOR) {
      return fail("wrong-field-type", ['"trusted" must be a plain data property, not an accessor']);
    }
    if (typeof trusted !== "boolean") return fail("wrong-field-type", ['"trusted" must be a boolean']);
    return { valid: true, value: { type: "trust-state", protocolVersion, trusted } };
  }

  if (type === "presentation-input") {
    const mode = ownField(obj, "mode");
    if (mode === undefined) return fail("missing-field", ['missing required field "mode"']);
    if (mode === ACCESSOR) return fail("wrong-field-type", ['"mode" must be a plain data property, not an accessor']);
    if (mode !== "rich" && mode !== "source-fallback") {
      return fail("wrong-field-type", ['"mode" must be "rich" or "source-fallback"']);
    }

    const diagnosticField = ownField(obj, "diagnostic");
    let diagnostic: Diagnostic | undefined;
    if (diagnosticField !== undefined) {
      if (diagnosticField === ACCESSOR) {
        return fail("wrong-field-type", ['"diagnostic" must be a plain data property, not an accessor']);
      }
      const diagnosticResult = validateDiagnostic(diagnosticField);
      if (!diagnosticResult.valid) return diagnosticResult;
      diagnostic = diagnosticResult.value;
    }

    return {
      valid: true,
      value: { type: "presentation-input", protocolVersion, mode, ...(diagnostic ? { diagnostic } : {}) },
    };
  }

  if (type === "disconnect") {
    const diagnosticField = ownField(obj, "diagnostic");
    if (diagnosticField === undefined) return fail("missing-field", ['missing required field "diagnostic"']);
    if (diagnosticField === ACCESSOR) {
      return fail("wrong-field-type", ['"diagnostic" must be a plain data property, not an accessor']);
    }
    const diagnosticResult = validateDiagnostic(diagnosticField);
    if (!diagnosticResult.valid) return diagnosticResult;
    return { valid: true, value: { type: "disconnect", protocolVersion, diagnostic: diagnosticResult.value } };
  }

  if (type === "projection") {
    const projectionField = ownField(obj, "projection");
    if (projectionField === undefined) return fail("missing-field", ['missing required field "projection"']);
    if (projectionField === ACCESSOR) {
      return fail("wrong-field-type", ['"projection" must be a plain data property, not an accessor']);
    }
    const projectionResult = validateProjectionShape(projectionField);
    if (!projectionResult.valid) return projectionResult;

    const pluginCss = ownField(obj, "pluginCss");
    if (pluginCss === undefined) return fail("missing-field", ['missing required field "pluginCss"']);
    if (pluginCss === ACCESSOR) {
      return fail("wrong-field-type", ['"pluginCss" must be a plain data property, not an accessor']);
    }
    if (typeof pluginCss !== "string") return fail("wrong-field-type", ['"pluginCss" must be a string']);
    if (pluginCss.length > MAX_MESSAGE_STRING_LENGTH) {
      return fail("oversized-payload", [`"pluginCss" exceeds the ${MAX_MESSAGE_STRING_LENGTH}-character wire ceiling`]);
    }

    const pluginErrorsField = ownField(obj, "pluginErrors");
    if (pluginErrorsField === undefined) return fail("missing-field", ['missing required field "pluginErrors"']);
    if (pluginErrorsField === ACCESSOR) {
      return fail("wrong-field-type", ['"pluginErrors" must be a plain data property, not an accessor']);
    }
    const pluginErrorsResult = validateProjectionPluginErrors(pluginErrorsField);
    if (!pluginErrorsResult.valid) return pluginErrorsResult;

    const diagnosticField = ownField(obj, "diagnostic");
    let diagnostic: Diagnostic | undefined;
    if (diagnosticField !== undefined) {
      if (diagnosticField === ACCESSOR) {
        return fail("wrong-field-type", ['"diagnostic" must be a plain data property, not an accessor']);
      }
      const diagnosticResult = validateDiagnostic(diagnosticField);
      if (!diagnosticResult.valid) return diagnosticResult;
      diagnostic = diagnosticResult.value;
    }

    return {
      valid: true,
      value: {
        type: "projection",
        protocolVersion,
        projection: projectionResult.value,
        pluginCss,
        pluginErrors: pluginErrorsResult.value,
        ...(diagnostic ? { diagnostic } : {}),
      },
    };
  }

  // Unreachable: validateEnvelope already restricted `type` to
  // HOST_TO_WEBVIEW_MESSAGE_TYPES, and every member is handled above.
  return fail("unknown-message-type", [`unknown message type "${type}"`]);
}
