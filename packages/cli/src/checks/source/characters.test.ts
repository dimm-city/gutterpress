import { describe, test, expect } from "bun:test";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getCheckById } from "../registry";
import { makeCtx } from "../../test-helpers/testkit";
import { createMarkdownRenderer } from "../../lib/markdown/renderer";
import { CHARACTER_PATTERN, describeCharacter } from "./character-table";

import "./characters";

/** Write one chapter into a fresh project dir and run the check over it. */
async function runOn(content: string) {
  const dir = await mkdtemp(join(tmpdir(), "gutterpress-characters-check-"));
  try {
    const file = join(dir, "chapter-01.md");
    await writeFile(file, content);
    const check = getCheckById("source.characters")!;
    return await check.run(makeCtx({ inputDir: dir, markdownFiles: [file] }));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

/** Every code point the pattern matches on its own. */
function matchedCodePoints(): number[] {
  const out: number[] = [];
  for (let cp = 0; cp <= 0x10ffff; cp++) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue;
    CHARACTER_PATTERN.lastIndex = 0;
    if (CHARACTER_PATTERN.test(String.fromCodePoint(cp))) out.push(cp);
  }
  return out;
}

describe("source.characters", () => {
  test("reports each character with its line, UTF-16 column, code and what to type", async () => {
    const results = await runOn("# Title\n\nThe door\u2014locked.\nShe said \u201Chi\u201D.\n");
    expect(results.map((r) => [r.line, r.column, r.code])).toEqual([
      [3, 9, "typographer"],
      [4, 10, "typographer"],
      [4, 13, "typographer"],
    ]);
    expect(results[0]!.severity).toBe("info");
    expect(results[0]!.message).toBe("Em dash (U+2014). Type --- instead; it prints the same.");
    expect(results[0]!.data).toEqual({ codePoint: 0x2014 });
  });

  test("covers every class", async () => {
    const results = await runOn(
      [
        "a\u2019b", // typographer
        "a\u2212b", // lookalike
        "a\u2192b \u{1F680}", // symbol, emoji
        "a\u200Bb", // invisible
        "a\u00A0b", // whitespace
        "a\u0007b", // control
        "a\uFFFDb", // replacement
        "a\uE001b", // private use
      ].join("\n"),
    );
    expect(results.map((r) => r.code)).toEqual([
      "typographer",
      "lookalike",
      "symbol",
      "symbol",
      "invisible",
      "whitespace",
      "control",
      "replacement",
      "private-use",
    ]);
    // Typography the typographer prints anyway is info; the rest can change
    // what prints, so it stays a warning.
    expect(results.map((r) => r.severity)).toEqual([
      "info",
      ...Array(8).fill("warning"),
    ]);
    expect(results[3]!.message).toBe("Emoji (U+1F680). Delete it, or type &#x1F680; if you meant it.");
    expect(results[4]!.message).toBe(
      "Zero-width space (U+200B). Delete it, or type &ZeroWidthSpace; if you meant it.",
    );
  });

  test("counts the column in UTF-16 units, the editor's unit, after an astral character", async () => {
    // U+1F680 is two UTF-16 units: the em dash sits at index 4, column 5.
    const [, dash] = await runOn("\u{1F680} x\u2014y");
    expect(dash!.column).toBe(5);
  });

  test("reports a byte-order mark at the start of a file", async () => {
    // It turns the first heading into a paragraph: `\uFEFF# Title` renders as <p>.
    const results = await runOn("\uFEFF# Title\n");
    expect(results).toHaveLength(1);
    expect(results[0]!.line).toBe(1);
    expect(results[0]!.column).toBe(1);
    expect(results[0]!.message).toBe("Byte-order mark (U+FEFF). Delete it.");
  });

  test("an emoji shown as text by default is reported only with the emoji selector", async () => {
    expect(await runOn("I \u2764 it")).toHaveLength(0);
    const results = await runOn("I \u2764\uFE0F it");
    expect(results.map((r) => r.message)).toEqual([
      "Emoji (U+2764). Delete it, or type &#x2764; if you meant it.",
    ]);
  });

  test("never reports the plain spellings, tabs, CRLF endings or other languages' quotation marks", async () => {
    const clean = [
      'She said "hi" --- then -- and... don\'t',
      "10&nbsp;kg co&shy;op &rarr; &bull; &#x1F680;",
      "\tindented\r",
      "\u00ABBonjour\u00BB \u2039a\u203A \u201E \u201A",
    ].join("\n");
    expect(await runOn(clean)).toEqual([]);
  });

  test("gutterpress-disable-next-line silences the line below it", async () => {
    const results = await runOn(
      "<!-- gutterpress-disable-next-line source.characters -- intended -->\na\u2014b\na\u2014b\n",
    );
    expect(results.map((r) => r.line)).toEqual([3]);
  });

  test("a clean file has no findings", async () => {
    expect(await runOn("# Title\n\nPlain text.\n")).toEqual([]);
  });
});

describe("character table", () => {
  test("every character the pattern matches has a description with a fix", () => {
    for (const cp of matchedCodePoints()) {
      const info = describeCharacter(String.fromCodePoint(cp));
      expect(info.name.length).toBeGreaterThan(0);
      expect(info.fix).not.toContain("undefined");
    }
  });

  test("each suggested spelling prints the character it replaces", () => {
    const md = createMarkdownRenderer();
    const typographer: Array<[string, string]> = [
      ["a --- b", "\u2014"],
      ["a -- b", "\u2013"],
      ['"a"', "\u201C"],
      ['"a"', "\u201D"],
      ["'a'", "\u2018"],
      ["don't", "\u2019"],
      ["a... b", "\u2026"],
    ];
    for (const [source, char] of typographer) {
      expect(describeCharacter(char).code).toBe("typographer");
      expect(md.render(source)).toContain(char);
    }
    // Every entity-spelled fix (symbols, invisible, whitespace) decodes back.
    const wrong = matchedCodePoints().filter((cp) => {
      const char = String.fromCodePoint(cp);
      const entity = /&#?\w+;/.exec(describeCharacter(char).fix)?.[0];
      return entity !== undefined && !md.render(`x${entity}x`).includes(char);
    });
    expect(wrong.map((cp) => cp.toString(16))).toEqual([]);
  });
});
