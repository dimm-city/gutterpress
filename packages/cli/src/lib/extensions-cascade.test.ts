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
 *      and core's layered blocks sit before all of them.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";

import { resolveConfig } from "./manifest";
import { loadPluginsWithCss } from "./markdown/plugins";
import { createMarkdownRenderer } from "./markdown/renderer";
import { renderChapters } from "./markdown/index";

const TMP_ROOT = join(process.cwd(), ".tmp", `extensions-cascade-${Date.now()}`);
let counter = 0;

function writeLook(dir: string, id: string, color: string): void {
  const ext = join(dir, "ext", id);
  mkdirSync(join(ext, "css"), { recursive: true });
  writeFileSync(
    join(ext, "gutterpress.json"),
    JSON.stringify({ name: id, markdown: "plugin.js", styles: ["css/look.css"] }),
    "utf8",
  );
  writeFileSync(
    join(ext, "plugin.js"),
    `export default function (md) { (md.__order ??= []).push(${JSON.stringify(id)}); }\n`,
    "utf8",
  );
  writeFileSync(join(ext, "css", "look.css"), `.tie { color: ${color}; }\n`, "utf8");
}

async function render(
  dir: string,
  order: string[],
): Promise<{ html: string; registration: string[] }> {
  const config = resolveConfig({}, { extensions: order, styles: ["styles/book.css"] });
  const { plugins, pluginCss, pluginStylePaths } = await loadPluginsWithCss(config.extensions, dir);
  const md = createMarkdownRenderer(plugins) as unknown as { __order?: string[] };
  const html = await renderChapters(dir, {
    styles: config.styles,
    files: ["chapter.md"],
    plugins,
    pluginCss,
    pluginStylePaths,
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
