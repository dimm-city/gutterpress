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
 * The rules that apply `data-align`. `assemble.ts` injects them UNLAYERED,
 * just before the book's own stylesheets, and with the natural specificity of
 * an element plus an attribute (0,1,1). That puts them where the inline style
 * they replace sat against the two things that used to lose to it:
 *
 *   - a plugin's default (`th { text-align: left }`, always in a cascade
 *     layer): unlayered beats layered, so a markdown `:-:` still wins;
 *   - a book's generic element rule (`th { text-align: left }`, specificity
 *     0,0,1): the attribute selector outranks it, so the same book prints the
 *     same. Measured on the user guide and the design guide, whose `th` rule
 *     centred headers only until a layered version of these rules let it win.
 *
 * Unlike an inline style they can be overridden without `!important`: any
 * book rule at least as specific that comes later wins, e.g.
 * `td[data-align="right"] { text-align: center }` or `.stats td { … }`.
 */
export const TABLE_ALIGN_CSS = `
th[data-align="left"], td[data-align="left"] { text-align: left; }
th[data-align="center"], td[data-align="center"] { text-align: center; }
th[data-align="right"], td[data-align="right"] { text-align: right; }
`;
