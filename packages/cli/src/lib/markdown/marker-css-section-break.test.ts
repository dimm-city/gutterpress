import { test, expect, afterAll, describe } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MARKER_CSS } from "./markers.js";
import { resolveChromiumExecutable } from "../chromium.ts";
import { launchChromium, type Browser } from "../../engine/shared/cdp.ts";

/**
 * MARKER_CSS used to carry `:where(.section, figure) > :where(:first-child) {
 * break-before: avoid }`. A first child's `break-before` propagates to its
 * parent's start edge (CSS Fragmentation), so that made the break point
 * BEFORE every section `avoid`: a section after other content had no legal
 * break above it, and Chromium broke INSIDE it instead — ignoring the
 * section's own `break-inside: avoid`. The rule is gone. These tests pin both
 * halves: a `break-inside: avoid` section moves whole, and a plain section
 * never strands an empty box fragment (its border/padding with no content).
 *
 * Fragmented with CSS multicol (fixed-height columns, `column-fill: auto`),
 * which is the same fragmentation machinery print uses, so one layout
 * measures both.
 */

describe("MARKER_CSS — no first-child break-before glue", () => {
  test("a first child's break-before (which propagates to its parent) is not declared", () => {
    expect(MARKER_CSS).not.toMatch(/:first-child\)?\s*\{\s*break-before/);
  });

  test("headings still keep with what follows", () => {
    expect(MARKER_CSS).toContain(":where(h1,h2,h3,h4,h5,h6) { break-after: avoid; }");
  });
});

const RENDER_TEST_TIMEOUT_MS = 60_000;
const SWEEP = Array.from({ length: 16 }, (_, k) => k);

// One 200px-tall column box per sweep step; the section under test starts at
// a different height in each, so some land at the column foot.
const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
body { margin: 0; font: 12px/16px serif; }
.mc { columns: 2; column-gap: 20px; column-fill: auto; height: 200px; width: 420px; margin-bottom: 10px; }
.section { border: 2px solid #000; padding: 6px; margin: 0; }
.avoid .section { break-inside: avoid; }
.block { height: 20px; margin: 0 0 6px; }
p { margin: 0 0 6px; }
</style>
${SWEEP.map(
  (k) => `<div class="mc avoid" id="a${k}">
  <div class="section pre"><div class="block" style="height:${20 + k * 10}px"></div></div>
  <div class="section box" id="box${k}"><div class="block" style="height:60px"></div></div>
</div>
<div class="mc plain" id="p${k}">
  <div style="height:${k * 14}px"></div>
  <div class="section" id="sec${k}"><h3 id="h${k}">Heading</h3><p>one line</p><p>second line of text that wraps over to a further line or two in a narrow column</p><p>third paragraph, also long enough to need more than one line to be set here</p></div>
</div>
<div class="mc avoid" id="l${k}">
  <div style="height:${k * 12}px"></div>
  <p class="block" id="lead${k}">Lead-in:</p>
  <div class="section box" id="lbox${k}"><table><tr><td style="height:80px">cell</td></tr></table></div>
</div>`
).join("\n")}`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[marker-css-section-break.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

let browser: Browser | undefined;
afterAll(async () => {
  await browser?.close();
});

async function measure(script: string): Promise<unknown> {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-section-break-"));
  try {
    const file = path.join(dir, "fixture.html");
    await fsp.writeFile(file, fixture, "utf8");
    browser ??= await launchChromium();
    const page = await browser.newPage();
    try {
      await page.navigate(`file://${file}`);
      // Source string, not a closure: this package's tsconfig is DOM-free.
      return await page.evaluate(script);
    } finally {
      await page.close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

testIf(
  "a break-inside: avoid section after other content moves whole instead of splitting",
  async () => {
    const fragments = (await measure(
      `${JSON.stringify(SWEEP)}.map((k) => document.getElementById("box" + k).getClientRects().length)`
    )) as number[];
    expect(fragments).toEqual(SWEEP.map(() => 1));
  },
  RENDER_TEST_TIMEOUT_MS
);

testIf(
  "a lead-in paragraph stays with the break-inside: avoid section that opens with its table",
  async () => {
    // Together in one column, or the lead-in would be stranded at the foot.
    const apart = (await measure(`(() => {
      const bad = [];
      for (const k of ${JSON.stringify(SWEEP)}) {
        const lead = document.getElementById("lead" + k).getBoundingClientRect();
        const box = document.getElementById("lbox" + k);
        const rects = box.getClientRects();
        if (rects.length !== 1 || Math.abs(lead.left - rects[0].left) > 1) bad.push(k);
      }
      return bad;
    })()`)) as number[];
    expect(apart).toEqual([]);
  },
  RENDER_TEST_TIMEOUT_MS
);

testIf(
  "a plain section never leaves an empty box fragment (border/padding with no content) at a column foot",
  async () => {
    // A fragment of the section is "empty" when no heading/paragraph line box
    // sits inside it. Checked at every sweep step, so the section's top edge
    // lands at the column foot in some of them.
    const empty = (await measure(`(() => {
      const bad = [];
      for (const k of ${JSON.stringify(SWEEP)}) {
        const sec = document.getElementById("sec" + k);
        const lines = [...sec.querySelectorAll("h3, p")].flatMap((el) => [...el.getClientRects()]);
        [...sec.getClientRects()].forEach((frag, i) => {
          const holds = lines.some((r) => r.left >= frag.left - 1 && r.right <= frag.right + 1 && r.top >= frag.top - 1 && r.bottom <= frag.bottom + 1);
          if (!holds) bad.push(k + ":" + i);
        });
      }
      return bad;
    })()`)) as string[];
    expect(empty).toEqual([]);
  },
  RENDER_TEST_TIMEOUT_MS
);

testIf(
  "a section's heading is never left alone at a column foot",
  async () => {
    const stranded = (await measure(`(() => {
      const bad = [];
      for (const k of ${JSON.stringify(SWEEP)}) {
        const h = document.getElementById("h" + k).getBoundingClientRect();
        const next = document.getElementById("sec" + k).querySelector("p").getBoundingClientRect();
        if (Math.abs(h.left - next.left) > 1) bad.push(k);
      }
      return bad;
    })()`)) as number[];
    expect(stranded).toEqual([]);
  },
  RENDER_TEST_TIMEOUT_MS
);
