/**
 * Print overlays (overlay.ts).
 *
 * Two layers of evidence:
 *  1. the pure geometry + classification, fast and browser-free — the boxes
 *     the project's `page` block produces (a text box and an art box), how
 *     a piece of ink is judged against the rule that applies to it, and how a
 *     host names the layers and the colours;
 *  2. the real viewer in Chromium on `fixtures/overlay.html` — which text and
 *     art is flagged under which rule (page furniture included), what reads as
 *     intended, how the meta is read, that every box sits on its sheet whatever
 *     the book's margins, that the book's own CSS cannot hide, move or restyle
 *     it, that each of the three layers (bleed, safe, margins) is drawn alone
 *     and in its own colour, what the legend says, and that switching any of it
 *     on changes NOTHING about the book — plus `fixtures/mirrored-sheets.html`
 *     for the margins layer on a book whose recto and verso margins mirror.
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
import { classifyRect, layersFrom, pageBoxes, sanitizeOverlayStyle, type Rect } from "./overlay.ts";

// DriveThruRPG's file: 8.625 x 11.25in with a 0.125in bleed inside it, text 0.5in and art 0.25in inside the trim.
const DTRPG = { width: 621, height: 810, bleed: 9, safe: 36, artSafe: 18 };
const at = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("the boxes come from the project's page geometry", () => {
  test("the trim is the sheet pulled in on the top, bottom and OUTER edge: right on a recto, left on a verso", () => {
    const recto = pageBoxes(DTRPG, "recto");
    const verso = pageBoxes(DTRPG, "verso");
    expect(recto.sheet).toEqual({ x: 0, y: 0, w: 621, h: 810 });
    expect(recto.trim).toEqual({ x: 0, y: 9, w: 612, h: 792 });
    expect(verso.trim).toEqual({ x: 9, y: 9, w: 612, h: 792 });
  });

  test("the text box is the trim pulled in by `safe` on every edge", () => {
    expect(pageBoxes(DTRPG, "recto").safe).toEqual({ x: 36, y: 45, w: 540, h: 720 });
    expect(pageBoxes(DTRPG, "verso").safe).toEqual({ x: 45, y: 45, w: 540, h: 720 });
  });

  test("the art box is pulled in by `artSafe` on the top, bottom and outer edge, and by `safe` at the binding", () => {
    // recto: binding LEFT (36), outside RIGHT (18); verso: mirrored
    expect(pageBoxes(DTRPG, "recto").safeArt).toEqual({ x: 36, y: 27, w: 558, h: 756 });
    expect(pageBoxes(DTRPG, "verso").safeArt).toEqual({ x: 27, y: 27, w: 558, h: 756 });
    // one rule: the two boxes are the same box
    const one = { ...DTRPG, artSafe: DTRPG.safe };
    expect(pageBoxes(one, "recto").safeArt).toEqual(pageBoxes(one, "recto").safe);
    expect(pageBoxes(one, "verso").safeArt).toEqual(pageBoxes(one, "verso").safe);
  });

  test("no bleed: the trim is the sheet; no safe inset: both boxes are the trim", () => {
    const b = pageBoxes({ width: 432, height: 648, bleed: 0, safe: 0, artSafe: 0 }, "verso");
    expect(b.trim).toEqual(b.sheet);
    expect(b.safe).toEqual(b.sheet);
    expect(b.safeArt).toEqual(b.sheet);
  });

  test("units scale together", () => {
    const b = pageBoxes({ width: 100, height: 200, bleed: 5, safe: 10, artSafe: 4 }, "recto", 2);
    expect(b.sheet.w).toBe(200);
    expect(b.trim).toEqual({ x: 0, y: 10, w: 190, h: 380 });
    expect(b.safe.x).toBe(20);
    expect(b.safeArt).toEqual({ x: 20, y: 18, w: 162, h: 364 });
    expect(b.bleed).toBe(10);
  });
});

describe("judging a piece of ink", () => {
  // recto: sheet 0..621 x 0..810, trim x 0..612 y 9..801, text box x 36..576 y 45..765, art box x 36..594 y 27..783
  const b = pageBoxes(DTRPG, "recto");
  const verso = pageBoxes(DTRPG, "verso");
  const kind = (r: Rect, boxes = b, rule: "text" | "art" = "text", tol = 0) => classifyRect(r, boxes, rule, tol).kind;

  test("text inside the text box", () => {
    expect(kind(at(36, 45, 540, 720))).toBe("inside");
    expect(kind(at(100, 100, 50, 50))).toBe("inside");
  });

  test("an exact fit, or sub-pixel noise, is not an overflow", () => {
    expect(kind(at(36, 45, 540.4, 720), b, "text", 1)).toBe("inside");
    expect(kind(at(35.5, 45, 540, 720), b, "text", 1)).toBe("inside");
    expect(kind(at(36, 45, 542, 720), b, "text", 1)).toBe("unsafe");
  });

  test("past the text box but on the trimmed page: unsafe, with how far from the trim and how far it should be", () => {
    expect(classifyRect(at(10, 100, 50, 10), b, "text")).toEqual({ kind: "unsafe", gap: 10, need: 36 });
    expect(classifyRect(at(100, 100, 510, 10), b, "text")).toEqual({ kind: "unsafe", gap: 2, need: 36 });
  });

  test("past the trim but on the sheet: the bleed; the binding edge has none", () => {
    // reaches the right edge: a recto's outer edge (bleed), a verso's binding edge (unsafe: nothing is cut there)
    const toRight = at(100, 100, 521, 10);
    expect(classifyRect(toRight, b, "text")).toEqual({ kind: "bleed", gap: -9, need: 36 });
    expect(kind(toRight, verso)).toBe("unsafe");
    expect(classifyRect(at(100, 3, 100, 10), b, "text")).toEqual({ kind: "bleed", gap: -6, need: 36 });
  });

  test("past the sheet: off the page", () => {
    expect(kind(at(100, 100, 600, 10))).toBe("off-page");
    expect(kind(at(-3, 100, 100, 10))).toBe("off-page");
  });

  test("with no bleed, anything past the trim is off the page", () => {
    const none = pageBoxes({ width: 400, height: 500, bleed: 0, safe: 24, artSafe: 24 }, "recto");
    expect(kind(at(0, 0, 400, 500), none)).toBe("unsafe");
    expect(kind(at(-1, 100, 100, 10), none)).toBe("off-page");
  });

  test("the same rect, two rules: 0.44in from the outside edge is fine for art (0.25in) and not for text (0.5in)", () => {
    const nearOutside = at(100, 100, 480, 10); // right edge 580: 32pt from the trim
    expect(kind(nearOutside, b, "text")).toBe("unsafe");
    expect(kind(nearOutside, b, "art")).toBe("inside");
  });

  test("DriveThruRPG at 0.3in: too close for text, fine for art on an outside edge, too close for art at the binding", () => {
    const edge = 0.3 * 72; // from the trim; a recto's binding is on the left, its outside edge on the right
    expect(classifyRect(at(edge, 100, 100, 10), b, "text")).toEqual({ kind: "unsafe", gap: edge, need: 36 });
    expect(kind(at(612 - edge - 100, 100, 100, 10), b, "art")).toBe("inside");
    expect(classifyRect(at(edge, 100, 100, 10), b, "art")).toEqual({ kind: "unsafe", gap: edge, need: 36 });
  });

  test("art at the binding needs the text rule's distance; mirrored on a verso", () => {
    const nearLeft = at(30, 100, 50, 10);
    expect(classifyRect(nearLeft, b, "art")).toEqual({ kind: "unsafe", gap: 30, need: 36 });
    expect(kind(nearLeft, verso, "art")).toBe("inside"); // a verso's LEFT is its outside edge
    const nearRight = at(540, 100, 50, 10);
    expect(kind(nearRight, b, "art")).toBe("inside");
    expect(classifyRect(nearRight, verso, "art")).toEqual({ kind: "unsafe", gap: 31, need: 36 });
  });

  test("art that runs out to the sheet's edge is bleeding there, on any edge, and passes", () => {
    expect(kind(at(100, 100, 521, 10), b, "art")).toBe("inside"); // right edge = the sheet's edge
    expect(kind(at(100, 100, 600, 10), b, "art")).toBe("inside"); // past it: still bleeding
    expect(kind(at(-20, 100, 700, 10), b, "art")).toBe("inside");
    expect(kind(at(100, 0, 100, 100), b, "art")).toBe("inside"); // top
    expect(kind(at(100, 700, 100, 110), b, "art")).toBe("inside"); // bottom
    expect(kind(at(0, 100, 100, 10), b, "art")).toBe("inside"); // the binding edge too
    expect(kind(at(0, 0, 621, 810), b, "art")).toBe("inside"); // a full-page plate
    expect(kind(at(0, 0, 621, 810), verso, "art")).toBe("inside");
    // text gets no such pass
    expect(kind(at(100, 100, 521, 10), b, "text")).toBe("bleed");
    expect(kind(at(0, 0, 621, 810), b, "text")).toBe("bleed");
  });

  test("art that stops in the bleed band is flagged, and only the edges that fall short are judged", () => {
    expect(classifyRect(at(100, 100, 515, 10), b, "art")).toEqual({ kind: "bleed", gap: -3, need: 18 });
    expect(kind(at(100, 4, 100, 100), b, "art")).toBe("bleed");
    // the left edge is further past its line (the binding wants 36), but the right edge is in the band: the worse verdict wins, with its own numbers
    expect(classifyRect(at(10, 100, 605, 10), b, "art")).toEqual({ kind: "bleed", gap: -3, need: 18 });
  });

  test("with no bleed and no safe inset, a plate to the edge is inside, as art and as text", () => {
    const none = pageBoxes({ width: 400, height: 500, bleed: 0, safe: 0, artSafe: 0 }, "recto");
    expect(kind(at(0, 0, 400, 500), none, "art")).toBe("inside");
    expect(kind(at(0, 0, 400, 500), none, "text")).toBe("inside");
    expect(kind(at(-1, 100, 100, 10), none, "text")).toBe("off-page");
  });
});

describe("the layers and the look a host may set", () => {
  test("a boolean sets all three layers; an object names the ones that are on", () => {
    expect(layersFrom(true)).toEqual({ bleed: true, safe: true, margins: true });
    expect(layersFrom(false)).toEqual({ bleed: false, safe: false, margins: false });
    expect(layersFrom({ safe: true })).toEqual({ bleed: false, safe: true, margins: false });
    expect(layersFrom({ bleed: true, margins: true })).toEqual({ bleed: true, safe: false, margins: true });
    // only a real `true` is on: anything else a host sends is off
    expect(layersFrom({ bleed: "yes", safe: 1, margins: true })).toEqual({ bleed: false, safe: false, margins: true });
    expect(layersFrom(undefined)).toEqual({ bleed: false, safe: false, margins: false });
    expect(layersFrom(null)).toEqual({ bleed: false, safe: false, margins: false });
  });

  test("only a hex colour and a known strength get through; `color` is the safe layer's alias", () => {
    expect(sanitizeOverlayStyle({ color: "#00AA55", strength: "strong" })).toEqual({
      colors: { safe: "#00AA55" },
      strength: "strong",
    });
    expect(sanitizeOverlayStyle({ color: "#0a5" })).toEqual({ colors: { safe: "#0a5" } });
    expect(sanitizeOverlayStyle({ colors: { bleed: "#aa0000", safe: "#00aa55", margins: "#e91e63" } })).toEqual({
      colors: { bleed: "#aa0000", safe: "#00aa55", margins: "#e91e63" },
    });
    // `colors.safe` wins over its alias; a bad one lets the alias through
    expect(sanitizeOverlayStyle({ color: "#111111", colors: { safe: "#222222" } })).toEqual({ colors: { safe: "#222222" } });
    expect(sanitizeOverlayStyle({ color: "#111111", colors: { safe: "blue" } })).toEqual({ colors: { safe: "#111111" } });
    // the alias is the SAFE layer's only
    expect(sanitizeOverlayStyle({ color: "#111111" }).colors).toEqual({ safe: "#111111" });
    expect(sanitizeOverlayStyle({ color: "red; x: y", strength: "loud" })).toEqual({});
    expect(sanitizeOverlayStyle({ color: "url(javascript:1)" })).toEqual({});
    expect(sanitizeOverlayStyle({ colors: { bleed: "red; x: y", margins: 7, nope: "#fff" } })).toEqual({});
    expect(sanitizeOverlayStyle({ colors: "#fff" })).toEqual({});
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

async function withFixture<T>(
  run: (url: string) => Promise<T>,
  name = "overlay.html",
  edit: (html: string) => string = (html) => html,
): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(FIXTURES_DIR, "..", ".overlay-"));
  try {
    const source = edit(await fsp.readFile(path.join(FIXTURES_DIR, name), "utf8"));
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
  "draws the project's safe lines, trim and bleed on every sheet, judges ink by the rule that applies to it, and changes nothing else",
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
        expect(summary).toEqual({
          on: true,
          layers: { bleed: true, safe: true, margins: true },
          issues: 11,
          intended: 1,
          bleedPt: 9,
          safePt: 18,
          artSafePt: 9,
          counts: { text: 3, art: 4, bleed: 3, offPage: 1, intended: 1 },
        });

        const flags = await page.evaluate(() =>
          Array.from(
            document.querySelector("gp-overlay")!.shadowRoot!.querySelectorAll<HTMLElement>(".gp-ov-flag"),
          ).map((f) => ({
            page: f.parentElement!.dataset.page,
            rule: f.dataset.rule,
            kind: f.dataset.kind,
            left: parseFloat(f.style.left),
            top: parseFloat(f.style.top),
            width: parseFloat(f.style.width),
            title: f.title,
          })),
        );
        // one flag per offending rect, in document order, then the page furniture; each carries the rule it broke
        expect(flags.map((f) => [f.page, f.rule, f.kind])).toEqual([
          ["1", "art", "unsafe"], //  #into-unsafe: a bar 4px past the art line on the outside edge
          ["1", "art", "bleed"], //   #into-bleed: ends in the bleed band
          ["1", "art", "intended"], // #placed (.gp-behind): in the band on purpose
          ["1", "art", "unsafe"], //  #boxed: a border alone paints
          ["1", "text", "unsafe"], // #text-near: glyphs 0.15in from the trim (a paragraph paints nothing: only its text is flagged)
          ["1", "text", "unsafe"], // #text-out: 0.125in from the outside edge: art could sit here, text may not
          ["1", "text", "bleed"], //  #text-bleed
          ["1", "text", "off-page"], // #text-off
          ["1", "art", "unsafe"], //  #art-binding: the 0.19in that is fine at the outside edge is not at the binding
          ["1", "art", "bleed"], //   #art-band: an image that stops in the band
          ["1", "text", "unsafe"], // the folio in the bottom margin: page furniture is judged too
          ["2", "art", "unsafe"], //  #v-binding on a verso: the binding is the RIGHT edge
        ]);
        // not flagged: #fits, #runs-off (runs past both sheet edges), #art-outside, #art-edge (reaches the sheet edge), #v-outside
        // the unsafe bar: starts at the text column (60), 320px wide
        expect(flags[0]!.left).toBeCloseTo(60, 0);
        expect(flags[0]!.width).toBeCloseTo(320, 0);
        // the folio sits in the bottom margin
        expect(flags[10]!.top).toBeGreaterThan(460);
        // what a flag says: how far from the trim, and what the printer needs (the preset's spec, by its label)
        const spec = "DriveThruRPG — Quick Specifications for Print Books";
        expect(flags[4]!.title).toBe(`text 0.15in from the trim; ${spec} needs 0.25in`);
        expect(flags[6]!.title).toBe(`text 0.06in past the trim; ${spec} needs 0.25in`);
        expect(flags[8]!.title).toBe(`art 0.19in from the trim; ${spec} needs 0.25in`); // at the binding art takes the text distance
        expect(flags[3]!.title).toBe(`art 0.08in from the trim; ${spec} needs 0.13in`); // on the outside edge, the art distance
        expect(flags[2]!.title).toMatch(/\(placed on purpose\)$/);

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
              arts: pg.querySelectorAll(".gp-ov-art").length,
              art: box(pg.querySelector<HTMLElement>(".gp-ov-art")!),
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
          expect(p.arts).toBe(1);
          expect(p.trim).toEqual([recto ? "0px" : "12px", "12px", "388px", "476px"]);
          // text box: 24px in on every edge
          expect(p.safe).toEqual([recto ? "24px" : "36px", "36px", "340px", "428px"]);
          // art box: 12px in on the top, bottom and outside edge, 24px at the binding — the same box on both sides of the spread
          expect(p.art).toEqual(["24px", "24px", "352px", "452px"]);
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
          issues: 11,
          intended: 1,
          counts: { text: 3, art: 4, bleed: 3, offPage: 1, intended: 1 },
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
  "the meta is read for what it says: no `artSafe` means `safe`, a spec only names the rule, junk is dropped",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        const withMeta = (content: string) =>
          page.evaluate((c: string) => {
            document.querySelector('meta[name="gp-print-area"]')!.setAttribute("content", c);
            const summary = (window as any).Gutterpress.decoration.setOverlay(true);
            const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
            const flags = Array.from(shadow.querySelectorAll<HTMLElement>(".gp-ov-flag"));
            return {
              summary,
              arts: shadow.querySelectorAll(".gp-ov-art").length,
              nearTrim: flags.find((f) => f.title.startsWith("text 0.15in"))?.title,
            };
          }, content);

        // no artSafe: the art rule is the text rule, so there is one safe line, and art 0.19in from the outside edge now fails too
        const one = await withMeta('{"width":300,"height":375,"bleed":9,"safe":18}');
        expect(one.summary).toMatchObject({ safePt: 18, artSafePt: 18, issues: 13 });
        expect(one.summary.counts).toEqual({ text: 3, art: 6, bleed: 3, offPage: 1, intended: 1 });
        expect(one.arts).toBe(0);
        // no spec: the rule is just "the safe area"
        expect(one.nearTrim).toBe("text 0.15in from the trim; the safe area needs 0.25in");

        // an explicit 0 is a rule too (art may touch the trim; only the binding edge keeps its distance)
        const zero = await withMeta('{"width":300,"height":375,"bleed":9,"safe":18,"artSafe":0}');
        expect(zero.summary).toMatchObject({ safePt: 18, artSafePt: 0 });
        expect(zero.arts).toBe(0);

        // not numbers, not strings: dropped, as if absent
        const junk = await withMeta(
          '{"width":300,"height":375,"bleed":9,"safe":18,"artSafe":"lots","preset":7,"spec":{"label":1}}',
        );
        expect(junk.summary).toMatchObject({ safePt: 18, artSafePt: 18 });
        expect(junk.nearTrim).toBe("text 0.15in from the trim; the safe area needs 0.25in");
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
            artDisplay: getComputedStyle(host.shadowRoot!.querySelector(".gp-ov-art")!).display,
            safeDisplay: ss.display,
            safeColor: ss.borderTopColor,
            safeWidth: parseFloat(ss.borderTopWidth),
          };
        });
        expect(seen.parent).toBe("HTML");
        expect(seen.display).toBe("block");
        expect(seen.opacity).toBe("1");
        expect(seen.pageDisplay).toBe("block");
        expect(seen.artDisplay).toBe("block");
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
        // only the text that leaves the sheet is a problem (art that runs past it is bleeding); no safe area, no bleed
        expect(summary).toEqual({
          on: true,
          layers: { bleed: true, safe: true, margins: true },
          issues: 1,
          intended: 0,
          bleedPt: 0,
          safePt: 0,
          artSafePt: 0,
          counts: { text: 0, art: 0, bleed: 0, offPage: 1, intended: 0 },
        });
        const sheets = await page.evaluate(() => document.querySelectorAll(".gp-sheet").length);
        const drawn = await page.evaluate(() => {
          const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
          return {
            safes: shadow.querySelectorAll(".gp-ov-safe").length,
            arts: shadow.querySelectorAll(".gp-ov-art").length,
            bleeds: shadow.querySelectorAll(".gp-ov-bleed").length,
            margins: shadow.querySelectorAll(".gp-ov-margins").length,
            flags: Array.from(shadow.querySelectorAll<HTMLElement>(".gp-ov-flag")).map((f) => [f.dataset.rule, f.dataset.kind]),
          };
        });
        // the margins layer is the book's own @page margins, so it needs no manifest: one box per sheet
        expect(drawn).toEqual({ safes: 0, arts: 0, bleeds: 0, margins: sheets, flags: [["text", "off-page"]] });
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
        expect((events[0] as any).issues).toBe(11);
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
            const art = cs(".gp-ov-art");
            return {
              // what the author sees: layout px x zoom
              safeLine: parseFloat(m.borderTopWidth) * zoom,
              safeColor: m.borderTopColor,
              safeStyle: m.borderTopStyle,
              artLine: parseFloat(art.borderTopWidth) * zoom,
              artColor: art.borderTopColor,
              artStyle: art.borderTopStyle,
              tint: cs(".gp-ov-tint").backgroundColor,
              trimLine: parseFloat(cs(".gp-ov-trim").outlineWidth) * zoom,
              clip: (shadow.querySelector(".gp-ov-tint") as HTMLElement).style.clipPath,
            };
          });

        // default: a 2px-on-screen text line (dashed) and art line (dotted) in one colour, a translucent unsafe band
        const base = await look();
        expect(base.safeLine).toBeGreaterThanOrEqual(1.9);
        expect(base.safeLine).toBeLessThanOrEqual(2.1);
        expect(base.safeStyle).toBe("dashed");
        expect(base.artStyle).toBe("dotted");
        expect(base.artLine).toBeGreaterThanOrEqual(1.9);
        expect(base.artLine).toBeLessThanOrEqual(2.1);
        expect(base.artColor).toBe(base.safeColor);
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
        expect(strong.artColor).toBe("rgb(0, 170, 85)");
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

// ── layers, colours, margins, legend ───────────────────────────────────────

/** The look of one of the project's two spec links, as the overlay fixture's meta words it. */
const SPEC_LABEL = "DriveThruRPG — Quick Specifications for Print Books";
const SPEC_URL = "https://help.drivethrupartners.com/hc/en-us/articles/12780800178583-Quick-Specifications-for-Print-Books";

testIf(
  "each layer is drawn alone: bleed is the band and the trim, safe the lines, the tint and every flag, margins the book's own content box",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        const sheets = await page.evaluate(() => document.querySelectorAll(".gp-sheet").length);
        const book = () =>
          page.evaluate(() => ({
            pages: (window as any).Gutterpress.totalPages as number,
            markup: document.querySelector(".gp-strip")!.outerHTML,
            body: document.body.getBoundingClientRect().height,
          }));
        const before = await book();
        await page.evaluate(() => {
          (window as any).__events = [];
          window.addEventListener("gp:overlay", (e) => (window as any).__events.push((e as CustomEvent).detail.layers));
        });

        /** Switch the overlay to `state`, and report what is drawn. */
        const drawn = (state: unknown) =>
          page.evaluate((s: unknown) => {
            const summary = (window as any).Gutterpress.decoration.setOverlay(s);
            const shadow = document.querySelector("gp-overlay")?.shadowRoot;
            const count = (sel: string) => shadow?.querySelectorAll(sel).length ?? 0;
            return {
              summary,
              bleed: count(".gp-ov-bleed"),
              trim: count(".gp-ov-trim"),
              tint: count(".gp-ov-tint"),
              safe: count(".gp-ov-safe"),
              art: count(".gp-ov-art"),
              margins: count(".gp-ov-margins"),
              flags: count(".gp-ov-flag"),
              legend: Array.from(shadow?.querySelectorAll(".gp-ov-row b") ?? []).map((b) => b.textContent),
              host: document.querySelectorAll("gp-overlay").length,
            };
          }, state);

        const none = { bleed: 0, trim: 0, tint: 0, safe: 0, art: 0, margins: 0, flags: 0 };
        const found = { text: 3, art: 4, bleed: 3, offPage: 1, intended: 1 };
        const quiet = { text: 0, art: 0, bleed: 0, offPage: 0, intended: 0 };

        // bleed: the band and the trim line, and nothing else — nothing is judged
        const bleed = await drawn({ bleed: true });
        expect(bleed).toMatchObject({ ...none, bleed: sheets, trim: sheets, legend: ["Bleed"], host: 1 });
        expect(bleed.summary).toMatchObject({ on: true, layers: { bleed: true, safe: false, margins: false }, issues: 0, bleedPt: 9, safePt: 18, counts: quiet });
        expect(await book()).toEqual(before);

        // safe: both lines, the tint and every flag (the whole of what the overlay found)
        const safe = await drawn({ safe: true });
        expect(safe).toMatchObject({ ...none, tint: sheets, safe: sheets, art: sheets, flags: 12, legend: ["Safe area"] });
        expect(safe.summary).toMatchObject({ on: true, layers: { bleed: false, safe: true, margins: false }, issues: 11, intended: 1, counts: found });
        expect(await book()).toEqual(before);

        // margins: the page's own content box, and nothing else — nothing is judged
        const margins = await drawn({ margins: true });
        expect(margins).toMatchObject({ ...none, margins: sheets, legend: ["Page margins"] });
        expect(margins.summary).toMatchObject({ on: true, layers: { bleed: false, safe: false, margins: true }, issues: 0, counts: quiet });
        expect(await book()).toEqual(before);

        // two together, and all three
        expect(await drawn({ bleed: true, margins: true })).toMatchObject({ ...none, bleed: sheets, trim: sheets, margins: sheets, legend: ["Bleed", "Page margins"] });
        const all = await drawn(true);
        expect(all).toMatchObject({ bleed: sheets, trim: sheets, tint: sheets, safe: sheets, art: sheets, margins: sheets, flags: 12, legend: ["Bleed", "Safe area", "Page margins"] });
        expect(all.summary).toMatchObject({ on: true, layers: { bleed: true, safe: true, margins: true }, issues: 11, counts: found });
        expect(await book()).toEqual(before);

        // the record a host carries across a reload names the layers that were showing, and outlives switching off
        const records = () => page.evaluate(() => ({ overlay: document.body.dataset.overlay, layers: document.body.dataset.overlayLayers }));
        await drawn({ bleed: true, margins: true });
        expect(await records()).toEqual({ overlay: "on", layers: "bleed,margins" });
        // no layer at all is no overlay: gone, whichever way it is asked for
        for (const off of [false, {}, { bleed: false, safe: false, margins: false }]) {
          await drawn(true);
          const gone = await drawn(off);
          expect(gone).toMatchObject({ ...none, host: 0, legend: [] });
          expect(gone.summary).toEqual({
            on: false,
            layers: { bleed: false, safe: false, margins: false },
            issues: 0,
            intended: 0,
            bleedPt: 0,
            safePt: 0,
            artSafePt: 0,
            counts: quiet,
          });
          expect(await records()).toEqual({ overlay: "off", layers: "bleed,safe,margins" });
        }
        await drawn({ bleed: true, margins: true });
        await drawn(false);
        expect(await records()).toEqual({ overlay: "off", layers: "bleed,margins" });
        expect(await book()).toEqual(before);

        // every change announced the layers it left drawn
        expect(await page.evaluate(() => (window as any).__events)).toContainEqual({ bleed: true, safe: false, margins: false });
        expect(await page.evaluate(() => (window as any).__events)).toContainEqual({ bleed: false, safe: false, margins: false });
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "switching a layer while the overlay is on repaints it; restyling the same layers does not",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        const state = (s: unknown, style?: unknown) =>
          page.evaluate(
            (a: unknown, b: unknown) => {
              const shadow = () => document.querySelector("gp-overlay")!.shadowRoot!;
              const first = shadow().querySelector<any>(".gp-ov-page");
              if (first) first.__same = true;
              const summary = (window as any).Gutterpress.decoration.setOverlay(a, b);
              const now = shadow();
              return {
                kept: now.querySelector<any>(".gp-ov-page")?.__same === true,
                margins: now.querySelectorAll(".gp-ov-margins").length,
                flags: now.querySelectorAll(".gp-ov-flag").length,
                summary,
              };
            },
            s,
            style,
          );
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay({ safe: true }));
        // the same layers with a look: a restyle, nothing is redrawn
        const restyled = await state({ safe: true }, { strength: "strong", colors: { safe: "#00aa55" } });
        expect(restyled.kept).toBe(true);
        expect(restyled.margins).toBe(0);
        // another layer: drawn again, and the flags are still found
        const more = await state({ safe: true, margins: true }, { strength: "subtle" });
        expect(more.kept).toBe(false);
        expect(more.margins).toBeGreaterThan(0);
        expect(more.flags).toBe(12);
        // the layer's own look can follow, again without a redraw
        const same = await state({ safe: true, margins: true }, { colors: { margins: "#e91e63" } });
        expect(same.kept).toBe(true);
        // dropping the safe layer drops its flags with it
        const less = await state({ margins: true }, { colors: { margins: "#e91e63" } });
        expect(less.kept).toBe(false);
        expect(less.flags).toBe(0);
        expect(less.summary).toMatchObject({ issues: 0, layers: { bleed: false, safe: false, margins: true } });
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "each layer has its own colour, kept when the overlay is switched off, and the legend's swatches show it",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        const look = () =>
          page.evaluate(() => {
            const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
            const cs = (sel: string) => getComputedStyle(shadow.querySelector(sel)!);
            const zoom = new DOMMatrixReadOnly(getComputedStyle(document.body).transform).a || 1;
            return {
              safe: cs(".gp-ov-safe").borderTopColor,
              art: cs(".gp-ov-art").borderTopColor,
              margins: cs(".gp-ov-margins").borderTopColor,
              trim: cs(".gp-ov-trim").outlineColor,
              swatch: {
                bleed: cs('.gp-ov-swatch[data-layer="bleed"]').backgroundColor,
                safe: cs('.gp-ov-swatch[data-layer="safe"]').backgroundColor,
                margins: cs('.gp-ov-swatch[data-layer="margins"]').backgroundColor,
              },
              marginsStyle: cs(".gp-ov-margins").borderTopStyle,
              // what the author sees: layout px x zoom
              marginsLine: parseFloat(cs(".gp-ov-margins").borderTopWidth) * zoom,
              safeLine: parseFloat(cs(".gp-ov-safe").borderTopWidth) * zoom,
              records: { ...document.body.dataset },
            };
          });
        const set = (style: unknown) =>
          page.evaluate((s: unknown) => (window as any).Gutterpress.decoration.setOverlay(true, s), style);
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true));

        // the defaults: blue safe lines, red bleed, green margins — the margins a thin solid line
        const base = await look();
        expect(base.safe).toBe("rgb(47, 128, 237)");
        expect(base.art).toBe("rgb(47, 128, 237)");
        expect(base.margins).toBe("rgb(26, 156, 107)");
        expect(base.swatch).toEqual({ bleed: "rgb(229, 72, 77)", safe: "rgb(47, 128, 237)", margins: "rgb(26, 156, 107)" });
        expect(base.marginsStyle).toBe("solid");
        expect(base.marginsLine).toBeGreaterThanOrEqual(0.9);
        expect(base.marginsLine).toBeLessThanOrEqual(1.1);
        expect(base.marginsLine).toBeLessThan(base.safeLine);

        // one layer's colour moves only that layer
        await set({ colors: { margins: "#e91e63" } });
        const margins = await look();
        expect(margins.margins).toBe("rgb(233, 30, 99)");
        expect(margins.swatch.margins).toBe("rgb(233, 30, 99)");
        expect(margins.safe).toBe(base.safe);
        expect(margins.swatch.bleed).toBe(base.swatch.bleed);
        expect(margins.trim).toBe(base.trim);

        // bleed's colour carries the trim line with it; safe's carries both of its lines
        await set({ colors: { bleed: "#00aa55", safe: "#0000ff" } });
        const two = await look();
        expect(two.swatch).toEqual({ bleed: "rgb(0, 170, 85)", safe: "rgb(0, 0, 255)", margins: "rgb(233, 30, 99)" });
        expect(two.safe).toBe("rgb(0, 0, 255)");
        expect(two.art).toBe("rgb(0, 0, 255)");
        expect(two.margins).toBe("rgb(233, 30, 99)");
        expect(two.trim).not.toBe(base.trim);

        // `color` is the safe layer's alias; a bad value is ignored, not applied
        await set({ color: "#123456" });
        expect((await look()).safe).toBe("rgb(18, 52, 86)");
        await set({ colors: { bleed: "red; x:y", margins: 7 as unknown as string }, color: "url(javascript:1)" });
        const kept = await look();
        expect(kept.swatch).toEqual({ bleed: "rgb(0, 170, 85)", safe: "rgb(18, 52, 86)", margins: "rgb(233, 30, 99)" });

        // the look is recorded for a host to carry across a reload, and survives switching the overlay off and on
        expect(kept.records).toMatchObject({
          overlayColor: "#123456",
          overlayBleedColor: "#00aa55",
          overlayMarginsColor: "#e91e63",
        });
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(false));
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay(true));
        expect((await look()).swatch).toEqual(kept.swatch);
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

/** In-page: every overlay margins box against the sheet it belongs to, in the sheet's own px. */
function marginsBoxes() {
  const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
  return Array.from(shadow.querySelectorAll<HTMLElement>(".gp-ov-page")).map((pg) => {
    const sheet = document.querySelector<HTMLElement>(`.gp-sheet[data-page="${pg.dataset.page}"]`)!;
    const box = pg.querySelector<HTMLElement>(".gp-ov-margins")!.getBoundingClientRect();
    const s = sheet.getBoundingClientRect();
    const round = (n: number) => Math.round(n * 100) / 100;
    return {
      page: Number(pg.dataset.page),
      side: sheet.dataset.side,
      x: round(box.left - s.left),
      y: round(box.top - s.top),
      w: round(box.width),
      h: round(box.height),
    };
  });
}

testIf(
  "margins: a page's own @page content box — a recto's margins, a verso's mirrored — where that page's text sits",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay({ margins: true }));
        // the fixture: a 400x500px sheet; a recto binds on the left (L50, R30), a verso on the right (L30, R50); top and bottom 40
        const boxes = await page.evaluate(marginsBoxes);
        expect(boxes).toHaveLength(6);
        for (const b of boxes) {
          expect(b.side).toBe(b.page % 2 === 1 ? "recto" : "verso");
          expect(b.x).toBeCloseTo(b.side === "recto" ? 50 : 30, 1);
          expect(b.y).toBeCloseTo(40, 1);
          expect(b.w).toBeCloseTo(320, 1);
          expect(b.h).toBeCloseTo(420, 1);
        }
        // …which is where each page's text is: the box is the book's choice, drawn, not a guess
        const text = await page.evaluate(() => {
          const left = (id: string) => {
            const el = document.getElementById(id)!;
            const sheet = document.querySelector(`.gp-sheet[data-page="${(window as any).Gutterpress.pageOf(el, (window as any).Gutterpress.strips) + 1}"]`)!;
            return Math.round((el.getBoundingClientRect().left - sheet.getBoundingClientRect().left) * 100) / 100;
          };
          const fits = document.getElementById("fits")!.getBoundingClientRect();
          return { t1: left("t1"), t2: left("t2"), fits: left("fits"), fitsWidth: fits.width };
        });
        expect(text.t1).toBeCloseTo(boxes[0]!.x, 1);
        expect(text.t2).toBeCloseTo(boxes[1]!.x, 1);
        // a bar that exactly fills the verso's content box is exactly the box
        expect(text.fits).toBeCloseTo(boxes[1]!.x, 1);
        expect(text.fitsWidth).toBeCloseTo(boxes[1]!.w, 1);

        // each box sits on its sheet, whatever the zoom
        for (const d of await page.evaluate(alignment)) expect(d).toBeLessThan(0.5);
        await page.evaluate(() => document.documentElement.style.setProperty("--gutterpress-zoom", "0.5"));
        for (const d of await page.evaluate(alignment)) expect(d).toBeLessThan(0.5);
        const half = await page.evaluate(marginsBoxes);
        for (const [i, b] of half.entries()) {
          // on screen the box is half the size, and still the same fraction of its sheet
          expect(b.x).toBeCloseTo(boxes[i]!.x / 2, 1);
          expect(b.w).toBeCloseTo(boxes[i]!.w / 2, 1);
        }
        // and a thin solid line at any zoom: about one pixel on screen
        const line = await page.evaluate(() => {
          const el = document.querySelector("gp-overlay")!.shadowRoot!.querySelector(".gp-ov-margins")!;
          const zoom = new DOMMatrixReadOnly(getComputedStyle(document.body).transform).a || 1;
          return parseFloat(getComputedStyle(el).borderTopWidth) * zoom;
        });
        expect(line).toBeGreaterThanOrEqual(0.9);
        expect(line).toBeLessThanOrEqual(1.1);
      } finally {
        await page.close();
      }
    }, "mirrored-sheets.html");
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "margins: a book whose recto and verso margins are the same draws the same box on both",
  async () => {
    await withFixture(
      async (url) => {
        const page = await (await getBrowser()).newPage();
        try {
          await page.goto(url);
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay({ margins: true }));
          for (const b of await page.evaluate(marginsBoxes)) {
            expect([b.x, b.y, b.w, b.h].map((n) => Math.round(n))).toEqual([40, 40, 320, 420]);
          }
        } finally {
          await page.close();
        }
      },
      "mirrored-sheets.html",
      // drop the pair of mirrored rules: both sides take `@page { margin: 40px }`
      (html) => html.replace("margin-left: 30px; margin-right: 50px;", "").replace("margin-left: 50px; margin-right: 30px;", ""),
    );
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "margins: the blank pages appended to fill a signature are plain sheets, with no margins of their own to draw",
  async () => {
    await withFixture(
      async (url) => {
        const page = await (await getBrowser()).newPage();
        try {
          await page.goto(url);
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          // six pages of content, padded to a signature of four: pages 7 and 8 are the PDF build's blanks
          expect(await page.evaluate(() => document.querySelectorAll(".gp-sheet").length)).toBe(8);
          await page.evaluate(() => (window as any).Gutterpress.decoration.setOverlay({ margins: true }));
          const boxes = await page.evaluate(() =>
            Array.from(document.querySelector("gp-overlay")!.shadowRoot!.querySelectorAll<HTMLElement>(".gp-ov-page")).map(
              (pg) => [Number(pg.dataset.page), pg.querySelectorAll(".gp-ov-margins").length],
            ),
          );
          expect(boxes).toEqual([[1, 1], [2, 1], [3, 1], [4, 1], [5, 1], [6, 1], [7, 0], [8, 0]]);
        } finally {
          await page.close();
        }
      },
      "mirrored-sheets.html",
      (html) => html.replace("<html>", '<html data-gp-signature="4">'),
    );
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "the legend: a row per enabled layer with its values, where they come from, what was found, in a corner that does not move",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        const legend = (state: unknown = true) =>
          page.evaluate((s: unknown) => {
            (window as any).Gutterpress.decoration.setOverlay(s);
            const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
            const el = shadow.querySelector<HTMLElement>(".gp-ov-legend");
            if (!el) return null;
            const link = el.querySelector("a");
            const r = el.getBoundingClientRect();
            const rows = Array.from(el.querySelectorAll(".gp-ov-row"));
            return {
              rows: rows.map((row) => row.textContent),
              swatches: Array.from(el.querySelectorAll<HTMLElement>(".gp-ov-swatch")).map((sw) => sw.dataset.layer),
              lines: Array.from(el.children).filter((c) => !rows.includes(c)).map((c) => c.textContent),
              link: link && { text: link.textContent, href: link.getAttribute("href"), target: link.target, rel: link.rel },
              corner: { right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
              inRoot: el.closest(".root") !== null,
              legendPointer: getComputedStyle(el).pointerEvents,
            };
          }, state);

        // all three layers (the fixture's meta is DriveThruRPG's rules, scaled: bleed 9pt, text 18pt, art 9pt)
        const all = (await legend())!;
        expect(all.rows).toEqual([
          "Bleed 0.125in — top, bottom, outside; none at the binding",
          "Safe area — text 0.25in; art 0.125in (0.25in at the binding)",
          "Page margins — your stylesheet's @page margins",
        ]);
        expect(all.swatches).toEqual(["bleed", "safe", "margins"]);
        // where the numbers come from: the printer's spec, as a link that opens elsewhere
        expect(all.link).toEqual({ text: SPEC_LABEL, href: SPEC_URL, target: "_blank", rel: "noopener" });
        expect(all.lines).toEqual([
          `from ${SPEC_LABEL}`,
          "3 text outside the safe area · 4 art outside · 3 in the bleed band · 1 off the page · 1 placed on purpose",
        ]);
        expect(all.inRoot).toBe(true);

        // each row follows its layer; the source is shown only where the printer's numbers are; counts only with the safe layer
        expect((await legend({ bleed: true }))!).toMatchObject({
          rows: ["Bleed 0.125in — top, bottom, outside; none at the binding"],
          lines: [`from ${SPEC_LABEL}`],
        });
        expect((await legend({ safe: true }))!).toMatchObject({
          rows: ["Safe area — text 0.25in; art 0.125in (0.25in at the binding)"],
          lines: [`from ${SPEC_LABEL}`, expect.stringMatching(/^3 text outside the safe area · 4 art outside/)],
        });
        const onlyMargins = (await legend({ margins: true }))!;
        expect(onlyMargins.rows).toEqual(["Page margins — your stylesheet's @page margins"]);
        expect(onlyMargins.lines).toEqual([]);
        expect(onlyMargins.link).toBeNull();

        // the host binds a key only in the standalone preview; the legend claims it only then
        expect(all.lines).not.toContain("Alt+M hides");
        await page.evaluate(() => (document.documentElement.dataset.overlayKey = "Alt+M"));
        expect((await legend())!.lines.at(-1)).toBe("Alt+M hides");

        // fixed in the corner of the viewport: scrolling and zooming the book do not move or scale it
        const corner = (await legend())!.corner;
        expect(corner.right).toBe(12);
        expect(corner.bottom).toBe(12);
        await page.evaluate(() => scrollTo(0, 400));
        expect(await page.evaluate(() => scrollY)).toBeGreaterThan(0); // the book really moved under the legend
        await page.evaluate(() => document.documentElement.style.setProperty("--gutterpress-zoom", "0.5"));
        expect((await page.evaluate(() => {
          const r = document.querySelector("gp-overlay")!.shadowRoot!.querySelector(".gp-ov-legend")!.getBoundingClientRect();
          return { right: Math.round(innerWidth - r.right), bottom: Math.round(innerHeight - r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
        }))).toEqual(corner);
        await page.evaluate(() => document.documentElement.style.removeProperty("--gutterpress-zoom"));
        await page.evaluate(() => scrollTo(0, 0));

        // the pointer: the legend takes it (its link must be clickable); nothing else the overlay draws does
        const pointer = await page.evaluate(() => {
          const shadow = document.querySelector("gp-overlay")!.shadowRoot!;
          const link = shadow.querySelector("a")!.getBoundingClientRect();
          const flagged = document.getElementById("text-near")!.getBoundingClientRect();
          const at = (x: number, y: number) => document.elementFromPoint(x, y);
          return {
            legend: getComputedStyle(shadow.querySelector(".gp-ov-legend")!).pointerEvents,
            host: getComputedStyle(document.querySelector("gp-overlay")!).pointerEvents,
            root: getComputedStyle(shadow.querySelector(".root")!).pointerEvents,
            flag: getComputedStyle(shadow.querySelector(".gp-ov-flag")!).pointerEvents,
            margins: getComputedStyle(shadow.querySelector(".gp-ov-margins")!).pointerEvents,
            linkHit: shadow.elementFromPoint(link.left + link.width / 2, link.top + link.height / 2)?.tagName,
            // over a flagged line the book is still what is under the pointer
            bookHit: at(flagged.left + 20, flagged.top + flagged.height / 2)?.id,
          };
        });
        expect(pointer).toEqual({ legend: "auto", host: "none", root: "none", flag: "none", margins: "none", linkHit: "A", bookHit: "text-near" });

        // and it is not part of a printed page
        const hiddenForPrint = await page.evaluate(() => {
          const sheet = document.querySelector("gp-overlay")!.shadowRoot!.querySelector("style")!.sheet!;
          const print = Array.from(sheet.cssRules).find((r) => r instanceof CSSMediaRule && r.media.mediaText === "print") as CSSMediaRule;
          return Array.from(print.cssRules).some((r) => (r as CSSStyleRule).selectorText === ".root" && (r as CSSStyleRule).style.display === "none");
        });
        expect(hiddenForPrint).toBe(true);
      } finally {
        await page.close();
      }
    });
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "the legend says what the project has not set, where its numbers come from without a spec, and when everything is inside",
  async () => {
    await withFixture(async (url) => {
      const page = await (await getBrowser()).newPage();
      try {
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        // this book (a 400x500px sheet, every line inside it) has no <meta> of its own: add the project's geometry
        const legendFor = (content: string) =>
          page.evaluate((c: string) => {
            document.querySelector('meta[name="gp-print-area"]')?.remove();
            const meta = document.createElement("meta");
            meta.name = "gp-print-area";
            meta.content = c;
            document.head.appendChild(meta);
            (window as any).Gutterpress.decoration.setOverlay(true);
            const el = document.querySelector("gp-overlay")!.shadowRoot!.querySelector(".gp-ov-legend")!;
            const rows = Array.from(el.querySelectorAll(".gp-ov-row"));
            return {
              rows: rows.map((r) => r.textContent),
              lines: Array.from(el.children).filter((x) => !rows.includes(x)).map((x) => x.textContent),
              links: el.querySelectorAll("a").length,
            };
          }, content);

        // nothing set: say so, name the manifest key, and a book with nothing outside is told so
        expect(await legendFor('{"width":300,"height":375}')).toEqual({
          rows: [
            "Bleed — none set (page.bleed in manifest.yaml)",
            "Safe area — none set (page.safe in manifest.yaml)",
            "Page margins — your stylesheet's @page margins",
          ],
          lines: ["from manifest.yaml", "everything inside the safe area"],
          links: 0,
        });

        // a preset without a spec of its own: the numbers are the manifest's; one rule for text and art reads as one distance
        expect(await legendFor('{"width":300,"height":375,"bleed":9,"safe":18,"preset":"book"}')).toMatchObject({
          rows: [
            "Bleed 0.125in — top, bottom, outside; none at the binding",
            "Safe area — text and art 0.25in, every edge",
            "Page margins — your stylesheet's @page margins",
          ],
          lines: ["from manifest.yaml (preset book)", expect.any(String)],
          links: 0,
        });

        // a spec is a link only when its address is a web address
        const spec = (url: string) =>
          legendFor(`{"width":300,"height":375,"bleed":9,"safe":18,"preset":"dtrpg","spec":{"label":"A spec","url":${JSON.stringify(url)}}}`);
        expect((await spec("https://example.com/spec")).links).toBe(1);
        const unsafe = await spec("javascript:alert(1)");
        expect(unsafe.links).toBe(0);
        expect(unsafe.lines[0]).toBe("from manifest.yaml (preset dtrpg)");
      } finally {
        await page.close();
      }
    }, "mirrored-sheets.html");
  },
  RENDER_TEST_TIMEOUT_MS,
);
