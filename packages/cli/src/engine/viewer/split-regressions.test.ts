/**
 * Measured split: the cases a review of the first version found. Each runs the
 * viewer (which decides the cuts) and, where it matters, the compiler agent on a
 * second page (which replays them for print), the way the build does.
 */
import { test, expect, afterAll, describe } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { serveDir } from "./test-support/serve-dir.ts";
import { closeBrowser, getBrowser, type TestPage } from "./test-support/browser.ts";
import { bookHtml } from "./test-support/split-fixture.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEST_TIMEOUT_MS = 120_000;
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

const mk = (name: string, scope: string, cut: string, body: string, attrs = "") =>
  `<div class="card" data-name="${name}" data-gp-split=".inner" data-gp-split-scope="${scope}" ` +
  `data-gp-split-cut="${cut}"${attrs}>` +
  `<template data-gp-split-head><div class="card contd"><div class="tab">CARD</div>` +
  `<div class="inner" data-gp-flow></div></div></template>` +
  `<div class="tab">CARD ${name}</div><div class="inner">${body}</div></div>`;
const div = (h: number, t: string, style = "") => `<div style="height:${h}px;${style}">${t}</div>`;
const blocks = (n: number, tag: string) => Array.from({ length: n }, (_, i) => div(40, `${tag}${i}`)).join("");

interface Pages {
  viewer: TestPage;
  print: TestPage;
}

/** the book in a viewer page and in a page with only the compiler agent, as the build has them */
async function withPages<T>(cards: string, extra: string, fn: (p: Pages) => Promise<T>): Promise<T> {
  const dir = await fsp.mkdtemp(path.join(HERE, ".split-reg-"));
  try {
    const html = bookHtml(cards, extra, false);
    await fsp.writeFile(path.join(dir, "view.html"), html.replace("</body>", `<script src="v.js"></script></body>`));
    await fsp.writeFile(path.join(dir, "print.html"), html.replace("</body>", `<script src="a.js"></script></body>`));
    await fsp.copyFile(await getAssetPath("engine/gutterpress-viewer.js"), path.join(dir, "v.js"));
    await fsp.copyFile(await getAssetPath("engine/gutterpress-agent.js"), path.join(dir, "a.js"));
    const { url, close } = await serveDir(dir, "view.html");
    try {
      const browser = await getBrowser();
      const viewer = await browser.newPage();
      const print = await browser.newPage();
      try {
        await viewer.setViewport({ width: 1280, height: 900 });
        await viewer.goto(`${url}view.html`);
        await viewer.waitForFunction("window.Gutterpress?.split !== undefined");
        await print.setViewport({ width: 1280, height: 900 });
        await print.goto(`${url}print.html`);
        await print.waitForFunction("!!window.__gp");
        return await fn({ viewer, print });
      } finally {
        await viewer.close();
        await print.close();
      }
    } finally {
      await close();
    }
  } finally {
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

interface Replay {
  continuations: string[];
  heads: string[];
  failed: number;
}

async function viewerOps(v: TestPage) {
  return (await v.evaluate(() => {
    const s = (window as any).Gutterpress.split;
    return { ops: s.ops, conts: s.continuations.length, codes: s.diagnostics.map((d: { code: string }) => d.code) };
  })) as { ops: unknown[]; conts: number; codes: string[] };
}

async function replay(p: TestPage, ops: unknown[]): Promise<Replay> {
  return (await p.evaluate(`window.__gp.applySplitOps(${JSON.stringify(ops)})`)) as Replay;
}

describe("print cuts the same cards as the viewer", () => {
  testIf(
    "when a pull-back fails and an op is dropped, later cards in other scopes still line up",
    async () => {
      // A's head still spans a page after its cut and cannot give up a unit: the op is dropped
      const cards =
        mk("A", "a", "cutA", div(150, "A0") + div(100, "A1")) +
        `</section><section>` + mk("B", "b", "cut", blocks(10, "B")) +
        `</section><section>` + mk("C", "c", "cut", blocks(10, "C"));
      await withPages(cards, `.cutA { padding-bottom: 90px; }`, async ({ viewer, print }) => {
        const v = await viewerOps(viewer);
        expect(v.codes).toContain("engine.split.unsplittable");
        expect(v.conts).toBeGreaterThan(2);
        const r = await replay(print, v.ops);
        expect(r.failed).toBe(0);
        expect(r.continuations).toHaveLength(v.conts);
      });
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "every card of a scope is cut in turn, however the passes interleave scopes",
    async () => {
      const cards =
        mk("A", "a", "cutA", div(150, "A0") + div(100, "A1")) +
        `</section><section>` + mk("B", "b", "cut", blocks(10, "B")) +
        `</section><section>` + mk("C", "c", "cut", blocks(3, "C")) +
        `</section><section>` + mk("D", "d", "cut", blocks(10, "D"));
      await withPages(cards, `.cutA { padding-bottom: 90px; }`, async ({ viewer, print }) => {
        const spanning = (await viewer.evaluate(() => {
          const G = (window as any).Gutterpress;
          return [...document.querySelectorAll("[data-gp-split]")]
            .filter((c) => (c as HTMLElement).dataset.name !== "A")
            .filter((c) => G.pageRangeOf(c)[1] > G.pageRangeOf(c)[0]).length;
        })) as number;
        // B and D each spanned two pages and were once left alone, their k read after A's cut moved them
        expect(spanning).toBe(0);
        const v = await viewerOps(viewer);
        expect((await replay(print, v.ops)).continuations).toHaveLength(v.conts);
      });
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "scopes that share a page are cut one pass apart, each against the layout the one before left",
    async () => {
      // no forced break between B and D: a cut in B moves D
      const cards = mk("B", "b", "cut", blocks(5, "B")) + mk("D", "d", "cut", blocks(6, "D"));
      await withPages(cards, "", async ({ viewer, print }) => {
        const v = await viewerOps(viewer);
        const heads = (await viewer.evaluate(() => {
          const G = (window as any).Gutterpress;
          return [...document.querySelectorAll("[data-gp-split]")].map((c) => {
            const [s, e] = G.pageRangeOf(c);
            return { cont: c.hasAttribute("data-gp-split-cont"), pages: e - s };
          });
        })) as Array<{ cont: boolean; pages: number }>;
        expect(heads.every((h) => h.pages === 0)).toBe(true);
        expect((await replay(print, v.ops)).continuations).toHaveLength(v.conts);
      });
    },
    TEST_TIMEOUT_MS,
  );
});

describe("a cut leaves no copy of what was one thing", () => {
  const cards =
    mk("P", "p", "cut", `<p id="p1" data-source-range="1:1-2:1">one two <a id="L" href="#x" aria-describedby="p1">three four five</a> six seven</p>`) +
    mk("T", "t", "cut",
      `<table data-source-range="3:1-9:1"><thead><tr><th>h1</th><th>h2</th></tr></thead><tbody>` +
      `<tr><td rowspan="2">R1a</td><td>R1b</td></tr><tr><td>R2b</td></tr><tr><td>R3a</td><td>R3b</td></tr></tbody></table>`) +
    mk("O", "o", "cut", `<ol start="3"><li>x1</li><li value="10">x2</li><li>x3</li></ol>`);
  const ops = [
    { n: 0, unit: 0, kind: "paragraph", word: 3 },
    { n: 2, unit: 1, kind: "table-row" },
    { n: 4, unit: 1, kind: "list-item" },
  ];

  testIf(
    "ids and source ranges stay with the part they were written on; no inline clone is left empty",
    async () => {
      await withPages(cards, "", async ({ print }) => {
        expect((await replay(print, ops)).failed).toBe(0);
        const r = (await print.evaluate(() => {
          const ids: Record<string, number> = {};
          for (const e of document.querySelectorAll("[id]")) ids[e.id] = (ids[e.id] || 0) + 1;
          const copies = [...document.querySelectorAll("[data-gp-split-join], [data-gp-split-copy]")];
          return {
            dup: Object.entries(ids).filter(([, n]) => n > 1),
            copiesWithMarks: copies.filter((e) => e.hasAttribute("id") && !/^gp-split/.test(e.id)).length,
            ranges: [...document.querySelectorAll("[data-source-range]")].length,
            para: [...document.querySelectorAll(".inner p, [data-gp-flow] p")].map((p) => p.outerHTML),
          };
        })) as { dup: unknown[]; copiesWithMarks: number; ranges: number; para: string[] };
        expect(r.dup).toEqual([]);
        expect(r.copiesWithMarks).toBe(0);
        expect(r.ranges).toBe(2); // the paragraph and the table, each once
        // the link is cut between "three" and "four": no empty <a> stays behind
        expect(r.para[0]).toContain(`<a id="L" href="#x" aria-describedby="p1">three </a>`);
        expect(r.para[1]).toMatch(/^<p [^>]*class="gp-split-cont"><a href="#x" aria-describedby="p1">four five<\/a> six seven<\/p>$/);
      });
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "a word that opens an inline element takes the element along instead of leaving an empty clone",
    async () => {
      const c = mk("F", "f", "cut", `<p>one two three<sup><a id="fnref1" href="#fn1">4</a></sup> five six</p>`);
      await withPages(c, "", async ({ print }) => {
        // the word "4" starts the sup and the link
        await replay(print, [{ n: 0, unit: 0, kind: "paragraph", word: 3 }]);
        const html = (await print.evaluate(() => [...document.querySelectorAll(".inner p, [data-gp-flow] p")].map((p) => p.outerHTML))) as string[];
        expect(html.join("")).not.toContain("<sup></sup>");
        expect(html.join("").match(/id="fnref1"/g)).toHaveLength(1);
      });
    },
    TEST_TIMEOUT_MS,
  );

  testIf(
    "a cut between rows tied by a rowspan is not offered: the group moves whole",
    async () => {
      await withPages(cards, "", async ({ print }) => {
        await replay(print, ops);
        const tables = (await print.evaluate(() =>
          [...document.querySelectorAll("table")].map((t) => [...t.querySelectorAll("tr")].map((r) => r.children.length + ":" + (r as HTMLElement).innerText.replace(/\s+/g, " "))),
        )) as string[][];
        // R1a spans R1 and R2: both stay in the first table, so no row loses its cell
        expect(tables[0]).toEqual(["2:h1 h2", "2:R1a R1b", "1:R2b"]);
        expect(tables[1]).toEqual(["2:h1 h2", "2:R3a R3b"]);
      });
    },
    TEST_TIMEOUT_MS,
  );
});

describe("paragraph lines", () => {
  testIf(
    "a raised or smaller inline does not count as a line: two lines stay on each side",
    async () => {
      const lines = Array.from({ length: 12 }, (_, i) => `word${i}<sup>[${i}]</sup> <code style="font-size:70%">c${i}</code> text text text text text text text text`).join(" ");
      const cards = mk("S", "s", "cut", `<p style="margin:0">${lines}</p>`);
      await withPages(cards, `.card p { line-height: 16px } sup { line-height: 0 }`, async ({ viewer }) => {
        const heights = (await viewer.evaluate(() =>
          [...document.querySelectorAll(".inner p, [data-gp-flow] p")].map((p) => Math.round(p.getBoundingClientRect().height)),
        )) as number[];
        expect(heights.length).toBeGreaterThan(1);
        for (const h of heights) expect(h).toBeGreaterThanOrEqual(32);
      });
    },
    TEST_TIMEOUT_MS,
  );
});

describe("break-after: avoid", () => {
  testIf(
    "a head never ends on a sub-heading that must stay with the next block",
    async () => {
      for (const at of [3, 4, 5, 6]) {
        const body = Array.from({ length: 10 }, (_, i) => div(40, `U${i}`, i === at ? "break-after: avoid" : "")).join("");
        await withPages(mk("V", "v", "cut", body), "", async ({ viewer }) => {
          const last = (await viewer.evaluate(() =>
            [...document.querySelectorAll("[data-gp-split]:not([data-gp-split-cont])")].map((c) => {
              const kids = [...c.querySelector(".inner")!.children];
              return kids[kids.length - 1]!.textContent;
            }),
          )) as string[];
          expect(last).not.toContain(`U${at}`);
        });
      }
    },
    TEST_TIMEOUT_MS,
  );
});

describe("preview refresh", () => {
  testIf(
    "refresh() cuts again when a part grew past its page, and keeps the cuts when nothing did",
    async () => {
      const cards = mk("G", "g", "cut", blocks(10, "G"));
      await withPages(cards, "", async ({ viewer }) => {
        const r = (await viewer.evaluate(() => {
          const G = (window as any).Gutterpress;
          const parts = () => [...document.querySelectorAll("[data-gp-split]")].map((c) => G.pageRangeOf(c) as number[]).filter(([s, e]) => e! > s!).length;
          const sig = () => document.querySelectorAll("[data-gp-split-cont]").length;
          const before = sig();
          G.refresh();
          const kept = sig() === before && G.split.ops.length === before;
          // the head grows by half a page
          const flow = document.querySelector("[data-gp-split]:not([data-gp-split-cont]) .inner")!;
          const extra = document.createElement("div");
          extra.style.height = "120px";
          extra.textContent = "GROWN";
          flow.insertBefore(extra, flow.children[2]!);
          G.refresh();
          return { kept, spanningAfterGrowth: parts(), conts: sig(), before };
        })) as { kept: boolean; spanningAfterGrowth: number; conts: number; before: number };
        expect(r.kept).toBe(true);
        expect(r.spanningAfterGrowth).toBe(0);
        expect(r.conts).toBeGreaterThanOrEqual(r.before);
      });
    },
    TEST_TIMEOUT_MS,
  );
});
