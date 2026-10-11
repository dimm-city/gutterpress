import { test, expect, afterAll, describe } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { GUTTERPRESS_CSS } from "./gutterpress-css.ts";
import { resolveChromiumExecutable } from "../chromium.ts";
import { launchChromium, type Browser } from "../../engine/shared/cdp.ts";

/**
 * #225/#228: the `.gp-no-break` / `.gp-break-before` utilities, and the
 * column hooks the `@columns` marker's output carries. `@columns [1-5]` is
 * the only column authoring surface (CLAUDE.md §6), so there is no
 * span/fill class: the CSS-text assertions pin the exact declarations, the
 * rendered fixtures prove they reach Chromium's computed style.
 */

describe("GUTTERPRESS_CSS — column hooks", () => {
  test("gap and rule tokens apply to .gp-columns and every count class at zero specificity", () => {
    expect(GUTTERPRESS_CSS).toContain(
      ":where(.gp-columns, .gp-columns-1, .gp-columns-2, .gp-columns-3, .gp-columns-4, .gp-columns-5) {\n" +
        "  column-gap: var(--gp-column-gap, 1.5em);\n" +
        "  column-rule: var(--gp-column-rule, none);\n}"
    );
  });

  test("the removed span/fill/grid classes and tokens are gone", () => {
    for (const gone of ["gp-columns-all", "gp-columns-flow", "gp-columns-balanced", "gp-grid", "gp-span-all"]) {
      expect(GUTTERPRESS_CSS).not.toContain(gone);
    }
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

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[marker-css-columns.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

// One Chromium for the file, launched through the engine's own launcher
// (the same binary, flags and resolver the CLI builds with).
let browser: Browser | undefined;
afterAll(async () => {
  await browser?.close();
});

testIf(
  "@columns: every count 1-5 and the bare default of 2 reach Chromium's computed column-count, and the gap/rule tokens apply",
  async () => {
    const { createMarkdownRenderer } = await import("./renderer.ts");
    const md = createMarkdownRenderer([]);
    const body = ["", "1", "2", "3", "4", "5"]
      .map((n) => md.render(`@columns ${n}\n\nText.\n\n@end-columns\n`))
      .join("\n");
    // A theme sets the tokens on any ancestor (here the run itself, for brevity).
    const tokened =
      '<div id="tok" class="gp-columns gp-columns-3" style="--gp-column-rule: 2px solid red; --gp-column-gap: 10px">x</div>';
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-columns-marker-"));
    try {
      const file = path.join(dir, "fixture.html");
      await fsp.writeFile(file, `<!doctype html><meta charset="utf-8"><style>${GUTTERPRESS_CSS}</style>${body}${tokened}`, "utf8");
      browser ??= await launchChromium();
      const page = await browser.newPage();
      try {
        await page.navigate(`file://${file}`);
        const counts = (await page.evaluate(
          `[...document.querySelectorAll(".gp-columns")].map((el) => getComputedStyle(el).columnCount)`
        )) as string[];
        expect(counts.slice(0, 6)).toEqual(["2", "1", "2", "3", "4", "5"]);
        // The hooks default to a 1.5em gap and no rule, and the tokens override both.
        const hooks = (await page.evaluate(
          `["tok"].map((id) => { const c = getComputedStyle(document.getElementById(id)); return [c.columnGap, c.columnRuleStyle, c.columnRuleWidth].join("|"); }).concat([...document.querySelectorAll(".gp-columns:not(#tok)")].map((el) => getComputedStyle(el).columnRuleStyle))`
        )) as string[];
        expect(hooks[0]).toBe("10px|solid|2px");
        expect(new Set(hooks.slice(1))).toEqual(new Set(["none"]));
      } finally {
        await page.close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
