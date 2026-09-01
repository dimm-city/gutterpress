// Unit tests for src/protocol/validate.ts (SFE-P3c run spec DETAILS #1 /
// behavior table "Malformed/hostile messages" row): "A wrong version,
// unknown type, missing field, wrong type, non-finite or negative offset,
// or oversized payload is rejected with the specific D14 category; a
// fixture proves each shape and proves a valid control still passes"
// (AP-21). Every describe block below pairs its rejection fixtures with one
// VALID CONTROL of the same message type, so a validator that rejected
// EVERYTHING (or accepted everything) would still fail this suite.

import { describe, expect, test } from "bun:test";
import { EDITOR_PROTOCOL_VERSION } from "@dimm-city/gutterpress-editor/core";
import type { GutterpressProjection } from "gutterpress/render";
import { diagnosticForProtocolRejection } from "../../src/protocol/diagnostics.ts";
import { validateHostToWebviewMessage, validateWebviewToHostMessage } from "../../src/protocol/validate.ts";

const VALID_DIAGNOSTIC = { category: "EDITOR_INVALID_RANGE", message: "example", safeAction: "Reload" } as const;

// ── Webview -> Host ─────────────────────────────────────────────────────

describe("validateWebviewToHostMessage — envelope rejections (shared by every message type)", () => {
  test("valid control: 'ready' passes", () => {
    const result = validateWebviewToHostMessage({ type: "ready", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(result).toEqual({ valid: true, value: { type: "ready", protocolVersion: 1 } });
  });

  test("wrong protocol version is rejected as wrong-protocol-version", () => {
    const result = validateWebviewToHostMessage({ type: "ready", protocolVersion: 999 });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.reason).toBe("wrong-protocol-version");
      expect(diagnosticForProtocolRejection(result.failure).category).toBe("EDITOR_HOST_DISCONNECTED");
    }
  });

  test("unknown message type is rejected as unknown-message-type", () => {
    const result = validateWebviewToHostMessage({ type: "not-a-real-type", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("unknown-message-type");
  });

  test("missing 'type' field is rejected as missing-field", () => {
    const result = validateWebviewToHostMessage({ protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });

  test("missing 'protocolVersion' field is rejected as missing-field", () => {
    const result = validateWebviewToHostMessage({ type: "ready" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });

  test("wrong-type 'protocolVersion' (a string) is rejected as wrong-field-type", () => {
    const result = validateWebviewToHostMessage({ type: "ready", protocolVersion: "1" });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("a non-object message is rejected", () => {
    expect(validateWebviewToHostMessage("just a string").valid).toBe(false);
    expect(validateWebviewToHostMessage(null).valid).toBe(false);
    expect(validateWebviewToHostMessage(undefined).valid).toBe(false);
    expect(validateWebviewToHostMessage(42).valid).toBe(false);
    expect(validateWebviewToHostMessage([1, 2, 3]).valid).toBe(false);
  });

  test("an accessor 'type' property is rejected, never invoked (TOCTOU/prototype-pollution defense)", () => {
    let invoked = false;
    const hostile = {
      get type() {
        invoked = true;
        return "ready";
      },
      protocolVersion: EDITOR_PROTOCOL_VERSION,
    };
    const result = validateWebviewToHostMessage(hostile);
    expect(result.valid).toBe(false);
    expect(invoked).toBe(false);
  });
});

describe("validateWebviewToHostMessage — 'apply-edit' payload", () => {
  test("valid control passes", () => {
    const result = validateWebviewToHostMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 0, to: 3, insert: "hi", expectedVersion: 0 },
    });
    expect(result).toEqual({
      valid: true,
      value: {
        type: "apply-edit",
        protocolVersion: 1,
        edit: { from: 0, to: 3, insert: "hi", expectedVersion: 0 },
      },
    });
  });

  test("missing 'edit' field is rejected as missing-field", () => {
    const result = validateWebviewToHostMessage({ type: "apply-edit", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });

  test("wrong-type 'edit' field (missing sub-fields) is rejected as wrong-field-type", () => {
    const result = validateWebviewToHostMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("NaN 'from' offset is rejected as wrong-field-type (validateSourceEdit's own finite check)", () => {
    const result = validateWebviewToHostMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: Number.NaN, to: 3, insert: "x", expectedVersion: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("non-finite (+Infinity) 'to' offset is rejected as wrong-field-type", () => {
    const result = validateWebviewToHostMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 0, to: Number.POSITIVE_INFINITY, insert: "x", expectedVersion: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("negative 'from' offset is rejected as invalid-range", () => {
    const result = validateWebviewToHostMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: -1, to: 3, insert: "x", expectedVersion: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.reason).toBe("invalid-range");
      expect(diagnosticForProtocolRejection(result.failure).category).toBe("EDITOR_INVALID_RANGE");
    }
  });

  test("negative 'to' offset is rejected as invalid-range", () => {
    const result = validateWebviewToHostMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 0, to: -3, insert: "x", expectedVersion: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("invalid-range");
  });

  test("from > to is rejected as invalid-range", () => {
    const result = validateWebviewToHostMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 10, to: 2, insert: "x", expectedVersion: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("invalid-range");
  });

  test("an oversized 'insert' payload is rejected as oversized-payload", () => {
    const result = validateWebviewToHostMessage({
      type: "apply-edit",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      edit: { from: 0, to: 0, insert: "x".repeat(5 * 1024 * 1024), expectedVersion: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) {
      expect(result.failure.reason).toBe("oversized-payload");
      expect(diagnosticForProtocolRejection(result.failure).category).toBe("EDITOR_FILE_TOO_LARGE");
    }
  });
});

describe("validateWebviewToHostMessage — 'diagnostic-report' payload", () => {
  test("valid control passes", () => {
    const result = validateWebviewToHostMessage({
      type: "diagnostic-report",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      diagnostic: VALID_DIAGNOSTIC,
    });
    expect(result).toEqual({
      valid: true,
      value: { type: "diagnostic-report", protocolVersion: 1, diagnostic: VALID_DIAGNOSTIC },
    });
  });

  test("missing 'diagnostic' field is rejected as missing-field", () => {
    const result = validateWebviewToHostMessage({ type: "diagnostic-report", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });

  test("an unknown diagnostic category is rejected as wrong-field-type", () => {
    const result = validateWebviewToHostMessage({
      type: "diagnostic-report",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      diagnostic: { category: "NOT_A_REAL_CATEGORY", message: "x" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });
});

// ── Host -> Webview ──────────────────────────────────────────────────────

describe("validateHostToWebviewMessage — envelope rejections", () => {
  test("wrong protocol version is rejected as wrong-protocol-version", () => {
    const result = validateHostToWebviewMessage({
      type: "snapshot",
      protocolVersion: 2,
      snapshot: { text: "x", version: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-protocol-version");
  });

  test("unknown message type is rejected as unknown-message-type", () => {
    const result = validateHostToWebviewMessage({ type: "not-real", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("unknown-message-type");
  });
});

describe("validateHostToWebviewMessage — 'snapshot' payload", () => {
  test("valid control passes", () => {
    const result = validateHostToWebviewMessage({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: { text: "hello", version: 3 },
    });
    expect(result).toEqual({
      valid: true,
      value: { type: "snapshot", protocolVersion: 1, snapshot: { text: "hello", version: 3 } },
    });
  });

  test("missing 'snapshot' field is rejected as missing-field", () => {
    const result = validateHostToWebviewMessage({ type: "snapshot", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });

  test("wrong-type 'snapshot.version' (a string) is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: { text: "x", version: "0" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("an oversized 'snapshot.text' payload is rejected as oversized-payload", () => {
    const result = validateHostToWebviewMessage({
      type: "snapshot",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      snapshot: { text: "x".repeat(5 * 1024 * 1024), version: 0 },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("oversized-payload");
  });
});

describe("validateHostToWebviewMessage — 'trust-state' payload", () => {
  test("valid control passes", () => {
    const result = validateHostToWebviewMessage({
      type: "trust-state",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      trusted: true,
    });
    expect(result).toEqual({ valid: true, value: { type: "trust-state", protocolVersion: 1, trusted: true } });
  });

  test("wrong-type 'trusted' (a string) is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "trust-state",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      trusted: "yes",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });
});

describe("validateHostToWebviewMessage — 'presentation-input' payload", () => {
  test("valid control (rich, no diagnostic) passes", () => {
    const result = validateHostToWebviewMessage({
      type: "presentation-input",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      mode: "rich",
    });
    expect(result).toEqual({ valid: true, value: { type: "presentation-input", protocolVersion: 1, mode: "rich" } });
  });

  test("valid control (source-fallback, with diagnostic) passes", () => {
    const result = validateHostToWebviewMessage({
      type: "presentation-input",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      mode: "source-fallback",
      diagnostic: VALID_DIAGNOSTIC,
    });
    expect(result).toEqual({
      valid: true,
      value: { type: "presentation-input", protocolVersion: 1, mode: "source-fallback", diagnostic: VALID_DIAGNOSTIC },
    });
  });

  test("an invalid 'mode' value is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "presentation-input",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      mode: "not-a-real-mode",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });
});

describe("validateHostToWebviewMessage — 'disconnect' payload", () => {
  test("valid control passes", () => {
    const result = validateHostToWebviewMessage({
      type: "disconnect",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      diagnostic: { category: "EDITOR_HOST_DISCONNECTED", message: "gone" },
    });
    expect(result).toEqual({
      valid: true,
      value: { type: "disconnect", protocolVersion: 1, diagnostic: { category: "EDITOR_HOST_DISCONNECTED", message: "gone" } },
    });
  });

  test("missing 'diagnostic' field is rejected as missing-field (never optional — D14: no generic 'failed')", () => {
    const result = validateHostToWebviewMessage({ type: "disconnect", protocolVersion: EDITOR_PROTOCOL_VERSION });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });
});

describe("validateHostToWebviewMessage — 'projection' payload (SFE-P3c Lane B)", () => {
  const VALID_PROJECTION: GutterpressProjection = {
    schemaVersion: 1,
    sourceVersion: 0,
    blocks: [],
    generated: [],
    diagnostics: [],
  };

  test("valid control passes", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginCss: ".gp-callout { color: red; }",
      pluginErrors: [{ pluginRef: "./plugins/broken.js", message: "not found" }],
    });
    expect(result).toEqual({
      valid: true,
      value: {
        type: "projection",
        protocolVersion: 1,
        projection: VALID_PROJECTION,
        pluginCss: ".gp-callout { color: red; }",
        pluginErrors: [{ pluginRef: "./plugins/broken.js", message: "not found" }],
      },
    });
  });

  test("valid control WITH an optional diagnostic passes", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginCss: "",
      pluginErrors: [],
      diagnostic: VALID_DIAGNOSTIC,
    });
    expect(result.valid).toBe(true);
    if (result.valid) expect((result.value as { diagnostic?: unknown }).diagnostic).toEqual(VALID_DIAGNOSTIC);
  });

  test("missing 'projection' field is rejected as missing-field", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      pluginCss: "",
      pluginErrors: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });

  test("'projection' as a non-object is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: "not an object",
      pluginCss: "",
      pluginErrors: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("'projection.schemaVersion' of the wrong version is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: { ...VALID_PROJECTION, schemaVersion: 2 },
      pluginCss: "",
      pluginErrors: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("'projection.blocks' as a non-array is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: { ...VALID_PROJECTION, blocks: "not-an-array" },
      pluginCss: "",
      pluginErrors: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("missing 'pluginCss' field is rejected as missing-field", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginErrors: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });

  test("wrong-type 'pluginCss' (a number) is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginCss: 42,
      pluginErrors: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("an oversized 'pluginCss' payload is rejected as oversized-payload", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginCss: "x".repeat(5 * 1024 * 1024),
      pluginErrors: [],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("oversized-payload");
  });

  test("missing 'pluginErrors' field is rejected as missing-field", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginCss: "",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("missing-field");
  });

  test("'pluginErrors' as a non-array is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginCss: "",
      pluginErrors: "not-an-array",
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("a 'pluginErrors' entry missing 'message' is rejected as wrong-field-type", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginCss: "",
      pluginErrors: [{ pluginRef: "./x.js" }],
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });

  test("an invalid optional 'diagnostic' is rejected (same rule as every other message)", () => {
    const result = validateHostToWebviewMessage({
      type: "projection",
      protocolVersion: EDITOR_PROTOCOL_VERSION,
      projection: VALID_PROJECTION,
      pluginCss: "",
      pluginErrors: [],
      diagnostic: { category: "NOT_A_REAL_CATEGORY", message: "x" },
    });
    expect(result.valid).toBe(false);
    if (!result.valid) expect(result.failure.reason).toBe("wrong-field-type");
  });
});

describe("diagnosticForProtocolRejection — every reason maps to an EXISTING D14 category, never a generic 'failed'", () => {
  const reasons = [
    "wrong-protocol-version",
    "unknown-message-type",
    "missing-field",
    "wrong-field-type",
    "invalid-range",
    "oversized-payload",
  ] as const;

  for (const reason of reasons) {
    test(`"${reason}" produces a Diagnostic with a non-empty message and a real category`, () => {
      const diagnostic = diagnosticForProtocolRejection({ reason, errors: ["example"] });
      expect(typeof diagnostic.category).toBe("string");
      expect(diagnostic.category.startsWith("EDITOR_")).toBe(true);
      expect(diagnostic.message.length).toBeGreaterThan(0);
    });
  }
});
