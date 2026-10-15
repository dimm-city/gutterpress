import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";
import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";

/**
 * The pin box in the VIEWER — the preview twin of the print measurement in
 * `compiler/build.page-content-height.test.ts`.
 *
 * The viewer implements pinned art from the same shared policy the compiler
 * uses (shared/pin-edges.ts): a run whose page root carries edge pins gets a
 * strip whose page area grows into the freed margins (the page area is the
 * printable area, so that is the only way art reaches the paper), the root
 * gets those margins back as padding so its TEXT keeps the author's content
 * box, and the pin box — the root's padding box — is inset by the printer's
 * art-safe line from the book's print-area meta. `.gp-flush` zeroes the
 * insets. Decoration keeps the AUTHOR context's geometry: sheets and
 * margin-box furniture do not move, and a verso's sheet still slides by its
 * mirrored margins.
 *
 * Every number below is on `fixtures/pin-box.html` (see its header): rectos
 * L50/R30, versos L30/R50, top/bottom 40, and every page root padded 10px
 * 12px by the book; the art-safe line 36px in from the sheet on the outside
 * edges and 48px at the binding. If the viewer ever
 * disagrees with print here, an author sees art (or text) in one place on
 * screen and another in the PDF — the worst failure this project can produce.
 */

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

const SOURCE = (await fsp.readFile(path.join(FIXTURES_DIR, "pin-box.html"), "utf8")).replace(
  "</style>",
  `</style>\n<style>${MARKER_CSS}\n${GUTTERPRESS_CSS}</style>`,
);
/** The same book with every pinned image taken out. */
const UNPINNED = SOURCE.replace(/<p><span class="art [^"]*" id="a\d"><\/span><\/p>/g, "");

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
  fromRight: number;
  fromBottom: number;
}
interface Measured {
  total: number;
  pages: Array<{
    page: number;
    side: string;
    pageOf: number;
    text: Box;
    art: Box | null;
    /** the page root's content box, on its sheet */
    content: { x: number; y: number; w: number; h: number };
    strip: { w: string; h: string };
  }>;
}

async function measure(html: string): Promise<Measured> {
  const dir = await fsp.mkdtemp(path.join(FIXTURES_DIR, "..", ".pin-box-"));
  try {
    await fsp.writeFile(path.join(dir, "book.html"), html, "utf8");
    await fsp.copyFile(await getAssetPath("engine/gutterpress-viewer.js"), path.join(dir, "gutterpress-viewer.js"));
    const { url, close } = await serveDir(dir, "book.html");
    try {
      const page = await (await getBrowser()).newPage();
      try {
        // wide enough that the fit-to-width zoom never applies (rects stay unscaled)
        await page.setViewport({ width: 1600, height: 1200 });
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        return (await page.evaluate(() => {
          const G = (window as any).Gutterpress;
          const round = (v: number) => Math.round(v * 10) / 10;
          const sheet = (n: number) => document.querySelector<HTMLElement>(`.gp-sheet[data-page="${n}"]`)!;
          const rel = (el: Element, n: number) => {
            const s = sheet(n).getBoundingClientRect();
            const r = el.getBoundingClientRect();
            return {
              x: round(r.left - s.left),
              y: round(r.top - s.top),
              w: round(r.width),
              h: round(r.height),
              fromRight: round(s.right - r.right),
              fromBottom: round(s.bottom - r.bottom),
            };
          };
          const pages = [1, 2, 3, 4, 5, 6, 7, 8].map((n) => {
            const text = document.getElementById(`t${n}`)!;
            const art = document.getElementById(`a${n}`);
            const root = document.getElementById(`r${n}`)!;
            const box = rel(root, n);
            const cs = getComputedStyle(root);
            const [pt, pr, pb, pl] = [cs.paddingTop, cs.paddingRight, cs.paddingBottom, cs.paddingLeft].map(parseFloat) as [
              number,
              number,
              number,
              number,
            ];
            const strip = getComputedStyle(root.closest<HTMLElement>(".gp-strip")!);
            return {
              page: n,
              side: sheet(n).dataset.side!,
              pageOf: G.pageOf(text),
              text: rel(text, n),
              art: art ? rel(art, n) : null,
              content: { x: round(box.x + pl), y: round(box.y + pt), w: round(box.w - pl - pr), h: round(box.h - pt - pb) },
              strip: { w: strip.getPropertyValue("--gp-content-w"), h: strip.getPropertyValue("--gp-content-h") },
            };
          });
          return { total: G.totalPages, pages };
        })) as Measured;
      } finally {
        await page.close();
      }
    } finally {
      await close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

/** Within the 1px fragmentation cushion MARKER_CSS keeps under every page root. */
function onLine(actual: number, expected: number) {
  expect(actual).toBeGreaterThanOrEqual(expected - 0.5);
  expect(actual).toBeLessThanOrEqual(expected + 1.5);
}

testIf(
  "an ordinary pin rests on the art-safe line and a .gp-flush pin on the paper, on a recto and a verso",
  async () => {
    const m = await measure(SOURCE);
    const art = (n: number) => m.pages[n - 1]!.art!;
    expect(m.pages.map((p) => p.side)).toEqual(["recto", "verso", "recto", "verso", "recto", "verso", "recto", "verso"]);

    // bottom: 9pt bleed + 18pt art rule = 27pt = 36px in from the sheet, either side
    onLine(art(3).fromBottom, 36);
    onLine(art(4).fromBottom, 36);
    // bottom-right: the right is a recto's OUTSIDE edge (36px) and a verso's
    // binding (36pt = 48px, no bleed there)
    onLine(art(5).fromBottom, 36);
    expect(art(5).fromRight).toBeCloseTo(36, 0);
    onLine(art(6).fromBottom, 36);
    expect(art(6).fromRight).toBeCloseTo(48, 0);
    // .gp-flush: the paper's edge, both edges, both sides
    onLine(art(7).fromBottom, 0);
    onLine(art(8).fromBottom, 0);
    expect(art(8).fromRight).toBeCloseTo(0, 0);
    // an edge it does not name keeps the text block's edge: no left inset
    expect(art(3).x).toBeCloseTo((320 - 80) / 2 + 50, 0); // still centred across the recto's page box
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "the text never moves: the same paragraph sits in the same rect with no pin, a bottom pin and a bottom-right pin, recto and verso",
  async () => {
    const m = await measure(SOURCE);
    const text = (n: number) => m.pages[n - 1]!.text;
    // the author's content box, multi-line: recto L50, verso L30, both 320
    // wide, inside the root's own 10px 12px padding
    expect(text(1)).toMatchObject({ x: 62, y: 50, w: 296 });
    expect(text(2)).toMatchObject({ x: 42, y: 50, w: 296 });
    expect(text(1).h).toBeGreaterThan(40); // several lines, so a wider box would rewrap them
    for (const n of [3, 5, 7]) expect(text(n)).toEqual(text(1));
    for (const n of [4, 6, 8]) expect(text(n)).toEqual(text(2));

    // ...and exactly where the same book without any pin puts it, on the same pages
    const bare = await measure(UNPINNED);
    expect(bare.total).toBe(m.total);
    expect(m.total).toBe(8);
    expect(m.pages.map((p) => p.pageOf)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (const p of m.pages) expect(p.text).toEqual(bare.pages[p.page - 1]!.text);
  },
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "the strip's page area grows into the freed margins while the pin root's content box stays the author's",
  async () => {
    const m = await measure(SOURCE);
    const page = (n: number) => m.pages[n - 1]!;
    // no pin: the author's page box (500 - 40 - 40 tall; 400 - 50 - 30 wide)
    expect(page(1).strip).toEqual({ w: "320px", h: "420px" });
    // a bottom pin frees the bottom margin; a bottom-right one the right too
    expect(page(3).strip).toEqual({ w: "320px", h: "460px" });
    expect(page(5).strip).toEqual({ w: "350px", h: "460px" });
    // ...but every root's content box is the author's — the page box less the
    // root's own padding and the 1px cushion — on its own side's margins
    for (const n of [1, 3, 5, 7]) expect(page(n).content).toEqual({ x: 62, y: 50, w: 296, h: 399 });
    for (const n of [2, 4, 6, 8]) expect(page(n).content).toEqual({ x: 42, y: 50, w: 296, h: 399 });
  },
  RENDER_TEST_TIMEOUT_MS,
);
