import { afterAll, expect, test } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocumentProxy } from "unpdf";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { launchChromium } from "../shared/cdp.ts";
import { closeBrowser, getBrowser } from "../viewer/test-support/browser.ts";
import { serveDir } from "../viewer/test-support/serve-dir.ts";
import { bookHtml, card, ladder, list, para, table, words } from "../viewer/test-support/split-fixture.ts";
import { build } from "./build.ts";

/**
 * Cards marked `data-gp-split` are cut where the viewer measures a page break,
 * the print page replays the same cuts, and the PDF agrees with the preview:
 * same page count, every continuation on the page the preview put it on, every
 * word of every card printed once and in order.
 */
const TEST_TIMEOUT_MS = 180_000;
const HERE = path.dirname(new URL(import.meta.url).pathname);
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

const cards =
  card({ scope: "a", body: para("Intro1") + list("ol", 12) + table(8) }) +
  card({ scope: "a", body: para("Intro2") + ladder(8) + para("Close2") }) +
  card({ scope: "b", body: para("Intro3") + `<p>LONG ${words(14)} END</p>` + table(12) + list("ul", 6) });

async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const doc = await getDocumentProxy(bytes);
  const out: string[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const tc = await (await doc.getPage(p)).getTextContent();
    out.push(tc.items.map((i) => (i as { str: string }).str).join(" ").replace(/\s+/g, " ").trim());
  }
  return out;
}

testIf(
  "the printed split agrees with the preview and loses no word",
  async () => {
    const dir = await fsp.mkdtemp(path.join(HERE, ".build-split-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, bookHtml(cards), "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });

      // the one finding is the summary line: breaks by kind, pages before and after
      expect(result.diagnostics.map((d) => d.code)).toEqual(["engine.split.summary"]);
      expect(result.diagnostics[0]!.message).toMatch(/^split: \d+ break\(s\) .*\d+pp -> \d+pp/);
      const ids = Object.keys(result.pageMap).filter((k) => k.startsWith("gp-split-"));
      expect(ids.length).toBeGreaterThan(3);
      // the print put every continuation where the viewer predicted it
      for (const id of ids) expect(result.pageMap[id]).toBe(result.predicted!.pageMap[id]!);
      expect(result.pageCount).toBe(result.predicted!.pageCount);

      const pages = await pdfPages(result.bytes);
      const starts = pages.filter((t) => t.startsWith("CARD ▸")).length;
      expect(starts).toBe(ids.length);

      // every row and item exactly once, in order (the copied heads are not words of the card)
      const all = pages.join(" ");
      const marks = all.match(/\b(item\d+|row\d+|tier\d+)\b/g)!;
      const source = cards.replace(/<template.*?<\/template>/g, "").match(/\b(item\d+|row\d+|tier\d+)\b/g)!;
      expect(marks).toEqual(source);
      expect(all.match(/lorem ipsum/g)!.length).toBe(
        cards.replace(/<template.*?<\/template>/g, "").match(/lorem ipsum/g)!.length,
      );
      // the table and ladder heads repeat once per part that holds rows or tiers
      expect(all.match(/Roll Result/g)!.length).toBeGreaterThanOrEqual(2);

      // preview: the same document mounted in the viewer shows as many pages as the PDF has
      await fsp.writeFile(path.join(dir, "view.html"), bookHtml(cards, "", true), "utf8");
      await fsp.copyFile(await getAssetPath("engine/gutterpress-viewer.js"), path.join(dir, "gutterpress-viewer.js"));
      const { url, close } = await serveDir(dir, "view.html");
      try {
        const page = await (await getBrowser()).newPage();
        try {
          await page.setViewport({ width: 1280, height: 900 });
          await page.goto(url);
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const shown = await page.evaluate("window.Gutterpress.totalPages");
          expect(shown).toBe(result.pageCount);
        } finally {
          await page.close();
        }
      } finally {
        await close();
      }
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);

testIf(
  "a book without split cards builds exactly as before",
  async () => {
    const dir = await fsp.mkdtemp(path.join(HERE, ".build-split-"));
    const browser = await launchChromium();
    try {
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, bookHtml("<p>One card of text.</p>"), "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
      expect(result.predicted).toBeNull();
      expect(result.diagnostics).toEqual([]);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  TEST_TIMEOUT_MS,
);
