import { test, expect, afterAll, describe } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { resolveChromiumExecutable } from "../chromium.ts";
import { closeBrowser, getBrowser } from "../browser-pool.ts";

/**
 * #225/#228: the `.gp-columns-all` / `.gp-columns-flow` / `.gp-columns-balanced`
 * / `.gp-no-break` / `.gp-break-before` utilities (2026-09-01 CSS
 * architecture review, findings C1/C7 — an author typed `@section
 * .gp-columns-all` unprompted and got a silent no-op because the class
 * didn't exist).
 *
 * The CSS-text assertions pin the exact one-name-each declarations; the
 * rendered fixture proves `.gp-columns-all` actually reaches Chromium's
 * computed style as `column-span: all` rather than silently doing nothing —
 * exactly the failure mode these classes exist to close.
 */

describe("GUTTERPRESS_CSS — column-fill/span vocabulary", () => {
  test("column-fill/column-span decisions are named, one rule each", () => {
    expect(GUTTERPRESS_CSS).toContain(".gp-columns-all { column-span: all; }");
    expect(GUTTERPRESS_CSS).toContain(".gp-columns-flow { column-fill: auto; }");
    expect(GUTTERPRESS_CSS).toContain(".gp-columns-balanced { column-fill: balance; }");
  });

  test("no .gp-span-all alias ships alongside .gp-columns-all", () => {
    expect(GUTTERPRESS_CSS).not.toContain("gp-span-all");
  });
});

describe("GUTTERPRESS_CSS — fragmentation vocabulary", () => {
  test("standard properties only, one rule each", () => {
    expect(GUTTERPRESS_CSS).toContain(".gp-no-break { break-inside: avoid; }");
    expect(GUTTERPRESS_CSS).toContain(".gp-break-before { break-before: page; }");
  });

  test("no legacy page-break-* twins (Chromium-only project)", () => {
    expect(GUTTERPRESS_CSS).not.toMatch(/page-break-inside/);
    expect(GUTTERPRESS_CSS).not.toMatch(/page-break-before/);
  });
});

describe("GUTTERPRESS_CSS — no .pmd-* names in core", () => {
  test("core ships no .pmd-* selector at all", () => {
    expect(GUTTERPRESS_CSS).not.toContain("pmd-");
  });
});

const RENDER_TEST_TIMEOUT_MS = 60_000;

const fixture = `<!doctype html><meta charset="utf-8"><style>
${GUTTERPRESS_CSS}
.wrap { columns: 2; column-gap: 1em; width: 400px; }
</style>
<div class="wrap">
  <h2 class="gp-columns-all" id="spanner">Spanning heading</h2>
  <p>content one</p>
  <p>content two</p>
</div>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[marker-css-columns.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

afterAll(async () => {
  await closeBrowser();
});

testIf(
  ".gp-columns-all reaches Chromium's computed style as column-span: all",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-columns-all-"));
    try {
      const file = path.join(dir, "fixture.html");
      await fsp.writeFile(file, fixture, "utf8");
      const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
      const page = await browser.newPage();
      try {
        await page.goto(`file://${file}`, { waitUntil: "networkidle0" });

        // Source string, not a closure: this package's tsconfig is DOM-free.
        const columnSpan = (await page.evaluate(
          `getComputedStyle(document.getElementById("spanner")).columnSpan`
        )) as string;

        expect(columnSpan).toBe("all");
      } finally {
        await page.close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
