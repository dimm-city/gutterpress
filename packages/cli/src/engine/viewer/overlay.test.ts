/**
 * Safe area & bleed overlay (overlay.ts).
 *
 * Two layers of evidence:
 *  1. the pure geometry + classification, fast and browser-free — the boxes
 *     the project's `page` block produces, and which box an element is put in;
 *  2. the real viewer in Chromium on `fixtures/overlay.html` — what is flagged,
 *     what reads as intended, that every box sits on its sheet whatever the
 *     book's margins, that the book's own CSS cannot hide, move or restyle it,
 *     and that switching it on changes NOTHING about the book.
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
import { classifyRect, pageBoxes, sanitizeOverlayStyle, worstKind, type Rect } from "./overlay.ts";

// DriveThruRPG's file: 8.625 x 11.25in with a 0.125in bleed inside it, and a 0.25in safe area.
const DTRPG = { width: 621, height: 810, bleed: 9, safe: 18 };
const at = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("the boxes come from the project's page geometry", () => {
  test("the trim is the sheet pulled in on the top, bottom and OUTER edge: right on a recto, left on a verso", () => {
    const recto = pageBoxes(DTRPG, "recto");
    const verso = pageBoxes(DTRPG, "verso");
    expect(recto.sheet).toEqual({ x: 0, y: 0, w: 621, h: 810 });
    expect(recto.trim).toEqual({ x: 0, y: 9, w: 612, h: 792 });
    expect(verso.trim).toEqual({ x: 9, y: 9, w: 612, h: 792 });
  });

  test("the safe area is the trim pulled in on every edge", () => {
    expect(pageBoxes(DTRPG, "recto").safe).toEqual({ x: 18, y: 27, w: 576, h: 756 });
    expect(pageBoxes(DTRPG, "verso").safe).toEqual({ x: 27, y: 27, w: 576, h: 756 });
  });

  test("no bleed: the trim is the sheet; no safe inset: the safe area is the trim", () => {
    const b = pageBoxes({ width: 432, height: 648, bleed: 0, safe: 0 }, "verso");
    expect(b.trim).toEqual(b.sheet);
    expect(b.safe).toEqual(b.sheet);
  });

  test("units scale together", () => {
    const b = pageBoxes({ width: 100, height: 200, bleed: 5, safe: 10 }, "recto", 2);
    expect(b.sheet.w).toBe(200);
    expect(b.trim).toEqual({ x: 0, y: 10, w: 190, h: 380 });
    expect(b.safe.x).toBe(20);
    expect(b.bleed).toBe(10);
  });
});

describe("classifying an element's box", () => {
  const b = pageBoxes(DTRPG, "recto");

  test("inside the safe area", () => {
    expect(classifyRect(at(18, 27, 576, 756), b)).toBe("inside");
    expect(classifyRect(at(100, 100, 50, 50), b)).toBe("inside");
  });

  test("an exact fit, or sub-pixel noise, is not an overflow", () => {
    expect(classifyRect(at(18, 27, 576.4, 756), b, 1)).toBe("inside");
    expect(classifyRect(at(17.5, 27, 576, 756), b, 1)).toBe("inside");
    expect(classifyRect(at(18, 27, 578, 756), b, 1)).toBe("unsafe");
  });

  test("past the safe area but on the trimmed page: unsafe", () => {
    expect(classifyRect(at(10, 100, 50, 10), b)).toBe("unsafe");
    expect(classifyRect(at(100, 100, 510, 10), b)).toBe("unsafe");
  });

  test("past the trim but on the sheet: the bleed; the binding edge has none", () => {
    // reaches the right edge: a recto's outer edge (bleed), a verso's binding edge (unsafe: nothing is cut there)
    const toRight = at(100, 100, 521, 10);
    expect(classifyRect(toRight, b)).toBe("bleed");
    expect(classifyRect(toRight, pageBoxes(DTRPG, "verso"))).toBe("unsafe");
    expect(classifyRect(at(100, 3, 100, 10), b)).toBe("bleed");
  });

  test("past the sheet: off the page", () => {
    expect(classifyRect(at(100, 100, 600, 10), b)).toBe("off-page");
    expect(classifyRect(at(-3, 100, 100, 10), b)).toBe("off-page");
  });

  test("with no bleed, anything past the trim is off the page", () => {
    const none = pageBoxes({ width: 400, height: 500, bleed: 0, safe: 24 }, "recto");
    expect(classifyRect(at(0, 0, 400, 500), none)).toBe("unsafe");
    expect(classifyRect(at(-1, 100, 100, 10), none)).toBe("off-page");
  });

  test("an element split across pages is judged by its worst fragment", () => {
    expect(worstKind(["inside", "unsafe", "inside"])).toBe("unsafe");
    expect(worstKind(["unsafe", "bleed"])).toBe("bleed");
    expect(worstKind(["bleed", "off-page", "unsafe"])).toBe("off-page");
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

async function withFixture<T>(run: (url: string) => Promise<T>, name = "overlay.html"): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(FIXTURES_DIR, "..", ".overlay-"));
  try {
    const source = await fsp.readFile(path.join(FIXTURES_DIR, name), "utf8");
    await fsp.writeFile(
      path.join(dir, name),
      source.replace("</style>", `</style>\n<style>${MARKER_CSS}\n${GUTTERPRESS_CSS}</style>`),
      "utf8",
    );
    await fsp.copyFile(
      await getAssetPath("engine/gutterpress-viewer.js"),
      path.join(dir, "gutterpress-viewer.js"),
    );
    const { url, close } = await serveDir(dir, name);
    try {
      return await run(url);
    } finally {
      await close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** In-page: every overlay page box against the sheet it belongs to, on screen. */
function alignment() {
  const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
  return Array.from(shadow.querySelectorAll<HTMLElement>(".gp-ov-page")).map((pg) => {
    const o = pg.getBoundingClientRect();
    const s = document.querySelector(`.gp-sheet[data-page="${pg.dataset.page}"]`)!.getBoundingClientRect();
    return Math.max(Math.abs(o.left - s.left), Math.abs(o.top - s.top), Math.abs(o.width - s.width), Math.abs(o.height - s.height));
  });
}

testIf(
  "draws the project's safe area, trim and bleed on every sheet, flags against them, and changes nothing else",
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
        expect(summary).toEqual({ on: true, issues: 3, intended: 1, bleedPt: 9, safePt: 18 });

        const flags = await page.evaluate(() =>
          Array.from(
            document.querySelector("gp-overlay")!.shadowRoot!.querySelectorAll<HTMLElement>(".gp-ov-flag"),
          ).map((f) => ({
            kind: f.dataset.kind,
            page: f.parentElement!.dataset.page,
            left: parseFloat(f.style.left),
            width: parseFloat(f.style.width),
          })),
        );
        const byKind = (k: string) => flags.filter((f) => f.kind === k);
        expect(byKind("unsafe")).toHaveLength(1);
        expect(byKind("bleed")).toHaveLength(1);
        expect(byKind("off-page")).toHaveLength(1);
        expect(byKind("intended")).toHaveLength(1);
        expect(flags).toHaveLength(4);
        // all on page 1, where the bars are; the bar that merely fits is absent
        expect(new Set(flags.map((f) => f.page))).toEqual(new Set(["1"]));
        // the unsafe bar: starts at the text column (60), 320px wide
        expect(byKind("unsafe")[0]!.left).toBeCloseTo(60, 0);
        expect(byKind("unsafe")[0]!.width).toBeCloseTo(320, 0);

        // what is drawn: the manifest's boxes, measured from the trim, the
        // same on every recto and every verso whatever the @page margins say
        const drawn = await page.evaluate(() => {
          const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
          const box = (el: HTMLElement) => [el.style.left, el.style.top, el.style.width, el.style.height];
          return {
            pages: shadow.querySelectorAll(".gp-ov-page").length,
            first: Array.from(shadow.querySelectorAll<HTMLElement>(".gp-ov-page")).slice(0, 4).map((pg) => ({
              page: pg.dataset.page,
              size: [pg.style.width, pg.style.height],
              safes: pg.querySelectorAll(".gp-ov-safe").length,
              safe: box(pg.querySelector<HTMLElement>(".gp-ov-safe")!),
              trim: box(pg.querySelector<HTMLElement>(".gp-ov-trim")!),
              band: getComputedStyle(pg.querySelector(".gp-ov-bleed")!).borderWidth,
            })),
          };
        });
        expect(drawn.pages).toBe(before.sheets);
        for (const p of drawn.first) {
          const recto = Number(p.page) % 2 === 1;
          expect(p.size).toEqual(["400px", "500px"]);
          expect(p.safes).toBe(1);
          expect(p.trim).toEqual([recto ? "0px" : "12px", "12px", "388px", "476px"]);
          expect(p.safe).toEqual([recto ? "24px" : "36px", "36px", "340px", "428px"]);
          // band widths: top right bottom left — the binding edge has none
          expect(p.band).toBe(recto ? "12px 12px 12px 0px" : "12px 0px 12px 12px");
        }

        // every box sits exactly on its sheet
        for (const d of await page.evaluate(alignment)) expect(d).toBeLessThan(0.5);

        // …and the book is exactly as it was
        expect(await snapshot()).toEqual(before);

        // zoom is a paint transform: the overlay follows it, the verdicts do not move
        await page.evaluate(() => document.documentElement.style.setProperty("--gutterpress-zoom", "0.5"));
        for (const d of await page.evaluate(alignment)) expect(d).toBeLessThan(0.5);
        expect(await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true))).toEqual(summary);

        // two-up (wrapped columns) re-lays the pages out; the boxes follow the sheets, the findings hold
        await page.evaluate(() => (window as any).Gutterpress.setSpread(true));
        expect(await page.evaluate(() => (window as any).Gutterpress.decoration.overlay())).toMatchObject({
          issues: 3,
          intended: 1,
        });
        for (const d of await page.evaluate(alignment)) expect(d).toBeLessThan(0.5);
        await page.evaluate(() => (window as any).Gutterpress.setSpread(false));
        await page.evaluate(() => document.documentElement.style.removeProperty("--gutterpress-zoom"));

        // off: the overlay is gone, the book is as it started
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(false));
        expect(await page.evaluate(() => document.querySelectorAll("gp-overlay").length)).toBe(0);
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
  "the book's own CSS cannot hide, move or restyle the overlay",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true));
        // The fixture's stylesheet sets `gp-overlay { display: none; transform; opacity: 0 }`,
        // `--gp-ov-color` / `--gp-ov-width` on :root and body, `display: none` on
        // the overlay's class names, and red outlines/borders on every div.
        const seen = await page.evaluate(() => {
          const host = document.querySelector("gp-overlay") as HTMLElement;
          const hs = getComputedStyle(host);
          const safe = host.shadowRoot!.querySelector(".gp-ov-safe")!;
          const ss = getComputedStyle(safe);
          return {
            parent: host.parentElement!.tagName,
            display: hs.display,
            opacity: hs.opacity,
            pageDisplay: getComputedStyle(host.shadowRoot!.querySelector(".gp-ov-page")!).display,
            safeDisplay: ss.display,
            safeColor: ss.borderTopColor,
            safeWidth: parseFloat(ss.borderTopWidth),
          };
        });
        expect(seen.parent).toBe("HTML");
        expect(seen.display).toBe("block");
        expect(seen.opacity).toBe("1");
        expect(seen.pageDisplay).toBe("block");
        expect(seen.safeDisplay).toBe("block");
        expect(seen.safeColor).toBe("rgb(47, 128, 237)");
        expect(seen.safeWidth).toBeGreaterThanOrEqual(1.9);
        expect(seen.safeWidth).toBeLessThanOrEqual(2.1);
        // and it is where the sheets are, not where the book's transform tried to put it
        for (const d of await page.evaluate(alignment)) expect(d).toBeLessThan(0.5);
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "without the project's geometry, each sheet's own edge is all there is to draw",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        const summary = await page.evaluate(() => {
          document.querySelector('meta[name="gp-print-area"]')!.remove();
          return (window as any).Gutterpress.decoration.setOverlay(true);
        });
        // only the bar that leaves the sheet is a problem; no safe area, no bleed
        expect(summary).toEqual({ on: true, issues: 1, intended: 0, bleedPt: 0, safePt: 0 });
        const drawn = await page.evaluate(() => {
          const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
          return {
            safes: shadow.querySelectorAll(".gp-ov-safe").length,
            bleeds: shadow.querySelectorAll(".gp-ov-bleed").length,
            flags: Array.from(shadow.querySelectorAll<HTMLElement>(".gp-ov-flag")).map((f) => f.dataset.kind),
          };
        });
        expect(drawn).toEqual({ safes: 0, bleeds: 0, flags: ["off-page"] });
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
        expect(
          await page.evaluate(
            () => document.querySelector("gp-overlay")!.shadowRoot!.querySelectorAll(".gp-ov-page").length,
          ),
        ).toBe(await page.evaluate(() => document.querySelectorAll(".gp-sheet").length));
        expect(await page.evaluate(() => document.querySelectorAll("gp-overlay").length)).toBe(1);
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
            const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
            const cs = (sel: string) => getComputedStyle(shadow.querySelector(sel)!);
            const m = cs(".gp-ov-safe");
            return {
              // what the author sees: layout px x zoom
              safeLine: parseFloat(m.borderTopWidth) * zoom,
              safeColor: m.borderTopColor,
              tint: cs(".gp-ov-tint").backgroundColor,
              trimLine: parseFloat(cs(".gp-ov-trim").outlineWidth) * zoom,
              clip: (shadow.querySelector(".gp-ov-tint") as HTMLElement).style.clipPath,
            };
          });

        // default: a solid 2px-on-screen line, a translucent unsafe band
        const base = await look();
        expect(base.safeLine).toBeGreaterThanOrEqual(1.9);
        expect(base.safeLine).toBeLessThanOrEqual(2.1);
        expect(base.trimLine).toBeGreaterThanOrEqual(1.9);
        expect(base.tint).toMatch(/^color\(srgb|^rgba?\(/);
        expect(base.tint).not.toBe("rgba(0, 0, 0, 0)");
        expect(base.clip).toContain("evenodd");

        // the stage is a paint transform; the line stays ~2px on screen at half zoom
        await page.evaluate(() => document.documentElement.style.setProperty("--gutterpress-zoom", "0.5"));
        const half = await look();
        expect(half.safeLine).toBeGreaterThanOrEqual(1.9);
        expect(half.safeLine).toBeLessThanOrEqual(2.1);
        await page.evaluate(() => document.documentElement.style.removeProperty("--gutterpress-zoom"));

        // strength and colour are tokens on the overlay's own root: a restyle needs no repaint
        const same = await page.evaluate(() => {
          const safe = document.querySelector("gp-overlay")!.shadowRoot!.querySelector(".gp-ov-safe") as any;
          safe.__same = true;
          (window as any).Gutterpress.decoration.setOverlay(true, { color: "#00aa55", strength: "strong" });
          return (document.querySelector("gp-overlay")!.shadowRoot!.querySelector(".gp-ov-safe") as any).__same === true;
        });
        expect(same).toBe(true);
        const strong = await look();
        expect(strong.safeLine).toBeGreaterThanOrEqual(2.9);
        expect(strong.safeColor).toBe("rgb(0, 170, 85)");
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true, { strength: "subtle" }));
        expect((await look()).safeLine).toBeLessThanOrEqual(1.1);

        // a bad value is ignored, not applied
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true, { color: "red; x:y", strength: "loud" }));
        const after = await look();
        expect(after.safeColor).toBe("rgb(0, 170, 85)");
        expect(after.safeLine).toBeLessThanOrEqual(1.1);
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);
