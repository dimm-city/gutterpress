import { describe, expect, test } from "bun:test";
import { applyCommand } from "../../src/web/standard/apply-command.ts";
import { commandState } from "../../src/web/standard/command-state.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";
import { applyViaHost } from "./support/round-trip.ts";

/** `toggle-blockquote` (run spec "Command list"). Multi-line commands are
 *  minimal at LINE granularity (D3: "multi-line commands span
 *  first-changed-line-start to last-changed-line-end"), not byte
 *  granularity, so these tests pass `allowSharedBoundary: true` to
 *  `assertLocalEdit` and instead assert line-boundary alignment directly. */

describe("toggle-blockquote", () => {
  test("caret-only on a plain line: adds the '> ' prefix", () => {
    const text = "some text";
    const result = applyCommand({ text, version: 0 }, { start: 0, endExclusive: 0 }, { kind: "toggle-blockquote" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("> some text");
    expect(result.edit.from).toBe(0);
    expect(result.edit.to).toBe(text.length);
  });

  test("caret-only on an already-quoted line: removes the '> ' prefix", () => {
    const text = "> some text";
    const result = applyCommand({ text, version: 0 }, { start: 0, endExclusive: 0 }, { kind: "toggle-blockquote" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("some text");
  });

  test("partial selection within one line still operates on the whole line", () => {
    const text = "some longer text";
    const result = applyCommand({ text, version: 0 }, { start: 5, endExclusive: 11 }, { kind: "toggle-blockquote" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("> " + text);
  });

  test("multi-line selection: every touched line is quoted together", () => {
    const text = "line one\nline two\nline three";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-blockquote" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("> line one\n> line two\n> line three");
  });

  test("multi-line toggle-OFF: every touched line is unquoted together", () => {
    const text = "> line one\n> line two";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-blockquote" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("line one\nline two");
  });

  test("edit range is exactly line-aligned: first-changed-line-start to last-changed-line-end", () => {
    const text = "before\nline one\nline two\nafter";
    const start = text.indexOf("line one");
    const endExclusive = text.indexOf("line two") + "line two".length;
    const result = applyCommand({ text, version: 0 }, { start, endExclusive }, { kind: "toggle-blockquote" });
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.from).toBe(text.indexOf("line one"));
    expect(result.edit.to).toBe(text.indexOf("line two") + "line two".length);
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("before\n> line one\n> line two\nafter");
  });

  test("idempotence: toggle-ON then toggle-OFF restores the original bytes", () => {
    const original = "para one\npara two";
    const on = applyViaHost(original, { start: 0, endExclusive: original.length }, { kind: "toggle-blockquote" });
    expect(on).not.toBe(original);
    const back = applyViaHost(on, { start: 0, endExclusive: on.length }, { kind: "toggle-blockquote" });
    expect(back).toBe(original);
  });

  test("commandState: active exactly when every touched line is already quoted", () => {
    const quoted = commandState({ text: "> a\n> b", version: 0 }, { start: 0, endExclusive: 7 });
    expect(quoted["toggle-blockquote"]).toEqual({ applicable: true, active: true });

    const mixed = commandState({ text: "> a\nb", version: 0 }, { start: 0, endExclusive: 5 });
    expect(mixed["toggle-blockquote"].active).toBe(false);
    expect(mixed["toggle-blockquote"].applicable).toBe(true);
  });
});
