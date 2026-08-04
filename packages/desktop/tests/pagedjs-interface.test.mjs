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
  "pagedjs-interface.js"
);
const scriptSource = readFileSync(scriptPath, "utf8");

function makePage(offsetTop, offsetWidth = 400, offsetHeight = 600) {
  return {
    offsetTop,
    offsetWidth,
    offsetHeight,
    scrollIntoViewCalls: [],
    scrollIntoView(opts) {
      this.scrollIntoViewCalls.push(opts);
    },
  };
}

function loadPreviewApi(pages, pagesWidth = 808, search = "") {
  const listeners = new Map();
  const bodyClasses = new Set();
  const pagesEl = { scrollWidth: pagesWidth };

  const document = {
    body: {
      classList: {
        add: (...classes) => classes.forEach((c) => bodyClasses.add(c)),
        remove: (...classes) => classes.forEach((c) => bodyClasses.delete(c)),
      },
    },
    documentElement: {
      scrollTop: 0,
      style: { setProperty() {} },
    },
    querySelectorAll(selector) {
      if (selector === ".pagedjs_page") return pages;
      return [];
    },
    querySelector(selector) {
      if (selector === ".pagedjs_page") return pages[0] ?? null;
      if (selector === ".pagedjs_pages") return pagesEl;
      return null;
    },
  };

  const windowObj = {
    document,
    innerHeight: 900,
    scrollY: 0,
    previewAPI: undefined,
    PagedConfig: {},
    location: { search },
    __PAGED_RENDERED__: false,
    parent: { postMessage() {} },
    print() {},
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

  // detectVisiblePage() uses getBoundingClientRect (viewport-relative, post-zoom)
  // rather than offsetTop, so the page number tracks scroll under CSS zoom. Mock
  // it to match the real DOM: top = offsetTop - scrollY.
  for (const p of pages) {
    p.getBoundingClientRect = () => ({
      top: p.offsetTop - windowObj.scrollY,
      bottom: p.offsetTop - windowObj.scrollY + p.offsetHeight,
      left: 0,
      right: p.offsetWidth,
      width: p.offsetWidth,
      height: p.offsetHeight,
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

  return { windowObj, pages, api: windowObj.previewAPI };
}

// Real DOM (happy-dom) loader for getContextTargetAt() / contextMenuRequested
// tests (protocol v4, docs/inline-editing-plan.md §3.1): resolution walks
// closest()/classList/getAttribute against real elements, which a hand-mock
// can't cheaply reproduce faithfully. Mirrors preview-bridge.test.mjs's
// setup() pattern, which loads this SAME script the same way.
function loadInterfaceWithDom(html) {
  const window = new Window({ url: "http://localhost/" });
  const document = window.document;
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
  {
    const pages = [makePage(0), makePage(0), makePage(1000), makePage(1000), makePage(2000), makePage(2000)];
    const { api } = loadPreviewApi(pages);
    api.setViewMode("two-column");
    api.goToPage(4);
    assert.equal(api.getCurrentPage(), 4);
    api.nextPage("two-column");
    assert.equal(api.getCurrentPage(), 6);
    api.prevPage("two-column");
    assert.equal(api.getCurrentPage(), 4);
  }

  {
    const pages = [makePage(0), makePage(0), makePage(1000), makePage(1000), makePage(2000), makePage(2000)];
    const { api } = loadPreviewApi(pages);
    api.setViewMode("single");
    api.goToPage(4);
    api.nextPage("two-column");
    assert.equal(api.getCurrentPage(), 6);
  }

  {
    const pages = [makePage(0), makePage(1000), makePage(2000), makePage(3000), makePage(4000), makePage(5000)];
    const { api } = loadPreviewApi(pages);
    api.setViewMode("single");
    api.goToPage(4);
    api.nextPage();
    assert.equal(api.getCurrentPage(), 5);
    api.prevPage();
    assert.equal(api.getCurrentPage(), 4);
  }

  {
    const pages = [makePage(0), makePage(0), makePage(1000), makePage(1000)];
    const { api, windowObj } = loadPreviewApi(pages);
    api.setViewMode("two-column");
    await new Promise((resolve) => setTimeout(resolve, 320));
    windowObj.scrollY = 1100;
    windowObj.dispatchEvent({ type: "scroll" });
    await new Promise((resolve) => setTimeout(resolve, 170));
    assert.equal(api.getCurrentPage(), 3);
  }

  {
    const pages = [makePage(0), makePage(0), makePage(1000), makePage(1000)];
    const { api } = loadPreviewApi(pages);
    api.goToPage(3);
    assert.equal(api.setZoom("1.25"), undefined);
    assert.equal(api.getCurrentPage(), 3);
    api.setViewMode("single");
    assert.equal(api.getCurrentPage(), 3);
    api.setViewMode("two-column");
    assert.equal(api.getCurrentPage(), 3);
  }

  {
    const pages = [makePage(0, 400), makePage(0, 400)];
    const { api } = loadPreviewApi(pages, 808);
    api.setViewMode("two-column");
    assert.deepEqual(api.getPageDimensions(), { width: 808, height: 600 });
    api.setViewMode("single");
    assert.deepEqual(api.getPageDimensions(), { width: 400, height: 600 });
  }

  console.log("[desktop-test] PASS pagedjs interface navigation");

  // ── getContextTargetAt: kind precedence + payload shape (protocol v4,
  // docs/inline-editing-plan.md §3.1) ────────────────────────────────────────
  const contextHtml = `
    <div class="pagedjs_pages">
      <div class="pagedjs_page">
        <div class="chapter" data-chapter-src="a.md" data-source-range="0:12" data-ref="chapter-ref">
          <div class="page" data-source-range="0:12" data-ref="page-ref">
            <p id="plain" data-source-range="1:2" data-ref="plain-ref">Just a plain paragraph.</p>
            <p id="para" data-source-range="2:3" data-ref="para-ref">Hello <a id="lnk" href="https://example.com/x">link text</a> and <img id="img" src="art.jpg" alt="Art"> world.</p>
            <div class="md-page-break" data-source-range="3:4" data-ref="break-ref" aria-hidden="true"></div>
            <pre id="pre" data-ref="pre-ref"><code id="code" data-source-range="4:5" data-ref="code-ref">const x = 1;</code></pre>
            <p id="frag1" data-source-range="5:7" data-ref="split-ref">first half</p>
            <p id="frag2" data-source-range="5:7" data-ref="split-ref" data-split-from="split-ref">second half</p>
          </div>
        </div>
      </div>
      <div class="pagedjs_margin"><span id="running">Running header</span></div>
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
    assert.equal(detail.ref, "plain-ref");
    assert.equal(detail.image, null);
    assert.equal(detail.link, null);
    assert.equal(detail.selection, null);
    assert.ok(detail.rect && typeof detail.rect.top === "number");
    assert.equal(Object.getPrototypeOf(detail.rect), Object.prototype, "rect is a plain object, not a DOMRect");
  }

  // kind: 'image' — wins over 'block' even though the <img> sits inside an annotated <p>.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("img");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "image");
    assert.deepEqual(detail.image, { src: "art.jpg", alt: "Art" });
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
    assert.deepEqual(detail.link, { href: "https://example.com/x", text: "link text" });
    assert.equal(detail.image, null);
  }

  // kind: 'marker' — a layout wrapper/break class.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.querySelector(".md-page-break");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.kind, "marker");
    assert.deepEqual(detail.range, [3, 4]);
    assert.equal(detail.ref, "break-ref");
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
    assert.equal(detail.ref, null);
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
    assert.equal(detail.ref, "code-ref");
  }
  // A click directly on the <code> resolves identically.
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("code");
    const detail = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(detail.blockTag, "code");
    assert.equal(detail.ref, "code-ref");
  }

  // Split-fragment grouping: fragments duplicate data-source-range and
  // data-ref; only the clone carrying data-split-from/-to reports split:true
  // — data-ref is the one identity that groups them (never `id`).
  {
    const { document, api } = loadInterfaceWithDom(contextHtml);
    document.elementFromPoint = () => document.getElementById("frag1");
    const d1 = api.getContextTargetAt({ x: 1, y: 1 });
    document.elementFromPoint = () => document.getElementById("frag2");
    const d2 = api.getContextTargetAt({ x: 1, y: 1 });
    assert.equal(d1.split, false);
    assert.equal(d2.split, true);
    assert.equal(d1.ref, "split-ref");
    assert.equal(d2.ref, "split-ref", "both fragments share the one stable identity");
    assert.deepEqual(d1.range, d2.range, "split fragments duplicate data-source-range");
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

  // getProtocolVersion() bumped to 4.
  {
    const { api } = loadInterfaceWithDom("<p>x</p>");
    assert.equal(api.getProtocolVersion(), 4);
  }

  console.log("[desktop-test] PASS getContextTargetAt kind precedence + protocol v4");

  // ── contextmenu listener: preventDefault + dispatch only when kind !== 'none' ─
  {
    const html = `
      <div class="chapter" data-chapter-src="a.md" data-source-range="0:1" data-ref="c">
        <p id="para" data-source-range="0:1" data-ref="p1">Hello</p>
      </div>
      <div class="pagedjs_margin"><span id="running">Header</span></div>`;
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
      <div class="pagedjs_pages"><div class="pagedjs_page">
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
}

main().catch((error) => {
  console.error("[desktop-test] FAIL", error);
  process.exit(1);
});
