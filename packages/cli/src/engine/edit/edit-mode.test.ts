import { serveDir } from "../viewer/test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";
import { createMarkdownRenderer } from "../../lib/markdown/renderer.ts";

/**
 * End-to-end tests for the in-frame inline-edit module (ADR 0010 Phase 2):
 * real Chromium, real contenteditable input, the real serializer.
 *
 *  1. Typing into a paragraph proposes a correct `{chapter, range, expected,
 *     replacement}` patch; acking it updates the source mirror and shifts
 *     every following block's `data-source-range` by the line delta.
 *  2. Enter mid-paragraph splits into two <p>; the proposal replaces the
 *     original range with both paragraphs joined by a blank line.
 *  3. The input policy refuses edits outside annotated content blocks
 *     (the injected `.chapter-opener`) — fail safe, never a guessed edit.
 *  4. A block containing raw inline HTML serializes as a refusal, not a
 *     patch.
 *  5. verifyChapter() heals a drifted block from the fresh render, skips
 *     the block being edited, and re-stamps authoritative ranges.
 */

const RENDER_TEST_TIMEOUT_MS = 120_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[edit-mode.test] No Chromium resolved — skipping.");
}

afterAll(async () => {
  await closeBrowser();
});

const SOURCE = `@chapter C.01

@page

# The Gutter Press

First paragraph with *emphasis* here.

Second paragraph stays untouched.

- item one
- item two

Raw <kbd>html</kbd> paragraph.

Closing paragraph on the default page.

Second-strip paragraph over here. {.on-two}
`;

function renderBookHtml(src: string): string {
  const md = createMarkdownRenderer();
  const body = md.render(src, { sourceChapter: "ch.md" });
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
@page { size: 5in 4in; margin: 0.4in; }
@page two { size: 5in 4in; margin: 0.4in; }
body { font: 11pt/1.4 Georgia, serif; margin: 0; }
.on-two { page: two; }
</style>
</head>
<body>
${body}
<script src="gutterpress-viewer.js"></script>
<script src="gutterpress-edit.js"></script>
</body>
</html>`;
}

testIf(
  "inline edit mode: propose → ack → shift; split; policy; refusal; drift heal",
  async () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const dir = await fsp.mkdtemp(path.join(here, ".edit-mode-"));
    try {
      await fsp.writeFile(path.join(dir, "book.html"), renderBookHtml(SOURCE));
      await fsp.writeFile(path.join(dir, "ch.md"), SOURCE);
      // "Fresh render" for the drift test: the source as it will exist AFTER
      // the committed edits of steps 1-2 (the verifier compares against the
      // authoritative render of the CURRENT source), with the second
      // paragraph drifted to new text.
      const healedSource = SOURCE.replace(
        "First paragraph with *emphasis* here.",
        "First paragraph typed\n\nFresh start with *emphasis* here.",
      ).replace("stays untouched", "was healed");
      await fsp.writeFile(path.join(dir, "fresh.html"), renderBookHtml(healedSource));
      for (const bundle of ["gutterpress-viewer.js", "gutterpress-edit.js"]) {
        await fsp.copyFile(await getAssetPath(`engine/${bundle}`), path.join(dir, bundle));
      }

      const { url: root, close } = await serveDir(dir, "book.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(`${root}book.html`, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");

          // Enable with fast debounces; collect events.
          await page.evaluate(() => {
            const w = window as unknown as {
              GutterpressEdit: {
                enable(o: object): void;
              };
              __batches: unknown[];
              __drifts: unknown[];
            };
            w.__batches = [];
            w.__drifts = [];
            window.addEventListener("editPatches", (e) =>
              w.__batches.push((e as CustomEvent).detail),
            );
            window.addEventListener("editDrift", (e) =>
              w.__drifts.push((e as CustomEvent).detail),
            );
            w.GutterpressEdit.enable({
              relayoutDelayMs: 40,
              autosyncDelayMs: 80,
              chapterUrl: () => "fresh.html",
            });
          });

          // ── 1. plain typing → patch → ack → range shift ────────────────
          await page.evaluate(() => {
            const p = [...document.querySelectorAll("p")].find((el) =>
              el.textContent!.startsWith("First paragraph"),
            )!;
            const sel = getSelection()!;
            const r = document.createRange();
            r.setStart(p.firstChild!, "First paragraph".length);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            (p.closest(".gp-strip") as HTMLElement).focus();
          });
          await page.keyboard.type(" typed");
          await page.waitForFunction("window.__batches.length >= 1");

          const batch1 = (await page.evaluate("window.__batches[0]")) as {
            batchId: number;
            patches: Array<{
              chapter: string;
              range: [number, number];
              expected: string;
              replacement: string;
            }>;
            refusals: unknown[];
          };
          expect(batch1.patches.length).toBe(1);
          const patch1 = batch1.patches[0]!;
          expect(patch1.chapter).toBe("ch.md");
          expect(patch1.expected).toBe("First paragraph with *emphasis* here.");
          expect(patch1.replacement).toBe("First paragraph typed with *emphasis* here.");

          // Ack as applied (same line count — delta 0), then grow the block
          // to test the shift: replace the ack with a two-line replacement.
          const shift = await page.evaluate((b: unknown) => {
            const batch = b as { batchId: number; patches: Array<{ chapter: string; range: [number, number] }> };
            const w = window as unknown as {
              GutterpressEdit: { ackPatches(s: object): void };
            };
            const before = [...document.querySelectorAll("[data-source-range]")].map((el) =>
              el.getAttribute("data-source-range"),
            );
            w.GutterpressEdit.ackPatches({
              batchId: batch.batchId,
              results: batch.patches.map((p) => ({ ...p, status: "applied" })),
            });
            const after = [...document.querySelectorAll("[data-source-range]")].map((el) =>
              el.getAttribute("data-source-range"),
            );
            return { before, after };
          }, batch1);
          // Delta 0 → annotations unchanged.
          expect(shift.after).toEqual(shift.before);

          // ── 2. Enter split proposes both paragraphs over the old range ──
          await page.evaluate(() => {
            const p = [...document.querySelectorAll("p")].find((el) =>
              el.textContent!.startsWith("First paragraph typed"),
            )!;
            const sel = getSelection()!;
            const r = document.createRange();
            r.setStart(p.firstChild!, "First paragraph typed".length);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            (p.closest(".gp-strip") as HTMLElement).focus();
          });
          await page.keyboard.press("Enter");
          await page.keyboard.type("Fresh start");
          await page.waitForFunction("window.__batches.length >= 2");
          const batch2 = (await page.evaluate("window.__batches[1]")) as typeof batch1;
          expect(batch2.patches.length).toBe(1);
          const split = batch2.patches[0]!;
          expect(split.replacement).toBe(
            "First paragraph typed\n\nFresh start with *emphasis* here.",
          );

          // Ack it: +2 lines. The list BELOW must shift by the delta.
          const listShift = await page.evaluate((b: unknown) => {
            const batch = b as { batchId: number; patches: Array<{ chapter: string; range: [number, number] }> };
            const w = window as unknown as { GutterpressEdit: { ackPatches(s: object): void } };
            const rangeOfList = () =>
              document.querySelector("ul")!.getAttribute("data-source-range");
            const before = rangeOfList();
            w.GutterpressEdit.ackPatches({
              batchId: batch.batchId,
              results: batch.patches.map((p) => ({ ...p, status: "applied" })),
            });
            return { before, after: rangeOfList() };
          }, batch2);
          const [lb0, lb1] = listShift.before!.split(":").map(Number);
          const [la0, la1] = listShift.after!.split(":").map(Number);
          expect(la0! - lb0!).toBe(2);
          expect(la1! - lb1!).toBe(2);

          // ── 3. policy: the injected .chapter-opener refuses typing ──────
          const openerBefore = await page.evaluate(() => {
            const opener = document.querySelector(".chapter-opener")!;
            const sel = getSelection()!;
            const r = document.createRange();
            r.selectNodeContents(opener);
            r.collapse(false);
            sel.removeAllRanges();
            sel.addRange(r);
            (opener.closest(".gp-strip") as HTMLElement).focus();
            return opener.textContent;
          });
          await page.keyboard.type("NOPE");
          const openerAfter = await page.evaluate(
            () => document.querySelector(".chapter-opener")!.textContent,
          );
          expect(openerAfter).toBe(openerBefore);

          // ── 4. raw-HTML paragraph serializes as a refusal ───────────────
          await page.evaluate(() => {
            const p = [...document.querySelectorAll("p")].find((el) =>
              el.textContent!.startsWith("Raw "),
            )!;
            const sel = getSelection()!;
            const r = document.createRange();
            r.setStart(p.firstChild!, 4);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
            (p.closest(".gp-strip") as HTMLElement).focus();
          });
          await page.keyboard.type("zz");
          await page.waitForFunction(
            "window.__batches.some((b) => b.refusals && b.refusals.length)",
          );
          const refusalBatch = (await page.evaluate(
            "window.__batches.find((b) => b.refusals.length)",
          )) as { refusals: Array<{ reason: string }> };
          expect(refusalBatch.refusals[0]!.reason).toContain("kbd");

          // ── 5. drift heal: fresh render heals the untouched paragraph,
          //      skips the dirty one ─────────────────────────────────────────
          const heal = await page.evaluate(async () => {
            const w = window as unknown as {
              GutterpressEdit: {
                verifyChapter(s: { chapter: string }): Promise<{ healed: number; mismatch?: string }>;
              };
            };
            // Point the mirror refetch at the healed source too.
            const result = await w.GutterpressEdit.verifyChapter({ chapter: "ch.md" });
            const healedText = [...document.querySelectorAll("p")].some((el) =>
              el.textContent!.includes("was healed"),
            );
            const dirtyKept = [...document.querySelectorAll("p")].some((el) =>
              el.textContent!.startsWith("Raw zz"),
            );
            return { result, healedText, dirtyKept };
          });
          expect(heal.result.mismatch).toBeUndefined();
          expect(heal.result.healed).toBeGreaterThanOrEqual(1);
          expect(heal.healedText).toBe(true);
          // The raw-HTML paragraph carries uncommitted local edits — the
          // verifier must never heal over them.
          expect(heal.dirtyKept).toBe(true);

          // ── 6. cross-strip caret hop: ArrowRight at the end of strip 1
          //      lands in strip 2 (each strip is its own editable host) ────
          const hop = await page.evaluate(async () => {
            const strips = [...document.querySelectorAll(".gp-strip")];
            if (strips.length < 2) return { strips: strips.length, hopped: false };
            const firstStrip = strips[0]!;
            const walker = document.createTreeWalker(firstStrip, NodeFilter.SHOW_TEXT, {
              acceptNode: (n) => ((n as Text).data.trim() ? 1 : 2),
            });
            let last: Text | null = null;
            for (let t = walker.nextNode(); t; t = walker.nextNode()) last = t as Text;
            const sel = getSelection()!;
            sel.setBaseAndExtent(last!, last!.length, last!, last!.length);
            (firstStrip as HTMLElement).focus();
            return { strips: strips.length, hopped: null };
          });
          expect(hop.strips).toBeGreaterThanOrEqual(2);
          await page.keyboard.press("ArrowRight");
          await new Promise((r) => setTimeout(r, 60));
          const hopResult = await page.evaluate(() => {
            const sel = getSelection()!;
            const strips = [...document.querySelectorAll(".gp-strip")];
            const container = sel.anchorNode?.parentElement?.closest(".gp-strip") ?? null;
            return { stripIndex: container ? strips.indexOf(container) : -1 };
          });
          expect(hopResult.stripIndex).toBe(1);

          // ── 7. repeated drift degrades the block to overlay-only ────────
          const degrade = await page.evaluate(async () => {
            const w = window as unknown as {
              GutterpressEdit: {
                verifyChapter(s: { chapter: string }): Promise<{
                  healed: number;
                  degraded?: Array<{ chapter: string; range: [number, number] }>;
                }>;
              };
            };
            const mutate = () => {
              const p = [...document.querySelectorAll("p")].find((el) =>
                el.textContent!.startsWith("Closing paragraph"),
              )!;
              (p.firstChild as Text).insertData(0, "DRIFT-");
              return p;
            };
            // Three drift+heal rounds on the same block: mutate, verify (the
            // block is not focused/dirty, so it heals), repeat.
            const results = [];
            for (let i = 0; i < 3; i++) {
              mutate();
              results.push(await w.GutterpressEdit.verifyChapter({ chapter: "ch.md" }));
            }
            const degradedEl = document.querySelector("[data-gp-edit-degraded]");
            return {
              heals: results.map((r) => r.healed),
              degradedReported: results[2]!.degraded?.length ?? 0,
              degradedAttr: degradedEl?.textContent?.startsWith("Closing paragraph") ?? false,
            };
          });
          expect(degrade.heals).toEqual([1, 1, 1]);
          expect(degrade.degradedReported).toBe(1);
          expect(degrade.degradedAttr).toBe(true);

          // Typing into the degraded block is refused by the input policy.
          const degradedBlocked = await page.evaluate(() => {
            const p = document.querySelector("[data-gp-edit-degraded]")!;
            const sel = getSelection()!;
            sel.setBaseAndExtent(p.firstChild!, 0, p.firstChild!, 0);
            (p.closest(".gp-strip") as HTMLElement).focus();
            return p.textContent;
          });
          await page.keyboard.type("XX");
          const degradedAfter = await page.evaluate(
            () => document.querySelector("[data-gp-edit-degraded]")!.textContent,
          );
          expect(degradedAfter).toBe(degradedBlocked);
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
