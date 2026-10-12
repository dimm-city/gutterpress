/**
 * Margin & bleed overlay (overlay.ts).
 *
 * Two layers of evidence:
 *  1. the pure geometry + classification, fast and browser-free — where the
 *     margins and bleed come from, and which box an element is put in;
 *  2. the real viewer in Chromium on `fixtures/overlay.html` — what is flagged,
 *     what reads as intended, and that switching the overlay on changes
 *     NOTHING about the book (page count, geometry, author markup).
 */
import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll, describe } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";
import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";
import { extract } from "../shared/gcpm-extract.ts";
import { runPageBox } from "./fragment.ts";
import {
  classifyRect,
  documentBleedPt,
  marginsDiffer,
  pageBoxes,
  sanitizeOverlayStyle,
  worstKind,
  type Rect,
} from "./overlay.ts";

const IN = 72;

describe("where the geometry comes from", () => {
  const BOOK = `
    @page { size: 6in 9in; margin: 0.75in 0.5in; bleed: 0.125in; }
    @page :left  { margin-left: 0.5in; margin-right: 1in; }
    @page :right { margin-left: 1in; margin-right: 0.5in; }
    @page plate { margin: 0; bleed: 1in; }
  `;
  const model = extract(BOOK);

  test("bleed is the document's @page bleed, as the print path resolves it", () => {
    expect(documentBleedPt(model)).toBeCloseTo(0.125 * IN, 5);
    // A named page's own `bleed` is ignored by print (tier2 resolves the base
    // page only), so the overlay must not draw it either.
    expect(documentBleedPt(extract(`@page { bleed: 9pt } @page a { bleed: 36pt }`))).toBe(9);
  });

  test("a book that sets no bleed has none to draw", () => {
    expect(documentBleedPt(extract(`@page { size: 6in 9in; margin: 1in; }`))).toBe(0);
  });

  test("mirrored @page :left/:right margins give the text column's real box", () => {
    const g = runPageBox(model, undefined);
    const b = pageBoxes(g, g.margin, documentBleedPt(model));
    // The recto's margins (the preview lays text in one column per run); the
    // column is the PDF's width: 6in - 1in - 0.5in.
    expect(b.content.x).toBeCloseTo(1 * IN, 5);
    expect(b.content.w).toBeCloseTo(4.5 * IN, 5);
    expect(b.content.y).toBeCloseTo(0.75 * IN, 5);
    expect(b.content.h).toBeCloseTo(9 * IN - 1.5 * IN, 5);
  });

  test("a named page resolves on its own margins", () => {
    const g = runPageBox(model, "plate");
    const b = pageBoxes(g, g.margin, documentBleedPt(model));
    expect(b.content).toEqual({ x: 0, y: 0, w: 6 * IN, h: 9 * IN });
  });

  test("the bleed box is the trim grown on every side; the trim is the page", () => {
    const b = pageBoxes({ width: 400, height: 500 }, { top: 40, right: 30, bottom: 40, left: 50 }, 12);
    expect(b.trim).toEqual({ x: 0, y: 0, w: 400, h: 500 });
    expect(b.bleedBox).toEqual({ x: -12, y: -12, w: 424, h: 524 });
    expect(b.content).toEqual({ x: 50, y: 40, w: 320, h: 420 });
  });

  test("the PDF's own margins are drawn too, only where they sit elsewhere", () => {
    const m = { top: 40, right: 30, bottom: 40, left: 50 };
    expect(marginsDiffer(m, { ...m })).toBe(false);
    expect(marginsDiffer(m, { ...m, left: 50.4 })).toBe(false);
    // the mirror image of a recto's margins: a verso
    expect(marginsDiffer(m, { top: 40, right: 50, bottom: 40, left: 30 })).toBe(true);
  });

  test("units scale together", () => {
    const b = pageBoxes({ width: 100, height: 200 }, { top: 10, right: 10, bottom: 10, left: 10 }, 5, 2);
    expect(b.trim.w).toBe(200);
    expect(b.content.x).toBe(20);
    expect(b.bleedBox.x).toBe(-10);
  });
});

describe("classifying an element's box", () => {
  const b = pageBoxes({ width: 400, height: 500 }, { top: 40, right: 30, bottom: 40, left: 50 }, 12);
  const at = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

  test("inside the content area", () => {
    expect(classifyRect(at(50, 40, 320, 420), b)).toBe("inside");
    expect(classifyRect(at(100, 100, 50, 50), b)).toBe("inside");
  });

  test("an exact fit, or sub-pixel noise, is not an overflow", () => {
    expect(classifyRect(at(50, 40, 320.4, 420), b, 1)).toBe("inside");
    expect(classifyRect(at(49.5, 40, 320, 420), b, 1)).toBe("inside");
    expect(classifyRect(at(50, 40, 322, 420), b, 1)).toBe("margin");
  });

  test("past the content area but on the page: the margin", () => {
    expect(classifyRect(at(50, 40, 340, 10), b)).toBe("margin");
    expect(classifyRect(at(20, 100, 50, 10), b)).toBe("margin");
    // taller than the column: runs into the bottom margin
    expect(classifyRect(at(50, 40, 100, 450), b)).toBe("margin");
  });

  test("past the trim but within the bleed band: the bleed", () => {
    expect(classifyRect(at(-5, 100, 410, 10), b)).toBe("bleed");
    expect(classifyRect(at(-12, -12, 424, 524), b)).toBe("bleed");
  });

  test("past the bleed band: off the page", () => {
    expect(classifyRect(at(-25, 100, 520, 10), b)).toBe("off-page");
    expect(classifyRect(at(-12.5, 0, 100, 10), b)).toBe("off-page");
  });

  test("with no bleed, anything past the trim is off the page", () => {
    const none = pageBoxes({ width: 400, height: 500 }, { top: 40, right: 30, bottom: 40, left: 50 }, 0);
    expect(classifyRect(at(0, 0, 400, 500), none)).toBe("margin");
    expect(classifyRect(at(-1, 100, 100, 10), none)).toBe("off-page");
  });

  test("an element split across pages is judged by its worst fragment", () => {
    expect(worstKind(["inside", "margin", "inside"])).toBe("margin");
    expect(worstKind(["margin", "bleed"])).toBe("bleed");
    expect(worstKind(["bleed", "off-page", "margin"])).toBe("off-page");
    expect(worstKind([])).toBe("inside");
  });
});

describe("the look a host may set", () => {
  test("only a hex colour and a known strength get through", () => {
    expect(sanitizeOverlayStyle({ color: "#00AA55", strength: "strong" })).toEqual({ color: "#00AA55", strength: "strong" });
    expect(sanitizeOverlayStyle({ color: "#0a5" })).toEqual({ color: "#0a5" });
    expect(sanitizeOverlayStyle({ color: "red; x: y", strength: "loud" })).toEqual({});
    expect(sanitizeOverlayStyle({ color: "url(javascript:1)" })).toEqual({});
    expect(sanitizeOverlayStyle(null)).toEqual({});
    expect(sanitizeOverlayStyle("strong")).toEqual({});
  });
});

// ── real viewer ────────────────────────────────────────────────────────────

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

async function withFixture<T>(run: (url: string) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(FIXTURES_DIR, "..", ".overlay-"));
  try {
    const source = await fsp.readFile(path.join(FIXTURES_DIR, "overlay.html"), "utf8");
    await fsp.writeFile(
      path.join(dir, "overlay.html"),
      source.replace("</style>", `</style>\n<style>${MARKER_CSS}\n${GUTTERPRESS_CSS}</style>`),
      "utf8",
    );
    await fsp.copyFile(
      await getAssetPath("engine/gutterpress-viewer.js"),
      path.join(dir, "gutterpress-viewer.js"),
    );
    const { url, close } = await serveDir(dir, "overlay.html");
    try {
      return await run(url);
    } finally {
      await close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

testIf(
  "flags margin / bleed / off-page overflow, softens placed art, and changes nothing else",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");

        const snapshot = () =>
          page.evaluate(() => {
            const G = (window as any).Gutterpress;
            const rect = (sel: string) => {
              const r = document.querySelector(sel)!.getBoundingClientRect();
              return [r.left, r.top, r.width, r.height].map((n) => Math.round(n * 100) / 100);
            };
            return {
              pages: G.totalPages as number,
              sheets: document.querySelectorAll(".gp-sheet").length,
              // the author's markup, byte for byte: no class, no attribute, no box
              markup: document.querySelector(".gp-strip")!.outerHTML,
              intro: rect("#intro"),
              fits: rect("#fits"),
              last: rect("#last"),
              page: G.pageOf(document.getElementById("last")!, G.strips),
              body: document.body.getBoundingClientRect().height,
            };
          });

        const before = await snapshot();
        expect(before.pages).toBeGreaterThanOrEqual(2);

        const summary = await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true));
        expect(summary).toEqual({ on: true, issues: 3, intended: 1, bleedPt: 9 });

        const flags = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>(".gp-ov-flag")).map((f) => ({
            kind: f.dataset.kind,
            page: f.parentElement!.dataset.page,
            left: parseFloat(f.style.left),
            width: parseFloat(f.style.width),
          })),
        );
        const byKind = (k: string) => flags.filter((f) => f.kind === k);
        expect(byKind("margin")).toHaveLength(1);
        expect(byKind("bleed")).toHaveLength(1);
        expect(byKind("off-page")).toHaveLength(1);
        expect(byKind("intended")).toHaveLength(1);
        expect(flags).toHaveLength(4);
        // all on page 1, where the bars are; the bar that merely fits is absent
        expect(new Set(flags.map((f) => f.page))).toEqual(new Set(["1"]));
        // the margin bar: starts at the content edge (50), 340px wide
        expect(byKind("margin")[0]!.left).toBeCloseTo(50, 0);
        expect(byKind("margin")[0]!.width).toBeCloseTo(340, 0);
        // the bleed bar starts 5px left of the trim
        expect(byKind("bleed")[0]!.left).toBeCloseTo(-5, 0);

        // the drawn guides: one margin outline + one bleed band + trim per page
        const drawn = await page.evaluate(() => ({
          pages: document.querySelectorAll(".gp-ov-page").length,
          margins: document.querySelectorAll(".gp-ov-margin").length,
          bleeds: document.querySelectorAll(".gp-ov-bleed").length,
          band: (document.querySelector(".gp-ov-bleed") as HTMLElement).style.borderWidth,
          margin1: (() => {
            const m = document.querySelector(".gp-ov-margin") as HTMLElement;
            return [m.style.left, m.style.top, m.style.width, m.style.height];
          })(),
          pointerEvents: getComputedStyle(document.querySelector(".gp-ov")!).pointerEvents,
        }));
        expect(drawn.pages).toBe(before.sheets);
        expect(drawn.margins).toBe(before.sheets);
        expect(drawn.bleeds).toBe(before.sheets);
        expect(drawn.band).toBe("12px");
        expect(drawn.margin1).toEqual(["50px", "40px", "320px", "420px"]);
        expect(drawn.pointerEvents).toBe("none");

        // mirrored margins: the verso's PDF margins (L30/R50) sit elsewhere than
        // the preview's text column (L50/R30), so page 2 carries a second,
        // dotted outline; the recto's two coincide, so page 1 draws just one.
        const print = await page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLElement>(".gp-ov-page")).slice(0, 2).map((pg) => {
            const p = pg.querySelector<HTMLElement>(".gp-ov-print");
            return p ? [p.style.left, p.style.width] : null;
          }),
        );
        expect(print).toEqual([null, ["30px", "320px"]]);

        // …and the book is exactly as it was
        expect(await snapshot()).toEqual(before);

        // zoom is a paint transform: the verdicts do not move with it
        await page.evaluate(() => document.documentElement.style.setProperty("--gutterpress-zoom", "0.5"));
        expect(await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true))).toEqual(summary);

        // two-up (wrapped columns) re-lays the pages out; the findings hold
        await page.evaluate(() => (window as any).Gutterpress.setSpread(true));
        expect(await page.evaluate(() => (window as any).Gutterpress.decoration.overlay())).toMatchObject({
          issues: 3,
          intended: 1,
        });
        await page.evaluate(() => (window as any).Gutterpress.setSpread(false));
        await page.evaluate(() => document.documentElement.style.removeProperty("--gutterpress-zoom"));

        // off: the layer is gone, the count is the same as at the start
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(false));
        expect(await page.evaluate(() => document.querySelectorAll(".gp-ov").length)).toBe(0);
        const after = await snapshot();
        expect(after.pages).toBe(before.pages);
        expect(after.last).toEqual(before.last);
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "the overlay survives a refresh and is repainted for the new pages",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true));
        const events = await page.evaluate(() => {
          const seen: unknown[] = [];
          window.addEventListener("gp:overlay", (e) => seen.push((e as CustomEvent).detail));
          (window as any).Gutterpress.refresh();
          return seen;
        });
        expect(events).toHaveLength(1);
        expect((events[0] as any).issues).toBe(3);
        expect(await page.evaluate(() => document.querySelectorAll(".gp-ov-page").length)).toBe(
          await page.evaluate(() => document.querySelectorAll(".gp-sheet").length),
        );
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "the look: visible by default, constant on screen at any zoom, and adjustable by strength and colour",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true));

        const look = () =>
          page.evaluate(() => {
            const zoom = new DOMMatrixReadOnly(getComputedStyle(document.body).transform).a || 1;
            const cs = (sel: string) => getComputedStyle(document.querySelector(sel)!);
            const m = cs(".gp-ov-margin");
            return {
              // what the author sees: layout px x zoom
              marginLine: parseFloat(m.borderTopWidth) * zoom,
              marginColor: m.borderTopColor,
              tint: cs(".gp-ov-tint").backgroundColor,
              trimLine: parseFloat(cs(".gp-ov-trim").outlineWidth) * zoom,
              band: cs(".gp-ov-bleed").borderTopColor,
              clip: (document.querySelector(".gp-ov-tint") as HTMLElement).style.clipPath,
            };
          });

        // default: a solid 2px-on-screen line, a translucent margin region, a stronger band
        const base = await look();
        expect(base.marginLine).toBeGreaterThanOrEqual(1.9);
        expect(base.marginLine).toBeLessThanOrEqual(2.1);
        expect(base.trimLine).toBeGreaterThanOrEqual(1.9);
        expect(base.tint).toMatch(/^color\(srgb|^rgba?\(/);
        expect(base.tint).not.toBe("rgba(0, 0, 0, 0)");
        expect(base.clip).toContain("evenodd");

        // the stage is a paint transform; the line stays ~2px on screen at half zoom
        await page.evaluate(() => document.documentElement.style.setProperty("--gutterpress-zoom", "0.5"));
        const half = await look();
        expect(half.marginLine).toBeGreaterThanOrEqual(1.9);
        expect(half.marginLine).toBeLessThanOrEqual(2.1);
        await page.evaluate(() => document.documentElement.style.removeProperty("--gutterpress-zoom"));

        // strength and colour are tokens on <body>: a restyle needs no repaint
        const layer = await page.evaluate(() => {
          (document.querySelector(".gp-ov-margin") as any).__same = true;
          (window as any).Gutterpress.decoration.setOverlay(true, { color: "#00aa55", strength: "strong" });
          return (document.querySelector(".gp-ov-margin") as any).__same === true;
        });
        expect(layer).toBe(true);
        const strong = await look();
        expect(strong.marginLine).toBeGreaterThanOrEqual(2.9);
        expect(strong.marginColor).toBe("rgb(0, 170, 85)");
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true, { strength: "subtle" }));
        expect((await look()).marginLine).toBeLessThanOrEqual(1.1);

        // a bad value is ignored, not applied
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true, { color: "red; x:y", strength: "loud" }));
        const after = await look();
        expect(after.marginColor).toBe("rgb(0, 170, 85)");
        expect(after.marginLine).toBeLessThanOrEqual(1.1);
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);
