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
// window.Gutterpress stub, against `.gp-sheet` fixtures instead of
// `.pagedjs_page`.
function loadNativePreviewApi(sheets) {
  const listeners = new Map();

  const document = {
    body: { classList: { add() {}, remove() {} } },
    documentElement: { scrollTop: 0, style: { setProperty() {} } },
    querySelectorAll(selector) {
      if (selector === ".gp-sheet") return sheets;
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
    scriptSource
  );
  run(windowObj, document, CustomEventStub, MutationObserverStub, setTimeout, clearTimeout);

  return { windowObj, sheets, api: windowObj.previewAPI };
}

// Real DOM (happy-dom) loader for getContextTargetAt() / contextMenuRequested
// tests (protocol v4, docs/inline-editing-plan.md §3.1): resolution walks
// closest()/classList/getAttribute against real elements, which a hand-mock
// can't cheaply reproduce faithfully. Mirrors preview-bridge.test.mjs's
// setup() pattern, which loads this SAME script the same way.
// `opts.native`: install the NATIVE_ENGINE detection tag plus a
// window.Gutterpress.pageOf() stub before the script runs, so getRectsFor()
// takes the native (no clone-grouping) path.
function loadInterfaceWithDom(html, opts = {}) {
  const window = new Window({ url: "http://localhost/" });
  const document = window.document;
  if (opts.native) {
    document.head.innerHTML = '<script src="/engine/gutterpress-viewer.js"></script>';
    window.Gutterpress = { pageOf: opts.pageOf || (() => -1) };
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
  // ── Native engine navigation, driven off .gp-sheet elements +
  // window.Gutterpress (Paged.js has been removed — see
  // native-only-migration-plan.md Phase 6) ────────────────────────────────────
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
      { width: 400, height: 600 },
      "native: dimensions come straight off the sheet — no wrapper-derived two-column width"
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

  // The native fragmenter MOVES elements into strips rather than cloning
  // them (unlike Paged.js, which cloned an element across pages and marked
  // the clone with data-split-from/-to) — a block that visually spans pages
  // is still exactly ONE element, so split is always false, even on an
  // element carrying a stale data-split-from attribute.
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
  // "protocol v6" check further down; this just pins the v4 floor here so a
  // future regression in THIS section's own feature set is caught locally.
  {
    const { api } = loadInterfaceWithDom("<p>x</p>");
    assert.ok(api.getProtocolVersion() >= 4);
  }

  console.log("[desktop-test] PASS getContextTargetAt kind precedence + protocol v4");

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

  // ── getRectsFor / setEditMask (protocol v6) ──────────────────────────────────
  // docs/inline-editing-plan.md §5.3. WORK PACKAGE B item 2 dropped `data-ref`
  // from the wire contract entirely — `{chapter, range}` is the only target
  // shape now, on both engines.
  const overlayHtml = `
    <div class="gp-test-root">
      <div class="gp-test-page">
        <div class="chapter" data-chapter-src="a.md" data-source-range="0:10">
          <p id="p1" data-source-range="0:1">Solo block</p>
          <p id="frag1" data-source-range="1:3">first half</p>
        </div>
      </div>
      <div class="gp-test-page">
        <div class="chapter" data-chapter-src="a.md" data-source-range="0:10">
          <p id="frag2" data-source-range="1:3" data-split-from="split">second half</p>
        </div>
      </div>
    </div>`;

  // getRectsFor is exercised against the native engine only, below (no
  // clone-grouping — the native viewer never clones an element across
  // pages, so a spec resolves to AT MOST ONE element).

  // setEditMask: masks EVERY fragment sharing a {chapter, range} + applies
  // the scroll lock, and unmasking fully reverts both — reversible, no
  // residue.
  {
    const { document, api } = loadInterfaceWithDom(overlayHtml);
    const frag1 = document.getElementById("frag1");
    const frag2 = document.getElementById("frag2");
    const root = document.documentElement;

    const onResult = api.setEditMask({ chapter: "a.md", range: [1, 3], masked: true });
    assert.equal(onResult.count, 2);
    assert.ok(frag1.classList.contains("gutterpress-edit-mask"));
    assert.ok(frag2.classList.contains("gutterpress-edit-mask"));
    assert.ok(root.classList.contains("gutterpress-edit-scroll-lock"));
    // An unmasked, unrelated fragment is untouched.
    const p1 = document.getElementById("p1");
    assert.equal(p1.classList.contains("gutterpress-edit-mask"), false);

    const offResult = api.setEditMask({ chapter: "a.md", range: [1, 3], masked: false });
    assert.equal(offResult.count, 2);
    assert.equal(frag1.classList.contains("gutterpress-edit-mask"), false);
    assert.equal(frag2.classList.contains("gutterpress-edit-mask"), false);
    assert.equal(root.classList.contains("gutterpress-edit-scroll-lock"), false, "scroll lock fully reverted");
  }

  // setEditMask({masked:false}) for a range with zero live fragments (e.g. a
  // splice already replaced the DOM) still clears the document-level scroll
  // lock — defense-in-depth teardown must not depend on the range resolving.
  {
    const { document, api } = loadInterfaceWithDom(overlayHtml);
    api.setEditMask({ chapter: "a.md", range: [1, 3], masked: true });
    assert.ok(document.documentElement.classList.contains("gutterpress-edit-scroll-lock"));
    const result = api.setEditMask({ chapter: "a.md", range: [999, 1000], masked: false });
    assert.equal(result.count, 0);
    assert.equal(
      document.documentElement.classList.contains("gutterpress-edit-scroll-lock"),
      false,
      "scroll lock is a document-level toggle, not scoped to the (now unresolved) range"
    );
  }

  // getProtocolVersion() bumped to 6.
  {
    const { api } = loadInterfaceWithDom("<p>x</p>");
    assert.equal(api.getProtocolVersion(), 6);
  }

  // ── Native engine getRectsFor: no clone-grouping — a spec resolves to AT
  // MOST ONE element, and its rects come straight from getClientRects() ──────
  const nativeOverlayHtml = `
    <div class="chapter" data-chapter-src="a.md" data-source-range="0:10">
      <p id="solo" data-source-range="0:1">Solo block</p>
    </div>`;

  {
    const { document, api } = loadInterfaceWithDom(nativeOverlayHtml, {
      native: true,
      pageOf: (el) => (el && el.id === "solo" ? 1 : -1), // 0-based -> reported page 2
    });
    const solo = document.getElementById("solo");
    solo.getClientRects = () => [{ top: 10, left: 5, bottom: 30, right: 100, width: 95, height: 20 }];
    const result = api.getRectsFor({ chapter: "a.md", range: [0, 1] });
    assert.deepEqual(result.rects, [{ top: 10, left: 5, width: 95, height: 20, page: 2 }]);
    assert.deepEqual(JSON.parse(JSON.stringify(result)), result, "JSON-cloneable, no DOMRect instances");
  }

  // Each client rect carries the page it actually intersects. A browser
  // column fragment can put one element's rects on adjacent sheets even
  // though Gutterpress.pageOf(el) can only report the element's start page.
  {
    const html = `
      <div class="gp-sheet" data-page="1"><div data-chapter-src="a.md"><p id="split" data-source-range="0:1">Split</p></div></div>
      <div class="gp-sheet" data-page="2"></div>`;
    const { window, document, api } = loadInterfaceWithDom(html, { native: true, pageOf: () => 0 });
    window.innerWidth = 800;
    window.innerHeight = 600;
    const sheets = [...document.querySelectorAll(".gp-sheet")];
    sheets[0].getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 0, right: 390, width: 390, height: 600 });
    sheets[1].getBoundingClientRect = () => ({ top: 0, bottom: 600, left: 410, right: 800, width: 390, height: 600 });
    const split = document.getElementById("split");
    split.getClientRects = () => [
      { top: 20, bottom: 60, left: 20, right: 370, width: 350, height: 40 },
      { top: 20, bottom: 60, left: 430, right: 780, width: 350, height: 40 },
    ];
    assert.deepEqual(api.getRectsFor({ chapter: "a.md", range: [0, 1] }), {
      rects: [
        { top: 20, left: 20, width: 350, height: 40, page: 1 },
        { top: 20, left: 430, width: 350, height: 40, page: 2 },
      ],
    });
  }

  // A fence's source identity lives on <code>, but its editable visual box is
  // the enclosing <pre>; line-box rects from <code> make the overlay tiny.
  {
    const html = `<div data-chapter-src="a.md"><pre id="pre"><code id="code" data-source-range="4:7">x\ny</code></pre></div>`;
    const { document, api } = loadInterfaceWithDom(html, { native: true, pageOf: () => 0 });
    const pre = document.getElementById("pre");
    const code = document.getElementById("code");
    pre.getClientRects = () => [{ top: 10, left: 20, bottom: 130, right: 420, width: 400, height: 120 }];
    code.getClientRects = () => [
      { top: 20, left: 30, bottom: 34, right: 80, width: 50, height: 14 },
      { top: 36, left: 30, bottom: 50, right: 80, width: 50, height: 14 },
    ];
    assert.deepEqual(api.getRectsFor({ chapter: "a.md", range: [4, 7] }), {
      rects: [{ top: 10, left: 20, width: 400, height: 120, page: 1 }],
    });
  }

  // Unmatched range: empty result, no throw.
  {
    const { api } = loadInterfaceWithDom(nativeOverlayHtml, { native: true });
    assert.deepEqual(api.getRectsFor({ chapter: "a.md", range: [99, 100] }), { rects: [] });
  }

  console.log("[desktop-test] PASS native-engine getRectsFor (no clone grouping)");

  console.log("[desktop-test] PASS getRectsFor / setEditMask / protocol v6");

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
  }
}

main().catch((error) => {
  console.error("[desktop-test] FAIL", error);
  process.exit(1);
});
