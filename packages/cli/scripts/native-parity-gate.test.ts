import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { launchChromium, type Browser } from "../src/engine/shared/cdp.ts";
import { resolveChromiumExecutable } from "../src/lib/chromium.ts";
import { getAssetPath } from "../src/lib/embedded-assets.ts";
import type { TextRun } from "../src/lib/pdf-inspect.ts";
import {
  EXACT_FIT_BROWSER_JS,
  EXACT_FIT_TOLERANCE_PX,
  classifyBoundary,
  firstDisagreeingHeading,
  groupTextRuns,
  mountViewer,
  normalizeLineText,
} from "./native-parity-gate.ts";

describe("classifyBoundary — the exact-fit rule", () => {
  test("issue #268: print kept at +0.00, the viewer pushed at -0.37", () => {
    expect(classifyBoundary(0, -0.37)).toBe(true);
  });
  test("issue #261: print kept with 0.5px to spare, the viewer overflowed by 0.2px", () => {
    expect(classifyBoundary(0.5, -0.2)).toBe(true);
  });
  test("the pushing side fitting once unconstrained is a break-rule disagreement", () => {
    expect(classifyBoundary(0.3, 0)).toBe(false);
    expect(classifyBoundary(0.3, 4)).toBe(false);
  });
  test("two large overflows with a tiny delta are a mismatched line, not a boundary", () => {
    expect(classifyBoundary(-300, -300.5)).toBe(false);
  });
  test("the tolerance bounds both the delta and how far past the edge the kept side may read", () => {
    expect(classifyBoundary(0.5, -0.5)).toBe(true);
    expect(classifyBoundary(0.51, -0.5)).toBe(false);
    expect(classifyBoundary(-EXACT_FIT_TOLERANCE_PX, -0.5)).toBe(true);
    expect(classifyBoundary(-EXACT_FIT_TOLERANCE_PX - 0.01, -0.5)).toBe(false);
  });
});

describe("firstDisagreeingHeading", () => {
  test("document order wins over page order, and the agreeing page is the last in-step heading's", () => {
    const ids = ["a", "b", "c", "d"];
    const print = { a: 1, b: 4, c: 3, d: 9 };
    const viewer = { a: 1, b: 4, c: 2, d: 8 };
    expect(firstDisagreeingHeading(ids, print, viewer)).toEqual({
      id: "c",
      print: 3,
      viewer: 2,
      agreeingPage: 4,
    });
  });
  test("one-sided entries are skipped, and the agreeing page defaults to 1", () => {
    const ids = ["a", "b", "c"];
    expect(firstDisagreeingHeading(ids, { a: 2, c: 5 }, { a: 2, b: 3, c: 6 })).toEqual({
      id: "c",
      print: 5,
      viewer: 6,
      agreeingPage: 2,
    });
    expect(firstDisagreeingHeading(ids, { b: 3 }, { b: 4 })).toEqual({
      id: "b",
      print: 3,
      viewer: 4,
      agreeingPage: 1,
    });
  });
  test("returns undefined when every measured heading agrees", () => {
    expect(firstDisagreeingHeading(["a", "b"], { a: 1, b: 2 }, { a: 1, b: 2 })).toBeUndefined();
  });
});

describe("normalizeLineText", () => {
  test("drops whitespace and a trailing hyphen of any of the three kinds, keeps internal hyphens", () => {
    expect(normalizeLineText("  well-known  words -")).toBe("well-knownwords");
    expect(normalizeLineText("soft­")).toBe("soft");
    expect(normalizeLineText("hy‐")).toBe("hy");
  });
});

describe("groupTextRuns", () => {
  const run = (s: string, x: number, y: number): TextRun => ({ s, x, y, w: 10, h: 10 });
  // 792pt page, content top at 72pt, 648pt tall (US Letter with 1in top/bottom)
  const H = 792;
  const TOP = 72;
  const CONTENT_H = 648;
  test("runs on one baseline join in x order; margin-box runs drop out; lines sort top-down; y stays exact", () => {
    const lines = groupTextRuns(
      [
        run("world", 60, H - 100.123),
        run("folio 7", 300, H - 750), // in the bottom margin
        run("hello ", 20, H - 100.123),
        run("running head", 20, H - 40), // in the top margin
        run("first", 20, H - 85.05),
      ],
      H,
      TOP,
      CONTENT_H,
    );
    expect(lines.map((l) => l.text)).toEqual(["first", "hello world"]);
    expect(lines[1]!.baselinePx).toBeCloseTo((100.123 - TOP) * (96 / 72), 6);
  });
  test("runs within 0.5pt share a line, 0.6pt apart do not", () => {
    const close = groupTextRuns([run("a", 0, H - 200), run("b", 10, H - 200.5)], H, TOP, CONTENT_H);
    expect(close.map((l) => l.text)).toEqual(["ab"]);
    const apart = groupTextRuns([run("a", 0, H - 200), run("b", 10, H - 200.6)], H, TOP, CONTENT_H);
    expect(apart.map((l) => l.text)).toEqual(["a", "b"]);
  });
});

// ---------------------------------------------------------------------------
// The viewer side, in a real Chromium: a 100px column, 21px lines, a one-line
// <p> then a six-line <pre>, so the viewer keeps three pre lines on page 1
// (21 + 3·21 = 84 ≤ 100; a fourth would end at 105) and pushes three.
// ---------------------------------------------------------------------------
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
const TIMEOUT = 60_000;

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
@page { size: 4in 3in; margin: 94px 20px; }
body { margin: 0; font-family: serif; font-size: 14px; line-height: 21px; }
p, pre, h2 { margin: 0; padding: 0; line-height: 21px; }
pre { font-family: monospace; font-size: 14px; }
.avoid pre { break-inside: avoid; }
</style></head><body><main>
<p>Intro line.</p>
<pre>line one
line two
line three
line four
line five
line six</pre>
<h2 id="after">After</h2>
</main></body></html>`;

let browser: Browser | undefined;
let dir: string | undefined;
let url = "";
let agent = "";
let viewer = "";

beforeAll(async () => {
  if (!chromium) return;
  dir = await mkdtemp(join(tmpdir(), "gp-exact-fit-"));
  const file = join(dir, "book.html");
  await writeFile(file, PAGE);
  url = pathToFileURL(file).href;
  agent = await Bun.file(await getAssetPath("engine/gutterpress-agent.js")).text();
  viewer = await Bun.file(await getAssetPath("engine/gutterpress-viewer.js")).text();
  browser = await launchChromium();
});

afterAll(async () => {
  await browser?.close();
  if (dir) await rm(dir, { recursive: true, force: true });
});

const VIEWPORT = { width: 384, height: 288 };

async function mount(bodyClass = "") {
  const page = await mountViewer(browser!, url, agent, viewer, VIEWPORT);
  await page.evaluate(EXACT_FIT_BROWSER_JS);
  if (bodyClass) {
    await page.evaluate(`document.body.className = ${JSON.stringify(bodyClass)}; window.__gpParity.relayout();`);
  }
  return page;
}

const line = (text: string, baselinePx: number) => ({ text, baselinePx });

testIf(
  "linesOf reads line boxes and pages from character rects without moving anything",
  async () => {
    const page = await mount();
    try {
      const out = await page.evaluate<{
        contentH: number;
        before: number;
        after: number;
        lines: Array<{ text: string; page: number; top: number; bottom: number; baseline: number }>;
      }>(`(() => {
        const api = window.__gpParity;
        const fx = window.__gpExactFit(api);
        const pre = document.querySelector("pre");
        const before = pre.getBoundingClientRect().top;
        const lines = fx.linesOf(pre).map((l) => ({ text: l.text.trim(), page: l.page, top: l.top, bottom: l.bottom, baseline: l.baseline }));
        return { contentH: parseFloat(getComputedStyle(pre.closest(".gp-strip")).getPropertyValue("--gp-content-h")),
                 before, after: pre.getBoundingClientRect().top, lines };
      })()`);
      expect(out.contentH).toBe(100);
      expect(out.before).toBe(out.after);
      expect(out.lines.map((l) => l.text)).toEqual([
        "line one",
        "line two",
        "line three",
        "line four",
        "line five",
        "line six",
      ]);
      expect(out.lines.map((l) => l.page)).toEqual([1, 1, 1, 2, 2, 2]);
      // page 1: the <p> takes 0..21, then 21px per pre line; page 2: from the column top
      const bottoms = [42, 63, 84, 21, 42, 63];
      out.lines.forEach((l, k) => {
        expect(l.bottom).toBeCloseTo(bottoms[k]!, 1);
        expect(l.top).toBeCloseTo(bottoms[k]! - 21, 1);
        expect(l.baseline).toBeGreaterThan(l.top);
        expect(l.baseline).toBeLessThan(l.bottom);
      });
    } finally {
      await page.close();
    }
  },
  TIMEOUT,
);

testIf(
  "print keeps a line: the viewer's chain is neutralised and the line projected back onto the page",
  async () => {
    const page = await mount();
    try {
      // as if print had squeezed "line four" onto page 1 with its baseline at 94px
      const input = {
        lo: 1,
        agreeingPage: 1,
        headingIds: ["after"],
        printLines: {
          1: [line("Intro line.", 10), line("line one", 31), line("line two", 52), line("line three", 73), line("line four", 94)],
          2: [line("line five", 10), line("line six", 31)],
        },
      };
      const m = await page.evaluate<any>(
        `window.__gpExactFit(window.__gpParity).measure(${JSON.stringify(input)})`,
      );
      expect(m.error).toBeUndefined();
      expect(m).toMatchObject({ page: 1, keptBy: "print", text: "line four", block: "pre", lineIndex: 4, lineCount: 6, contentHPx: 100 });
      // the viewer's geometry puts the line right under page 1's last kept line: 84 + 21
      expect(m.viewerBottomPx).toBeCloseTo(105, 1);
      expect(m.printBaselinePx).toBe(94);
      const tail = m.printBottomPx - m.printBaselinePx;
      expect(tail).toBeGreaterThan(0);
      expect(tail).toBeLessThan(21);
      expect(m.viewerBottomPx - m.viewerBaselinePx).toBeCloseTo(tail, 6);
    } finally {
      await page.close();
    }
  },
  TIMEOUT,
);

testIf(
  "the viewer keeps a line: print's position for it is projected from print's last kept line",
  async () => {
    const page = await mount();
    try {
      // as if print had broken before "line three" (its last page-1 baseline, "line two", at 52px)
      const input = {
        lo: 1,
        agreeingPage: 1,
        headingIds: ["after"],
        printLines: {
          1: [line("Intro line.", 10), line("line one", 31), line("line two", 52)],
          2: [line("line three", 10), line("line four", 31), line("line five", 52), line("line six", 73)],
        },
      };
      const m = await page.evaluate<any>(
        `window.__gpExactFit(window.__gpParity).measure(${JSON.stringify(input)})`,
      );
      expect(m.error).toBeUndefined();
      expect(m).toMatchObject({ page: 1, keptBy: "viewer", text: "line three", block: "pre", lineIndex: 3, lineCount: 6 });
      expect(m.viewerBottomPx).toBeCloseTo(84, 1);
      expect(m.printBaselinePx).toBeCloseTo(52 + 21, 1);
    } finally {
      await page.close();
    }
  },
  TIMEOUT,
);

testIf(
  "a line the viewer fits once its break rules are neutralised is reported as a break-rule disagreement",
  async () => {
    // break-inside: avoid moves the whole <pre> to page 2 in the viewer…
    const page = await mount("avoid");
    try {
      const prePage = await page.evaluate<number>(
        `window.__gpParity.pageOf(document.querySelector("pre")) + 1`,
      );
      expect(prePage).toBe(2);
      // …while (as if) print kept three of its lines on page 1
      const input = {
        lo: 1,
        agreeingPage: 1,
        headingIds: ["after"],
        printLines: {
          1: [line("Intro line.", 10), line("line one", 31), line("line two", 52), line("line three", 73)],
          2: [line("line four", 10), line("line five", 31), line("line six", 52)],
        },
      };
      const m = await page.evaluate<any>(
        `window.__gpExactFit(window.__gpParity).measure(${JSON.stringify(input)})`,
      );
      expect(m.error).toMatch(/fits "line three" on p1 once its break rules are neutralised/);
    } finally {
      await page.close();
    }
  },
  TIMEOUT,
);
