import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { startPreviewServer } from "../server.ts";
import { resolveChromiumExecutable } from "../lib/chromium.ts";
import { closeBrowser, getBrowser } from "../lib/browser-pool.ts";

/**
 * LIVE end-to-end test for inline editing (ADR 0010) against the REAL
 * preview server: real render pipeline, real script injection, real chapter
 * source serving, and the real `/__chapter` verifier route — no fixtures.
 *
 * The load-bearing assertion is the zero-drift one: after typing in the
 * frame, committing the proposed patch to the actual file, and acking, the
 * converge-on-drift verifier fetches the chapter's authoritative render from
 * `/__chapter` and must find NOTHING to heal — the edited DOM, the source
 * file, and a fresh render all agree. Then an external edit must show up as
 * drift and heal in place, without any reload.
 */

const TIMEOUT_MS = 120_000;

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[edit-live.test] No Chromium resolved — skipping.");
}

afterAll(async () => {
  await closeBrowser();
});

const SOURCE = `# Live Book

Alpha paragraph to edit right here.

Beta paragraph stays put.
`;

testIf(
  "live preview server: type → commit to disk → ack → zero drift; external edit → heal",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-edit-live-"));
    let server: Awaited<ReturnType<typeof startPreviewServer>> | null = null;
    try {
      const chapterFile = "chapter.md";
      await fsp.writeFile(path.join(dir, chapterFile), SOURCE);
      server = await startPreviewServer({
        input: dir,
        port: 0,
        host: "127.0.0.1",
        openBrowser: false,
        installSignals: false,
      } as Parameters<typeof startPreviewServer>[0]);
      const base = `http://127.0.0.1:${server.port}`;

      const browser = await getBrowser(TIMEOUT_MS);
      const page = await browser.newPage();
      try {
        await page.goto(`${base}/book.html`, { waitUntil: "domcontentloaded" });
        await page.waitForFunction("window.Gutterpress && window.Gutterpress.totalPages > 0");
        await page.waitForFunction("window.GutterpressEdit && window.previewAPI");

        // The injected interface must be protocol v7 with edit mode live.
        const protocol = await page.evaluate(() =>
          (window as unknown as { previewAPI: { getProtocolVersion(): number } })
            .previewAPI.getProtocolVersion(),
        );
        expect(protocol).toBe(7);

        await page.evaluate(() => {
          const w = window as unknown as {
            GutterpressEdit: { enable(o: object): void };
            __batches: Array<{ batchId: number; patches: unknown[] }>;
          };
          w.__batches = [];
          window.addEventListener("editPatches", (e) =>
            w.__batches.push((e as CustomEvent).detail),
          );
          w.GutterpressEdit.enable({ relayoutDelayMs: 40, autosyncDelayMs: 80 });
        });

        // Type into the first paragraph through the real input path.
        await page.evaluate(() => {
          const p = [...document.querySelectorAll("p")].find((el) =>
            el.textContent!.startsWith("Alpha paragraph"),
          )!;
          const sel = getSelection()!;
          const r = document.createRange();
          r.setStart(p.firstChild!, "Alpha paragraph".length);
          r.collapse(true);
          sel.removeAllRanges();
          sel.addRange(r);
          (p.closest(".gp-strip") as HTMLElement).focus();
        });
        await page.keyboard.type(", now edited,");
        await page.waitForFunction("window.__batches.length >= 1");

        const batch = (await page.evaluate("window.__batches[0]")) as {
          batchId: number;
          patches: Array<{
            chapter: string;
            range: [number, number];
            expected: string;
            replacement: string;
          }>;
        };
        expect(batch.patches.length).toBe(1);
        const patch = batch.patches[0]!;
        expect(patch.chapter).toBe(chapterFile);
        expect(patch.expected).toBe("Alpha paragraph to edit right here.");
        expect(patch.replacement).toBe("Alpha paragraph, now edited, to edit right here.");

        // Commit exactly as the SPA session would: splice the file on disk.
        const lines = SOURCE.split("\n");
        lines.splice(
          patch.range[0],
          patch.range[1] - patch.range[0],
          ...patch.replacement.split("\n"),
        );
        await fsp.writeFile(path.join(dir, chapterFile), lines.join("\n"));
        // (The real flow marks this write origin:"inline-edit" through
        // notifySettledWrite; writing directly exercises the harsher case —
        // the watcher rebuild runs and must still not disturb this page,
        // which loads book.html directly and owns its own DOM.)

        const zeroDrift = await page.evaluate(
          async (b: unknown) => {
            const batch = b as { batchId: number; patches: Array<Record<string, unknown>> };
            const w = window as unknown as {
              GutterpressEdit: {
                ackPatches(s: object): void;
                verifyChapter(s: { chapter: string }): Promise<{ healed: number; mismatch?: string }>;
              };
            };
            w.GutterpressEdit.ackPatches({
              batchId: batch.batchId,
              results: batch.patches.map((p) => ({ ...p, status: "applied" })),
            });
            return w.GutterpressEdit.verifyChapter({ chapter: "chapter.md" });
          },
          batch,
        );
        // The pipeline agrees end-to-end: edited DOM ≡ committed source ≡
        // the /__chapter route's fresh render. Nothing to heal.
        expect(zeroDrift.mismatch).toBeUndefined();
        expect(zeroDrift.healed).toBe(0);

        // External edit (another tool touches the file): drift must heal in
        // place from the live route — no reload, no swap.
        const external = lines
          .join("\n")
          .replace("Beta paragraph stays put.", "Beta paragraph was changed elsewhere.");
        await fsp.writeFile(path.join(dir, chapterFile), external);
        const healed = await page.evaluate(async () => {
          const w = window as unknown as {
            GutterpressEdit: {
              verifyChapter(s: { chapter: string }): Promise<{ healed: number; mismatch?: string }>;
            };
          };
          const result = await w.GutterpressEdit.verifyChapter({ chapter: "chapter.md" });
          return {
            result,
            text: [...document.querySelectorAll("p")].map((p) => p.textContent).join("|"),
          };
        });
        expect(healed.result.mismatch).toBeUndefined();
        expect(healed.result.healed).toBe(1);
        expect(healed.text).toContain("Beta paragraph was changed elsewhere.");
        expect(healed.text).toContain("Alpha paragraph, now edited,");
      } finally {
        await page.close();
      }
    } finally {
      await server?.stop();
      await fsp.rm(dir, { recursive: true, force: true });
    }
  },
  TIMEOUT_MS,
);
