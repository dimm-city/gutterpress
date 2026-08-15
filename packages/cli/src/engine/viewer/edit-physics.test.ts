import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";

/**
 * Inline-editing physics gate (ADR 0010 Phase 1 GO/NO-GO spikes).
 *
 * The HTML-first editing model rests on three physical claims about the
 * native viewer, each measured here on a ~200-page single-strip synthetic
 * book (the WORST case for per-keystroke reflow — one default-page run, so
 * one multicol strip contains the whole book):
 *
 *  1. TYPING IS CHEAP. A text mutation inside a strip forces a multicol
 *     reflow of that strip; the median forced-reflow cost must stay well
 *     under a frame budget or per-keystroke editing is a NO-GO (fallback
 *     design: chapter-isolated edit strips).
 *  2. RELAYOUT IS CHEAP ENOUGH TO DEBOUNCE. `Gutterpress.refresh()` (full
 *     strip teardown + rebuild + decorate) runs on an idle debounce after
 *     edits; its cost bounds how quickly pagination re-settles.
 *  3. NODES AND CARETS SURVIVE RELAYOUT. `buildStrips()` MOVES content
 *     nodes, so text-node references captured before a refresh must remain
 *     connected and selectable afterwards — that is what makes caret
 *     capture/restore across relayout possible at all.
 *
 * Thresholds are deliberately generous tripwires, not perf targets — the
 * logged numbers are the real deliverable and are recorded in the plan/PR.
 */

const RENDER_TEST_TIMEOUT_MS = 120_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn(
    "[edit-physics.test] No Chromium resolved — skipping. Install Chrome/Chromium or set CHROMIUM_PATH."
  );
}

afterAll(async () => {
  await closeBrowser();
});

/** ~200 pages at 4×3in/0.4in margins: short paragraphs, annotated like real
 *  rendered blocks so the fixture resembles the editing surface. */
function syntheticBook(paragraphs: number): string {
  const lorem =
    "Gutter presses hum through the night shift, setting long galleys of " +
    "borrowed prose while the compositor argues with the clock about widows.";
  let body = "";
  for (let i = 0; i < paragraphs; i++) {
    body += `<p id="para-${i}" data-source-range="${i * 2}:${i * 2 + 1}" data-chapter-src="ch.md">§${i} ${lorem}</p>\n`;
  }
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>edit physics</title>
<style>
@page { size: 4in 3in; margin: 0.4in; }
body { font: 11pt/1.35 Georgia, serif; margin: 0; }
p { margin: 0 0 6pt; }
</style>
</head>
<body>
<main id="root">
${body}</main>
<script src="gutterpress-viewer.js"></script>
</body>
</html>`;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

testIf(
  "edit physics on a ~200pp single-strip book: typing reflow, relayout, node/caret survival",
  async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = await fsp.mkdtemp(path.join(here, ".edit-physics-"));
    try {
      await fsp.writeFile(path.join(dir, "book.html"), syntheticBook(600));
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js")
      );
      const { url: root, close } = await serveDir(dir, "book.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          const t0 = Date.now();
          await page.goto(`${root}book.html`, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");
          const mountMs = Date.now() - t0;

          const totalPages = await page.evaluate(
            () => (window as unknown as { Gutterpress: { totalPages: number } }).Gutterpress.totalPages
          );
          expect(totalPages).toBeGreaterThan(150); // the fixture is the size it claims

          // ── 2. relayout cost ─────────────────────────────────────────────
          const relayoutMs = await page.evaluate(() => {
            const gp = (window as unknown as { Gutterpress: { refresh(): void } }).Gutterpress;
            const times: number[] = [];
            for (let i = 0; i < 5; i++) {
              const a = performance.now();
              gp.refresh();
              times.push(performance.now() - a);
            }
            return times;
          });

          // ── 1. per-keystroke forced-reflow cost, mid-book ───────────────
          const editReflowMs = await page.evaluate(() => {
            const target = document.getElementById("para-300")!;
            const probe = document.getElementById("para-599")!;
            const textNode = target.firstChild as Text;
            const times: number[] = [];
            for (let i = 0; i < 30; i++) {
              const a = performance.now();
              textNode.insertData(4, "x");
              void probe.getBoundingClientRect().top; // force full strip reflow
              times.push(performance.now() - a);
            }
            return times;
          });

          // ── typing through the real input path on a contenteditable strip ─
          const typing = await page.evaluate(() => {
            for (const strip of document.querySelectorAll<HTMLElement>(".gp-strip")) {
              strip.contentEditable = "true";
              strip.spellcheck = false;
            }
            const target = document.getElementById("para-300")!;
            target.scrollIntoView({ block: "center" });
            const sel = getSelection()!;
            const r = document.createRange();
            r.setStart(target.firstChild!, 6);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            (target.closest(".gp-strip") as HTMLElement).focus();
            return {
              editable: (target.closest("[contenteditable=true]") != null),
              focused: document.activeElement?.classList.contains("gp-strip") ?? false,
            };
          });
          expect(typing.editable).toBe(true);

          const frames: number[] = await (async () => {
            await page.evaluate(() => {
              const w = window as unknown as { __frames: number[]; __stop: boolean };
              w.__frames = [];
              w.__stop = false;
              let last = performance.now();
              const tick = () => {
                const now = performance.now();
                w.__frames.push(now - last);
                last = now;
                if (!w.__stop) requestAnimationFrame(tick);
              };
              requestAnimationFrame(tick);
            });
            await page.keyboard.type("The quick brown fox jumps over the lazy dog.", { delay: 0 });
            return page.evaluate(() => {
              const w = window as unknown as { __frames: number[]; __stop: boolean };
              w.__stop = true;
              return w.__frames.slice(1); // discard the settle-in frame
            });
          })();

          const typed = await page.evaluate(
            () => document.getElementById("para-300")!.textContent!.includes("quick brown fox")
          );
          expect(typed).toBe(true);

          // ── 3. node identity + caret restore across relayout ────────────
          const survival = await page.evaluate(() => {
            const gp = (window as unknown as { Gutterpress: { refresh(): void; totalPages: number } })
              .Gutterpress;
            const target = document.getElementById("para-300")!;
            const textNode = target.firstChild as Text;
            const marker = "SURVIVAL-MARKER";
            textNode.insertData(0, marker);

            gp.refresh();

            const sameNode = textNode.isConnected && textNode.data.startsWith(marker);
            let selectable = false;
            let selectionReadsBack = false;
            if (sameNode) {
              const sel = getSelection()!;
              sel.removeAllRanges();
              const r = document.createRange();
              r.setStart(textNode, 0);
              r.setEnd(textNode, marker.length);
              sel.addRange(r);
              selectable = sel.rangeCount === 1;
              selectionReadsBack = sel.toString() === marker;
            }
            return { sameNode, selectable, selectionReadsBack, pagesAfter: gp.totalPages };
          });

          const medEdit = median(editReflowMs);
          const medRelayout = median(relayoutMs);
          const p95Frame = [...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)] ?? 0;

          // eslint-disable-next-line no-console
          console.log(
            `[edit-physics] ${totalPages}pp single strip — mount ${mountMs}ms; ` +
              `relayout median ${medRelayout.toFixed(1)}ms (${relayoutMs.map((t) => t.toFixed(0)).join("/")}); ` +
              `edit+forced-reflow median ${medEdit.toFixed(2)}ms; ` +
              `typing p95 frame ${p95Frame.toFixed(1)}ms over ${frames.length} frames`
          );

          expect(survival.sameNode).toBe(true);
          expect(survival.selectable).toBe(true);
          expect(survival.selectionReadsBack).toBe(true);

          // GO/NO-GO tripwires (generous): typing must fit a couple of frame
          // budgets even on this worst-case fixture; relayout must be
          // debounce-friendly.
          expect(medEdit).toBeLessThan(100);
          expect(medRelayout).toBeLessThan(3000);
        } finally {
          await page.close();
        }
      } finally {
        await close();
      }
    } finally {
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  RENDER_TEST_TIMEOUT_MS
);
