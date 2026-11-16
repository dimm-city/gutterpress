import { expect, test } from "bun:test";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * A recto/verso break makes the engine print the whole book to read page
 * numbers before the print it ships. Chromium re-encodes every image in every
 * print (seconds per large picture), so a print that is only read for page
 * numbers must not paint the book's pictures: only the shipped print has them.
 */

const plate = fs.readFileSync(path.join(import.meta.dir, "../../../../../docs/fixtures/exact-fit-image/book/plate.png"));
const src = `data:image/png;base64,${plate.toString("base64")}`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

testIf(
  "prints read only for page numbers leave the pictures out; the shipped print keeps them",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-measure-prints-"));
    const browser = await launchChromium();
    const prints: Uint8Array[] = [];
    const newPage = browser.newPage.bind(browser);
    browser.newPage = async () => {
      const page = await newPage();
      const printToPDF = page.printToPDF.bind(page);
      page.printToPDF = async (opts) => {
        const bytes = await printToPDF(opts);
        prints.push(bytes);
        return bytes;
      };
      return page;
    };
    try {
      const html = `<!doctype html><meta charset="utf-8"><style>
@page { size: 384px 480px; margin: 24px; }
h2 { break-before: right; }
.bg { width: 100px; height: 100px; background: url("${src}"); }
</style>
<p>Page one.</p><img src="${src}" width="100" height="100">
<h2>Chapter</h2><div class="bg"></div>`;
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, html, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });

      const images = (bytes: Uint8Array) => (Buffer.from(bytes).toString("latin1").match(/\/Subtype\s*\/Image/g) ?? []).length;
      expect(result.pageCount).toBe(3); // the chapter moved to page 3 by a blank page
      expect(prints.length).toBeGreaterThan(1);
      const shipped = prints.at(-1)!;
      expect(images(shipped)).toBeGreaterThan(0);
      expect(images(result.bytes)).toBeGreaterThan(0);
      expect(prints.slice(0, -1).map(images)).toEqual(prints.slice(0, -1).map(() => 0));
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  90_000,
);
