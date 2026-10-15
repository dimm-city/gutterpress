/**
 * special-characters — marks, in the editor, the characters the
 * `source.characters` check reports (#382): a box around each one that takes
 * up space (VS Code's Unicode highlighting is the model), and a visible
 * placeholder for each zero-width one, since a box around nothing shows
 * nothing. Hovering either says what the character is and what to type
 * instead, in the same words as the Problems panel.
 *
 * The data below mirrors core's `packages/cli/src/checks/source/character-table.ts`
 * verbatim: the SPA cannot value-import `gutterpress` (CLAUDE.md §8), so
 * `tests/editor/special-characters.test.ts` holds the two copies equal. Edit
 * core's first, then copy it here.
 *
 * Both marks come from the buffer, so they appear while the author types or
 * pastes, not only after the next save.
 */
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  highlightSpecialChars,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import type { Extension } from "@codemirror/state";

// ── Mirror of core's character-table.ts ─────────────────────────────────────

/** Stable id for the kind of character, carried on each finding's `code`. */
export type CharacterCode =
  /** The typographer makes it from plain typing (`---`, `"`, `...`). */
  | "typographer"
  /** Looks like a quote mark or hyphen but is not one. */
  | "lookalike"
  /** Bullets, arrows, marks and emoji. */
  | "symbol"
  /** Zero-width, format and bidi characters. */
  | "invisible"
  /** A space that is not a plain space. */
  | "whitespace"
  /** A control character. */
  | "control"
  /** U+FFFD, left where an encoding error lost the real character. */
  | "replacement"
  /** A private-use code point: a glyph only its own font has. */
  | "private-use";

export interface CharacterInfo {
  /** Plain-language name, e.g. "Em dash". */
  name: string;
  code: CharacterCode;
  /** What to do about it, as a sentence for the author. */
  fix: string;
}

/**
 * Every reported character, one code point at a time. Built from a string,
 * not a regex literal: Bun's transpiler turns `\u2028` / `\u2029` escapes in
 * a regex literal into the raw characters, which are line terminators, and
 * the file no longer parses. Emoji are those shown as emoji by default, plus
 * any pictograph followed by the emoji presentation selector (U+FE0F).
 */
export const CHARACTER_PATTERN = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u00A0\\u00AD\\u00B4\\u02BC" +
    "\\u061C\\u2000-\\u2015\\u2018\\u2019\\u201B-\\u201D\\u201F\\u2022\\u2026" +
    "\\u2028-\\u202F\\u2032\\u2033\\u205F\\u2060\\u2066-\\u2069\\u2190\\u2192" +
    "\\u2194\\u21D2\\u2212\\u25AA\\u25E6\\u2605\\u2713\\u2714\\u2717\\u3000" +
    "\\uE000-\\uF8FF\\uFEFF\\uFF02\\uFF07\\uFFFD]" +
    "|\\p{Emoji_Presentation}|\\p{Extended_Pictographic}(?=\\uFE0F)",
  "gu",
);

type Entry = [name: string, code: CharacterCode, spelling?: string];

/** Named characters. A missing spelling means there is nothing to type: delete it. */
const NAMED: Record<number, Entry> = {
  0x2014: ["Em dash", "typographer", "---"],
  0x2013: ["En dash", "typographer", "--"],
  0x201c: ["Opening curly quote", "typographer", '"'],
  0x201d: ["Closing curly quote", "typographer", '"'],
  0x2018: ["Opening curly single quote", "typographer", "'"],
  0x2019: ["Curly apostrophe", "typographer", "'"],
  0x2026: ["Ellipsis character", "typographer", "..."],

  0x02bc: ["Modifier-letter apostrophe", "lookalike", "'"],
  0x00b4: ["Acute accent", "lookalike", "'"],
  0x2032: ["Prime", "lookalike", "'"],
  0x2033: ["Double prime", "lookalike", '"'],
  0x201b: ["Reversed single quote", "lookalike", "'"],
  0x201f: ["Reversed double quote", "lookalike", '"'],
  0xff02: ["Full-width quote", "lookalike", '"'],
  0xff07: ["Full-width apostrophe", "lookalike", "'"],
  0x2010: ["Unicode hyphen", "lookalike", "-"],
  0x2011: ["Non-breaking hyphen", "lookalike", "-"],
  0x2012: ["Figure dash", "lookalike", "-"],
  0x2015: ["Horizontal bar", "lookalike", "---"],
  0x2212: ["Minus sign", "lookalike", "-"],

  0x2022: ["Bullet", "symbol", "&bull;"],
  0x25e6: ["White bullet", "symbol", "&#x25E6;"],
  0x25aa: ["Small square", "symbol", "&squf;"],
  0x2192: ["Right arrow", "symbol", "&rarr;"],
  0x2190: ["Left arrow", "symbol", "&larr;"],
  0x2194: ["Left-right arrow", "symbol", "&harr;"],
  0x21d2: ["Double right arrow", "symbol", "&rArr;"],
  0x2713: ["Check mark", "symbol", "&check;"],
  0x2714: ["Heavy check mark", "symbol", "&#x2714;"],
  0x2717: ["Ballot X", "symbol", "&cross;"],
  0x2605: ["Star", "symbol", "&starf;"],

  0x200b: ["Zero-width space", "invisible", "&ZeroWidthSpace;"],
  0x2060: ["Word joiner", "invisible", "&NoBreak;"],
  0xfeff: ["Byte-order mark", "invisible"],
  0x00ad: ["Soft hyphen", "invisible", "&shy;"],
  0x200c: ["Zero-width non-joiner", "invisible", "&zwnj;"],
  0x200d: ["Zero-width joiner", "invisible", "&zwj;"],
  0x200e: ["Left-to-right mark", "invisible", "&lrm;"],
  0x200f: ["Right-to-left mark", "invisible", "&rlm;"],
  0x061c: ["Arabic letter mark", "invisible", "&#x61C;"],
  0x202a: ["Left-to-right embedding", "invisible", "&#x202A;"],
  0x202b: ["Right-to-left embedding", "invisible", "&#x202B;"],
  0x202c: ["Pop directional formatting", "invisible", "&#x202C;"],
  0x202d: ["Left-to-right override", "invisible", "&#x202D;"],
  0x202e: ["Right-to-left override", "invisible", "&#x202E;"],
  0x2066: ["Left-to-right isolate", "invisible", "&#x2066;"],
  0x2067: ["Right-to-left isolate", "invisible", "&#x2067;"],
  0x2068: ["First-strong isolate", "invisible", "&#x2068;"],
  0x2069: ["Pop directional isolate", "invisible", "&#x2069;"],
  0x2028: ["Line separator", "invisible"],
  0x2029: ["Paragraph separator", "invisible"],

  0x00a0: ["Non-breaking space", "whitespace", "&nbsp;"],
  0x2000: ["En quad", "whitespace", "&#x2000;"],
  0x2001: ["Em quad", "whitespace", "&#x2001;"],
  0x2002: ["En space", "whitespace", "&ensp;"],
  0x2003: ["Em space", "whitespace", "&emsp;"],
  0x2004: ["Three-per-em space", "whitespace", "&#x2004;"],
  0x2005: ["Four-per-em space", "whitespace", "&#x2005;"],
  0x2006: ["Six-per-em space", "whitespace", "&#x2006;"],
  0x2007: ["Figure space", "whitespace", "&#x2007;"],
  0x2008: ["Punctuation space", "whitespace", "&#x2008;"],
  0x2009: ["Thin space", "whitespace", "&thinsp;"],
  0x200a: ["Hair space", "whitespace", "&hairsp;"],
  0x202f: ["Narrow non-breaking space", "whitespace", "&#x202F;"],
  0x205f: ["Medium mathematical space", "whitespace", "&#x205F;"],
  0x3000: ["Ideographic space", "whitespace", "&#x3000;"],

  0xfffd: ["Replacement character", "replacement"],
};

function fixFor(code: CharacterCode, spelling: string | undefined): string {
  switch (code) {
    case "typographer":
      return `Type ${spelling} instead; it prints the same.`;
    case "lookalike":
      return `Type ${spelling} instead.`;
    case "whitespace":
      return `Type a space, or ${spelling} if you meant it.`;
    case "symbol":
    case "invisible":
      return spelling ? `Delete it, or type ${spelling} if you meant it.` : "Delete it.";
    case "control":
      return "Delete it; it does not print.";
    case "replacement":
      return "Retype the character that was lost here.";
    case "private-use":
      return "Replace it with the character you meant; this one only shows in the font it came from.";
  }
}

function info(name: string, code: CharacterCode, spelling?: string): CharacterInfo {
  return { name, code, fix: fixFor(code, spelling) };
}

/**
 * Describe one character {@link CHARACTER_PATTERN} matched. Only called on
 * matches, so the emoji fallback is the only branch left at the end.
 */
export function describeCharacter(char: string): CharacterInfo {
  const cp = char.codePointAt(0)!;
  const named = NAMED[cp];
  if (named) return info(...named);
  if (cp <= 0x9f) return info("Control character", "control");
  if (cp >= 0xe000 && cp <= 0xf8ff) return info("Private-use character", "private-use");
  return info("Emoji", "symbol", `&#x${cp.toString(16).toUpperCase()};`);
}

/** `U+2014` for a character. */
export function codePointLabel(char: string): string {
  return `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`;
}

// ── Editor marks ────────────────────────────────────────────────────────────

/** The hover text: the Problems panel's message for the character. */
export function characterTitle(char: string): string {
  const { name, fix } = describeCharacter(char);
  return `${name} (${codePointLabel(char)}). ${fix}`;
}

/**
 * Exactly the `invisible` and `control` characters (the drift test holds this
 * to the table): the ones with no width, rendered as placeholders.
 */
export const ZERO_WIDTH_PATTERN = new RegExp(
  "[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F\\u00AD\\u061C" +
    "\\u200B-\\u200F\\u2028-\\u202E\\u2060\\u2066-\\u2069\\uFEFF]",
  // `g`: CodeMirror hands it straight to a MatchDecorator, which requires it.
  "gu",
);

function isZeroWidth(char: string): boolean {
  const { code } = describeCharacter(char);
  return code === "invisible" || code === "control";
}

const boxes = new MatchDecorator({
  regexp: CHARACTER_PATTERN,
  decorate: (add, from, to, match) => {
    if (isZeroWidth(match[0])) return;
    add(
      from,
      to,
      Decoration.mark({ class: "cm-gp-char", attributes: { title: characterTitle(match[0]) } }),
    );
  },
});

const boxPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = boxes.createDeco(view);
    }
    update(update: ViewUpdate) {
      this.decorations = boxes.updateDeco(update, this.decorations);
    }
  },
  { decorations: (plugin) => plugin.decorations },
);

/**
 * What a zero-width character shows as: a dotted circle, Unicode's own sign
 * for "nothing visible here". Not CodeMirror's default `•`, which is U+2022, a
 * character this check reports itself, so the two could not be told apart.
 */
export const PLACEHOLDER = "\u25CC";

/**
 * The placeholder, titled like the boxes. Only ZERO_WIDTH_PATTERN's
 * characters reach it: that pattern replaces CodeMirror's own list.
 */
function renderPlaceholder(code: number) {
  const span = document.createElement("span");
  span.textContent = PLACEHOLDER;
  span.title = characterTitle(String.fromCodePoint(code));
  span.className = "cm-specialChar";
  return span;
}

/**
 * Placeholders for the zero-width characters. Always on: they are what makes
 * an invisible character visible at all, not a problem mark.
 */
export function characterPlaceholders(): Extension {
  return highlightSpecialChars({ specialChars: ZERO_WIDTH_PATTERN, render: renderPlaceholder });
}

/**
 * Boxes around the characters with width. Problem highlighting, so they follow
 * "Highlight problems in the editor" (#383).
 */
export function characterBoxes(): Extension {
  return boxPlugin;
}
