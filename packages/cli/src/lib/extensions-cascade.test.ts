/**
 * #265 acceptance — the cascade contract, pinned end to end through the real
 * loader and renderer:
 *
 *   1. the `extensions:` list order IS the CSS include order: swapping two
 *      style-carrying extensions swaps whose rule comes last, and so wins a
 *      tie at equal specificity;
 *   2. the same list order IS the markdown registration order;
 *   3. the project's own `styles:` come after every extension, whatever the
 *      list order — an author rule beats an extension rule by position alone,
 *      and core's layered blocks sit before all of them;
 *   4. each extension's CSS sits in its own cascade layer (`ext.<name>`), in
 *      list order, so the list order holds even when an earlier extension
 *      leaves its CSS unlayered and a later one layers its own — and the
 *      book's unlayered `styles:` beat them all. Proved on computed style in
 *      Chromium, not on string positions.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { resolveConfig } from "./manifest";
import { loadPluginsWithCss } from "./markdown/plugins";
import { createMarkdownRenderer } from "./markdown/renderer";
import { renderChapters } from "./markdown/index";
import { launchChromium } from "../engine/shared/cdp.ts";

const TMP_ROOT = join(process.cwd(), ".tmp", `extensions-cascade-${Date.now()}`);
let counter = 0;

function writeLook(dir: string, id: string, color: string, css = `.tie { color: ${color}; }\n`): void {
  const ext = join(dir, "ext", id);
  mkdirSync(join(ext, "css"), { recursive: true });
  writeFileSync(
    join(ext, "package.json"),
    JSON.stringify({ name: id, main: "plugin.js", gutterpress: { styles: ["css/look.css"] } }),
    "utf8",
  );
  writeFileSync(
    join(ext, "plugin.js"),
    `export default function (md) { (md.__order ??= []).push(${JSON.stringify(id)}); }\n`,
    "utf8",
  );
  writeFileSync(join(ext, "css", "look.css"), css, "utf8");
}

async function render(
  dir: string,
  order: string[],
): Promise<{ html: string; registration: string[] }> {
  const config = resolveConfig({}, { extensions: order, styles: ["styles/book.css"] });
  const { plugins, pluginStyles } = await loadPluginsWithCss(config.extensions, dir);
  const md = createMarkdownRenderer(plugins) as unknown as { __order?: string[] };
  const html = await renderChapters(dir, {
    styles: config.styles,
    files: ["chapter.md"],
    plugins,
    pluginStyles,
  });
  return { html, registration: md.__order ?? [] };
}

describe("extensions cascade contract (#265)", () => {
  let dir: string;

  beforeEach(() => {
    dir = join(TMP_ROOT, `proj-${counter++}`);
    mkdirSync(join(dir, "styles"), { recursive: true });
    writeFileSync(join(dir, "chapter.md"), "# Hi\n\nBody.\n", "utf8");
    writeFileSync(join(dir, "styles", "book.css"), ".tie { color: green; }\n", "utf8");
    writeLook(dir, "alpha", "red");
    writeLook(dir, "beta", "blue");
  });

  afterEach(() => {
    rmSync(TMP_ROOT, { recursive: true, force: true });
  });

  test("list order is the CSS include order — swapping the list swaps the tie winner", async () => {
    const ab = await render(dir, ["./ext/alpha", "./ext/beta"]);
    expect(ab.html).toContain("color: red");
    expect(ab.html.indexOf("color: red")).toBeLessThan(ab.html.indexOf("color: blue"));

    const ba = await render(dir, ["./ext/beta", "./ext/alpha"]);
    expect(ba.html.indexOf("color: blue")).toBeLessThan(ba.html.indexOf("color: red"));
  });

  test("each extension's CSS is wrapped in its own layer, declared after core's, in list order", async () => {
    const { html } = await render(dir, ["./ext/alpha", "./ext/beta"]);
    const at = (s: string) => {
      const i = html.indexOf(s);
      expect(i, s).toBeGreaterThan(-1);
      return i;
    };
    expect(at("@layer gp.marker, gp.vocab;")).toBeLessThan(at("@layer ext.alpha, ext.beta;"));
    expect(at("@layer ext.alpha, ext.beta;")).toBeLessThan(at("@layer ext.alpha {"));
    expect(at("@layer ext.alpha {")).toBeLessThan(at("color: red"));
    expect(at("color: red")).toBeLessThan(at("@layer ext.beta {"));
    expect(at("@layer ext.beta {")).toBeLessThan(at("color: blue"));
    expect(at("color: blue")).toBeLessThan(at("color: green"));
  });

  test(
    "computed style: an unlayered earlier extension loses to a layered later one, and the book beats both",
    async () => {
      // The bug this guards: an extension whose CSS is unlayered used to beat
      // every layered extension after it, whatever the list said.
      writeLook(dir, "alpha", "red", "p { color: red; }\n");
      writeLook(dir, "beta", "blue", "@layer beta { p { color: blue; } }\n");
      writeFileSync(join(dir, "styles", "book.css"), ".unrelated { color: green; }\n", "utf8");
      const browser = await launchChromium();
      try {
        const colorOf = async (html: string): Promise<string> => {
          const page = await browser.newPage();
          try {
            await page.setContent(html);
            return await page.evaluate<string>("getComputedStyle(document.querySelector('p')).color");
          } finally {
            await page.close();
          }
        };
        expect(await colorOf((await render(dir, ["./ext/alpha", "./ext/beta"])).html)).toBe("rgb(0, 0, 255)");
        expect(await colorOf((await render(dir, ["./ext/beta", "./ext/alpha"])).html)).toBe("rgb(255, 0, 0)");

        writeFileSync(join(dir, "styles", "book.css"), "p { color: green; }\n", "utf8");
        expect(await colorOf((await render(dir, ["./ext/alpha", "./ext/beta"])).html)).toBe("rgb(0, 128, 0)");
      } finally {
        await browser.close();
      }
    },
    60000,
  );

  test("list order is the markdown registration order", async () => {
    expect((await render(dir, ["./ext/alpha", "./ext/beta"])).registration).toEqual(["alpha", "beta"]);
    expect((await render(dir, ["./ext/beta", "./ext/alpha"])).registration).toEqual(["beta", "alpha"]);
  });

  test("the project's own styles come after every extension, whatever the order", async () => {
    for (const order of [
      ["./ext/alpha", "./ext/beta"],
      ["./ext/beta", "./ext/alpha"],
    ]) {
      const { html } = await render(dir, order);
      const green = html.indexOf("color: green");
      expect(green).toBeGreaterThan(html.indexOf("color: red"));
      expect(green).toBeGreaterThan(html.indexOf("color: blue"));
      // Core's layered blocks are declared before all of them.
      expect(html.indexOf("@layer gp.marker")).toBeLessThan(html.indexOf("color: red"));
    }
  });
});
