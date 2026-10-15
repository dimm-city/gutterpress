/**
 * Drift gate for the editor's copy of core's character table (#382): the
 * editor marks exactly the characters `source.characters` reports, with the
 * same names and fixes, and draws placeholders for exactly the zero-width ones.
 */
import { describe, expect, test } from "bun:test";
import * as editor from "../../src/lib/editor/special-characters";

function loadCore() {
  return import("../../../cli/src/checks/source/character-table.ts");
}

/** Every code point except the surrogate halves, as a string. */
function* allCharacters(): Generator<string> {
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    yield String.fromCodePoint(cp);
  }
}

/** A stateless (non-`g`) copy of a pattern, for `.test()` in a loop. */
function stateless(pattern: RegExp): RegExp {
  return new RegExp(pattern.source, "u");
}

describe("special-characters mirrors core's character table", () => {
  test("the same pattern", async () => {
    const core = await loadCore();
    expect(editor.CHARACTER_PATTERN.source).toBe(core.CHARACTER_PATTERN.source);
    expect(editor.CHARACTER_PATTERN.flags).toBe(core.CHARACTER_PATTERN.flags);
  });

  test("the same name, code and fix for every character", async () => {
    const core = await loadCore();
    const flagged = stateless(core.CHARACTER_PATTERN);
    const differ: string[] = [];
    for (const char of allCharacters()) {
      if (!flagged.test(char)) continue;
      const a = JSON.stringify(core.describeCharacter(char));
      const b = JSON.stringify(editor.describeCharacter(char));
      if (a !== b) differ.push(core.codePointLabel(char));
    }
    expect(differ).toEqual([]);
  });

  test("the hover text is the check's message", () => {
    expect(editor.characterTitle("\u2014")).toBe(
      "Em dash (U+2014). Type --- instead; it prints the same.",
    );
  });
});

describe("zero-width characters get placeholders, the rest get boxes", () => {
  test("ZERO_WIDTH_PATTERN is exactly the invisible and control characters", () => {
    const flagged = stateless(editor.CHARACTER_PATTERN);
    const placeholder = stateless(editor.ZERO_WIDTH_PATTERN);
    const wrong: string[] = [];
    for (const char of allCharacters()) {
      const code = flagged.test(char) ? editor.describeCharacter(char).code : undefined;
      const zeroWidth = code === "invisible" || code === "control";
      if (zeroWidth !== placeholder.test(char)) {
        wrong.push(editor.codePointLabel(char));
      }
    }
    expect(wrong).toEqual([]);
  });

  test("the placeholder is not a character the check reports", () => {
    expect(stateless(editor.CHARACTER_PATTERN).test(editor.PLACEHOLDER)).toBe(false);
  });
});
