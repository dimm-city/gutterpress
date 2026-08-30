import { serveDir } from "./test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";

const FIXTURES_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");
const RENDER_TEST_TIMEOUT_MS = 60_000;
const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;

afterAll(async () => {
  await closeBrowser();
});

testIf(
  "a full-height named-page containing block keeps bottom art on its print page",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".full-height-root-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "full-height-abspos.html"),
        path.join(dir, "full-height-abspos.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "full-height-abspos.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>(".art-page")!;
            const prose = document.querySelector<HTMLElement>(".prose")!;
            const art = document.querySelector<HTMLElement>(".bottom-art")!;
            const strip = root.closest<HTMLElement>(".gp-strip")!;
            const rr = root.getBoundingClientRect();
            const pr = prose.getBoundingClientRect();
            const ar = art.getBoundingClientRect();
            const sr = strip.getBoundingClientRect();
            return {
              runPages: (window as any).Gutterpress.strips.find(
                (s: any) => s.el === strip,
              ).pages,
              rootFragments: root.getClientRects().length,
              rootTop: rr.top,
              stripTop: sr.top,
              proseInset: pr.top - rr.top,
              artBottom: ar.bottom,
              rootBottom: rr.bottom,
              stabilized: root.dataset.gpLeadingPageRoot,
              page: getComputedStyle(root).page,
              display: getComputedStyle(root).display,
              position: getComputedStyle(root).position,
              height: getComputedStyle(root).height,
              stripHeight: getComputedStyle(strip).getPropertyValue("--gp-content-h"),
            };
          });

          expect(result.runPages).toBe(1);
          expect(result.rootFragments).toBe(1);
          expect(result.rootTop).toBeCloseTo(result.stripTop, 1);
          expect(result.proseInset).toBeCloseTo(16, 1);
          expect(result.artBottom).toBeCloseTo(result.rootBottom, 1);
          expect(result.stabilized).toBe("stabilized");

          // A CSS/content refresh may make the root cease to qualify. The
          // viewer must restore the exact authored inline display instead of
          // leaking its flow-root correction into the rebuilt document.
          const refreshed = await page.evaluate(() => {
            const root = document.querySelector<HTMLElement>(".art-page")!;
            root.style.minHeight = "100px";
            (window as any).Gutterpress.refresh();
            return {
              marker: root.dataset.gpLeadingPageRoot,
              inlineDisplay: root.style.display,
              computedDisplay: getComputedStyle(root).display,
            };
          });
          expect(refreshed.marker).toBeUndefined();
          expect(refreshed.inlineDisplay).toBe("block");
          expect(refreshed.computedDisplay).toBe("block");
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
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "break synthesis follows the winning cascade for before and after",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".break-cascade-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "break-cascade.html"),
        path.join(dir, "break-cascade.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "break-cascade.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => ({
            computed: {
              before: getComputedStyle(document.querySelector("#overridden-before")!).breakBefore,
              after: getComputedStyle(document.querySelector("#overridden-after")!).breakAfter,
              always: getComputedStyle(document.querySelector("#invalid-always")!).breakBefore,
            },
            spacers: Array.from(document.querySelectorAll(".gp-column-break-spacer")).map(
              (el) => ({
                previous: el.previousElementSibling?.id,
                next: el.nextElementSibling?.id,
              }),
            ),
          }));

          expect(result.computed).toEqual({ before: "auto", after: "auto", always: "auto" });
          expect(result.spacers).toEqual([
            { previous: "invalid-always", next: "valid-before" },
            { previous: "valid-after", next: "tail" },
          ]);
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
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "break synthesis propagates a first-child forced break to its wrapper",
  async () => {
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".break-propagation-"));
    try {
      await fsp.copyFile(
        path.join(FIXTURES_DIR, "break-propagation.html"),
        path.join(dir, "break-propagation.html"),
      );
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "break-propagation.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          // Print ground truth (Chromium printToPDF named destinations,
          // measured on this same document shape): lead-chapter p1 (a forced
          // break at the strip's leading edge is spec-ignorable),
          // clean-chapter p2 (the nested `.page`'s break-before propagates to
          // the wrapper, so the WHOLE wrapper starts the new page),
          // text-chapter p2 with text-page p3 (rendered text before the
          // nested `.page` is an anonymous sibling box, so print splits the
          // wrapper between the text and the `.page`).
          const result = await page.evaluate(() => {
            const api = (window as any).Gutterpress;
            const byId = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!;
            const clean = byId("clean-chapter");
            const strip = clean.closest<HTMLElement>(".gp-strip")!;
            // "Top of its page" must account for the wrapped view mode: pages
            // stack as rows at a pitch of content-height + row-gap (see
            // rowStrideOf), so the page top is stripTop + row * pitch, not
            // stripTop itself. Distance to the nearest multiple covers the
            // unwrapped single-row layout too (every column top IS stripTop).
            const cs = getComputedStyle(strip);
            const pitch =
              parseFloat(cs.getPropertyValue("--gp-content-h")) + (parseFloat(cs.rowGap) || 0);
            const inset = clean.getClientRects()[0]!.top - strip.getBoundingClientRect().top;
            const rows = inset / pitch;
            return {
              totalPages: api.totalPages,
              pages: {
                lead: api.pageOf(byId("lead-chapter")),
                clean: api.pageOf(clean),
                text: api.pageOf(byId("text-chapter")),
                textPage: api.pageOf(byId("text-page")),
              },
              cleanFragments: clean.getClientRects().length,
              cleanAtColumnTop: Math.abs(rows - Math.round(rows)) * pitch < 1,
              spacers: Array.from(document.querySelectorAll(".gp-column-break-spacer")).map(
                (el) => ({
                  parent: el.parentElement!.id || el.parentElement!.className,
                  next: el.nextElementSibling?.id,
                }),
              ),
            };
          });

          expect(result.totalPages).toBe(3);
          expect(result.pages).toEqual({ lead: 0, clean: 1, text: 1, textPage: 2 });
          // The clean wrapper moved WHOLE: one fragment, starting at the top
          // of its column — not a stub fragment left at the previous column's
          // tail (the pre-fix shape that shifted every cross-reference to the
          // wrapper one page early; see docs/fixtures/css-authoring-spike).
          expect(result.cleanFragments).toBe(1);
          expect(result.cleanAtColumnTop).toBe(true);
          expect(result.spacers).toEqual([
            { parent: "gp-strip", next: "clean-chapter" },
            { parent: "text-chapter", next: "text-page" },
          ]);
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
  RENDER_TEST_TIMEOUT_MS,
);

testIf(
  "an avoid block deferred by a trailing margin lands on the SAME page the PDF puts it on",
  async () => {
    // This replaces a test that asserted the OPPOSITE and never printed
    // anything. It encoded `compensateTrailingMarginsBeforeAvoids`'s premise —
    // "Print pagination discards that margin at the fragmentainer edge" — and
    // that premise is false. Measured with page.pdf({preferCSSPageSize:true})
    // on this very fixture: print puts #fit-prev on PDF p1 and #fit-block on
    // p2, 8 pages total. Chromium print KEEPS the trailing margin and defers
    // the avoid block, so the shim's "correction" was the divergence.
    //
    // The test therefore asserts against print rather than against a belief:
    // print IS the contract (the PDF is the product), so the viewer's page
    // deltas must equal the PDF's.
    const dir = await fsp.mkdtemp(path.join(path.dirname(FIXTURES_DIR), ".avoid-margin-"));
    try {
      const fixture = path.join(FIXTURES_DIR, "avoid-trailing-margin.html");
      await fsp.copyFile(fixture, path.join(dir, "avoid-trailing-margin.html"));
      await fsp.copyFile(
        await getAssetPath("engine/gutterpress-viewer.js"),
        path.join(dir, "gutterpress-viewer.js"),
      );
      const { url, close } = await serveDir(dir, "avoid-trailing-margin.html");
      try {
        const browser = await getBrowser(RENDER_TEST_TIMEOUT_MS);

        // ── PRINT: the same markup with the viewer script removed, so this is
        // Chromium's own paged-media fragmenter and nothing else.
        const printPage = await browser.newPage();
        let printPages: number;
        try {
          const raw = await fsp.readFile(fixture, "utf8");
          await printPage.setContent(
            raw.replace('<script src="gutterpress-viewer.js"></script>', ""),
            { waitUntil: "networkidle0" },
          );
          const pdf = await printPage.pdf({ preferCSSPageSize: true });
          // Page count is enough to catch the shim: it removes exactly the
          // pages the deferred avoid blocks would have started.
          printPages = (Buffer.from(pdf).toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
        } finally {
          await printPage.close();
        }

        // ── VIEWER: the same fixture through the engine.
        const page = await browser.newPage();
        try {
          await page.goto(url, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.Gutterpress?.totalPages > 0");
          const result = await page.evaluate(() => {
            const api = (window as any).Gutterpress;
            const byId = (id: string) => document.querySelector<HTMLElement>(`#${id}`)!;
            return {
              total: api.totalPages,
              fit: [api.pageOf(byId("fit-prev")), api.pageOf(byId("fit-block"))],
              second: [api.pageOf(byId("second-prev")), api.pageOf(byId("second-block"))],
              tall: [api.pageOf(byId("tall-prev")), api.pageOf(byId("tall-block"))],
            };
          });

          // The whole point: the viewer paginates this fixture the way the PDF does.
          expect(result.total).toBe(printPages);
          // …and the avoid block is DEFERRED, exactly as print defers it. A
          // trailing margin is not discarded at a fragmentainer edge.
          expect(result.fit[1]).toBe(result.fit[0]! + 1);
          expect(result.second[1]).toBe(result.second[0]! + 1);
          // The too-tall case never depended on the margin and is unchanged.
          expect(result.tall[1]).toBe(result.tall[0]! + 1);
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
  RENDER_TEST_TIMEOUT_MS,
);
