/**
 * Table column alignment as `data-align`, not an inline style.
 *
 * markdown-it writes `|:--|--:|` as `style="text-align:left"` on every cell.
 * An inline style beats every stylesheet, so a plugin or book could never
 * restyle a column without `!important`. The same fact as a plain attribute,
 * `data-align="left|center|right"`, is read by a zero-specificity rule in
 * `MARKER_CSS` (markers.js) and loses to any stylesheet rule, which is the
 * order every other core default has.
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
