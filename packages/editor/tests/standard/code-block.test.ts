import { describe, expect, test } from "bun:test";
import { applyCommand } from "../../src/web/standard/apply-command.ts";
import { commandState } from "../../src/web/standard/command-state.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";
import { applyViaHost } from "./support/round-trip.ts";

/** `toggle-code-block {lang?}` (run spec "Command list"). */

describe("toggle-code-block — fence (toggle-ON)", () => {
  test("caret-only on a blank line: fences an empty block", () => {
    const text = "";
    const result = applyCommand({ text, version: 0 }, { start: 0, endExclusive: 0 }, { kind: "toggle-code-block" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("```\n\n```");
  });

  test("with a language: opens with ```lang", () => {
    const text = "const x = 1;";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-code-block", lang: "js" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("```js\nconst x = 1;\n```");
  });

  test("multi-line selection: fences every touched line as one block", () => {
    const text = "line one\nline two";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-code-block" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("```\nline one\nline two\n```");
  });
});

describe("toggle-code-block — unfence (toggle-OFF)", () => {
  test("selection exactly spanning a fenced block: removes the fence lines, keeps content", () => {
    const text = "```js\nconst x = 1;\n```";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-code-block" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("const x = 1;");
  });

  test("an empty fenced block unfences to an empty string", () => {
    const text = "```\n\n```";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-code-block" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("");
  });

  test("a selection that only PARTLY overlaps a fenced block does not unfence (falls through to fence-ON)", () => {
    const text = "```\ncode\n```";
    // Selects only the opening fence + first content line, not the closer.
    const endExclusive = text.indexOf("code") + "code".length;
    const result = applyCommand({ text, version: 0 }, { start: 0, endExclusive }, { kind: "toggle-code-block" });
    if ("refused" in result) throw new Error("unexpected refusal");
    // Still produces valid, locally-scoped output — it wraps the touched
    // lines in a NEW fence rather than silently doing nothing.
    assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(result.edit.insert.startsWith("```\n")).toBe(true);
  });
});

describe("toggle-code-block — trailing-newline / unclosed-fence regressions", () => {
  test("a fence with an ordinary trailing newline unfences without dropping the closing fence", () => {
    const text = "```\na\n```\n";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-code-block" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("a\n");
    // No orphan fence delimiter left behind anywhere in the result.
    expect(after.includes("```")).toBe(false);
  });

  test("a fenced block preceded by other content, trailing newline included in the selection", () => {
    const text = 'intro\n```\na\n```\n';
    const start = text.indexOf("```");
    const result = applyCommand({ text, version: 0 }, { start, endExclusive: text.length }, { kind: "toggle-code-block" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("intro\na\n");
    expect(after.includes("```")).toBe(false);
  });

  test("an UNCLOSED fence never unfences — falls through to a non-destructive fence-ON, losing nothing", () => {
    const text = "```\na\nb";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-code-block" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    // Every authored line survives somewhere in the result — nothing (in
    // particular the unclosed fence's last line, "b") is silently dropped.
    expect(after).toContain("a");
    expect(after).toContain("b");
    expect(result.edit.insert.startsWith("```\n")).toBe(true);
  });

  test("commandState.active is false for an unclosed fence (never advertises the destructive toggle)", () => {
    const text = "```\na\nb";
    const state = commandState({ text, version: 0 }, { start: 0, endExclusive: text.length });
    expect(state["toggle-code-block"].active).toBe(false);
  });

  test("commandState.active is true, and matches the actual unfence, for the trailing-newline shape", () => {
    const text = "```\na\n```\n";
    const state = commandState({ text, version: 0 }, { start: 0, endExclusive: text.length });
    expect(state["toggle-code-block"].active).toBe(true);
  });
});

describe("toggle-code-block — idempotence and commandState", () => {
  test("idempotence: fence then unfence restores the original bytes", () => {
    const original = "const x = 1;\nconst y = 2;";
    const fenced = applyViaHost(original, { start: 0, endExclusive: original.length }, { kind: "toggle-code-block" });
    expect(fenced).toBe("```\nconst x = 1;\nconst y = 2;\n```");
    const unfenced = applyViaHost(fenced, { start: 0, endExclusive: fenced.length }, { kind: "toggle-code-block" });
    expect(unfenced).toBe(original);
  });

  test("commandState: active exactly when the touched range is exactly one fenced block", () => {
    const text = "```\ncode\n```";
    const exact = commandState({ text, version: 0 }, { start: 0, endExclusive: text.length });
    expect(exact["toggle-code-block"]).toEqual({ applicable: true, active: true });

    const partial = commandState({ text, version: 0 }, { start: 0, endExclusive: text.indexOf("code") });
    expect(partial["toggle-code-block"].active).toBe(false);
    expect(partial["toggle-code-block"].applicable).toBe(true);
  });
});
