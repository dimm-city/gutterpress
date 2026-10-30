import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

/**
 * Typography from plain typing: what markdown-it's `replacements` rule (the
 * `typographer` option, `renderer.ts`) makes, which every book through
 * 0.11.22 printed with, and what the user guide lists:
 *
 *   `---`  →  — (em dash)         `(c)`  →  ©    `+-`  →  ±
 *   `--`   →  – (en dash)         `(r)`  →  ®    `..`, `...`  →  … (`?...` → `?..`)
 *   `...`  →  … (ellipsis)        `(tm)` →  ™    `????` → `???`, `!!!!` → `!!!`, `,,` → `,`
 *
 * The patterns are markdown-it's own, kept verbatim, with one correction
 * (#426): a list labelled (a), (b), (c) keeps its labels. A `(c)` or `(r)`
 * prints as typed when it continues a lettered list — when the same file has
 * a `(b)` (or `(q)`), in the same case, before it. Curly quotes stay
 * markdown-it's `smartquotes` rule. Text inside an autolink is left alone, as
 * markdown-it leaves it; code spans, math and a backslash-escaped `\(c)` are
 * separate tokens and are never touched.
 */
const SCOPED = /\((c|tm|r)\)/gi;
const SYMBOLS: Record<string, string> = { c: "©", r: "®", tm: "™" };
/** The label a `(c)` / `(r)` follows when it is the next item of a lettered list. */
const LABEL_BEFORE: Record<string, string> = { c: "(b)", C: "(B)", r: "(q)", R: "(Q)" };
const LABELS = /\((b|q)\)/gi;
const RARE = /\+-|\.\.|\?\?\?\?|!!!!|,,|--/;
const EM_DASH = /(^|[^-])---(?=[^-]|$)/gm;
const EN_DASH_SPACED = /(^|\s)--(?=\s|$)/gm;
const EN_DASH = /(^|[^-\s])--(?=[^-\s]|$)/gm;
/** Cheap pre-test so untouched paragraphs cost one regex. */
const CANDIDATE = /\((?:c|tm|r|b|q)\)|\+-|\.\.|\?\?\?\?|!!!!|,,|--/i;

function replaceRare(text: string): string {
  return text
    .replace(/\+-/g, "±")
    .replace(/\.{2,}/g, "…")
    .replace(/([?!])…/g, "$1..")
    .replace(/([?!]){4,}/g, "$1$1$1")
    .replace(/,{2,}/g, ",")
    .replace(EM_DASH, "$1—")
    .replace(EN_DASH_SPACED, "$1–")
    .replace(EN_DASH, "$1–");
}

/** `seen`: the list labels (`(b)`, `(Q)`, …) the file has had so far; grows as the text is read. */
function replaceInText(children: Token[], seen: Set<string>): void {
  let insideAutolink = 0;
  for (const token of children) {
    if (token.type === "link_open" && token.info === "auto") insideAutolink++;
    if (token.type === "link_close" && token.info === "auto") insideAutolink--;
    if (token.type !== "text") continue;
    const typed = token.content;
    if (!insideAutolink) {
      let text = typed.replace(SCOPED, (match: string, name: string, offset: number) => {
        const label = LABEL_BEFORE[name];
        return label && (seen.has(label) || typed.slice(0, offset).includes(label))
          ? match
          : SYMBOLS[name.toLowerCase()]!;
      });
      if (RARE.test(text)) text = replaceRare(text);
      token.content = text;
    }
    for (const [label] of typed.matchAll(LABELS)) seen.add(label);
  }
}

/**
 * The quotation marks straight quotes print as — markdown-it's `quotes`
 * option: outer open, outer close, inner open, inner close — for the book's
 * language (manifest `language`, a BCP 47 tag). A language not listed gets
 * the English marks. Only the languages whose convention is settled are
 * here; add one with its source, not from memory. The desktop's selection
 * search must fold every mark here; its test reads this table.
 */
export const QUOTES: Record<string, string | string[]> = {
  en: "“”‘’",
  de: "„“‚‘",
  "de-ch": "«»‹›",
  "de-li": "«»‹›",
  fr: ["«\u00a0", "\u00a0»", "‹\u00a0", "\u00a0›"],
  es: "«»“”",
  it: "«»“”",
  pt: "«»“”",
  "pt-br": "“”‘’",
  ru: "«»„“",
  pl: "„”«»",
  cs: "„“‚‘",
  sk: "„“‚‘",
  sv: "””’’",
  fi: "””’’",
};

export function quotesFor(language?: string): string | string[] {
  const tag = (language ?? "en").toLowerCase();
  return QUOTES[tag] ?? QUOTES[tag.split("-")[0]!] ?? QUOTES.en!;
}

/** Replaces markdown-it's `replacements` rule, at its place in the core chain. */
export function gpTypography(md: MarkdownIt): void {
  md.disable("replacements");
  md.core.ruler.after("linkify", "gp_typography", (state) => {
    const seen = new Set<string>();
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children || !CANDIDATE.test(token.content)) continue;
      replaceInText(token.children, seen);
    }
  });
}
