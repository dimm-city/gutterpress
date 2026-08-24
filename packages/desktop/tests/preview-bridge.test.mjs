#!/usr/bin/env node
// Committed regression tests for the preview-bridge primitives (ADR 0005) that
// power the chapter-jump dropdown and editor↔preview sync. These run the REAL
// lib script (preview-interface.js) against a real DOM (happy-dom), so they
// exercise the actual querySelector/closest/getBoundingClientRect logic — not a
// hand-mock that can drift from the source.
//
// The most important property under test is CHAPTER-SCOPED line resolution:
// data-source-line resets per file, so two chapters share line numbers. A line
// is only unambiguous paired with its chapter. If scoping regresses, scrollTo /
// sync land in the WRONG chapter — which is exactly the "not following
// correctly" failure this suite guards against.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.resolve(
  __dirname,
  "..",
  "..",
  "cli",
  "src",
  "assets",
  "preview",
  "scripts",
  "preview-interface.js",
);
const source = readFileSync(scriptPath, "utf8");

// Wrap `inner` in the page-boundary element the native viewer uses. `n` is
// the page's 1-based book position, matching what decorate.ts stamps.
function pageWrap(n, inner) {
  return `<div class="gp-sheet" data-page="${n}">${inner}</div>`;
}

// Two chapters that DELIBERATELY share the same source-line numbers (1, 4, 9) —
// the realistic case, since data-source-line resets per file.
function chapterHtml() {
  return (
    pageWrap(
      1,
      `<div class="gutterpress-chapter" data-chapter-src="a.md">
        <h1 data-source-line="1" id="a-title">Alpha Title</h1>
        <p data-source-line="4">alpha body</p>
        <h2 data-source-line="9">Alpha Section</h2>
      </div>`,
    ) +
    pageWrap(
      2,
      `<div class="gutterpress-chapter" data-chapter-src="b.md">
        <h1 data-source-line="1" id="b-title">Beta Title</h1>
        <p data-source-line="4">beta body</p>
        <h2 data-source-line="9">Beta Section</h2>
      </div>`,
    )
  );
}

function setup(markup) {
  const window = new Window({ url: "http://localhost/" });
  const document = window.document;
  {
    document.head.innerHTML = '<script src="/engine/gutterpress-viewer.js"></script>';
    // Book-wide (0-based) page index of an element, from its enclosing
    // .gp-sheet's dataset.page — the fixture's stand-in for the real
    // viewer's fragmentainer-position math (engine/viewer/fragment.ts's
    // pageOf()), which happy-dom can't lay out to measure.
    window.Gutterpress = {
      pageOf(el) {
        const sheet = el && el.closest ? el.closest(".gp-sheet") : null;
        return sheet ? parseInt(sheet.getAttribute("data-page"), 10) - 1 : -1;
      },
    };
  }
  document.body.innerHTML = markup ?? chapterHtml();

  // happy-dom does no layout, so synthesise a vertical stack: each source-mapped
  // block sits 100px below the previous; each three-block chapter occupies one
  // 300px page. `scrollY` slides the
  // whole stack so a chosen element can sit at the viewport top.
  const state = { scrollY: 0 };
  const blocks = [...document.querySelectorAll("[data-source-line]")];
  blocks.forEach((el) => {
    const sheet = el.closest(".gp-sheet");
    const page = sheet ? parseInt(sheet.getAttribute("data-page"), 10) - 1 : 0;
    const position = sheet
      ? [...sheet.querySelectorAll("[data-source-line]")].indexOf(el)
      : blocks.indexOf(el);
    el.getBoundingClientRect = () => ({
      top: page * 300 + position * 100 - state.scrollY,
      bottom: page * 300 + position * 100 - state.scrollY + 40,
      left: 0,
      right: 400,
      width: 400,
      height: 40,
    });
    el.getClientRects = () => [el.getBoundingClientRect()];
  });
  const pages = [...document.querySelectorAll(".gp-sheet")];
  pages.forEach((el, i) => {
    el.getBoundingClientRect = () => ({
      top: i * 300 - state.scrollY,
      bottom: i * 300 - state.scrollY + 300,
      left: 0,
      right: 400,
      width: 400,
      height: 300,
    });
  });
  window.innerHeight = 300;

  // happy-dom has no window.scrollBy; record the interpolation nudges that
  // scrollTo() issues for lines that fall between annotated blocks.
  const scrolls = [];
  window.scrollBy = (opts) => {
    scrolls.push(opts);
    state.scrollY += opts && typeof opts.top === "number" ? opts.top : 0;
  };

  const run = new Function(
    "window",
    "document",
    "CustomEvent",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    source,
  );
  run(window, document, window.CustomEvent, window.MutationObserver, setTimeout, clearTimeout);
  return { window, document, api: window.previewAPI, state, scrolls };
}

async function main() {
  // Native is the only engine, so this runs once against one DOM shape.
  // This used to be `for (const engine of ["native"])` — a one-element loop
  // kept "so a future second engine slots back in with minimal diff". The
  // Chromium-only ruling forecloses that engine, `pageWrap` already ignored
  // the parameter, and the `.pagedjs_page` branch it selected was
  // unreachable. A seam held open for something that is not coming costs
  // every later reader the question of which engine a given line is about.
 // ── 1. Chapter-scoped line resolution (the critical correctness property) ──
 {
   const { api, scrolls } = setup(undefined);

   const b = api.scrollTo({ line: 9, chapter: "b.md" });
   assert.equal(b.page, 2, "line 9 in chapter b resolves to page 2");
   assert.equal(b.sourceLine, 9);
   assert.equal(scrolls.length, 0, "exact line match needs no interpolation nudge");

   const a = api.scrollTo({ line: 9, chapter: "a.md" });
   assert.equal(a.page, 1, "the SAME line 9 in chapter a resolves to page 1");

   // A nearest-preceding line still stays inside the requested chapter, and
   // the scroll is interpolated by line fraction between the bounding blocks
   // (line 6 sits 2/5 of the way from b's line 4 to b's line 9; blocks are
   // 100px apart → a 40px nudge past the block top). RC1-5.
   const bMid = api.scrollTo({ line: 6, chapter: "b.md" });
   assert.equal(bMid.page, 2, "line 6 in chapter b snaps to b's line 4 (page 2)");
   assert.equal(bMid.sourceLine, 4);
   assert.equal(scrolls.length, 1, "between-block line gets one interpolation nudge");
   assert.equal(scrolls[0].top, 40, "nudge = fraction (2/5) of the 100px block gap");

   // Un-scoped resolution is ambiguous (picks the first line-9 = chapter a),
   // which is exactly why sync must pass the chapter.
   const g = api.scrollTo({ line: 9 });
   assert.equal(g.page, 1, "un-scoped line 9 is ambiguous → first match (a)");
 }

 // ── 2. getVisibleSource reports the top block's line + chapter + page ──────
 {
   const { api, state } = setup(undefined);
   // Slide so chapter b's <h1> (4th block, top=300) sits at the viewport top.
   state.scrollY = 300;
   const vs = api.getVisibleSource();
   assert.equal(vs.chapter, "b.md", "top-visible chapter is b");
   assert.equal(vs.sourceLine, 1, "top-visible source line is b's line 1");
   assert.equal(vs.page, 2);

   // Once b's h1 is wholly above the viewport, the next visible block owns
   // the source position; an offscreen predecessor must not be interpolated.
   state.scrollY = 350;
   const mid = api.getVisibleSource();
   assert.equal(mid.chapter, "b.md");
   assert.equal(mid.sourceLine, 4, "the first actually visible block wins");
 }

 // ── 3. getOutline returns headings with chapter + page ────────────────────
 {
   const { api } = setup(undefined);
   const outline = api.getOutline();
   assert.deepEqual(
     outline.map((o) => [o.text, o.level, o.sourceLine, o.chapter, o.page]),
     [
       ["Alpha Title", 1, 1, "a.md", 1],
       ["Alpha Section", 2, 9, "a.md", 1],
       ["Beta Title", 1, 1, "b.md", 2],
       ["Beta Section", 2, 9, "b.md", 2],
     ],
   );
 }

 // ── 4. queryDom is chapter-aware and read-only ────────────────────────────
 {
   const { api } = setup(undefined);
   const rows = api.queryDom({
     selector: "h2",
     fields: ["text", "sourceLine", "chapter", "page"],
   });
   assert.equal(rows.length, 2);
   assert.deepEqual(rows[0], { text: "Alpha Section", sourceLine: 9, chapter: "a.md", page: 1 });
   assert.deepEqual(rows[1], { text: "Beta Section", sourceLine: 9, chapter: "b.md", page: 2 });
 }

 // ── 5. Scrolling emits sourceLineChanged carrying the chapter ─────────────
 {
   const { api, window, state } = setup(undefined);
   let detail = null;
   window.addEventListener("sourceLineChanged", (e) => (detail = e.detail));
   api.getTotalPages(); // prime the page list
   state.scrollY = 300; // chapter b's h1 to the top
   window.dispatchEvent(new window.Event("scroll"));
   await new Promise((r) => setTimeout(r, 220)); // > 150ms scroll debounce
   assert.ok(detail, "sourceLineChanged fired on scroll");
   assert.equal(detail.chapter, "b.md");
   assert.equal(detail.sourceLine, 1);
 }

 // ── 6. Interpolation never crosses a chapter boundary ─────────────────────
 {
   const crossChapterLines =
     pageWrap(1, '<div data-chapter-src="a.md"><p data-source-line="9">end of a</p></div>') +
     pageWrap(2, '<div data-chapter-src="b.md"><p data-source-line="20">b starts after front matter</p></div>');
   const { api, state } = setup(crossChapterLines);
   state.scrollY = 20;
   const source = api.getVisibleSource();
   assert.equal(source.sourceLine, 9);
   assert.equal(source.chapter, "a.md", "a numerically higher line in the next chapter is not an interpolation endpoint");
 }

 // ── 7. A reader scroll during a programmatic guard is deferred, not lost ──
 {
   const { api, window, state } = setup(undefined);
   let detail = null;
   window.addEventListener("sourceLineChanged", (e) => (detail = e.detail));
   api.setZoom("0.8");
   state.scrollY = 300;
   window.dispatchEvent(new window.Event("scroll"));
   await new Promise((r) => setTimeout(r, 380));
   assert.equal(detail?.chapter, "b.md");
   assert.equal(detail?.sourceLine, 1);
 }

 // Menu geometry is invalid as soon as scrolling starts, independent of the
 // slower source-position debounce used for editor synchronization.
 {
   const { window } = setup(undefined);
   let viewportChanges = 0;
   window.addEventListener("viewportChanged", () => viewportChanges++);
   window.dispatchEvent(new window.Event("scroll"));
   await new Promise((r) => setTimeout(r, 20));
   assert.equal(viewportChanges, 1, "scroll publishes an immediate viewport invalidation");

   window.dispatchEvent(new window.Event("resize"));
   await new Promise((r) => setTimeout(r, 20));
   assert.equal(viewportChanges, 2, "resize publishes the same immediate viewport invalidation");
 }

 // ── 8. Source selection ignores blocks outside the 2D viewport ───────────
 {
   const markup =
     pageWrap(1, '<p id="old" data-chapter-src="a.md" data-source-line="9">old page</p>') +
     pageWrap(2, '<p id="current" data-chapter-src="b.md" data-source-line="1">current page</p>');
   const { api, document, window } = setup(markup);
   window.innerWidth = 500;
   window.innerHeight = 500;
   const old = document.getElementById("old");
   const current = document.getElementById("current");
   const oldRect = { top: -100, bottom: -40, left: 0, right: 400, width: 400, height: 60 };
   const currentRect = { top: 40, bottom: 80, left: 0, right: 400, width: 400, height: 40 };
   old.getBoundingClientRect = () => oldRect;
   old.getClientRects = () => [oldRect];
   current.getBoundingClientRect = () => currentRect;
   current.getClientRects = () => [currentRect];
   const pages = [...document.querySelectorAll(".gp-sheet")];
   pages[0].getBoundingClientRect = () => ({ top: -600, bottom: -100, left: 0, right: 400, width: 400, height: 500 });
   pages[1].getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 400, width: 400, height: 500 });

   assert.deepEqual(api.getVisibleSource(), {
     sourceLine: 1,
     chapter: "b.md",
     page: 2,
   }, "a block wholly above the viewport cannot remain the visible source");
 }

 {
   const markup =
     pageWrap(1, '<p id="left" data-chapter-src="a.md" data-source-line="9">offscreen column</p>') +
     pageWrap(2, '<p id="onscreen" data-chapter-src="b.md" data-source-line="1">visible column</p>');
   const { api, document, window } = setup(markup);
   window.innerWidth = 500;
   window.innerHeight = 500;
   const left = document.getElementById("left");
   const onscreen = document.getElementById("onscreen");
   const leftRect = { top: 40, bottom: 80, left: -600, right: -200, width: 400, height: 40 };
   const onscreenRect = { top: 40, bottom: 80, left: 20, right: 420, width: 400, height: 40 };
   left.getBoundingClientRect = () => leftRect;
   left.getClientRects = () => [leftRect];
   onscreen.getBoundingClientRect = () => onscreenRect;
   onscreen.getClientRects = () => [onscreenRect];
   const pages = [...document.querySelectorAll(".gp-sheet")];
   pages[0].getBoundingClientRect = () => ({ top: 0, bottom: 500, left: -600, right: -100, width: 500, height: 500 });
   pages[1].getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500 });

   assert.deepEqual(api.getVisibleSource(), {
     sourceLine: 1,
     chapter: "b.md",
     page: 2,
   }, "a horizontally offscreen page cannot supply the visible source");
 }

 {
   const markup =
     pageWrap(1, '<p id="majority" data-chapter-src="a.md" data-source-line="10">mostly visible page</p>') +
     pageWrap(2, '<p id="minority" data-chapter-src="b.md" data-source-line="20">less visible page</p>');
   const { api, document, window } = setup(markup);
   window.innerWidth = 500;
   window.innerHeight = 500;
   const pages = [...document.querySelectorAll(".gp-sheet")];
   pages[0].getBoundingClientRect = () => ({ top: 0, bottom: 500, left: -200, right: 300, width: 500, height: 500 });
   pages[1].getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 300, right: 800, width: 500, height: 500 });
   const majority = document.getElementById("majority");
   const minority = document.getElementById("minority");
   const majorityRect = { top: 80, bottom: 120, left: -150, right: 250, width: 400, height: 40 };
   const minorityRect = { top: 4, bottom: 400, left: 300, right: 800, width: 500, height: 396 };
   majority.getBoundingClientRect = () => majorityRect;
   majority.getClientRects = () => [majorityRect];
   minority.getBoundingClientRect = () => minorityRect;
   minority.getClientRects = () => [minorityRect];

   assert.deepEqual(api.getVisibleSource(), {
     sourceLine: 10,
     chapter: "a.md",
     page: 1,
   }, "source identity is constrained to the sheet selected by visible overlap");
 }

 {
   const markup =
     pageWrap(1, '<p id="start" data-chapter-src="same.md" data-source-line="10">selected page</p>') +
     pageWrap(2, '<p id="next" data-chapter-src="same.md" data-source-line="20">neighbor page</p>');
   const { api, document, window } = setup(markup);
   window.innerWidth = 500;
   window.innerHeight = 500;
   const pages = [...document.querySelectorAll(".gp-sheet")];
   pages[0].getBoundingClientRect = () => ({ top: 0, bottom: 500, left: -200, right: 300, width: 500, height: 500 });
   pages[1].getBoundingClientRect = () => ({ top: 0, bottom: 500, left: 300, right: 800, width: 500, height: 500 });
   const start = document.getElementById("start");
   const next = document.getElementById("next");
   const startRect = { top: -20, bottom: 80, left: -150, right: 250, width: 400, height: 100 };
   const nextRect = { top: 100, bottom: 140, left: 300, right: 700, width: 400, height: 40 };
   start.getBoundingClientRect = () => startRect;
   start.getClientRects = () => [startRect];
   next.getBoundingClientRect = () => nextRect;
   next.getClientRects = () => [nextRect];

   assert.equal(
     api.getVisibleSource().sourceLine,
     10,
     "line interpolation cannot use a same-chapter block on the neighboring sheet",
   );
 }

 {
   const markup = pageWrap(
     1,
     '<p id="long" data-chapter-src="same.md" data-source-line="10">long block</p>' +
       '<p id="below" data-chapter-src="same.md" data-source-line="20">below viewport</p>',
   );
   const { api, document, window } = setup(markup);
   window.innerWidth = 500;
   window.innerHeight = 500;
   document.querySelector(".gp-sheet").getBoundingClientRect = () => ({
     top: -500, bottom: 1000, left: 0, right: 500, width: 500, height: 1500,
   });
   const long = document.getElementById("long");
   const below = document.getElementById("below");
   const longRect = { top: -400, bottom: 400, left: 0, right: 400, width: 400, height: 800 };
   const belowRect = { top: 600, bottom: 640, left: 0, right: 400, width: 400, height: 40 };
   long.getBoundingClientRect = () => longRect;
   long.getClientRects = () => [longRect];
   below.getBoundingClientRect = () => belowRect;
   below.getClientRects = () => [belowRect];

   assert.equal(
     api.getVisibleSource().sourceLine,
     14,
     "a below-viewport endpoint on the same sheet still interpolates a long block",
   );
 }

 {
   const { api, document } = setup(
     '<p id="first" data-chapter-src="a.md" data-source-line="1">before layout</p>' +
       '<p id="next" data-chapter-src="a.md" data-source-line="5">next</p>',
   );
   const first = document.getElementById("first");
   const next = document.getElementById("next");
   const firstRect = { top: -20, bottom: 80, left: 0, right: 400, width: 400, height: 100 };
   const nextRect = { top: 100, bottom: 140, left: 0, right: 400, width: 400, height: 40 };
   first.getBoundingClientRect = () => firstRect;
   first.getClientRects = () => [firstRect];
   next.getBoundingClientRect = () => nextRect;
   next.getClientRects = () => [nextRect];

   assert.doesNotThrow(() => api.getVisibleSource(), "pre-layout source inspection is safe without any sheets");
 }

 {
   const markup = pageWrap(
     1,
     '<p id="fragmented" data-chapter-src="a.md" data-source-line="10">fragmented block</p>',
   );
   const { api, document, window } = setup(markup);
   window.innerWidth = 500;
   window.innerHeight = 500;
   const fragmented = document.getElementById("fragmented");
   const above = { top: -100, bottom: -20, left: 0, right: 400, width: 400, height: 80 };
   const visible = { top: 30, bottom: 90, left: 0, right: 400, width: 400, height: 60 };
   fragmented.getBoundingClientRect = () => ({ top: -100, bottom: 90, left: 0, right: 400, width: 400, height: 190 });
   fragmented.getClientRects = () => [above, visible];
   document.querySelector(".gp-sheet").getBoundingClientRect = () => ({
     top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500,
   });

   assert.deepEqual(api.getVisibleSource(), {
     sourceLine: 10,
     chapter: "a.md",
     page: 1,
   }, "an onscreen fragment is selected even when the element's first fragment is offscreen");
 }

 {
   const markup = pageWrap(
     1,
     '<p id="anchor" data-chapter-src="a.md" data-source-line="10">fragment anchor</p>',
   );
   const { api, document, window, scrolls } = setup(markup);
   window.innerWidth = 500;
   window.innerHeight = 500;
   document.querySelector(".gp-sheet").getBoundingClientRect = () => ({
     top: 0, bottom: 500, left: 0, right: 500, width: 500, height: 500,
   });
   const anchor = document.getElementById("anchor");
   anchor.getClientRects = () => {
     const changed = document.documentElement.style.getPropertyValue("--gutterpress-zoom") === "0.8";
     return changed
       ? [
           { top: 5, bottom: 25, left: 0, right: 400, width: 400, height: 20 },
           { top: 50, bottom: 110, left: 0, right: 400, width: 400, height: 60 },
         ]
       : [
           { top: 5, bottom: 25, left: -500, right: -100, width: 400, height: 20 },
           { top: 30, bottom: 90, left: 0, right: 400, width: 400, height: 60 },
         ];
   };
   anchor.getBoundingClientRect = () => ({ top: 5, bottom: 110, left: 0, right: 400, width: 400, height: 105 });

   api.setZoom("0.8");
   assert.equal(scrolls.at(-1)?.top, 20, "zoom preserves the same source fragment index");
 }

 console.log("preview-bridge.test.mjs: all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
