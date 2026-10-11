import { test, expect, afterAll, describe } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { MARKER_CSS } from "./markers.js";
import { resolveChromiumExecutable } from "../chromium.ts";
import { launchChromium, type Browser } from "../../engine/shared/cdp.ts";

/**
 * #370: a plain lead-in paragraph ("**ROLL A DIE!**" above a roll table,
 * "You will need:" above a list) stays with the table or list it introduces,
 * the way a heading stays with what follows it. One standard `break-after`
 * rule next to the heading rule in MARKER_CSS, zero specificity, deliberately
 * limited to table / ul / ol.
 */

describe("MARKER_CSS — #370 lead-in paragraph keeps with its table or list", () => {
  test("one zero-specificity break-after rule, table/ul/ol only", () => {
    expect(MARKER_CSS).toContain(
      ":where(p):has(+ :where(table, ul, ol)) { break-after: avoid; }"
    );
  });
});

const RENDER_TEST_TIMEOUT_MS = 60_000;

const fixture = `<!doctype html><meta charset="utf-8"><style>
${MARKER_CSS}
</style>
<p id="lead-table">Roll a die!</p>
<table><tr><td>1</td><td>one</td></tr></table>
<p id="lead-ul">You will need:</p>
<ul><li>a pencil</li></ul>
<p id="lead-ol">Steps:</p>
<ol><li>begin</li></ol>
<p id="plain">Plain paragraph.</p>
<p id="before-pre">Code follows.</p>
<pre>x</pre>
<div class="author"><p id="overridden">Author opts out.</p><table><tr><td>2</td></tr></table></div>
<style>.author p { break-after: auto; }</style>`;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[marker-css-lead-in.test] No Chromium resolved via resolveChromiumExecutable() — skipping. Install Chrome/Chromium or set CHROMIUM_PATH to run it."
  );
}

let browser: Browser | undefined;
afterAll(async () => {
  await browser?.close();
});

testIf(
  "a paragraph directly before a table/ul/ol avoids a break after; other paragraphs and author rules are untouched",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gp-leadin-"));
    try {
      const file = path.join(dir, "fixture.html");
      await fsp.writeFile(file, fixture, "utf8");
      browser ??= await launchChromium();
      const page = await browser.newPage();
      try {
        await page.navigate(`file://${file}`);
        const ids = ["lead-table", "lead-ul", "lead-ol", "plain", "before-pre", "overridden"];
        // Source string, not a closure: this package's tsconfig is DOM-free.
        const measured = (await page.evaluate(
          `(() => Object.fromEntries(${JSON.stringify(ids)}.map((id) =>
            [id, getComputedStyle(document.getElementById(id)).breakAfter])))()`
        )) as Record<string, string>;

        expect(measured["lead-table"]).toBe("avoid");
        expect(measured["lead-ul"]).toBe("avoid");
        expect(measured["lead-ol"]).toBe("avoid");
        expect(measured["plain"]).toBe("auto");
        expect(measured["before-pre"]).toBe("auto");
        // :where() = zero specificity, so an author rule wins.
        expect(measured["overridden"]).toBe("auto");
      } finally {
        await page.close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
