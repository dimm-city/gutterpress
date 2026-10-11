import { describe, expect, test } from "bun:test";
import { applyCommand } from "../../src/web/standard/apply-command.ts";
import { commandState } from "../../src/web/standard/command-state.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";
import { applyViaHost } from "./support/round-trip.ts";

/** `set-heading {level 1-6 | none}` (run spec "Command list" + DETAILS). */

describe("set-heading — ATX", () => {
  test("plain line: inserts a fresh prefix for every level 1-6", () => {
    const levels = [1, 2, 3, 4, 5, 6] as const;
    for (const level of levels) {
      const text = "Title";
      const snapshot = { text, version: 0 };
      const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level });
      if ("refused" in result) throw new Error("unexpected refusal");
      const after = assertLocalEdit(text, result.edit);
      expect(after).toBe("#".repeat(level) + " Title");
    }
  });

  test("existing heading: rewriting to a DIFFERENT level is a minimal insertion, not a full replace", () => {
    const text = "## Old heading";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: 3 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("### Old heading");
    // D3 minimality: only the "#" run changed — a single-character
    // insertion, not a wholesale prefix replace.
    expect(result.edit.insert).toBe("#");
    expect(result.edit.to - result.edit.from).toBe(0);
  });

  test("existing heading: rewriting to the SAME level is a true no-op edit (from === to, insert empty)", () => {
    const text = "## Same level";
    const snapshot = { text, version: 3 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: 2 });
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe("");
    expect(result.edit.from).toBe(result.edit.to);
    expect(result.edit.expectedVersion).toBe(3);
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe(text);
  });

  test("level: none strips an existing prefix down to a plain paragraph line", () => {
    const text = "## Some heading";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 5, endExclusive: 5 }, { kind: "set-heading", level: "none" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("Some heading");
  });

  test("level: none on a line with no heading prefix is a true no-op edit", () => {
    const text = "plain paragraph";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 3, endExclusive: 3 }, { kind: "set-heading", level: "none" });
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe("");
    expect(result.edit.from).toBe(result.edit.to);
  });

  test("multi-line selection: only the FIRST line's heading changes (mirrors desktop applyHeading's caret-only scope)", () => {
    const text = "Para one\nPara two";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: text.length }, { kind: "set-heading", level: 1 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("# Para one\nPara two");
  });

  test("idempotence: set-heading(N) then set-heading(none) restores a plain paragraph's original bytes", () => {
    const original = "Chapter title";
    const withHeading = applyViaHost(original, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: 3 });
    expect(withHeading).toBe("### Chapter title");
    const stripped = applyViaHost(withHeading, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: "none" });
    expect(stripped).toBe(original);
  });
});

describe("set-heading — setext", () => {
  test("caret on the TEXT line converts a setext H1 (===) to ATX", () => {
    const text = "Title\n=====";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 2, endExclusive: 2 }, { kind: "set-heading", level: 2 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("## Title");
  });

  test("caret on the UNDERLINE line converts a setext H2 (---) to ATX identically", () => {
    const text = "Title\n-----";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 7, endExclusive: 7 }, { kind: "set-heading", level: 1 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("# Title");
  });

  test("level: none on a setext heading collapses it to a bare paragraph, dropping the underline", () => {
    const text = "Title\n=====\nNext para";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: "none" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("Title\nNext para");
  });

  test("ONLY the targeted heading's lines change: a following paragraph is untouched", () => {
    const text = "Title\n=====\nBody text unaffected";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: 3 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit, { allowSharedBoundary: true });
    expect(after).toBe("### Title\nBody text unaffected");
  });

  test("a `---` after a list item is a thematic break, NOT a setext underline — it survives untouched", () => {
    const text = "- a\n---";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: 2 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("## - a\n---");
    // Only the caret's own line (the list item) changed; the thematic
    // break's own bytes are untouched.
    expect(after.endsWith("\n---")).toBe(true);
  });

  test("a `---` after a blockquote is a thematic break, NOT a setext underline — it survives untouched", () => {
    const text = "> q\n---";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: 2 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("## > q\n---");
    expect(after.endsWith("\n---")).toBe(true);
  });

  test("an underline-shaped line directly under an ATX heading is NOT treated as setext", () => {
    // "## Title" followed by "---" is a heading then a thematic break /
    // table-ish line, not a setext pair (the line above is already ATX).
    const text = "## Title\n---";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: 4 });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("#### Title\n---");
  });
});

describe("set-heading — refusal", () => {
  test("inside a fenced code block: refused with an EDITOR_INVALID_RANGE diagnostic, source unchanged", () => {
    const text = "```\nconst x = 1;\n```";
    const snapshot = { text, version: 0 };
    // Caret on the "const x = 1;" line, inside the fence.
    const caret = text.indexOf("const");
    const result = applyCommand(snapshot, { start: caret, endExclusive: caret }, { kind: "set-heading", level: 2 });
    expect("refused" in result).toBe(true);
    if (!("refused" in result)) throw new Error("expected a refusal");
    expect(result.refused.category).toBe("EDITOR_INVALID_RANGE");
    expect(result.refused.message.length).toBeGreaterThan(0);
    expect(result.refused.safeAction).toBeDefined();
  });

  test("on the fence delimiter line itself is also refused (the fence line is inside its own block)", () => {
    const text = "```\ncode\n```";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "set-heading", level: 1 });
    expect("refused" in result).toBe(true);
  });

  test("a line AFTER a closed fence is NOT refused", () => {
    const text = "```\ncode\n```\nafter";
    const snapshot = { text, version: 0 };
    const caret = text.indexOf("after");
    const result = applyCommand(snapshot, { start: caret, endExclusive: caret }, { kind: "set-heading", level: 1 });
    expect("refused" in result).toBe(false);
  });
});

describe("set-heading — commandState", () => {
  test("headingLevel reports the active ATX level, or 'none'", () => {
    const withHeading = commandState({ text: "### Title", version: 0 }, { start: 0, endExclusive: 0 });
    expect(withHeading["set-heading"].level).toBe(3);
    expect(withHeading["set-heading"].active).toBe(true);
    expect(withHeading["set-heading"].applicable).toBe(true);

    const plain = commandState({ text: "Plain text", version: 0 }, { start: 0, endExclusive: 0 });
    expect(plain["set-heading"].level).toBe("none");
    expect(plain["set-heading"].active).toBe(false);
  });

  test("applicable is false exactly for the fenced-code-block refusal case (NEVER falsely false elsewhere)", () => {
    const text = "```\ncode\n```";
    const caret = text.indexOf("code");
    const inFence = commandState({ text, version: 0 }, { start: caret, endExclusive: caret });
    expect(inFence["set-heading"].applicable).toBe(false);

    const outsideFence = commandState({ text: "plain", version: 0 }, { start: 0, endExclusive: 0 });
    expect(outsideFence["set-heading"].applicable).toBe(true);
  });
});
