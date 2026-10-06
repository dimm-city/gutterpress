/**
 * SFE-P3d-sweep Lane B — deterministic, seeded markdown corpus generator
 * for the D13 performance evidence (mount-to-interactive / edit-to-paint at
 * 25 KiB, 100 KiB, 250 KiB, and 1 MiB).
 *
 * `tests/corpus/fixtures.ts` is a small, FIXED dictionary of hand-written
 * byte-identity fixtures (SFE-P2a) — a corpus of individually meaningful
 * documents, not a size-targeted generator, so there is no existing
 * "produce a realistic N-KiB document" approach to reuse directly. What IS
 * reused from `tests/corpus`: its seeded-PRNG primitive, `mulberry32`
 * (`tests/corpus/support/command-harness.ts`), imported here rather than
 * re-implemented. The run's governing posture (SFE-P3e product-owner
 * ruling: "simplify instead of adding machinery... a hand-rolled X next to
 * the real Y is machinery we do not need") is written about production
 * code, but the same reasoning applies to test infrastructure — a second
 * hand-rolled PRNG beside an already-committed, already-tested one buys
 * nothing.
 *
 * Output is realistic markdown IN SHAPE — headings, paragraphs, lists,
 * fenced code, and a sparse sprinkling of Gutterpress structural marker
 * lines (`@page`, `@page-break`, `@section`, in the exact bare-line form
 * `tests/gutterpress/provider.test.ts` and `limits.btest.ts` use) — never
 * in literal wording. This run mounts documents through the PLAIN
 * `mountEditor` (`src/web/mount.ts`, "the fork surface" per this run's own
 * DETAILS), not the Gutterpress-projection-aware `mountGutterpressEditor`,
 * so the marker lines exist here purely as REALISTIC CONTENT SHAPE —
 * ordinary paragraph-like lines from the base editor's point of view — not
 * because this harness expects `mountEditor` to recognize or project them.
 *
 * Pure ASCII vocabulary throughout (word bank, punctuation, code sample),
 * deliberately: `string.length` (UTF-16 code units) then equals the UTF-8
 * byte count for every generated document, so the "N KiB" labels this
 * suite reports are exact byte counts, not approximations.
 */
import { mulberry32 } from "../../corpus/support/command-harness.ts";

export const KIB = 1024;
export const MIB = 1024 * 1024;

const WORD_BANK: readonly string[] = [
  "gutterpress", "chapter", "layout", "author", "preview", "engine", "source",
  "markdown", "paragraph", "margin", "column", "spread", "binding", "press",
  "proof", "folio", "kerning", "ligature", "glyph", "stanza", "verse",
  "narrative", "chronicle", "manuscript", "draft", "revision", "galley",
  "signature", "imprint", "colophon", "typeface", "leading", "gutterway",
  "recto", "verso", "plate", "frontispiece", "reader", "writer", "editor",
  "publisher", "project", "plugin", "theme", "style", "render", "export",
  "build", "publish", "the", "quick", "brown", "fox", "jumps", "over",
  "lazy", "dog", "story", "book", "print", "paper", "page", "design",
  "craft", "word", "line", "voice", "tone", "scene", "character",
  "setting", "plot", "detail", "texture", "chapter", "opening", "closing",
];

/** Bare-line Gutterpress structural markers — "a few," sprinkled sparsely. */
const MARKER_LINES: readonly string[] = [
  "@page splash",
  "@page-break",
  "@section .gp-columns-2",
];

function pick(rand: () => number, items: readonly string[]): string {
  const index = Math.min(items.length - 1, Math.floor(rand() * items.length));
  return items[index]!;
}

function capitalize(word: string): string {
  return word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1);
}

function buildWords(rand: () => number, count: number): string[] {
  const words: string[] = [];
  for (let i = 0; i < count; i++) words.push(pick(rand, WORD_BANK));
  return words;
}

function buildSentence(rand: () => number): string {
  const words = buildWords(rand, 6 + Math.floor(rand() * 9)); // 6..14 words
  words[0] = capitalize(words[0]!);
  return `${words.join(" ")}.`;
}

function buildParagraph(rand: () => number): string {
  const sentenceCount = 3 + Math.floor(rand() * 4); // 3..6 sentences
  const sentences: string[] = [];
  for (let i = 0; i < sentenceCount; i++) sentences.push(buildSentence(rand));
  return sentences.join(" ");
}

function buildHeading(rand: () => number, chapterNumber: number): string {
  const level = 1 + Math.floor(rand() * 2); // "##" or "###" — shallow, realistic
  const title = buildWords(rand, 2).map(capitalize).join(" ");
  return `${"#".repeat(level + 1)} Chapter ${chapterNumber}: ${title}`;
}

function buildList(rand: () => number): string {
  const itemCount = 3 + Math.floor(rand() * 4); // 3..6 items
  const lines: string[] = [];
  for (let i = 0; i < itemCount; i++) {
    const words = buildWords(rand, 3 + Math.floor(rand() * 5));
    lines.push(`- ${capitalize(words.join(" "))}`);
  }
  return lines.join("\n");
}

function buildFence(rand: () => number, index: number): string {
  return [
    "```",
    `function chapter${index}Sample() {`,
    `  const ${pick(rand, WORD_BANK)} = ${1 + Math.floor(rand() * 100)};`,
    `  return ${pick(rand, WORD_BANK)};`,
    "}",
    "```",
  ].join("\n");
}

/**
 * Generates deterministic, realistic markdown of approximately
 * `targetBytes` UTF-8 bytes (exact, given the ASCII-only vocabulary — see
 * this module's header). The SAME `seed` always produces the SAME
 * document, byte for byte — which is what lets this run's "run the 250 KiB
 * measurement at least twice" variance check compare two runs against
 * literally the same input document.
 *
 * Content mix, chosen by a fixed block-index cadence (not by `rand()`, so
 * the block-KIND sequence is trivially reviewable): mostly paragraphs, a
 * heading roughly every 17 blocks, a list roughly every 11, a fenced code
 * block roughly every 23, and a sparse structural marker line every 40 —
 * "prose + headings + lists + fences + a few markers" per this run's own
 * DETAILS.
 */
export function generateMarkdownCorpus(targetBytes: number, seed = 0x6770_5266 /* "gpRf" */): string {
  const rand = mulberry32(seed);
  const blocks: string[] = [];
  let chapterNumber = 1;
  let fenceIndex = 1;
  let length = 0;
  let blockIndex = 0;

  while (length < targetBytes) {
    let block: string;
    if (blockIndex > 0 && blockIndex % 40 === 0) {
      block = pick(rand, MARKER_LINES);
    } else if (blockIndex > 0 && blockIndex % 17 === 0) {
      block = buildHeading(rand, chapterNumber++);
    } else if (blockIndex > 0 && blockIndex % 11 === 0) {
      block = buildList(rand);
    } else if (blockIndex > 0 && blockIndex % 23 === 0) {
      block = buildFence(rand, fenceIndex++);
    } else {
      block = buildParagraph(rand);
    }
    blocks.push(block);
    length += block.length + 2; // "+2" accounts for the "\n\n" join below.
    blockIndex++;
  }

  const joined = `${blocks.join("\n\n")}\n`;
  return joined.length > targetBytes ? joined.slice(0, targetBytes) : joined;
}
