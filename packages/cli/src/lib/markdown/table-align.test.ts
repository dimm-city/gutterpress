import { describe, expect, test } from "bun:test";
import { createMarkdownRenderer } from "./renderer";
import { MARKER_CSS } from "./markers.js";

const TABLE = "| Left | Mid | Right | None |\n|:--|:-:|--:|---|\n| a | b | c | d |\n";

describe("table cell alignment", () => {
  test("alignment is data-align on every th and td, with no inline style", () => {
    const html = createMarkdownRenderer().render(TABLE, {});
    expect(html).not.toContain("style=");
    expect(html.match(/<t[hd] data-align="left"/g)).toHaveLength(2);
    expect(html.match(/<t[hd] data-align="center"/g)).toHaveLength(2);
    expect(html.match(/<t[hd] data-align="right"/g)).toHaveLength(2);
    expect(html.match(/<t[hd]>/g)).toHaveLength(2);
  });

  test("an author's own style on a cell is left alone", () => {
    const html = createMarkdownRenderer().render('<table><tr><td style="text-align:right">x</td></tr></table>\n', {});
    expect(html).toContain('style="text-align:right"');
  });

  test("core styles data-align at zero specificity, so any stylesheet rule overrides it", () => {
    for (const side of ["left", "center", "right"]) {
      expect(MARKER_CSS).toContain(
        `:where(th[data-align="${side}"], td[data-align="${side}"]) { text-align: ${side}; }`
      );
    }
  });
});
