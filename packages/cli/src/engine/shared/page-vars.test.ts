import { describe, expect, test } from "bun:test";

import { assembleBookHtml } from "../../lib/markdown/assemble.ts";
import { extract } from "./gcpm-extract.ts";
import { pageGeometryVarsCss } from "./page-vars.ts";
import { printAreaFromMeta, type PrintAreaSource } from "./print-area.ts";

/**
 * The `gp-page-vars` rules a book gets, one per line, from the stylesheet its
 * assembly writes and the print area its meta carries: what the compiler and
 * the viewer both read. The first is `:root`'s; core's own named pages (a
 * full-bleed page, a blank one) follow, each on its own selector.
 */
async function varsFor(opts: { printArea: PrintAreaSource; pluginCss?: string; projectCss?: string }) {
  const html = await assembleBookHtml({ files: ["a.md"], readText: () => Promise.resolve("# A\n"), ...opts });
  const css = html.slice(html.indexOf("<style data-project-css>"), html.indexOf("</style>"));
  const content = html.match(/<meta name="gp-print-area" content='([^']*)'>/)![1]!;
  const doc = { querySelector: () => ({ getAttribute: () => content }) };
  return pageGeometryVarsCss(extract(css), printAreaFromMeta(doc)).split("\n");
}

/** The ten names, in the order they are written. */
function rule(v: Record<string, number>): string {
  const names = [
    "width", "height", "margin-top", "margin-bottom", "margin-inside", "margin-outside",
    "bleed", "safe", "gutter", "art-safe",
  ];
  return `{ ${names.map((n) => `--gp-page-${n}: ${v[n]}pt;`).join(" ")} }`;
}

const DTRPG = { width: 621, height: 810, bleed: 9, safe: 36, artSafe: 18, preset: "dtrpg" };
const SHEET = { width: 621, height: 810, bleed: 9, safe: 36, gutter: 36, "art-safe": 18 };

describe("gp-page-vars: the page geometry a stylesheet can read", () => {
  test("a manifest margin is the margin, over a look's mirrored @page", async () => {
    const pluginCss =
      "@layer ext.look;\n@layer ext.look {\n@page :left { margin: 0.5in 0.875in 0.5in 0.625in }\n@page :right { margin: 0.5in 0.625in 0.5in 0.875in }\n}";
    const [root] = await varsFor({
      printArea: { ...DTRPG, margin: { top: 54, bottom: 61.2, inside: 64.8, outside: 50.4 } },
      pluginCss,
    });
    expect(root).toBe(
      `:root ${rule({ ...SHEET, "margin-top": 54, "margin-bottom": 61.2, "margin-inside": 64.8, "margin-outside": 50.4 })}`,
    );
  });

  test("with no manifest margin, the look's @page margin is the margin: inside is the binding edge of a recto", async () => {
    const pluginCss =
      "@layer ext.look;\n@layer ext.look {\n@page :left { margin: 0.5in 0.875in 0.75in 0.625in }\n@page :right { margin: 0.5in 0.625in 0.75in 0.875in }\n}";
    const [root] = await varsFor({ printArea: DTRPG, pluginCss });
    expect(root).toBe(
      `:root ${rule({ ...SHEET, "margin-top": 36, "margin-bottom": 54, "margin-inside": 63, "margin-outside": 45 })}`,
    );
  });

  test("with no margin anywhere it is the 1in default, and what the book does not define is 0pt, not missing", async () => {
    const [root] = await varsFor({ printArea: { width: 432, height: 648 } });
    expect(root).toBe(
      `:root ${rule({
        width: 432, height: 648,
        "margin-top": 72, "margin-bottom": 72, "margin-inside": 72, "margin-outside": 72,
        bleed: 0, safe: 0, gutter: 0, "art-safe": 0,
      })}`,
    );
  });

  test("a book without a print area still has every name: the reader's page, zero elsewhere", () => {
    expect(pageGeometryVarsCss(extract(""), null)).toBe(
      `:root ${rule({
        width: 612, height: 792,
        "margin-top": 72, "margin-bottom": 72, "margin-inside": 72, "margin-outside": 72,
        bleed: 0, safe: 0, gutter: 0, "art-safe": 0,
      })}`,
    );
  });

  test("a named page publishes its own sheet and margins on the selector that assigns it", async () => {
    const lines = await varsFor({
      printArea: { width: 432, height: 648 },
      projectCss: "@page cover { size: 7in 10in; margin: 0 }\n.cover { page: cover }",
    });
    // the book-wide rule is untouched by a named page
    expect(lines[0]).toContain("--gp-page-width: 432pt; --gp-page-height: 648pt; --gp-page-margin-top: 72pt;");
    expect(lines.filter((l) => l.startsWith(".cover "))).toEqual([
      ".cover { --gp-page-width: 504pt; --gp-page-height: 720pt; --gp-page-margin-top: 0pt; " +
        "--gp-page-margin-bottom: 0pt; --gp-page-margin-inside: 0pt; --gp-page-margin-outside: 0pt; }",
    ]);
    // core's full-bleed page has no margins either, and says so
    expect(lines.find((l) => l.startsWith(".page.gp-page-full-bleed "))).toContain("--gp-page-margin-outside: 0pt;");
  });
});
