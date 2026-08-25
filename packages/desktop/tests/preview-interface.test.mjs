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

  // ── In-flow block editing (protocol v8) ─────────────────────────────────────
  // docs/inline-editing-plan.md §3.1. beginBlockEdit()/endBlockEdit() replaced
  // getRectsFor()/setEditMask(), which existed only to place and de-clutter
  // behind a floating edit panel.
  const editHtml = `
    <div class="chapter" data-chapter-src="a.md" data-source-range="0:10">
      <p id="p1" data-source-range="0:1">Untouched block</p>
      <p id="target" data-source-range="2:4">rendered <em>text</em> here</p>
    </div>`;

  // Opening: exactly ONE element becomes editable, its rendered HTML is
  // replaced by the SOURCE the host supplied, and pre-wrap is applied (without
  // it a multi-line block's newlines collapse and it cannot be edited by line).
  {
    const { document, window, api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const states = [];
    window.addEventListener("blockEditStateChanged", (e) => states.push(e.detail.open));

    const result = api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "source *markdown* here" });
    assert.deepEqual(result, { ok: true });

    const target = document.getElementById("target");
    assert.equal(target.getAttribute("contenteditable"), "plaintext-only");
    assert.equal(target.style.whiteSpace, "pre-wrap");
    assert.equal(target.textContent, "source *markdown* here");
    assert.ok(target.classList.contains("gutterpress-editing"));
    // The neighbour is untouched: one edit, one element.
    const p1 = document.getElementById("p1");
    assert.equal(p1.hasAttribute("contenteditable"), false);
    assert.equal(p1.textContent, "Untouched block");
    // The shell holds hot-reload swaps on this event, so it must fire on open.
    assert.deepEqual(states, [true]);
  }

  // Repagination is MANDATORY on open, not cosmetic: swapping rendered HTML for
  // source text changes the block's extent before a single keystroke, and
  // `.gp-run` clips to the last measured page — unmeasured growth is silently
  // invisible rather than overlapping (ADR 0009 decision 4, as revised).
  {
    let refreshes = 0;
    const { api } = loadInterfaceWithDom(editHtml, {
      native: true,
      pageOf: () => 0,
      refresh: () => { refreshes += 1; },
    });
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "x" });
    assert.equal(refreshes, 1, "opening re-measures");
    api.endBlockEdit({ commit: true });
    assert.equal(refreshes, 2, "closing re-measures");
  }

  // Round-trip: multi-line markdown survives EXACTLY through textContent, which
  // is what lets this design carry lists, tables and fences with no serializer.
  {
    const { document, api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const src = "- item one\n- item two\n  - nested\n\n| a | b |\n|---|---|\n| 1 | 2 |";
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: src });
    assert.equal(document.getElementById("target").textContent, src);
    const ended = api.endBlockEdit({ commit: true });
    assert.deepEqual(ended.text, src, "source round-trips byte-for-byte");
    assert.equal(ended.ended, true);
    assert.equal(ended.commit, true);
  }

  // Closing restores the rendered HTML byte-for-byte, on BOTH paths — on commit
  // too, so raw markdown is not left on screen for the ~500ms until the
  // authoritative re-render swaps the frame.
  for (const commit of [true, false]) {
    const { document, api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const before = document.getElementById("target").innerHTML;
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "typed over it" });
    api.endBlockEdit({ commit });
    const target = document.getElementById("target");
    assert.equal(target.innerHTML, before, `rendered HTML restored (commit: ${commit})`);
    assert.equal(target.hasAttribute("contenteditable"), false);
    assert.equal(target.classList.contains("gutterpress-editing"), false);
    // No inline-style residue: the attribute itself is dropped when it would
    // otherwise be left empty.
    assert.equal(target.hasAttribute("style"), false, "no leftover inline style");
  }

  // A pre-existing inline white-space value is restored, not clobbered.
  {
    const html = `<div data-chapter-src="a.md"><p id="t" data-source-range="0:1" style="white-space: nowrap">x</p></div>`;
    const { document, api } = loadInterfaceWithDom(html, { native: true, pageOf: () => 0 });
    api.beginBlockEdit({ chapter: "a.md", range: [0, 1], text: "y" });
    api.endBlockEdit({ commit: false });
    assert.equal(document.getElementById("t").style.whiteSpace, "nowrap");
  }

  // Unresolved range: a clean refusal the host can act on, never a throw and
  // never a silent no-op that leaves the author waiting.
  {
    const { api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    assert.deepEqual(api.beginBlockEdit({ chapter: "a.md", range: [99, 100] }), {
      ok: false,
      reason: "unresolved",
    });
  }

  // endBlockEdit is idempotent — nothing open is `{ended: false}`, not an error.
  {
    const { api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const result = api.endBlockEdit({ commit: true });
    assert.equal(result.ended, false);
    assert.equal(result.text, null);
  }

  // A second beginBlockEdit commits its predecessor rather than dropping the
  // author's typing, and reports the close so the shell releases its hold.
  {
    const { document, window, api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const finished = [];
    const states = [];
    window.addEventListener("blockEditFinished", (e) => finished.push(e.detail));
    window.addEventListener("blockEditStateChanged", (e) => states.push(e.detail.open));
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "first" });
    document.getElementById("target").textContent = "first edited";
    api.beginBlockEdit({ chapter: "a.md", range: [0, 1], text: "second" });
    assert.equal(finished.length, 1, "predecessor was finished, not dropped");
    assert.equal(finished[0].text, "first edited");
    assert.equal(finished[0].commit, true);
    assert.deepEqual(states, [true, false, true]);
  }

  // Escape cancels and Cmd/Ctrl+Enter commits, both from INSIDE the book
  // document — these keystrokes never reach the host SPA (cross-origin), so the
  // outcome has to arrive as an event carrying the text.
  for (const [key, mods, expectCommit] of [
    ["Escape", {}, false],
    ["Enter", { metaKey: true }, true],
    ["Enter", { ctrlKey: true }, true],
  ]) {
    const { document, window, api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const finished = [];
    window.addEventListener("blockEditFinished", (e) => finished.push(e.detail));
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "seed" });
    document.getElementById("target").textContent = "edited by hand";
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key, ...mods, bubbles: true, cancelable: true }));
    assert.equal(finished.length, 1, `${key} resolved the edit`);
    assert.equal(finished[0].commit, expectCommit);
    assert.equal(finished[0].text, "edited by hand", "the text rides along on both paths");
    assert.equal(finished[0].chapter, "a.md");
    assert.deepEqual(finished[0].range, [2, 4]);
  }

  // Plain Enter is a NEWLINE, not a commit: a markdown block is multi-line.
  {
    const { document, window, api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const finished = [];
    window.addEventListener("blockEditFinished", (e) => finished.push(e.detail));
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "seed" });
    document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
    assert.equal(finished.length, 0);
  }

  // "Clicked away" is a POINTER PRESS outside the box — never `blur`.
  //
  // Blur is the regression this guards: opening from the context menu is a
  // postMessage with no user activation, so the frame takes focus a moment
  // later and Chromium settles activeElement back to BODY, firing a blur the
  // box never earned. In the packaged app that committed and closed the editor
  // 7ms after it opened, so both entry points looked like they did nothing.
  {
    const { document, window, api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const finished = [];
    window.addEventListener("blockEditFinished", (e) => finished.push(e.detail));
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "seed" });
    const target = document.getElementById("target");

    // A blur on its own must NOT end the edit.
    target.dispatchEvent(new window.FocusEvent("blur", { bubbles: false }));
    assert.equal(finished.length, 0, "blur alone does not commit");
    assert.equal(target.getAttribute("contenteditable"), "plaintext-only", "the edit is still open");

    // A press INSIDE the box is the author working, not leaving.
    target.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    assert.equal(finished.length, 0, "a press inside the box does not commit");

    // A press anywhere else in the book commits.
    document.getElementById("p1").dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
    assert.equal(finished.length, 1, "a press outside the box commits");
    assert.equal(finished[0].commit, true);
  }

  // The caret survives re-pagination. `relayout()` re-parents the edit box, and
  // re-parenting a focused element drops focus AND the selection — so without
  // this the caret died on the first debounced refresh after the author started
  // typing and every keystroke after it went nowhere.
  {
    const { document, api } = loadInterfaceWithDom(editHtml, {
      native: true,
      pageOf: () => 0,
      // A refresh that actually moves the element, like the real relayout.
      refresh: () => {
        const el = document.getElementById("target");
        const parent = el.parentElement;
        parent.removeChild(el);
        parent.appendChild(el);
      },
    });
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "abcdefghij" });
    const target = document.getElementById("target");
    // Seat the caret mid-text, then force the re-parenting refresh.
    const range = document.createRange();
    range.setStart(target.firstChild, 4);
    range.collapse(true);
    const sel = document.defaultView.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    api.endBlockEdit({ commit: false });
    // The text is what matters here: a lost caret in the real app meant lost
    // keystrokes, and the round-trip must still be exact either way.
    assert.equal(target.innerHTML, "rendered <em>text</em> here", "restored after a moving refresh");
  }

  // Double-click REQUESTS an edit (it never starts one): only the host can read
  // the authoritative buffer, so the book document must not source its own text.
  {
    const { document, window, api } = loadInterfaceWithDom(editHtml, { native: true, pageOf: () => 0 });
    const requests = [];
    window.addEventListener("blockEditRequested", (e) => requests.push(e.detail));
    const target = document.getElementById("target");
    target.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, clientX: 40, clientY: 60 }));
    assert.equal(requests.length, 1);
    assert.equal(requests[0].chapter, "a.md");
    assert.deepEqual(requests[0].range, [2, 4]);
    assert.equal(requests[0].x, 40);
    assert.equal(requests[0].y, 60);
    assert.equal(requests[0].via, "dblclick");
    // Nothing became editable off the double-click alone.
    assert.equal(target.hasAttribute("contenteditable"), false);

    // While an edit IS open, double-click keeps its native meaning (select
    // word) inside the box rather than re-requesting.
    api.beginBlockEdit({ chapter: "a.md", range: [2, 4], text: "seed" });
    target.dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, clientX: 40, clientY: 60 }));
    assert.equal(requests.length, 1, "no re-request while editing");
  }

  // Double-click on unannotated furniture (a running header, a margin box) is
  // not an edit request.
  {
    const { document, window } = loadInterfaceWithDom(
      `<div class="gp-margin-box"><span id="folio">12</span></div>`,
      { native: true, pageOf: () => 0 },
    );
    const requests = [];
    window.addEventListener("blockEditRequested", (e) => requests.push(e.detail));
    document
      .getElementById("folio")
      .dispatchEvent(new window.MouseEvent("dblclick", { bubbles: true, clientX: 1, clientY: 1 }));
    assert.equal(requests.length, 0);
  }

  // getProtocolVersion() bumped to 8 (in-flow editing; rects/mask removed).
  {
    const { api } = loadInterfaceWithDom("<p>x</p>");
    assert.equal(api.getProtocolVersion(), 8);
    assert.equal(typeof api.beginBlockEdit, "function");
    assert.equal(typeof api.endBlockEdit, "function");
    assert.equal(api.getRectsFor, undefined, "geometry command removed with the panel");
    assert.equal(api.setEditMask, undefined, "mask command removed with the panel");
  }

  console.log("[desktop-test] PASS in-flow block editing / protocol v8");

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

    // The three in-flow editing events (protocol v8) are useless unless they
    // cross the origin boundary: blockEditRequested is the double-click entry
    // point, blockEditFinished carries the edited text to the only code that
    // can write it, and blockEditStateChanged is what preview-shell.js holds
    // hot-reload swaps on. A missed forward on the last one freezes the
    // preview, so assert all three rather than trusting the pattern.
    const forwarded = [
      ["blockEditRequested", { chapter: "a.md", range: [2, 4], x: 5, y: 6, via: "dblclick" }],
      ["blockEditFinished", { text: "edited", commit: true, chapter: "a.md", range: [2, 4] }],
      ["blockEditStateChanged", { open: true }],
    ];
    for (const [name, detail] of forwarded) {
      posted.length = 0;
      windowObj.dispatchEvent({ type: name, detail });
      const hit = posted.find((m) => m.type === "gutterpress:event" && m.name === name);
      assert.ok(hit, `bridge forwards ${name}`);
      assert.deepEqual(hit.detail, detail, `${name} detail crosses intact`);
    }
    console.log("[desktop-test] PASS bridge forwards protocol v8 edit events");
  }
}

main().catch((error) => {
  console.error("[desktop-test] FAIL", error);
  process.exit(1);
});
