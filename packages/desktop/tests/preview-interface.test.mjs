#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

// Resolve relative to THIS FILE, not process.cwd() — the test must pass no
// matter where bun/node is invoked from (zero-tolerance: bare `bun test`
// from the repo root previously failed on this).
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
  "preview-interface.js"
);
const scriptSource = readFileSync(scriptPath, "utf8");
const bridgeSource = readFileSync(
  path.resolve(__dirname, "..", "..", "cli", "src", "assets", "preview", "scripts", "preview-bridge.js"),
  "utf8",
);

// A `.gp-sheet`, keyed by its 1-based `dataset.page` (the same value the
// real viewer's decorate.ts
// stamps on each sheet) rather than DOM order.
function makeSheet(page, offsetWidth = 400, offsetHeight = 600) {
  return {
    dataset: { page: String(page) },
    offsetWidth,
    offsetHeight,
    scrollIntoViewCalls: [],
    scrollIntoView(opts) {
      this.scrollIntoViewCalls.push(opts);
    },
  };
}

// Loads preview-interface.js with a `script[src*="/engine/gutterpress-viewer.js"]`
// tag present (the NATIVE_ENGINE detection signal) and a minimal
// window.Gutterpress stub, against `.gp-sheet` fixtures.
function loadNativePreviewApi(sheets, runs = []) {
  const listeners = new Map();

  const document = {
    body: { classList: { add() {}, remove() {} } },
    documentElement: { scrollTop: 0, clientWidth: 385, style: { setProperty() {} } },
    querySelectorAll(selector) {
      if (selector === ".gp-sheet") return sheets;
      if (selector === ".gp-run") return runs;
      return [];
    },
    querySelector(selector) {
      if (selector === 'script[src*="/engine/gutterpress-viewer.js"]') return {};
      return null;
    },
  };

  const windowObj = {
    document,
    innerHeight: 900,
    scrollY: 0,
    previewAPI: undefined,
    location: { search: "" },
    parent: { postMessage() {} },
    print() {},
    Gutterpress: {
      // 0-based, matching engine/viewer/fragment.ts's pageOf() contract.
      pageOf: (el) => sheets.indexOf(el),
    },
    scrollTo(_x, y) {
      this.scrollY = y;
      document.documentElement.scrollTop = y;
    },
    requestAnimationFrame(cb) {
      cb();
      return 1;
    },
    addEventListener(name, fn) {
      listeners.set(name, [...(listeners.get(name) ?? []), fn]);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) ?? []) fn(event);
    },
  };

  for (const [i, s] of sheets.entries()) {
    s.getBoundingClientRect = () => ({
      top: i * 900 - windowObj.scrollY,
      bottom: i * 900 - windowObj.scrollY + s.offsetHeight,
      left: 0,
      right: s.offsetWidth,
      width: s.offsetWidth,
      height: s.offsetHeight,
    });
  }

  class CustomEventStub {
    constructor(type, init = {}) {
      this.type = type;
      this.detail = init.detail;
    }
  }
  class MutationObserverStub {
    constructor(_callback) {}
    observe() {}
    disconnect() {}
  }

  const run = new Function(
    "window",
    "document",
    "CustomEvent",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    "getComputedStyle",
    scriptSource
  );
  run(
    windowObj,
    document,
    CustomEventStub,
    MutationObserverStub,
    setTimeout,
    clearTimeout,
    (el) => ({ getPropertyValue: (name) => name === "--gp-sheet-gap" ? String(el.sheetGap ?? 0) : "" }),
  );

  return { windowObj, sheets, api: windowObj.previewAPI };
}

// Real DOM (happy-dom) loader for getContextTargetAt() / contextMenuRequested
// tests (protocol v4, docs/inline-editing-plan.md §3.1): resolution walks
// closest()/classList/getAttribute against real elements, which a hand-mock
// can't cheaply reproduce faithfully. Mirrors preview-bridge.test.mjs's
// setup() pattern, which loads this SAME script the same way.
// `opts.native`: install the NATIVE_ENGINE detection tag plus a
// window.Gutterpress stub (pageOf + refresh) before the script runs, so the
// page-resolution and re-fragmentation paths have something to call.
function loadInterfaceWithDom(html, opts = {}) {
  const window = new Window({ url: "http://localhost/" });
  const document = window.document;
  if (opts.native) {
    document.head.innerHTML = '<script src="/engine/gutterpress-viewer.js"></script>';
    // `refresh` is the viewer's re-fragment entry point; in-flow editing calls
    // it after every DOM mutation (ADR 0009 decision 4, as revised), so tests
    // that care can count the calls.
    window.Gutterpress = { pageOf: opts.pageOf || (() => -1), refresh: opts.refresh || (() => {}) };
  }
  document.body.innerHTML = html;
  // happy-dom implements elementFromPoint() but has no layout engine, so it
  // always returns null — tests set it explicitly per case to the element
  // under test; real hit-testing geometry is not what this suite verifies.
  document.elementFromPoint = () => null;
  const run = new Function(
    "window",
    "document",
    "CustomEvent",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    scriptSource
  );
  run(window, document, window.CustomEvent, window.MutationObserver, setTimeout, clearTimeout);
  return { window, document, api: window.previewAPI };
}

async function main() {
  // ── Navigation, driven off .gp-sheet elements + window.Gutterpress ────────
  {
    const sheets = [makeSheet(1), makeSheet(2), makeSheet(3), makeSheet(4)];
    const { api } = loadNativePreviewApi(sheets);
    api.setViewMode("single", true);
    assert.equal(api.getTotalPages(), 4, "native: page count comes from .gp-sheet elements");
    api.goToPage(3);
    assert.equal(api.getCurrentPage(), 3);
    assert.equal(sheets[2].scrollIntoViewCalls.length, 1, "native: goToPage scrolls the matching sheet");
    api.nextPage();
    assert.equal(api.getCurrentPage(), 4);
    api.prevPage();
    assert.equal(api.getCurrentPage(), 3);
    assert.deepEqual(
      api.getPageDimensions(),
      { width: 400, height: 600, viewportWidth: 385 },
      "native: single-view dimensions come straight off one sheet"
    );
  }

  {
    const sheets = [makeSheet(1), makeSheet(2)];
    sheets[0].offsetLeft = 0;
    sheets[1].offsetLeft = 426;
    const { api } = loadNativePreviewApi(sheets, [{
      offsetWidth: 850,
      sheetGap: 24,
      querySelectorAll: () => sheets,
    }]);
    api.setViewMode("two-column", true);
    assert.deepEqual(
      api.getPageDimensions(),
      { width: 826, height: 600, viewportWidth: 385 },
      "native: two-column dimensions exclude the run's trailing sheet gap"
    );
  }

  {
    // .gp-sheet insertion order need not match page order (draw() appends
    // per-strip); refreshPages() must sort by dataset.page, not DOM order.
    const sheets = [makeSheet(2), makeSheet(1)];
    const { api } = loadNativePreviewApi(sheets);
    assert.equal(api.getTotalPages(), 2);
    api.goToPage(1);
    assert.equal(sheets[1].scrollIntoViewCalls.length, 1, "page 1 is the sheet with dataset.page===\"1\", not DOM order");
  }

  console.log("[desktop-test] PASS native-engine page navigation");

  // ── getContextTargetAt: kind precedence + payload shape (protocol v4,
  // docs/inline-editing-plan.md §3.1) ────────────────────────────────────────
  const contextHtml = `
    <div class="gp-test-root">
      <div class="gp-test-page">
        <div class="chapter" data-chapter-src="a.md" data-source-range="0:12" data-ref="chapter-ref">
          <div class="page" data-source-range="0:12" data-ref="page-ref">
            <p id="plain" data-source-range="1:2" data-ref="plain-ref">Just a plain paragraph.</p>
            <p id="para" data-source-range="2:3" data-ref="para-ref">Hello <a id="lnk" href="https://example.com/x" data-gp-source-token="[link text](https://example.com/x)" data-gp-source-occurrence="0">link text</a> and <img id="img" src="art.jpg" alt="Art" data-gp-source-token="![Art](art.jpg)" data-gp-source-occurrence="1"> <img id="bad-source" src="raw.jpg" data-gp-source-token="![Victim](x.png)" data-gp-source-occurrence="oops"> world.</p>
            <div class="gp-page-break" data-source-range="3:4" data-ref="break-ref" aria-hidden="true"></div>
            <pre id="pre" data-ref="pre-ref"><code id="code" data-source-range="4:5" data-ref="code-ref">const x = 1;</code></pre>
            <p id="frag1" data-source-range="5:7" data-ref="split-ref">first half</p>
            <p id="frag2" data-source-range="5:7" data-ref="split-ref" data-split-from="split-ref">second half</p>
          </div>
        </div>
      </div>
      <div class="gp-test-margin"><span id="running">Running header</span></div>
    </div>`;

  // kind: 'block'
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("plain");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "block");
    assert.deepEqual(detail.range, [1, 2]);
    assert.equal(detail.chapter, "a.md");
    assert.equal(detail.blockTag, "p");
    assert.equal(detail.split, false);
    assert.equal(detail.image, null);
    assert.equal(detail.link, null);
    assert.equal(detail.selection, null);
    assert.ok(detail.rect && typeof detail.rect.top === "number");
    assert.equal(Object.getPrototypeOf(detail.rect), Object.prototype, "rect is a plain object, not a DOMRect");
  }

  // Malformed coordinates fail closed instead of being coerced to occurrence 0.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("bad-source");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "image");
    assert.equal(detail.image.source, null);
  }

  // kind: 'image' — wins over 'block' even though the <img> sits inside an annotated <p>.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("img");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "image");
    assert.deepEqual(detail.image, {
      src: "art.jpg",
      alt: "Art",
      source: { token: "![Art](art.jpg)", occurrence: 1 },
    });
    assert.deepEqual(detail.range, [2, 3], "the enclosing block's range still resolves");
    assert.equal(detail.blockTag, "p");
    assert.equal(detail.link, null);
  }

  // kind: 'link' — wins over 'block'.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("lnk");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "link");
    assert.deepEqual(detail.link, {
      href: "https://example.com/x",
      text: "link text",
      source: { token: "[link text](https://example.com/x)", occurrence: 0 },
    });
    assert.equal(detail.image, null);
  }

  // kind: 'marker' — a layout wrapper/break class.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.querySelector(".gp-page-break");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "marker");
    assert.deepEqual(detail.range, [3, 4]);
  }

  // kind: 'none' — no [data-source-range] ancestor (margin box content, e.g.
  // a running header) keeps native browser behavior.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("running");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "none");
    assert.equal(detail.range, null);
    assert.equal(detail.chapter, null);
    assert.equal(detail.blockTag, null);
  }

  // kind: 'none' — no element at all under the point (elementFromPoint finds nothing).
  {
    const { api } = loadInterfaceWithDom(contextHtml); // loader's default elementFromPoint already returns null
    const detail = api.getContextTargetAt({ x: 9999, y: 9999 });
    assert.equal(detail.kind, "none");
    assert.equal(detail.rect, null);
  }

  // Fence gotcha (§2.6): a click on <pre>'s padding hits <pre> itself, which
  // never carries data-source-range (the fence renderer puts attrs on the
  // inner <code>) — must resolve to the annotated <code> descendant, not
  // climb to a coarser ancestor.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("pre");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "block");
    assert.equal(detail.blockTag, "code", "resolves to the <code> descendant, not <pre>");
    assert.deepEqual(detail.range, [4, 5]);
  }
  // A click directly on the <code> resolves identically.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("code");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.blockTag, "code");
  }

  // The fragmenter MOVES elements into strips rather than cloning them — a
  // block that visually spans pages is still exactly ONE element, so split is
  // always false, even on an element carrying a stale data-split-from
  // attribute.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("frag1");
    const d1 = api.getContextTargetAt({ x: 1, y: 1 });
    document.elementFromPoint = () => document.getElementById("frag2");
    const d2 = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(d1.split, false);
    assert.equal(d2.split, false);
    assert.deepEqual(d1.range, d2.range, "both fragments carry the same data-source-range");
  }

  // JSON-cloneability: the payload crosses two postMessage boundaries — no
  // DOM nodes, no functions, no DOMRect instances.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("plain");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    const roundTripped = JSON.parse(JSON.stringify(detail));
    assert.deepEqual(roundTripped, detail);
  }

  // kind: 'selection' — wins over image/link/block regardless of the point.
  {
    const html = `<div class="chapter" data-chapter-src="a.md" data-source-range="0:1" data-ref="c">
      <p id="para" data-source-range="0:1" data-ref="p1">Hello world</p>
      <p id="other" data-source-range="1:2" data-ref="p2">Second para</p>
    </div>`;
    const { window, document, api } = loadInterfaceWithDom(html);
    const para = document.getElementById("para");
    const range = document.createRange();
    range.setStart(para.firstChild, 0);
    range.setEnd(para.firstChild, 5);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    // Point at an unrelated element — selection still wins per the decided kind precedence.
    document.elementFromPoint = () => document.getElementById("other");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "selection");
    assert.equal(detail.selection.text, "Hello");
    assert.equal(detail.selection.withinSingleBlock, true);
    assert.deepEqual(detail.selection.range, [0, 1]);
    assert.equal(detail.selection.chapter, "a.md");
    // The point's own block info is still reported (secondary items).
    assert.deepEqual(detail.range, [1, 2]);
  }

  // selection spanning two blocks: withinSingleBlock is false, never Range.toString().
  {
    const html = `<div class="chapter" data-chapter-src="a.md" data-source-range="0:1" data-ref="c">
      <p id="p1" data-source-range="0:1" data-ref="p1">First paragraph</p>
      <p id="p2" data-source-range="1:2" data-ref="p2">Second paragraph</p>
    </div>`;
    const { window, document, api } = loadInterfaceWithDom(html);
    const p1 = document.getElementById("p1");
    const p2 = document.getElementById("p2");
    const range = document.createRange();
    range.setStart(p1.firstChild, 0);
    range.setEnd(p2.firstChild, 6);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    document.elementFromPoint = () => p1;
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "selection");
    assert.equal(detail.selection.withinSingleBlock, false);
    assert.equal(detail.selection.range, null);
    assert.equal(detail.selection.chapter, null);
  }

  // getProtocolVersion() is at least 4 (getContextTargetAt's own protocol
  // floor) — the exact current value is asserted once, definitively, by the
  // "protocol v8" check further down; this just pins the v4 floor here so a
  // future regression in THIS section's own feature set is caught locally.
  {
    const { api } = loadInterfaceWithDom("<p>x</p>");
    assert.ok(api.getProtocolVersion() >= 4);
  }

  console.log("[desktop-test] PASS getContextTargetAt kind precedence + protocol v4");

  // ── @page marker reachability (protocol v7): the pageMarker secondary
  // field + the margin-band fallback ─────────────────────────────────────────
  const pageMarkerHtml = `
    <div class="gp-run">
      <div class="gp-layer"><div class="gp-sheet" data-page="1"></div></div>
      <div class="gp-strip">
        <div class="chapter" data-chapter-src="a.md" data-source-range="0:1">
          <div class="page" id="pg" data-source-range="2:3">
            <div class="section" id="sec" data-source-range="4:5">
              <p id="inner" data-source-range="6:8">Body text</p>
            </div>
          </div>
        </div>
      </div>
    </div>`;

  // pageMarker is populated from the ENCLOSING .page even when the innermost
  // annotated block (here a paragraph inside a @section) wins the primary
  // slot — resolveAnnotatedBlock() alone can never surface the @page marker
  // from inside a section.
  {
    const { document, api } = loadInterfaceWithDom(pageMarkerHtml);
    document.elementFromPoint = () => document.getElementById("inner");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "block");
    assert.deepEqual(detail.range, [6, 8]);
    assert.deepEqual(detail.pageMarker, {
      chapter: "a.md",
      range: [2, 3],
      blockTag: "div",
    });
    const roundTripped = JSON.parse(JSON.stringify(detail));
    assert.deepEqual(roundTripped, detail, "pageMarker stays JSON-cloneable");
  }

  // A hit on the .page itself: the primary target IS the page marker, and
  // pageMarker reports the same range (the SPA suppresses the duplicate).
  {
    const { document, api } = loadInterfaceWithDom(pageMarkerHtml);
    document.elementFromPoint = () => document.getElementById("pg");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "marker");
    assert.deepEqual(detail.range, [2, 3]);
    assert.deepEqual(detail.pageMarker.range, [2, 3]);
  }

  // No enclosing page wrapper: pageMarker is null.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("running");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "none");
    assert.equal(detail.pageMarker, null);
  }

  // Margin band: a point inside a .gp-sheet's box but outside every author
  // box (the hit lands on un-annotated chrome/body) resolves to the sheet's
  // owning .page — right-click anywhere on the paper reaches the @page
  // marker. happy-dom has no layout, so the geometric rects are stubbed:
  // the sheet covers 0,0-400,600 and the page's content box 50,50-350,550.
  {
    const { document, api } = loadInterfaceWithDom(pageMarkerHtml);
    const sheet = document.querySelector(".gp-sheet");
    sheet.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600 });
    const pg = document.getElementById("pg");
    pg.getClientRects = () => [];
    pg.getBoundingClientRect = () => ({ left: 50, top: 50, right: 350, bottom: 550, width: 300, height: 500 });
    // The margin-band hit: the strip box itself (never annotated).
    document.elementFromPoint = () => document.querySelector(".gp-strip");
    const detail = api.getContextTargetAt({ x: 10, y: 10 });
    assert.equal(detail.kind, "marker", "margin band resolves to the owning .page marker");
    assert.deepEqual(detail.range, [2, 3]);
    assert.equal(detail.chapter, "a.md");
  }

  // Margin band over a page with NO author @page wrapper: nothing to offer —
  // kind stays 'none' and native browser behavior is kept.
  {
    const html = `
      <div class="gp-run">
        <div class="gp-layer"><div class="gp-sheet" data-page="1"></div></div>
        <div class="gp-strip">
          <div class="chapter" data-chapter-src="a.md" data-source-range="0:1">
            <p id="plain" data-source-range="1:2">Flowed content, no page wrapper.</p>
          </div>
        </div>
      </div>`;
    const { document, api } = loadInterfaceWithDom(html);
    const sheet = document.querySelector(".gp-sheet");
    sheet.getBoundingClientRect = () => ({ left: 0, top: 0, right: 400, bottom: 600, width: 400, height: 600 });
    document.elementFromPoint = () => document.querySelector(".gp-strip");
    const detail = api.getContextTargetAt({ x: 10, y: 10 });
    assert.equal(detail.kind, "none");
    assert.equal(detail.pageMarker, null);
  }

  console.log("[desktop-test] PASS @page marker reachability (protocol v7)");

  // ── Behind-layered images (`.gp-behind`, z-index:-1): the elementsFromPoint
  // hit-stack probe. A plate layered under the page's own text NEVER wins
  // elementFromPoint — the covering paragraph/page box does — so before the
  // probe the image context menu was unreachable at EVERY point. happy-dom has
  // no elementsFromPoint (and no layout engine), so each case stubs the full
  // stack explicitly, top-most first, the way a real browser reports it. The
  // fixture's <style> gives .gp-behind its real computed z-index (-1 via the
  // --gp-z-behind ladder, exactly as gutterpress-css.ts defines it).
  const behindHtml = `
    <style>:root { --gp-z-behind: -1; } .gp-behind { z-index: var(--gp-z-behind); }</style>
    <div class="chapter" data-chapter-src="a.md" data-source-range="0:20">
      <div class="page" data-source-range="0:20">
        <p id="plate-block" data-source-range="1:2"><img id="plate" class="gp-pin gp-behind" src="plate.jpg" alt="Backdrop" data-gp-source-token="![Backdrop](plate.jpg)" data-gp-source-occurrence="0"></p>
        <p id="upper-block" data-source-range="2:3"><img id="upper" class="gp-pin gp-behind" src="upper.jpg" alt="Upper" data-gp-source-token="![Upper](upper.jpg)" data-gp-source-occurrence="0"></p>
        <p id="cover" data-source-line="3" data-source-range="3:4">Body text over the plate <a id="cover-link" href="https://example.com/" data-gp-source-token="[x](https://example.com/)" data-gp-source-occurrence="0">x</a></p>
        <p id="inflow-block" data-source-range="4:5"><img id="inflow" src="art.jpg" alt="Art" data-gp-source-token="![Art](art.jpg)" data-gp-source-occurrence="0"></p>
      </div>
    </div>
    <div class="gp-marginbox" data-box="bottom-center"><span id="folio">7</span></div>`;

  // THE regression: a right-click point covered by a text block still resolves
  // the gp-behind image beneath it — kind 'image', and the payload targets the
  // IMAGE's own annotated block, not the covering paragraph's.
  {
    const { document, api } = loadInterfaceWithDom(behindHtml);
    const cover = document.getElementById("cover");
    document.elementFromPoint = () => cover;
    document.elementsFromPoint = () => [
      cover,
      document.querySelector(".page"),
      document.querySelector(".chapter"),
      document.getElementById("plate"),
      document.body,
    ];
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "image", "buried gp-behind image wins over the covering text block");
    assert.deepEqual(detail.image, {
      src: "plate.jpg",
      alt: "Backdrop",
      source: { token: "![Backdrop](plate.jpg)", occurrence: 0 },
    });
    assert.deepEqual(detail.range, [1, 2], "range targets the plate's OWN block, not the covering paragraph's");
    assert.equal(detail.blockTag, "p");
    assert.equal(detail.chapter, "a.md");
    assert.equal(detail.link, null, "the covering paragraph's link is NOT misattributed to the image");
    assert.deepEqual(JSON.parse(JSON.stringify(detail)), detail, "payload stays JSON-cloneable");
  }

  // Two overlapping plates: the TOP-MOST one in paint order (first in the
  // elementsFromPoint stack) wins.
  {
    const { document, api } = loadInterfaceWithDom(behindHtml);
    const cover = document.getElementById("cover");
    document.elementsFromPoint = () => [
      cover,
      document.querySelector(".page"),
      document.getElementById("upper"),
      document.getElementById("plate"),
      document.body,
    ];
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "image");
    assert.equal(detail.image.src, "upper.jpg", "the upper of two overlapping plates wins");
    assert.deepEqual(detail.range, [2, 3]);
  }

  // A normally-layered image (z-index auto) beneath the point is NOT
  // preferred: it is already reachable at its uncovered points, and stealing
  // the covering content's right-clicks would invert the bug.
  {
    const { document, api } = loadInterfaceWithDom(behindHtml);
    const cover = document.getElementById("cover");
    document.elementsFromPoint = () => [
      cover,
      document.querySelector(".page"),
      document.getElementById("inflow"),
      document.body,
    ];
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "block");
    assert.deepEqual(detail.range, [3, 4], "the covering paragraph keeps the click");
    assert.equal(detail.image, null);
  }

  // A right-click ON a link's own text keeps the link menu even over a plate
  // (visible interactive content is never probed beneath).
  {
    const { document, api } = loadInterfaceWithDom(behindHtml);
    const link = document.getElementById("cover-link");
    document.elementsFromPoint = () => [
      link,
      document.getElementById("cover"),
      document.querySelector(".page"),
      document.getElementById("plate"),
      document.body,
    ];
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "link");
    assert.equal(detail.link.href, "https://example.com/");
    assert.equal(detail.image, null);
  }

  // Margin-box furniture keeps its native-menu contract (kind 'none', no
  // preventDefault) even when a full-bleed plate runs beneath it.
  {
    const { window, document } = loadInterfaceWithDom(behindHtml);
    const folio = document.getElementById("folio");
    document.elementFromPoint = () => folio;
    document.elementsFromPoint = () => [
      folio,
      document.querySelector(".gp-marginbox"),
      document.getElementById("plate"),
      document.body,
    ];
    let received = null;
    window.addEventListener("contextMenuRequested", (e) => {
      received = e.detail;
    });
    const ev = new window.MouseEvent("contextmenu", { clientX: 1, clientY: 1, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, false, "native copy on furniture text survives a plate beneath it");
    assert.equal(received, null);
  }

  // Mouse listener end-to-end: right-click over the covered plate dispatches
  // the image menu request and suppresses the native menu.
  {
    const { window, document } = loadInterfaceWithDom(behindHtml);
    const cover = document.getElementById("cover");
    document.elementsFromPoint = () => [cover, document.querySelector(".page"), document.getElementById("plate")];
    let received = null;
    window.addEventListener("contextMenuRequested", (e) => {
      received = e.detail;
    });
    const ev = new window.MouseEvent("contextmenu", { clientX: 12, clientY: 34, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    assert.ok(ev.defaultPrevented);
    assert.ok(received);
    assert.equal(received.kind, "image");
    assert.equal(received.image.src, "plate.jpg");
    assert.equal(received.via, "mouse");
  }

  // The keyboard path opts OUT of the probe: its anchor is a synthetic
  // block-center point, not a user-aimed pointer position — Shift+F10 on a
  // page with a background plate must still target the anchor block.
  {
    const { window, document } = loadInterfaceWithDom(behindHtml);
    const cover = document.getElementById("cover");
    cover.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 40, right: 400, width: 400, height: 40 });
    window.innerHeight = 900;
    document.elementFromPoint = () => cover;
    document.elementsFromPoint = () => [cover, document.querySelector(".page"), document.getElementById("plate")];
    let received = null;
    window.addEventListener("contextMenuRequested", (e) => {
      received = e.detail;
    });
    const ev = new window.KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    assert.ok(received);
    assert.equal(received.kind, "block", "keyboard menus never get hijacked by a plate under the anchor");
    assert.deepEqual(received.range, [3, 4]);
  }

  // Hosts without elementsFromPoint degrade to the old single-element hit
  // (the plate stays unreachable there, but nothing else regresses). This is
  // also the path every OTHER case in this file exercises, since happy-dom
  // ships no elementsFromPoint.
  {
    const { document, api } = loadInterfaceWithDom(behindHtml);
    assert.equal(typeof document.elementsFromPoint, "undefined", "precondition: happy-dom has no elementsFromPoint");
    document.elementFromPoint = () => document.getElementById("cover");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "block");
    assert.deepEqual(detail.range, [3, 4]);
  }

  console.log("[desktop-test] PASS gp-behind image hit-stack probe (elementsFromPoint)");

  // ── contextmenu listener: preventDefault + dispatch only when kind !== 'none' ─
  {
    const html = `
      <div class="chapter" data-chapter-src="a.md" data-source-range="0:1" data-ref="c">
        <p id="para" data-source-range="0:1" data-ref="p1">Hello</p>
      </div>
      <div class="gp-test-margin"><span id="running">Header</span></div>`;
    const { window, document } = loadInterfaceWithDom(html);
    const para = document.getElementById("para");

    let received = null;
    window.addEventListener("contextMenuRequested", (e) => {
      received = e.detail;
    });

    document.elementFromPoint = () => para;
    const ev1 = new window.MouseEvent("contextmenu", { clientX: 12, clientY: 34, bubbles: true, cancelable: true });
    document.dispatchEvent(ev1);
    assert.ok(ev1.defaultPrevented, "native menu suppressed for a real target");
    assert.ok(received, "contextMenuRequested dispatched");
    assert.equal(received.kind, "block");
    assert.equal(received.x, 12);
    assert.equal(received.y, 34);
    assert.equal(received.via, "mouse");

    // Page furniture (kind 'none'): native behavior preserved, no event dispatched.
    received = null;
    const running = document.getElementById("running");
    document.elementFromPoint = () => running;
    const ev2 = new window.MouseEvent("contextmenu", { clientX: 1, clientY: 1, bubbles: true, cancelable: true });
    document.dispatchEvent(ev2);
    assert.equal(ev2.defaultPrevented, false, "native context menu kept for page furniture");
    assert.equal(received, null, "no contextMenuRequested dispatched for kind 'none'");
  }

  // ── keydown listener: Shift+F10 / the dedicated ContextMenu key ────────────
  // Anchor resolution runs entirely inside this iframe (keyboard events
  // targeted at a focused element in a cross-origin iframe never reach the
  // parent SPA).
  {
    const html = `
      <div class="gp-test-root"><div class="gp-test-page">
        <div class="chapter" data-chapter-src="a.md" data-source-range="0:1" data-ref="c">
          <p id="para" data-source-line="1" data-source-range="0:1" data-ref="p1">Top of viewport</p>
        </div>
      </div></div>`;
    const { window, document, api } = loadInterfaceWithDom(html);
    const para = document.getElementById("para");
    para.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 40, right: 400, width: 400, height: 40 });
    window.innerHeight = 900;
    // topVisibleSourceEl() re-derives the anchor from its own rect; point
    // elementFromPoint at the same element so getContextTargetAt agrees.
    document.elementFromPoint = () => para;

    let received = null;
    window.addEventListener("contextMenuRequested", (e) => {
      received = e.detail;
    });

    const ev = new window.KeyboardEvent("keydown", { key: "F10", shiftKey: true, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    assert.ok(ev.defaultPrevented);
    assert.ok(received, "Shift+F10 dispatches contextMenuRequested");
    assert.equal(received.via, "keyboard");
    assert.equal(received.kind, "block");
    assert.deepEqual(received.range, [0, 1]);

    received = null;
    const ev2 = new window.KeyboardEvent("keydown", { key: "ContextMenu", bubbles: true, cancelable: true });
    document.dispatchEvent(ev2);
    assert.ok(received, "the ContextMenu key also dispatches");
    assert.equal(received.via, "keyboard");

    // An unrelated key is ignored.
    received = null;
    const ev3 = new window.KeyboardEvent("keydown", { key: "a", bubbles: true, cancelable: true });
    document.dispatchEvent(ev3);
    assert.equal(received, null);
  }

  console.log("[desktop-test] PASS contextMenuRequested mouse + keyboard listeners");

  // getProtocolVersion() bumped to 9 (SFE-P4: in-flow block editing deleted;
  // beginBlockEdit/endBlockEdit no longer exist on previewAPI at all — this is
  // the permanent post-deletion shape, not a feature-detect fallback).
  {
    const { api } = loadInterfaceWithDom("<p>x</p>");
    assert.equal(api.getProtocolVersion(), 9);
    assert.equal(api.beginBlockEdit, undefined, "in-flow block editing command removed");
    assert.equal(api.endBlockEdit, undefined, "in-flow block editing command removed");
    assert.equal(api.getRectsFor, undefined, "geometry command removed with the panel");
    assert.equal(api.setEditMask, undefined, "mask command removed with the panel");
  }

  console.log("[desktop-test] PASS protocol version 9 / block-edit commands absent");

  // The cross-origin bridge must forward the immediate viewport invalidation,
  // not merely emit it inside the iframe where desktop controllers cannot see it.
  {
    const listeners = new Map();
    const posted = [];
    const windowObj = {
      previewAPI: {},
      parent: { postMessage: (message) => posted.push(message) },
      addEventListener(name, fn) {
        listeners.set(name, [...(listeners.get(name) ?? []), fn]);
      },
      dispatchEvent(event) {
        for (const fn of listeners.get(event.type) ?? []) fn(event);
      },
      print() {},
    };
    const document = { documentElement: { style: {} } };
    const runBridge = new Function("window", "document", "setTimeout", bridgeSource);
    runBridge(windowObj, document, setTimeout);
    windowObj.dispatchEvent({ type: "viewportChanged", detail: { reason: "resize" } });
    assert.ok(posted.some((message) =>
      message.type === "gutterpress:event" &&
      message.name === "viewportChanged" &&
      message.detail.reason === "resize"
    ));
    console.log("[desktop-test] PASS bridge forwards viewportChanged");
  }
}

main().catch((error) => {
  console.error("[desktop-test] FAIL", error);
  process.exit(1);
});
