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
 *      Chromium, not on string positions;
 *   5. an extension's `@page` rules are the exception (#454): they follow its
 *      layer, unlayered and in source order, so Chromium ranks them by page
 *      selector as the engine's reader does. Where they print is pinned on
 *      the PDF by render-parity.page-margins.test.ts.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import postcss from "postcss";

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

  test("an extension's @page rules follow its layer, unlayered and in source order; its element rules stay inside (#454)", async () => {
    writeLook(
      dir,
      "alpha",
      "red",
      [
        "@layer alpha.pages {",
        "  @page { margin: 0.5in; }",
        "  @page full { margin: 0; }",
        "  .plate { page: full; }",
        "}",
        ".tie { color: red; }",
        "@media print {",
        "  @page front { margin: 0.25in; }",
        "  .x { color: red; }",
        "}",
      ].join("\n"),
    );
    writeLook(dir, "beta", "blue", "@page { margin: 0.75in; }\n.tie { color: blue; }\n");
    writeFileSync(join(dir, "styles", "book.css"), "@page { margin: 1in; }\n", "utf8");
    const config = resolveConfig({}, { extensions: ["./ext/alpha", "./ext/beta"], styles: ["styles/book.css"] });
    const { plugins, pluginStyles } = await loadPluginsWithCss(config.extensions, dir);
    const html = await renderChapters(dir, {
      styles: config.styles,
      files: ["chapter.md"],
      plugins,
      pluginStyles,
      printArea: { width: 432, height: 648, margin: { top: 54, bottom: 54, inside: 54, outside: 54 } },
    });

    // Every node of the extension CSS, flat, with the layers around it.
    const root = postcss.parse(html.slice(html.indexOf("/* extension css */"), html.indexOf("/* column alignment */")));
    const layersAround = (node: postcss.Node): string[] => {
      const names: string[] = [];
      for (let p = node.parent; p instanceof postcss.AtRule || p instanceof postcss.Rule; p = p.parent) {
        if (p instanceof postcss.AtRule && p.name === "layer") names.unshift(p.params);
      }
      return names;
    };
    const topIndex = (node: postcss.Node): number => {
      let top = node;
      while (top.parent && top.parent !== root) top = top.parent as postcss.Node;
      return root.index(top as postcss.ChildNode);
    };
    const pages: postcss.AtRule[] = [];
    root.walkAtRules("page", (rule) => {
      pages.push(rule);
    });
    const layer = (name: string) => root.nodes.findIndex((n) => n instanceof postcss.AtRule && n.name === "layer" && n.params === name);

    // In source order, alpha's then beta's, none inside a layer.
    expect(pages.map((r) => `${r.params} ${r.toString().match(/margin: [^;]+/)?.[0]}`)).toEqual([
      " margin: 0.5in",
      "full margin: 0",
      "front margin: 0.25in",
      " margin: 0.75in",
    ]);
    for (const rule of pages) expect(layersAround(rule), rule.toString()).toEqual([]);
    // The one in `@media print` keeps its condition.
    expect((pages[2]!.parent as postcss.AtRule).params).toBe("print");
    // Right after their own extension's layer, before the next one's.
    expect(layer("ext.alpha")).toBeGreaterThan(-1);
    for (const rule of pages.slice(0, 3)) {
      expect(topIndex(rule)).toBeGreaterThan(layer("ext.alpha"));
      expect(topIndex(rule)).toBeLessThan(layer("ext.beta"));
    }
    expect(topIndex(pages[3]!)).toBeGreaterThan(layer("ext.beta"));

    // Element rules stay in their layers, an extension's own sublayer too.
    const layersOf = (selector: string): string[][] => {
      const found: string[][] = [];
      root.walkRules((r) => {
        if (r.selector === selector) found.push(layersAround(r));
      });
      return found;
    };
    expect(layersOf(".plate")).toEqual([["ext.alpha", "alpha.pages"]]);
    expect(layersOf(".x")).toEqual([["ext.alpha"]]);
    expect(layersOf(".tie")).toEqual([["ext.alpha"], ["ext.beta"]]);

    // The book's own @page, then the manifest's margins, come after all of them.
    const css = html.slice(html.indexOf("<style data-project-css>"), html.indexOf("</style>"));
    expect(css.indexOf("@page { margin: 1in; }")).toBeGreaterThan(css.indexOf("@page { margin: 0.75in; }"));
    expect(css.indexOf("/* page geometry (manifest) */")).toBeGreaterThan(css.indexOf("@page { margin: 1in; }"));
  });

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
