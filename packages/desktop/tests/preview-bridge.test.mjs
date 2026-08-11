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
function pageWrap(engine, n, inner) {
  return `<div class="gp-sheet" data-page="${n}">${inner}</div>`;
}

// Two chapters that DELIBERATELY share the same source-line numbers (1, 4, 9) —
// the realistic case, since data-source-line resets per file.
function chapterHtml(engine) {
  return (
    pageWrap(
      engine,
      1,
      `<div class="gutterpress-chapter" data-chapter-src="a.md">
        <h1 data-source-line="1" id="a-title">Alpha Title</h1>
        <p data-source-line="4">alpha body</p>
        <h2 data-source-line="9">Alpha Section</h2>
      </div>`,
    ) +
    pageWrap(
      engine,
      2,
      `<div class="gutterpress-chapter" data-chapter-src="b.md">
        <h1 data-source-line="1" id="b-title">Beta Title</h1>
        <p data-source-line="4">beta body</p>
        <h2 data-source-line="9">Beta Section</h2>
      </div>`,
    )
  );
}

// engine defaults to "paged" for compatibility with the pre-parameterization
// call sites; pass "native" to run the SAME assertions against the
// Gutterpress engine viewer's DOM shape instead.
function setup(markup, engine = "paged") {
  const window = new Window({ url: "http://localhost/" });
  const document = window.document;
  if (engine === "native") {
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
  document.body.innerHTML = markup ?? chapterHtml(engine);

  // happy-dom does no layout, so synthesise a vertical stack: each source-mapped
  // block sits 100px below the previous; each page 1000px. `scrollY` slides the
  // whole stack so a chosen element can sit at the viewport top.
  const state = { scrollY: 0 };
  const blocks = [...document.querySelectorAll("[data-source-line]")];
  blocks.forEach((el, i) => {
    el.getBoundingClientRect = () => ({
      top: i * 100 - state.scrollY,
      bottom: i * 100 - state.scrollY + 40,
      left: 0,
      right: 400,
      width: 400,
      height: 40,
    });
  });
  const pageSelector = engine === "native" ? ".gp-sheet" : ".pagedjs_page";
  const pages = [...document.querySelectorAll(pageSelector)];
  pages.forEach((el, i) => {
    el.getBoundingClientRect = () => ({
      top: i * 1000 - state.scrollY,
      bottom: i * 1000 - state.scrollY + 900,
      left: 0,
      right: 400,
      width: 400,
      height: 900,
    });
  });
  window.innerHeight = 900;

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
 // Paged.js has been removed (native-only-migration-plan.md Phase 6) — native
 // is the only engine now; the loop stays (rather than being flattened) so a
 // future second engine slots back in with minimal diff.
 for (const engine of ["native"]) {
  // ── 1. Chapter-scoped line resolution (the critical correctness property) ──
  {
    const { api, scrolls } = setup(undefined, engine);

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
    const { api, state } = setup(undefined, engine);
    // Slide so chapter b's <h1> (4th block, top=300) sits at the viewport top.
    state.scrollY = 300;
    const vs = api.getVisibleSource();
    assert.equal(vs.chapter, "b.md", "top-visible chapter is b");
    assert.equal(vs.sourceLine, 1, "top-visible source line is b's line 1");
    assert.equal(vs.page, 2);

    // Scrolled INTO a block: the reported line interpolates toward the next
    // annotated block instead of snapping to the block's start line (RC1-5).
    // b's h1 (line 1) top=-50, next block (line 4) top=+50, ref=4 →
    // fraction 54/100 → line 1 + round(0.54 * 3) = 3.
    state.scrollY = 350;
    const mid = api.getVisibleSource();
    assert.equal(mid.chapter, "b.md");
    assert.equal(mid.sourceLine, 3, "line interpolates within the straddled block");
  }

  // ── 3. getOutline returns headings with chapter + page ────────────────────
  {
    const { api } = setup(undefined, engine);
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
    const { api } = setup(undefined, engine);
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
    const { api, window, state } = setup(undefined, engine);
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
      pageWrap(engine, 1, '<div data-chapter-src="a.md"><p data-source-line="9">end of a</p></div>') +
      pageWrap(engine, 2, '<div data-chapter-src="b.md"><p data-source-line="20">b starts after front matter</p></div>');
    const { api, state } = setup(crossChapterLines, engine);
    state.scrollY = 50;
    assert.deepEqual(api.getVisibleSource(), {
      sourceLine: 9,
      chapter: "a.md",
      page: 1,
    }, "a numerically higher line in the next chapter is not an interpolation endpoint");
  }

  // ── 7. A reader scroll during a programmatic guard is deferred, not lost ──
  {
    const { api, window, state } = setup(undefined, engine);
    let detail = null;
    window.addEventListener("sourceLineChanged", (e) => (detail = e.detail));
    api.setZoom("0.8");
    state.scrollY = 300;
    window.dispatchEvent(new window.Event("scroll"));
    await new Promise((r) => setTimeout(r, 380));
    assert.equal(detail?.chapter, "b.md");
    assert.equal(detail?.sourceLine, 1);
  }

  console.log(`preview-bridge.test.mjs: all assertions passed (engine: ${engine})`);
 }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
