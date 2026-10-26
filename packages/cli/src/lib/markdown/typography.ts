import type MarkdownIt from "markdown-it";
import type Token from "markdown-it/lib/token.mjs";

/**
 * Typography from plain typing — exactly the three sequences the character
 * check (`checks/source/character-table.ts`) tells an author to type:
 *
 *   `---`  →  — (em dash)
 *   `--`   →  – (en dash)
 *   `...`  →  … (ellipsis)
 *
 * Curly quotes stay markdown-it's own `smartquotes` rule (the `typographer`
 * option, `renderer.ts`). This rule REPLACES the `replacements` rule that
 * option also switches on: besides the dashes and the ellipsis, that rule
 * rewrote `(c)`, `(r)` and `(tm)` into ©, ® and ™, `+-` into ±, and
 * collapsed runs of `..`, `??`, `!!` and `,,` — conversions nothing in
 * Gutterpress asked for or told authors about, and that broke every list
 * labelled (a), (b), (c). A symbol an author wants is typed as itself; the
 * character check leaves © alone.
 *
 * The dash patterns are markdown-it's own, kept verbatim so a book prints
 * the dashes it always printed. Text inside an autolink is left alone, as
 * markdown-it leaves it; code spans and math are separate tokens and are
 * never touched.
 */
const EM_DASH = /(^|[^-])---(?=[^-]|$)/gm;
const EN_DASH_SPACED = /(^|\s)--(?=\s|$)/gm;
const EN_DASH = /(^|[^-\s])--(?=[^-\s]|$)/gm;
const ELLIPSIS = /\.\.\./g;
/** Cheap pre-test so untouched paragraphs cost one regex, not four. */
const CANDIDATE = /--|\.\.\./;

function replaceInText(children: Token[]): void {
  let insideAutolink = 0;
  for (let i = children.length - 1; i >= 0; i--) {
    const token = children[i]!;
    if (token.type === "text" && !insideAutolink && CANDIDATE.test(token.content)) {
      token.content = token.content
        .replace(ELLIPSIS, "…")
        .replace(EM_DASH, "$1—")
        .replace(EN_DASH_SPACED, "$1–")
        .replace(EN_DASH, "$1–");
    }
    // Walking backwards, so a close is met before its open.
    if (token.type === "link_close" && token.info === "auto") insideAutolink++;
    if (token.type === "link_open" && token.info === "auto") insideAutolink--;
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

export function gpTypography(md: MarkdownIt): void {
  md.disable("replacements");
  md.core.ruler.after("linkify", "gp_typography", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "inline" || !token.children || !CANDIDATE.test(token.content)) continue;
      replaceInText(token.children);
    }
  });
}
