import { expect, test } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { getDocumentProxy } from "unpdf";

import { MARKER_CSS } from "../../lib/markdown/markers.js";
import { GUTTERPRESS_CSS } from "../../lib/markdown/gutterpress-css.ts";
import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { launchChromium } from "../shared/cdp.ts";
import { build } from "./build.ts";

/**
 * #519: a `.gp-bottom` pin in a page root that runs across N sheets sits at
 * the foot of the LAST sheet (the root gets N sheets of min-height, less the
 * core cushion), and the page count does not grow. `engine.pin.page-span`
 * warns only when the pin is not the last thing in the root, because then it
 * no longer sits where it was written.
 */

const lines = (n: number) =>
  Array.from({ length: n }, (_, i) => `<p>Line ${i}.</p>`).join("");
const PIN = `<p class="gp-pin gp-bottom">FOOTPIN</p>`;
const head = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
${GUTTERPRESS_CSS}
@page { size: 384px 240px; margin: 24px; }
body { margin: 0; }
p { margin: 0; font: 12px/1 monospace; }
</style>`;
// content box is 192px = 16 lines; 22 lines run onto a second sheet
const doc = (body: string) => `${head}${body}`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

async function run(html: string) {
  const dir = await fsp.mkdtemp(path.join(process.env.GP_FIXTURE_DIR ?? os.tmpdir(), "gp-pin-span-"));
  const browser = await launchChromium();
  try {
    const file = path.join(dir, "book.html");
    await fsp.writeFile(file, html, "utf8");
    const result = await build({ input: pathToFileURL(file).href, browser, dpiFloor: 0 });
    const pdf = await getDocumentProxy(result.bytes);
    const pin: Array<{ page: number; y: number }> = [];
    for (let n = 1; n <= pdf.numPages; n++) {
      const tc = await (await pdf.getPage(n)).getTextContent();
      for (const i of tc.items as Array<{ str: string; transform: number[] }>)
        if (i.str.includes("FOOTPIN")) pin.push({ page: n, y: i.transform[5]! });
    }
    return {
      pages: result.pageCount,
      pin,
      findings: result.diagnostics.filter((d) => d.code === "engine.pin.page-span"),
    };
  } finally {
    await browser.close();
    await fsp.rm(dir, { recursive: true, force: true });
  }
}

testIf(
  "a bottom pin at the end of a two-sheet root sits at the foot of sheet 2, with no extra sheet",
  async () => {
    const without = await run(doc(`<div class="page">${lines(22)}</div>`));
    const withPin = await run(doc(`<div class="page">${lines(22)}${PIN}</div>`));
    expect(without.pages).toBe(2);
    expect(withPin.pages).toBe(without.pages);
    expect(withPin.pin).toHaveLength(1);
    expect(withPin.pin[0]!.page).toBe(2);
    // the foot: within a line of the 18pt bottom margin (the text ends ~6 lines up)
    expect(withPin.pin[0]!.y).toBeLessThan(18 + 12);
    expect(withPin.findings).toHaveLength(0);
  },
  120_000,
);

testIf(
  "a root whose text nearly fills its last sheet does not gain a sheet from the stretch",
  async () => {
    // 31 lines: the text ends one line short of the sheet edge, where a
    // min-height without the 1px cushion would land exactly on it
    for (const n of [30, 31]) {
      const without = await run(doc(`<div class="page">${lines(n)}</div>`));
      const withPin = await run(doc(`<div class="page">${lines(n)}${PIN}</div>`));
      expect(withPin.pages).toBe(without.pages);
      expect(withPin.pin[0]!.page).toBe(without.pages);
    }
  },
  120_000,
);

testIf(
  "a pin at the end of a long root does not warn when the engine appends its furniture layer after it",
  async () => {
    // a footer margin box on the freed bottom edge is re-homed into the pin
    // root as a `.gp-pin-furniture` layer, which follows the pin in the DOM
    const r = await run(
      doc(`<div class="page">${lines(22)}<p class="gp-pin gp-bottom gp-flush">FOOTPIN</p></div>`).replace(
        "</style>",
        `@page { @bottom-center { content: "FOLIO"; font: 9px monospace; } }</style>`,
      ),
    );
    expect(r.pages).toBe(2);
    expect(r.findings).toHaveLength(0);
  },
  120_000,
);

testIf(
  "a one-sheet root is unchanged, and a mid-root bottom pin in a long root warns",
  async () => {
    const one = await run(doc(`<div class="page">${lines(3)}${PIN}</div>`));
    expect(one.pages).toBe(1);
    expect(one.pin[0]!.y).toBeLessThan(18 + 12);
    expect(one.findings).toHaveLength(0);

    const mid = await run(
      doc(`<div class="page">${lines(3)}<img class="gp-pin gp-bottom" alt="" src="pin.svg?mid">${lines(19)}</div>`),
    );
    expect(mid.pages).toBe(2);
    expect(mid.findings).toHaveLength(1);
    expect(mid.findings[0]!.message).toContain("?mid");
    expect(mid.findings[0]!.message).toMatch(/runs across 2 pages/);
    expect(mid.findings[0]!.message).toContain("foot of the last page");
  },
  120_000,
);
