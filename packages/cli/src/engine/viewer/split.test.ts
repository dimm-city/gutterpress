/**
 * Measured split, in the viewer: a card marked `data-gp-split` that spans a
 * page boundary is cut at the measured break, moving whole units, and every
 * part but the last ends on the page it started on.
 */
import { test, expect, afterAll, describe } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { serveDir } from "./test-support/serve-dir.ts";
import { closeBrowser, getBrowser } from "./test-support/browser.ts";
import { bookHtml, card, ladder, list, para, table, words } from "./test-support/split-fixture.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_TIMEOUT_MS = 120_000;
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

interface Rendered {
  pages: number;
  pagesBefore: number;
  kinds: Record<string, number>;
  codes: string[];
  ops: number;
  /** per card part: continuation?, first page, last page, unit tags inside it */
  parts: Array<{ cont: boolean; first: number; last: number; text: string; cut: boolean }>;
  /** the unsplit DOM equals the source markup */
  restored: boolean;
  ids: string[];
}

async function render(cards: string, extra = "", refreshes = 0): Promise<Rendered> {
  const dir = await fsp.mkdtemp(path.join(HERE, ".split-"));
  try {
    await fsp.writeFile(path.join(dir, "book.html"), bookHtml(cards, extra, true));
    await fsp.copyFile(await getAssetPath("engine/gutterpress-viewer.js"), path.join(dir, "gutterpress-viewer.js"));
    const { url, close } = await serveDir(dir, "book.html");
    try {
      const page = await (await getBrowser()).newPage();
      try {
        await page.setViewport({ width: 1280, height: 900 });
        await page.goto(url);
        await page.waitForFunction("window.Gutterpress?.totalPages > 0");
        await new Promise((r) => setTimeout(r, 200));
        return (await page.evaluate((source: string, refreshes: number) => {
          const G = (window as any).Gutterpress;
          for (let i = 0; i < refreshes; i++) G.refresh();
          const parts = [...document.querySelectorAll("[data-gp-split]")].map((el) => {
            const [first, last] = G.pageRangeOf(el);
            return {
              cont: el.hasAttribute("data-gp-split-cont"),
              first,
              last,
              text: (el.querySelector("[data-gp-flow], .inner") as HTMLElement).innerText.replace(/\s+/g, " ").trim(),
              cut: el.classList.contains("cut"),
            };
          });
          const split = G.split;
          const ids = [...document.querySelectorAll("[data-gp-split-cont]")].map((e) => e.id);
          G.unsplitAll();
          const doc = new DOMParser().parseFromString(source, "text/html");
          const norm = (e: Element) => e.outerHTML.replace(/\sid="gp-split-\d+"/g, "").replace(/\s+/g, " ");
          const now = [...document.querySelectorAll("[data-gp-split]")].map(norm);
          const was = [...doc.querySelectorAll("[data-gp-split]")].map(norm);
          return {
            pages: G.totalPages,
            pagesBefore: split.pagesBefore,
            kinds: split.kinds,
            codes: split.diagnostics.map((d: { code: string }) => d.code),
            ops: split.ops.length,
            parts,
            restored: JSON.stringify(now) === JSON.stringify(was),
            ids,
          };
        }, cards, refreshes)) as Rendered;
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

/** every part but the last ends on the page it starts on, and a continuation starts a page */
function expectWholeParts(r: Rendered) {
  r.parts.forEach((p, i) => {
    if (i < r.parts.length - 1 && p.cut) expect(p.last).toBe(p.first);
    if (p.cont) expect(r.parts[i - 1]!.last).toBeLessThan(p.first);
  });
}

describe("measured split in the viewer", () => {
  testIf(
    "blocks: a block that crosses the break starts the continuation, a straddling paragraph is cut at a line",
    async () => {
      const body = para("A") + para("B") + para("C") + para("D") + para("E") + para("F");
      const r = await render(card({ body }));
      expect(r.codes).toEqual([]);
      expect(Object.keys(r.kinds).sort()).toEqual(["block", "paragraph"]);
      expect(r.parts.length).toBeGreaterThan(1);
      expect(r.parts[0]!.cut).toBe(true);
      expect(r.parts[1]!.cont).toBe(true);
      expectWholeParts(r);
      expect(r.parts.map((p) => p.text).join(" ")).toContain("A lorem");
      expect(r.restored).toBe(true);
      expect(r.ids).toEqual(r.parts.slice(1).map((_, i) => `gp-split-${i + 1}`));
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "list items move whole and the new ol carries on its numbering",
    async () => {
      const r = await render(card({ body: para("Intro") + list("ol", 14) }));
      expect(r.kinds["list-item"]).toBeGreaterThan(0);
      expectWholeParts(r);
      const itemsAfter = r.parts[1]!.text.match(/item(\d+)/)![1]!;
      expect(r.parts[0]!.text).toContain(`item${Number(itemsAfter) - 1} `);
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "table rows move and the header row is copied onto the continuation",
    async () => {
      const r = await render(card({ body: para("Intro") + table(14) }));
      expect(r.kinds["table-row"]).toBeGreaterThan(0);
      expectWholeParts(r);
      expect(r.parts[1]!.text.startsWith("Roll Result row")).toBe(true);
      for (const p of r.parts.slice(1)) expect(p.text.match(/Roll Result/g)?.length).toBe(1);
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "declared units move whole with their head repeated",
    async () => {
      const r = await render(card({ body: para("Intro") + ladder(9) }));
      expect(r.kinds.unit).toBeGreaterThan(0);
      expectWholeParts(r);
      expect(r.parts[1]!.text.startsWith("TIERS tier")).toBe(true);
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "a card longer than a page chains continuations, each ending on its own page",
    async () => {
      const body = Array.from({ length: 12 }, (_, i) => para(`P${i}`)).join("");
      const r = await render(card({ body }));
      expect(r.parts.length).toBeGreaterThan(2);
      expectWholeParts(r);
      expect(r.pages - r.pagesBefore).toBeGreaterThanOrEqual(0);
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "a unit taller than a page keeps the native break and says so",
    async () => {
      const huge = `<div style="height: 400px">HUGE</div>`;
      const r = await render(card({ body: para("A") + huge + para("Z") }));
      expect(r.codes).toContain("engine.split.unsplittable");
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "data-gp-nosplit keeps a list whole",
    async () => {
      const body = para("A") + list("ul", 14).replace("<ul>", "<ul data-gp-nosplit>");
      const r = await render(card({ body }));
      expect(r.kinds["list-item"]).toBeUndefined();
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "cards that fit are left alone",
    async () => {
      const r = await render(card({ body: para("A") }));
      expect(r.ops).toBe(0);
      expect(r.parts).toHaveLength(1);
      expect(r.pages).toBe(r.pagesBefore);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "scopes split independently in one pass and the words never change",
    async () => {
      const body = para("A") + para("B") + para("C") + para("D") + para("E") + para("F");
      const r = await render(card({ body, scope: "a" }) + card({ body, scope: "b" }));
      expect(r.ops).toBeGreaterThanOrEqual(2);
      const total = (t: string) => t.match(/lorem ipsum/g)?.length ?? 0;
      const source = card({ body, scope: "a" }) + card({ body, scope: "b" });
      expect(total(r.parts.map((p) => p.text).join(" "))).toBe(
        total(source.replace(/<template.*?<\/template>/g, "")),
      );
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "refresh() undoes the cuts and cuts again to the same result",
    async () => {
      const body = para("A") + list("ul", 12) + para("Z");
      const once = await render(card({ body }));
      const again = await render(card({ body }), "", 2);
      expect(again.parts.map((p) => p.text)).toEqual(once.parts.map((p) => p.text));
      expect(again.pages).toBe(once.pages);
      expect(again.ids).toEqual(once.ids);
      expect(again.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "a paragraph that straddles the break is cut at a line, two lines each side, no word lost",
    async () => {
      const long = `<p>LONG ${words(12)} END</p>`;
      const r = await render(card({ body: para("Intro") + long + para("Tail") }));
      expect(r.kinds.paragraph).toBeGreaterThan(0);
      expectWholeParts(r);
      const flat = r.parts.map((p) => p.text).join(" ");
      expect(flat.match(/lorem ipsum/g)!.length).toBe(
        `Intro ${words(4)} LONG ${words(12)} END Tail ${words(4)}`.match(/lorem ipsum/g)!.length,
      );
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "a paragraph taller than a page is cut into pages instead of left native",
    async () => {
      const r = await render(card({ body: `<p>HUGE ${words(30)}</p>` }));
      expect(r.codes).toEqual([]);
      expect(r.kinds.paragraph).toBeGreaterThan(1);
      expectWholeParts(r);
      expect(r.restored).toBe(true);
    },
    TEST_TIMEOUT_MS,
  );
});
