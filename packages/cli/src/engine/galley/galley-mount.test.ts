/**
 * Galley mount integration (chromium) — the architecture's riskiest claims,
 * exercised against the REAL bundles:
 *
 * 1. The Tiptap editor's view.dom serves as the fragmenter's flow root: the
 *    viewer paginates the editor's DOM (strips/sheets appear, pages > 0).
 * 2. Typing through the real input path lands in the doc, survives the
 *    debounced Gutterpress.refresh() (nodes moved by the fragmenter), and
 *    emits a whole-file galleyContent proposal whose untouched blocks are
 *    byte-preserved.
 * 3. Opaque blocks display via the fragment renderer and the marker input
 *    rule inserts a break atom that serializes back as `@page-break`.
 *
 * `/__galley/*` fetches are stubbed in-page — this test proves the frame
 * architecture, not the preview server plumbing (http-server tests own it).
 */
import { serveDir } from "../viewer/test-support/serve-dir.ts";
import { test, expect, afterAll } from "bun:test";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { resolveChromiumExecutable } from "../../lib/chromium.ts";
import { getAssetPath } from "../../lib/embedded-assets.ts";
import { closeBrowser, getBrowser } from "../../lib/browser-pool.ts";
import { createMarkdownRenderer } from "../../lib/markdown/renderer.ts";
import { MARKER_CSS } from "../../lib/markdown/markers.js";

const TIMEOUT_MS = 120_000;

declare const window: {
  Gutterpress?: { totalPages: number };
  GutterpressGalley: {
    setEditMode(s: { on: boolean }): { on: boolean };
    isEditing(): boolean;
    saveNow(): { flushed: boolean };
  };
  __contents: Array<{ chapter: string; markdown: string; expected: string }>;
  addEventListener(name: string, cb: (e: { detail: unknown }) => void): void;
};
declare const document: {
  querySelector(sel: string): { textContent: string | null } | null;
  querySelectorAll(sel: string): ArrayLike<{ textContent: string | null }>;
};

const chromium = await resolveChromiumExecutable();
const testIf = chromium ? test : test.skip;
if (!chromium) {
  // eslint-disable-next-line no-console
  console.warn("[galley-mount.test] No Chromium resolved — skipping.");
}

afterAll(async () => {
  await closeBrowser();
});

const CH1 = `@section .lede

Alpha paragraph to edit right here.

Beta paragraph stays put -- with an en dash spelling.

@end-section

<div class="custom-raw">island</div>

Gamma closes the chapter.
`;

const CH2 = `## Second chapter

Delta paragraph in the second file.
`;

const md = createMarkdownRenderer();
const tokensOf = (src: string) => JSON.parse(JSON.stringify(md.parse(src, {})));

function pageHtml(): string {
  const book = {
    chapters: [
      { chapter: "ch1.md", source: CH1, tokens: tokensOf(CH1) },
      { chapter: "ch2.md", source: CH2, tokens: tokensOf(CH2) },
    ],
  };
  return `<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<style>
@page { size: 4in 4in; margin: 0.5in; }
${MARKER_CSS}
p { margin: 0 0 0.5em; font: 12px/1.4 serif; }
</style>
<script>
  window.__GP_MANUAL__ = 1;
  window.__GP_GALLEY_HOLD__ = true;
  // Same-origin stub for the galley routes: this test proves the frame
  // architecture; the server routes have their own tests.
  const BOOK = ${JSON.stringify(book)};
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, init) => {
    const u = String(url);
    if (u.includes("/__galley/book")) {
      return Promise.resolve(new Response(JSON.stringify(BOOK), { headers: { "content-type": "application/json" } }));
    }
    if (u.includes("/__galley/fragment")) {
      const body = JSON.parse(init.body);
      return Promise.resolve(new Response(JSON.stringify({ html: '<div class="frag-rendered">' + body.markdown.replace(/</g, "&lt;") + "</div>" }), { headers: { "content-type": "application/json" } }));
    }
    return realFetch(url, init);
  };
  window.__contents = [];
  window.addEventListener("galleyContent", (e) => window.__contents.push(e.detail));
</script>
<script src="gutterpress-viewer.js"></script>
<script src="gutterpress-galley.js"></script>
</head><body>
<p>server-rendered placeholder (replaced by the galley takeover)</p>
</body></html>`;
}

testIf(
  "readonly mount first, then setEditMode(on) takes over IN PLACE (no reload) — the render-perf regression shape",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-galley-takeover-"));
    try {
      await fsp.writeFile(path.join(dir, "book.html"), pageHtml());
      for (const bundle of ["gutterpress-viewer.js", "gutterpress-galley.js"]) {
        await fsp.copyFile(await getAssetPath(`engine/${bundle}`), path.join(dir, bundle));
      }
      const { url: root, close } = await serveDir(dir, "book.html");
      try {
        const browser = await getBrowser(TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(`${root}book.html`, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.GutterpressGalley !== undefined");

          // The host declines editing → plain readonly viewer mount.
          await page.evaluate(() => {
            window.GutterpressGalley.setEditMode({ on: false });
          });
          await page.waitForFunction(
            "window.Gutterpress && window.Gutterpress.totalPages > 0",
          );
          const readonly = (await page.evaluate(() => ({
            editing: window.GutterpressGalley.isEditing(),
            tiptap: document.querySelector(".tiptap") !== null,
          }))) as { editing: boolean; tiptap: boolean };
          expect(readonly.editing).toBe(false);
          expect(readonly.tiptap).toBe(false);

          // The kill-switch flips on late (the packaged-app race the
          // render-perf gate caught): the takeover must happen in place —
          // same document, no reload — and layout must complete.
          await page.evaluate(() => {
            (window as unknown as { __no_reload_marker: boolean }).__no_reload_marker = true;
            window.GutterpressGalley.setEditMode({ on: true });
          });
          await page.waitForFunction(
            "window.Gutterpress && window.Gutterpress.totalPages > 0 && document.querySelector('.tiptap[contenteditable=true]') && window.GutterpressGalley.isEditing()",
          );
          const after = (await page.evaluate(() => ({
            sameDocument: (window as unknown as { __no_reload_marker?: boolean })
              .__no_reload_marker === true,
            chapters: document.querySelectorAll("div.gutterpress-chapter").length,
            alpha: [...(document.querySelectorAll(".tiptap p") as unknown as Iterable<{ textContent: string | null }>)]
              .some((p) => p.textContent!.startsWith("Alpha paragraph")),
          }))) as { sameDocument: boolean; chapters: number; alpha: boolean };
          expect(after.sameDocument).toBe(true);
          expect(after.chapters).toBe(2);
          expect(after.alpha).toBe(true);
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
  TIMEOUT_MS,
);

testIf(
  "galley mount: PM view is the flow root; typing survives refresh and emits byte-preserving whole-file saves",
  async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "gutterpress-galley-mount-"));
    try {
      await fsp.writeFile(path.join(dir, "book.html"), pageHtml());
      for (const bundle of ["gutterpress-viewer.js", "gutterpress-galley.js"]) {
        await fsp.copyFile(await getAssetPath(`engine/${bundle}`), path.join(dir, bundle));
      }
      const { url: root, close } = await serveDir(dir, "book.html");
      try {
        const browser = await getBrowser(TIMEOUT_MS);
        const page = await browser.newPage();
        try {
          await page.goto(`${root}book.html`, { waitUntil: "networkidle0" });
          await page.waitForFunction("window.GutterpressGalley !== undefined");
          await page.evaluate(() => {
            window.GutterpressGalley.setEditMode({ on: true });
          });

          // 1. The viewer paginates the PM view's DOM.
          await page.waitForFunction(
            "window.Gutterpress && window.Gutterpress.totalPages > 0 && document.querySelector('.tiptap[contenteditable=true]')",
          );
          const mounted = (await page.evaluate(() => ({
            pages: window.Gutterpress!.totalPages,
            editing: window.GutterpressGalley.isEditing(),
            chapters: document.querySelectorAll("div.gutterpress-chapter").length,
            alpha: !!document.querySelector(".tiptap p"),
          }))) as { pages: number; editing: boolean; chapters: number; alpha: boolean };
          expect(mounted.editing).toBe(true);
          expect(mounted.pages).toBeGreaterThanOrEqual(1);
          expect(mounted.chapters).toBe(2);
          expect(mounted.alpha).toBe(true);

          // Opaque island renders through the (stubbed) fragment pipeline.
          await page.waitForFunction(
            "document.querySelector('.gp-raw-block .frag-rendered') !== null",
          );

          // 2. Type through the real input path.
          await page.evaluate(() => {
            const p = [...(document.querySelectorAll("p") as unknown as Iterable<HTMLElement>)].find(
              (el) => el.textContent!.startsWith("Alpha paragraph"),
            )!;
            // Focus FIRST so ProseMirror is listening, then place the DOM
            // caret — PM adopts it from the selectionchange event, exactly
            // like a user click.
            (p.closest(".tiptap") as HTMLElement).focus();
            const sel = (window as unknown as { getSelection(): Selection }).getSelection();
            const r = (document as unknown as Document).createRange();
            r.setStart(p.firstChild as Node, "Alpha paragraph".length);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
          });
          await new Promise((r) => setTimeout(r, 50));
          await page.keyboard.type(", now edited,");

          // 3. The whole-file proposal arrives with untouched bytes intact.
          await page.waitForFunction(
            `window.__contents.some((c) => c.markdown.includes(", now edited,"))`,
          );
          const content = (await page.evaluate(
            `window.__contents.findLast((c) => c.markdown.includes(", now edited,"))`,
          )) as { chapter: string; markdown: string; expected: string };
          expect(content.chapter).toBe("ch1.md");
          expect(content.expected).toBe(CH1);
          expect(content.markdown).toContain("Alpha paragraph, now edited, to edit right here.");
          // Byte preservation: the untouched sibling keeps its authored "--".
          expect(content.markdown).toContain("Beta paragraph stays put -- with an en dash spelling.");
          expect(content.markdown).toContain('<div class="custom-raw">island</div>');
          expect(content.markdown).toContain("@section .lede");
          expect(content.markdown).toContain("@end-section");
          // Chapter 2 untouched — no proposal for it.
          const chapters = (await page.evaluate("window.__contents.map((c) => c.chapter)")) as string[];
          expect(chapters).not.toContain("ch2.md");

          // 4. The view survived the debounced refresh that followed typing.
          await new Promise((r) => setTimeout(r, 400));
          const after = (await page.evaluate(() => ({
            pages: window.Gutterpress!.totalPages,
            editing: window.GutterpressGalley.isEditing(),
            text: [...(document.querySelectorAll(".tiptap p") as unknown as Iterable<{ textContent: string | null }>)]
              .map((p) => p.textContent)
              .join("|"),
          }))) as { pages: number; editing: boolean; text: string };
          expect(after.editing).toBe(true);
          expect(after.pages).toBeGreaterThanOrEqual(1);
          expect(after.text).toContain("Alpha paragraph, now edited,");

          // 5. Marker input rule: a break atom from plain typing.
          await page.evaluate(() => {
            const ps = [...(document.querySelectorAll(".tiptap p") as unknown as Iterable<HTMLElement>)];
            const gamma = ps.find((el) => el.textContent!.startsWith("Gamma"))!;
            const sel = (window as unknown as { getSelection(): Selection }).getSelection();
            const r = (document as unknown as Document).createRange();
            r.setStart(gamma.firstChild as Node, 0);
            r.collapse(true);
            sel.removeAllRanges();
            sel.addRange(r);
          });
          await page.keyboard.press("Enter");
          await page.keyboard.press("ArrowUp");
          await page.keyboard.type("@page-break ");
          await page.waitForFunction("document.querySelector('.tiptap .gp-page-break') !== null");
          await page.evaluate(() => window.GutterpressGalley.saveNow());
          await page.waitForFunction(
            `window.__contents.some((c) => c.markdown.includes("@page-break"))`,
          );
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
  TIMEOUT_MS,
);
