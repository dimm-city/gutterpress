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
// tests: resolution walks
// closest()/classList/getAttribute against real elements, which a hand-mock
// can't cheaply reproduce faithfully. Mirrors preview-bridge.test.mjs's
// setup() pattern, which loads this SAME script the same way.
// `opts.native`: install the NATIVE_ENGINE detection tag plus a
// window.Gutterpress.pageOf() stub before the script runs, so page lookup
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


  // ── contextmenu listener: preventDefault + dispatch only when kind !== 'none' ─
  // Targets come from the galley (protocol v9): it owns the document, and its
  // rendered DOM carries no `data-source-range` for anything else to resolve.
  {
    const html = `<p id="para">Hello</p>
      <div class="gp-test-margin"><span id="running">Header</span></div>`;
    const { window, document } = loadInterfaceWithDom(html);

    let target = { kind: "block", chapter: "a.md", pos: 12, blockTag: "paragraph", rect: null };
    window.GutterpressGalley = {
      isEditing: () => true,
      targetAt: () => target,
    };

    let received = null;
    window.addEventListener("contextMenuRequested", (e) => {
      received = e.detail;
    });

    const ev1 = new window.MouseEvent("contextmenu", { clientX: 12, clientY: 34, bubbles: true, cancelable: true });
    document.dispatchEvent(ev1);
    assert.ok(ev1.defaultPrevented, "native menu suppressed for a real target");
    assert.ok(received, "contextMenuRequested dispatched");
    assert.equal(received.kind, "block");
    assert.equal(received.galley.pos, 12, "node handle replaces the source range");
    assert.equal(received.range, null, "galley targets are never range-addressed");
    assert.equal(received.x, 12);
    assert.equal(received.y, 34);
    assert.equal(received.via, "mouse");

    // Nothing resolvable (page furniture): native behavior preserved.
    received = null;
    target = null;
    const ev2 = new window.MouseEvent("contextmenu", { clientX: 1, clientY: 1, bubbles: true, cancelable: true });
    document.dispatchEvent(ev2);
    assert.equal(ev2.defaultPrevented, false, "native context menu kept when nothing resolves");
    assert.equal(received, null, "no contextMenuRequested dispatched for kind 'none'");
  }

  // Outside editing there is no resolver at all — the native menu always wins.
  {
    const { window, document } = loadInterfaceWithDom(`<p id="para">Hello</p>`);
    window.GutterpressGalley = { isEditing: () => false, targetAt: () => ({ kind: "block", pos: 1 }) };
    let received = null;
    window.addEventListener("contextMenuRequested", (e) => { received = e.detail; });
    const ev = new window.MouseEvent("contextmenu", { clientX: 5, clientY: 5, bubbles: true, cancelable: true });
    document.dispatchEvent(ev);
    assert.equal(ev.defaultPrevented, false, "read-only preview keeps the native menu");
    assert.equal(received, null);
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
    const { window, document } = loadInterfaceWithDom(html);
    const para = document.getElementById("para");
    para.getBoundingClientRect = () => ({ top: 0, left: 0, bottom: 40, right: 400, width: 400, height: 40 });
    window.innerHeight = 900;
    // The anchor point is derived from the top-visible block's own rect; the
    // galley answers for whatever point that lands on.
    window.GutterpressGalley = {
      isEditing: () => true,
      targetAt: () => ({ kind: "block", chapter: "a.md", pos: 7, blockTag: "paragraph", rect: null }),
    };

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
    assert.equal(received.galley.pos, 7);

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

  // getProtocolVersion() is 9: the range-addressed surface (getRectsFor /
  // setEditMask / the `data-source-range` target resolver) went with the
  // pre-galley editing surface it served.
  {
    const { api } = loadInterfaceWithDom("<p>x</p>");
    assert.equal(api.getProtocolVersion(), 9);
    assert.equal(typeof api.getRectsFor, "undefined", "rect geometry API removed");
    assert.equal(typeof api.setEditMask, "undefined", "edit-mask API removed");
    // The galley commands are the editing surface.
    for (const cmd of [
      "setEditMode",
      "getSelectionState",
      "applyInlineFormat",
      "galleyInsertMarkdown",
      "galleySetOpaqueSource",
      "galleySetImageAttrs",
      "galleySetLink",
      "galleySaveNow",
      "galleyTargetAt",
      "galleyAckContent",
    ]) {
      assert.equal(typeof api[cmd], "function", `${cmd} is part of protocol v9`);
    }
    // With no galley mounted every command is inert rather than throwing.
    assert.deepEqual(api.applyInlineFormat({ format: "bold" }), { applied: false });
    assert.deepEqual(api.getContextTargetAt({ x: 1, y: 1 }).kind, "none");
  }

  console.log("[desktop-test] PASS protocol v9 surface");

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
