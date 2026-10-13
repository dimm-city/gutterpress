import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMarkdownRenderer } from "./renderer";
import { TABLE_ALIGN_CSS } from "./table-align";
import { renderChapters } from "./index";
import { resolveConfig } from "../manifest";
import { loadPluginsWithCss } from "./plugins";
import { launchChromium } from "../../engine/shared/cdp.ts";

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

  test("the rules are element + attribute (0,1,1), so they outrank a bare th/td rule", () => {
    for (const side of ["left", "center", "right"]) {
      expect(TABLE_ALIGN_CSS).toContain(
        `th[data-align="${side}"], td[data-align="${side}"] { text-align: ${side}; }`
      );
    }
  });
});

describe("where data-align sits in the cascade (computed style, Chromium)", () => {
  const root = join(process.cwd(), ".tmp", `table-align-${Date.now()}`);
  let dir: string;
  let n = 0;

  beforeEach(() => {
    dir = join(root, `p${n++}`);
    mkdirSync(join(dir, "styles"), { recursive: true });
    mkdirSync(join(dir, "ext", "look"), { recursive: true });
    writeFileSync(join(dir, "chapter.md"), TABLE, "utf8");
    // A plugin's default for every header cell, the very rule that used to lose to the inline style.
    writeFileSync(join(dir, "ext", "look", "package.json"), JSON.stringify({ name: "look", main: "plugin.js", gutterpress: { styles: ["look.css"] } }));
    writeFileSync(join(dir, "ext", "look", "plugin.js"), "export default function () {}\n");
    writeFileSync(join(dir, "ext", "look", "look.css"), "th, td { text-align: left; }\n");
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Computed text-align of `selector` cells: header cells then body cells, in a book with or without the look extension. */
  async function aligns(bookCss: string, selector = "tbody td", withExtension = true): Promise<string[]> {
    writeFileSync(join(dir, "styles", "book.css"), bookCss, "utf8");
    const config = resolveConfig({}, { extensions: withExtension ? ["./ext/look"] : [], styles: ["styles/book.css"] });
    const { plugins, pluginStyles } = await loadPluginsWithCss(config.extensions, dir);
    const html = await renderChapters(dir, { styles: config.styles, files: ["chapter.md"], plugins, pluginStyles });
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      return await page.evaluate<string[]>(
        `[...document.querySelectorAll(${JSON.stringify(selector)})].map((c) => getComputedStyle(c).textAlign)`
      );
    } finally {
      await browser.close();
    }
  }

  test(
    "a markdown alignment still beats a plugin's default, and a book rule as specific and later overrides it without !important",
    async () => {
      expect(await aligns("p { margin: 0 }")).toEqual(["left", "center", "right", "left"]);
      expect(await aligns('td[data-align="right"] { text-align: center }')).toEqual(["left", "center", "center", "left"]);
      // A less specific book rule (0,0,2) does not: that is the generic-rule case below.
      expect(await aligns("table td { text-align: right }")).toEqual(["left", "center", "right", "right"]);
    },
    60000
  );

  test(
    "no extensions: header AND body cells keep their markdown alignment against a book's generic th/td rule",
    async () => {
      // The user guide's and design guide's own `th { text-align: left }`, which the inline style used to beat.
      const generic = "th { text-align: left } td { text-align: left }";
      expect(await aligns(generic, "thead th", false)).toEqual(["left", "center", "right", "left"]);
      expect(await aligns(generic, "tbody td", false)).toEqual(["left", "center", "right", "left"]);
      // Without any book rule the UA default shows through for an unaligned column only.
      expect(await aligns("p { margin: 0 }", "thead th", false)).toEqual(["left", "center", "right", "center"]);
      // And the book can still override one column, header included, with no !important.
      expect(await aligns('th[data-align="center"], td[data-align="center"] { text-align: right }', "thead th", false)).toEqual(
        ["left", "right", "right", "center"]
      );
    },
    60000
  );
});
