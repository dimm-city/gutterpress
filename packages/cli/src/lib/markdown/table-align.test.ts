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

  test("the rules are zero-specificity", () => {
    for (const side of ["left", "center", "right"]) {
      expect(TABLE_ALIGN_CSS).toContain(
        `:where(th[data-align="${side}"], td[data-align="${side}"]) { text-align: ${side}; }`
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

  async function aligns(bookCss: string): Promise<string[]> {
    writeFileSync(join(dir, "styles", "book.css"), bookCss, "utf8");
    const config = resolveConfig({}, { extensions: ["./ext/look"], styles: ["styles/book.css"] });
    const { plugins, pluginStyles } = await loadPluginsWithCss(config.extensions, dir);
    const html = await renderChapters(dir, { styles: config.styles, files: ["chapter.md"], plugins, pluginStyles });
    const browser = await launchChromium();
    try {
      const page = await browser.newPage();
      await page.setContent(html);
      return await page.evaluate<string[]>(
        "[...document.querySelectorAll('tbody td')].map((td) => getComputedStyle(td).textAlign)"
      );
    } finally {
      await browser.close();
    }
  }

  test(
    "a markdown alignment still beats a plugin's default, and the book's CSS beats it without !important",
    async () => {
      expect(await aligns("p { margin: 0 }")).toEqual(["left", "center", "right", "left"]);
      expect(await aligns('td[data-align="right"] { text-align: center }')).toEqual(["left", "center", "center", "left"]);
      expect(await aligns("td { text-align: right }")).toEqual(["right", "right", "right", "right"]);
    },
    60000
  );
});
