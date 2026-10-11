import { describe, expect, test } from "bun:test";
import type { EditorCommand } from "../../src/core/commands.ts";
import { applyCommand } from "../../src/web/standard/apply-command.ts";
import { commandState } from "../../src/web/standard/command-state.ts";
import { assertLocalEdit } from "./support/assert-locality.ts";
import { applyViaHost } from "./support/round-trip.ts";

/**
 * `toggle-bold` / `toggle-italic` / `toggle-strike` / `toggle-inline-code`
 * (run spec "Command list" + "Toggle semantics"). Every case in this file
 * is exercised across all four commands via `WRAP_COMMANDS` below, so a
 * regression in the shared `wrapInline` helper shows up once per command
 * rather than once total.
 */

interface WrapCase {
  readonly kind: "toggle-bold" | "toggle-italic" | "toggle-strike" | "toggle-inline-code";
  readonly canonical: string;
  readonly altSpelling: string;
}

const WRAP_COMMANDS: WrapCase[] = [
  { kind: "toggle-bold", canonical: "**", altSpelling: "__" },
  { kind: "toggle-italic", canonical: "*", altSpelling: "_" },
  { kind: "toggle-strike", canonical: "~~", altSpelling: "~~" },
  { kind: "toggle-inline-code", canonical: "`", altSpelling: "`" },
];

function command(kind: WrapCase["kind"]): EditorCommand {
  return { kind };
}

describe.each(WRAP_COMMANDS)("$kind", ({ kind, canonical, altSpelling }) => {
  test("caret-only: inserts the delimiter pair with the caret-inside convention", () => {
    const text = "hello ";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 6, endExclusive: 6 }, command(kind));
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit).toEqual({
      from: 6,
      to: 6,
      insert: canonical + canonical,
      expectedVersion: 0,
    });
    const after = assertLocalEdit(text, result.edit);
    // Caret-inside convention (documented on `wrapInline`): the caller
    // places its cursor at `edit.from + canonical.length` — exactly between
    // the two inserted markers, with nothing else in between.
    const caretPos = result.edit.from + canonical.length;
    expect(after.slice(caretPos - canonical.length, caretPos)).toBe(canonical);
    expect(after.slice(caretPos, caretPos + canonical.length)).toBe(canonical);
  });

  test("partial selection: toggle-ON wraps exactly the selected text", () => {
    const text = "hello world";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 6, endExclusive: 11 }, command(kind));
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe(canonical + "world" + canonical);
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("hello " + canonical + "world" + canonical);
  });

  test("full-line selection: wraps the entire line", () => {
    const text = "whole line";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: text.length }, command(kind));
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe(canonical + "whole line" + canonical);
  });

  test("multi-line selection: wraps across the embedded newline", () => {
    const text = "first\nsecond";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 2, endExclusive: 8 }, command(kind));
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("fi" + canonical + "rst\nse" + canonical + "cond");
  });

  test("toggle-OFF: canonical spelling removed byte-exactly", () => {
    // Selection covers only the CONTENT ("world"), not the markers — the
    // markers sit immediately outside [start, endExclusive), which is what
    // `wrapInline` inspects to detect an existing wrap.
    const text = `hello ${canonical}world${canonical}!`;
    const start = 6 + canonical.length;
    const endExclusive = start + "world".length;
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start, endExclusive }, command(kind));
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("hello world!");
  });

  test("toggle-OFF: alternate spelling removed byte-exactly (not rewritten to canonical)", () => {
    const text = `hello ${altSpelling}world${altSpelling}!`;
    const start = 6 + altSpelling.length;
    const endExclusive = start + "world".length;
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start, endExclusive }, command(kind));
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("hello world!");
  });

  test("caret directly between an existing pair toggles OFF instead of nesting", () => {
    const text = `abc${canonical}${canonical}def`;
    const caret = 3 + canonical.length;
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: caret, endExclusive: caret }, command(kind));
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("abcdef");
  });

  test("idempotence: toggle-ON then toggle-OFF at the same position restores the original bytes", () => {
    const original = "hello world";
    const onceOn = applyViaHost(original, { start: 6, endExclusive: 11 }, command(kind));
    expect(onceOn).not.toBe(original);
    // "world" now sits `canonical.length` further along, still 5 chars wide.
    const newStart = 6 + canonical.length;
    const back = applyViaHost(onceOn, { start: newStart, endExclusive: newStart + 5 }, command(kind));
    expect(back).toBe(original);
  });

  test("idempotence on an empty caret: toggle-ON then toggle-OFF restores the original bytes", () => {
    const original = "prefix  suffix";
    const onceOn = applyViaHost(original, { start: 7, endExclusive: 7 }, command(kind));
    expect(onceOn).toBe(`prefix ${canonical}${canonical} suffix`);
    const back = applyViaHost(onceOn, { start: 7 + canonical.length, endExclusive: 7 + canonical.length }, command(kind));
    expect(back).toBe(original);
  });

  test("commandState reports active=true exactly when wrapped, applicable always true", () => {
    const wrapped = `x ${canonical}y${canonical} z`;
    const start = 2 + canonical.length; // "x " (2 chars) + the opening marker
    const endExclusive = start + 1; // the single-char content "y"
    const state = commandState({ text: wrapped, version: 0 }, { start, endExclusive });
    expect(state[kind].applicable).toBe(true);
    expect(state[kind].active).toBe(true);

    const plain = "x y z";
    const plainState = commandState({ text: plain, version: 0 }, { start: 2, endExclusive: 3 });
    expect(plainState[kind].applicable).toBe(true);
    expect(plainState[kind].active).toBe(false);
  });
});

describe("toggle-italic never mistakes a bold wrap for its own — cross-command marker-run regressions", () => {
  test("**bold** + toggle-italic does NOT strip the bold; it applies italic on top", () => {
    const text = "**bold**";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 2, endExclusive: 6 }, { kind: "toggle-italic" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    // The original "**bold**" survives, byte-exact, inside the result — the
    // bug this guards against replaced it with "*bold*" (deleted one `*`
    // from each side, permanently destroying the bold).
    expect(after).toContain("**bold**");
    expect(after).toBe("***bold***");
  });

  test("__bold__ + toggle-italic does NOT strip the bold; it applies italic on top", () => {
    const text = "__bold__";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 2, endExclusive: 6 }, { kind: "toggle-italic" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    // The original "bold" content is untouched, still flanked by the
    // original "__" pair — italic is applied INSIDE it, not stripped from
    // it.
    expect(after).toBe("__*bold*__");
  });

  test("*it* + toggle-bold applies bold around the existing italic (never mistaken for a bold unwrap)", () => {
    const text = "*it*";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 1, endExclusive: 3 }, { kind: "toggle-bold" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toContain("*it*");
    expect(after).toBe("***it***");
  });

  test("commandState toggle-italic.active is false on plain bold text (matches wrapInline's own decision)", () => {
    const state = commandState({ text: "**bold**", version: 0 }, { start: 2, endExclusive: 6 });
    expect(state["toggle-italic"].active).toBe(false);
    // Bold itself is still correctly reported active at the same selection.
    expect(state["toggle-bold"].active).toBe(true);
  });

  test("***x*** (bold+italic together) still toggles italic off correctly (the inner pair, not a false reject)", () => {
    const text = "***x***";
    const snapshot = { text, version: 0 };
    const result = applyCommand(snapshot, { start: 3, endExclusive: 4 }, { kind: "toggle-italic" });
    if ("refused" in result) throw new Error("unexpected refusal");
    const after = assertLocalEdit(text, result.edit);
    expect(after).toBe("**x**");
  });
});

describe("toggle-bold / toggle-italic distinct canonical spellings", () => {
  test("toggle-bold canonical is ** (never rewrites to __)", () => {
    const snapshot = { text: "x", version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "toggle-bold" });
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe("****");
  });

  test("toggle-italic canonical is * (never rewrites to _) — the documented desktop divergence", () => {
    const snapshot = { text: "x", version: 0 };
    const result = applyCommand(snapshot, { start: 0, endExclusive: 0 }, { kind: "toggle-italic" });
    if ("refused" in result) throw new Error("unexpected refusal");
    expect(result.edit.insert).toBe("**");
  });
});
