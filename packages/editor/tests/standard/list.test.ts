import { describe, expect, test } from "bun:test";
import { applyCommand } from "../../src/web/standard/apply-command.ts";
import { commandState } from "../../src/web/standard/command-state.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";
import { applyViaHost } from "./support/round-trip.ts";

/** `toggle-list {bullet|ordered|task}` (run spec "Command list"). Multi-line
 *  at LINE granularity — see `blockquote.test.ts`'s header for why these
 *  pass `allowSharedBoundary: true`. */

describe("toggle-list — bullet", () => {
  test("caret-only: adds the '- ' marker", () => {
    const text = "item one";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: 0 },
      { kind: "toggle-list", variant: "bullet" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("- item one");
  });

  test("toggle-OFF removes an existing '- ' or '* ' marker", () => {
    for (const marker of ["- ", "* "]) {
      const text = `${marker}item one`;
      const result = applyCommand(
        { text, version: 0 },
        { start: 0, endExclusive: 0 },
        { kind: "toggle-list", variant: "bullet" },
      );
      if ("refused" in result) throw new Error("unexpected refusal");
      const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
      expect(after).toBe("item one");
    }
  });

  test("preserves existing indentation on toggle-ON and toggle-OFF", () => {
    const text = "  nested item";
    const on = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: 0 },
      { kind: "toggle-list", variant: "bullet" },
    );
    if ("refused" in on) throw new Error("unexpected refusal");
    const afterOn = assertLocalEdit(text, on.edit, { allowSharedBoundary: true });
    expect(afterOn).toBe("  - nested item");

    const off = applyCommand(
      { text: afterOn, version: 0 },
      { start: 0, endExclusive: 0 },
      { kind: "toggle-list", variant: "bullet" },
    );
    if ("refused" in off) throw new Error("unexpected refusal");
    const afterOff = assertLocalEdit(afterOn, off.edit, { allowSharedBoundary: true });
    expect(afterOff).toBe(text);
  });

  test("multi-line toggle-ON marks every touched line", () => {
    const text = "one\ntwo\nthree";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-list", variant: "bullet" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("- one\n- two\n- three");
  });

  test("idempotence: toggle-ON then toggle-OFF restores the original bytes", () => {
    const original = "first item";
    const on = applyViaHost(original, { start: 0, endExclusive: 0 }, { kind: "toggle-list", variant: "bullet" });
    const back = applyViaHost(on, { start: 0, endExclusive: 0 }, { kind: "toggle-list", variant: "bullet" });
    expect(back).toBe(original);
  });
});

describe("toggle-list — ordered", () => {
  test("caret-only on an isolated line: numbers it 1", () => {
    const text = "first item";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: 0 },
      { kind: "toggle-list", variant: "ordered" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("1. first item");
  });

  test("toggle-OFF removes an existing numbered prefix of any digit count", () => {
    const text = "42. an item";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: 0 },
      { kind: "toggle-list", variant: "ordered" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("an item");
  });

  test("multi-line toggle-ON renumbers the touched lines starting at 1", () => {
    const text = "alpha\nbeta\ngamma";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: text.length },
      { kind: "toggle-list", variant: "ordered" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("1. alpha\n2. beta\n3. gamma");
  });

  test("touched-contiguous-list extension: toggling ON against an existing numbered neighbor renumbers the whole run", () => {
    const text = "1. existing\nnew item";
    const start = text.indexOf("new item");
    const result = applyCommand(
      { text, version: 0 },
      { start, endExclusive: start + "new item".length },
      { kind: "toggle-list", variant: "ordered" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    // The edit's range extends UP to include the pre-existing "1. existing"
    // neighbor, not just the raw selection on "new item" — this is the
    // "smallest safe range" for the CONTIGUOUS list, per the run spec.
    expect(result.edit.from).toBe(0);
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("1. existing\n2. new item");
  });

  test("extension does not cross a blank-line list boundary", () => {
    const text = "1. existing\n\nnew item";
    const start = text.indexOf("new item");
    const result = applyCommand(
      { text, version: 0 },
      { start, endExclusive: start + "new item".length },
      { kind: "toggle-list", variant: "ordered" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("1. existing\n\n1. new item");
  });

  test("idempotence: toggle-ON then toggle-OFF (no adjacent list) restores the original bytes", () => {
    const original = "solo item";
    const on = applyViaHost(original, { start: 0, endExclusive: 0 }, { kind: "toggle-list", variant: "ordered" });
    const back = applyViaHost(on, { start: 0, endExclusive: 0 }, { kind: "toggle-list", variant: "ordered" });
    expect(back).toBe(original);
  });
});

describe("toggle-list — task", () => {
  test("caret-only: adds the '- [ ] ' marker", () => {
    const text = "buy milk";
    const result = applyCommand(
      { text, version: 0 },
      { start: 0, endExclusive: 0 },
      { kind: "toggle-list", variant: "task" },
    );
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("- [ ] buy milk");
  });

  test("toggle-OFF removes an existing checked or unchecked task marker", () => {
    for (const marker of ["- [ ] ", "- [x] ", "- [X] "]) {
      const text = `${marker}buy milk`;
      const result = applyCommand(
        { text, version: 0 },
        { start: 0, endExclusive: 0 },
        { kind: "toggle-list", variant: "task" },
      );
      if ("refused" in result) throw new Error("unexpected refusal");
      const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
      expect(after).toBe("buy milk");
    }
  });

  test("a task-marked line does not also read as an active bullet", () => {
    const state = commandState({ text: "- [ ] buy milk", version: 0 }, { start: 0, endExclusive: 0 });
    expect(state["toggle-list"].variant).toBe("task");
    expect(state["toggle-list"].active).toBe(true);
  });

  test("idempotence: toggle-ON then toggle-OFF restores the original bytes", () => {
    const original = "buy milk";
    const on = applyViaHost(original, { start: 0, endExclusive: 0 }, { kind: "toggle-list", variant: "task" });
    const back = applyViaHost(on, { start: 0, endExclusive: 0 }, { kind: "toggle-list", variant: "task" });
    expect(back).toBe(original);
  });
});

describe("toggle-list — commandState", () => {
  test("reports the active variant across bullet/ordered/task, or null", () => {
    expect(commandState({ text: "- a", version: 0 }, { start: 0, endExclusive: 3 })["toggle-list"].variant).toBe(
      "bullet",
    );
    expect(commandState({ text: "1. a", version: 0 }, { start: 0, endExclusive: 4 })["toggle-list"].variant).toBe(
      "ordered",
    );
    expect(
      commandState({ text: "- [ ] a", version: 0 }, { start: 0, endExclusive: 7 })["toggle-list"].variant,
    ).toBe("task");
    expect(commandState({ text: "plain", version: 0 }, { start: 0, endExclusive: 5 })["toggle-list"].variant).toBe(
      null,
    );
  });
});
