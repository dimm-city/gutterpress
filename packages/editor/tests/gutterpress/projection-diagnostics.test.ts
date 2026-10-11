import { describe, expect, test } from "bun:test";
import { DIAGNOSTIC_CATEGORIES } from "../../src/core/index.ts";
import { diagnosticForProjection } from "../../src/gutterpress/projection-diagnostics.ts";
import type { ProjectionDiagnostic } from "gutterpress/render";

/**
 * SFE-P2c repair round 1 (finding 5) — unit coverage for
 * `projection-diagnostics.ts`. See that module's own header, and
 * `match.ts`'s "REFUSED PLUGIN REGIONS" section, for the full decision
 * record this proves: a refused plugin-region (or any other projection
 * refusal/limit) reaches a consumer through `onDiagnostic`, not through a
 * per-block chip.
 */

describe("diagnosticForProjection", () => {
  test("EDITOR_UNSUPPORTED_PROJECTION passes through unchanged, states the safe action explicitly, and keeps the rule-named reason verbatim as the message", () => {
    const source: ProjectionDiagnostic = {
      category: "EDITOR_UNSUPPORTED_PROJECTION",
      reason:
        'Refusing: plugin core rule "aside_plugin_transform" reordered other tokens elsewhere ' +
        'in this document — a token that survives the plugin boundary appears in a different ' +
        'relative order before vs. after, so no local origin near "plugin_aside_open" can be ' +
        "trusted (interleaved edits). Edit this content in source mode.",
    };
    const diagnostic = diagnosticForProjection(source);
    expect(diagnostic.category).toBe("EDITOR_UNSUPPORTED_PROJECTION");
    // The rule-named reason is carried VERBATIM -- never rewritten,
    // truncated, or replaced with a generic string (the exact defect this
    // repair round closes at the projection layer).
    expect(diagnostic.message).toBe(source.reason);
    expect(diagnostic.message).toContain("aside_plugin_transform");
    expect(diagnostic.safeAction).toBe("Edit in source mode.");
  });

  test("EDITOR_PROJECTION_LIMIT also passes through with the same safe action", () => {
    const source: ProjectionDiagnostic = {
      category: "EDITOR_PROJECTION_LIMIT",
      reason: "Projection stopped at the 10,000-block cap (D13); the rest of this document has no block coverage. Edit in source mode.",
    };
    const diagnostic = diagnosticForProjection(source);
    expect(diagnostic.category).toBe("EDITOR_PROJECTION_LIMIT");
    expect(diagnostic.message).toBe(source.reason);
    expect(diagnostic.safeAction).toBe("Edit in source mode.");
  });

  test("both ProjectionDiagnosticCategory members are verbatim D14 DiagnosticCategory members -- the categories are not merely assumed compatible, they are asserted so", () => {
    expect(DIAGNOSTIC_CATEGORIES).toContain("EDITOR_UNSUPPORTED_PROJECTION");
    expect(DIAGNOSTIC_CATEGORIES).toContain("EDITOR_PROJECTION_LIMIT");
  });
});
