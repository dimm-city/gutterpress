import { describe, expect, test } from "bun:test";
import { applyCommand } from "../../src/web/standard/apply-command.ts";
import { commandState } from "../../src/web/standard/command-state.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";

/** `insert-horizontal-rule` (run spec "Command list"). Insert-only — no
 *  toggle-OFF, so no idempotence-of-toggle-pairs case applies (documented,
 *  per the run spec's "command-specific decisions documented"). */

describe("insert-horizontal-rule", () => {
  test("caret at end of document: inserts the padded rule after the line", () => {
    const text = "paragraph text";
    const result = applyCommand(
      { text, version: 0 },
      { start: text.length, endExclusive: text.length },
      { kind: "insert-horizontal-rule" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("paragraph text\n\n---\n\n");
  });

  test("caret mid-line: still inserts at the LINE boundary, not the caret offset", () => {
    const text = "some paragraph text";
    const caret = 4; // inside "some"
    const result = applyCommand(
      { text, version: 0 },
      { start: caret, endExclusive: caret },
      { kind: "insert-horizontal-rule" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.from).toBe(text.length);
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe(text + "\n\n---\n\n");
  });

  test("non-empty selection: endExclusive is ignored — insertion point comes from selection.start's line", () => {
    const text = "some paragraph text";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: 4 },
      { kind: "insert-horizontal-rule" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.from).toBe(text.length);
  });

  test("commandState: always applicable, never reports active (no toggle state)", () => {
    const state = commandState({ text: "x", version: 0 }, { start: 0, endExclusive: 0 });
    expect(state["insert-horizontal-rule"]).toEqual({ applicable: true, active: false });
  });
});
