import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * A book whose page numbers must be measured (here a running head) is laid
 * out by the viewer first, so the first print can ship. The viewer also shows
 * the blank pages that pad the book to its print signature; the print gets
 * those later, in postprocess. The guess must compare like with like, or a
 * padded book always reprints: the whole book printed twice.
 */

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

testIf(
  "a book padded to its signature ships its first print",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-predicted-print-"));
    const browser = await launchChromium();
    try {
      const html = `<!doctype html><html data-gp-signature="4"><meta charset="utf-8"><style>
@page { size: 384px 480px; margin: 48px 24px; @top-center { content: string(chapter); font: 9px monospace; } }
h1 { string-set: chapter content(); break-before: page; font: 14px monospace; margin: 0; }
</style>
<h1>One</h1><p>First.</p><h1>Two</h1><p>Second.</p><h1>Three</h1><p>Third.</p></html>`;
      const file = path.join(dir, "book.html");
      await fsp.writeFile(file, html, "utf8");
      const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0, signature: 4 });

      expect(result.pageCount).toBe(4); // 3 pages + 1 to reach the signature
      expect(result.predicted).not.toBeNull();
      expect(result.passes).toBe(1);
      expect(result.prints).toBe(1);
    } finally {
      await browser.close();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  90_000,
);
