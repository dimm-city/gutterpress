/**
 * Table column alignment as `data-align`, not an inline style.
 *
 * markdown-it writes `|:--|--:|` as `style="text-align:left"` on every cell.
 * An inline style beats every stylesheet, so a book could never restyle a
 * column without `!important`. The same fact as a plain attribute,
 * `data-align="left|center|right"`, is applied by {@link TABLE_ALIGN_CSS} and
 * loses to the book's own rules.
 *
 * Only markdown-it's own exact `text-align:` value is converted. An author's
 * own `{style=…}` on a cell is left untouched.
 */
import type MarkdownIt from "markdown-it";

const ALIGN = /^text-align:(left|center|right)$/;

export function gpTableAlign(md: MarkdownIt): void {
  md.core.ruler.after("block", "gp_table_align", (state) => {
    for (const token of state.tokens) {
      if (token.type !== "th_open" && token.type !== "td_open") continue;
      const match = ALIGN.exec(token.attrGet("style") ?? "");
      if (!match) continue;
      token.attrs = (token.attrs ?? []).filter(([key]) => key !== "style");
      token.attrSet("data-align", match[1]!);
    }
  });
}

/**
 * The rules that apply `data-align`. `assemble.ts` injects them in their own
 * top-level layer declared AFTER every extension's, which puts them exactly
 * where the inline style they replace sat among those two: an author's
 * `:-:` in markdown still beats a plugin's default `th { text-align: left }`.
 * The book's own stylesheets are unlayered and so beat them at any
 * specificity, which is the point: `td[data-align="right"] { text-align:
 * center }` in `book.css` now works with no `!important`. (In `gp.marker`
 * instead, the rules would sit under the plugins and silently demote every
 * markdown alignment to a default.) `:where()` keeps them at zero specificity.
 */
export const TABLE_ALIGN_CSS = `
:where(th[data-align="left"], td[data-align="left"]) { text-align: left; }
:where(th[data-align="center"], td[data-align="center"]) { text-align: center; }
:where(th[data-align="right"], td[data-align="right"]) { text-align: right; }
`;
