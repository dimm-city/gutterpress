#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptDir = path.resolve(__dirname, "..", "..", "cli", "src", "assets", "preview", "scripts");
const shellSource = readFileSync(path.join(scriptDir, "preview-shell.js"), "utf8");
const interfaceSource = readFileSync(path.join(scriptDir, "preview-interface.js"), "utf8");

// `.folio-sheet` elements (the viewer's page unit — see
// engine/viewer/decorate.ts). Paged.js has been removed
// (native-only-migration-plan.md Phase 6) — the incremental chapter-splice
// scenario this fixture set used to also cover (UPDATED_CHAPTER) was removed
// with it: every content-update now goes through the same full-reload swap
// as a geometry-wide change (see preview-shell.js's header comment on the
// removed spliceChapter()).
const BOOK_NATIVE = `
  <div class="folio-sheet" data-page="1"><div class="gutterpress-chapter" data-chapter-src="chapter-1.md">
    <p data-source-line="1">Chapter one</p>
  </div></div>
  <div class="folio-sheet" data-page="2"><div class="gutterpress-chapter" data-chapter-src="chapter-2.md">
    <p data-source-line="1">Chapter two start</p>
  </div></div>
  <div class="folio-sheet" data-page="3"><div class="gutterpress-chapter" data-chapter-src="chapter-2.md">
    <p data-source-line="20">Chapter two anchor</p>
  </div></div>`;

function installBook(frame, markup = BOOK_NATIVE) {
  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  const scroll = { y: 0 };
  frameDocument.head.innerHTML = '<script src="/engine/gutterpress-viewer.js"></script>';
  frameWindow.Gutterpress = {
    pageOf(el) {
      const sheet = el && el.closest ? el.closest(".folio-sheet") : null;
      return sheet ? parseInt(sheet.getAttribute("data-page"), 10) - 1 : -1;
    },
  };
  frameDocument.body.innerHTML = markup;
  const pageSelector = ".folio-sheet";
  const pages = [...frameDocument.querySelectorAll(pageSelector)];
  const blocks = [...frameDocument.querySelectorAll("[data-source-line]")];
  let zoom = 1;

  frameWindow.innerHeight = 900;
  Object.defineProperty(frameWindow, "scrollY", { configurable: true, get: () => scroll.y });
  frameWindow.scrollBy = (xOrOptions, y) => {
    const top = typeof xOrOptions === "number" ? y : xOrOptions?.top;
    const apply = () => {
      scroll.y += typeof top === "number" ? top : 0;
      frameDocument.documentElement.scrollTop = scroll.y;
    };
    // Model `scroll-behavior: smooth`: the numeric overload is asynchronous,
    // while the explicit instant behavior used by restoration is synchronous.
    if (typeof xOrOptions === "number") setTimeout(apply, 20);
    else apply();
  };
  frameDocument.documentElement.scrollTop = 0;
  const setProperty = frameDocument.documentElement.style.setProperty.bind(frameDocument.documentElement.style);
  frameDocument.documentElement.style.setProperty = (name, value) => {
    setProperty(name, value);
    if (name === "--gutterpress-zoom") zoom = Number(value);
  };
  pages.forEach((page, index) => {
    page.scrollIntoView = () => {
      scroll.y = index * 1000;
      frameDocument.documentElement.scrollTop = scroll.y;
    };
    page.getBoundingClientRect = () => ({
      top: index * 1000 * zoom - frameWindow.scrollY,
      bottom: index * 1000 * zoom - frameWindow.scrollY + 900 * zoom,
      left: 0,
      right: 400,
      width: 400,
      height: 900 * zoom,
    });
  });
  blocks.forEach((block) => {
    const page = pages.indexOf(block.closest(pageSelector));
    block.getBoundingClientRect = () => ({
      top: (page * 1000 + 20) * zoom - frameWindow.scrollY,
      bottom: (page * 1000 + 60) * zoom - frameWindow.scrollY,
      left: 0,
      right: 400,
      width: 400,
      height: 40 * zoom,
    });
  });

  const run = new Function(
    "window",
    "document",
    "CustomEvent",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    interfaceSource,
  );
  run(
    frameWindow,
    frameDocument,
    frameWindow.CustomEvent,
    frameWindow.MutationObserver,
    setTimeout,
    clearTimeout,
  );
}

async function main() {
  const outer = new Window({ url: "http://localhost/" });
  const document = outer.document;
  const hostEvents = [];
  Object.defineProperty(outer, "parent", {
    configurable: true,
    value: { postMessage: (message) => hostEvents.push(message) },
  });
  const active = document.createElement("iframe");
  active.id = "gutterpress-active";
  active.title = "preview";
  document.body.appendChild(active);
  installBook(active);

  // The user is reading a non-first chapter/page when the full reload arrives.
  active.contentWindow.scrollBy({ top: 2016 });
  active.contentWindow.previewAPI.setViewMode("single");
  active.contentWindow.previewAPI.setZoom("0.8");
  active.contentDocument.body.classList.add("debug");
  const desktopStyle = active.contentDocument.createElement("style");
  desktopStyle.setAttribute("data-gutterpress-desktop-canvas", "true");
  desktopStyle.textContent = ".folio-sheet { box-shadow: 0 0 2px black; }";
  active.contentDocument.head.appendChild(desktopStyle);

  let onChange;
  const acknowledgedRevisions = [];
  outer.__GUTTERPRESS_INSTANCE = "instance-a";
  outer.__GUTTERPRESS_REVISION = 0;
  outer.__GUTTERPRESS_CHANGE_SOURCE = {
    subscribe(callback) {
      onChange = callback;
      return () => {};
    },
    acknowledge(instance, revision) {
      acknowledgedRevisions.push(`${instance}:${revision}`);
    },
  };
  const animationFrames = [];
  outer.requestAnimationFrame = (callback) => animationFrames.push(callback);
  const flushAnimationFrames = () => {
    while (animationFrames.length) animationFrames.shift()();
  };
  let deferNextFrameLoad = false;
  let deferredFrame = null;

  const appendChild = document.body.appendChild.bind(document.body);
  document.body.appendChild = (node) => {
    const result = appendChild(node);
    if (node.tagName === "IFRAME" && node !== active) {
      installBook(node);
      const refresh = node.contentWindow.previewAPI.refresh;
      node.contentWindow.previewAPI.refresh = () => {
        const result = refresh();
        const event = new outer.Event("message");
        Object.defineProperties(event, {
          data: { value: { type: "gutterpress:event", name: "pageChanged", detail: {
            currentPage: node.contentWindow.previewAPI.getCurrentPage(),
            totalPages: node.contentWindow.previewAPI.getTotalPages(),
          } } },
          source: { value: node.contentWindow },
        });
        outer.dispatchEvent(event);
        return result;
      };
      if (deferNextFrameLoad) {
        deferNextFrameLoad = false;
        deferredFrame = node;
      } else {
        // Real production: the viewer's mount() fires 'folio:layout' once its
        // own async fragmentDocument() resolves; preview-interface.js's
        // listener (installed by installBook() above) turns that into
        // 'renderingComplete' for preview-shell.js's onReady() to pick up —
        // see preview-interface.js's onRenderingComplete(). installBook has
        // no real viewer to await, so the fixture fires it directly.
        node.contentWindow.dispatchEvent(new node.contentWindow.CustomEvent("folio:layout", { detail: {} }));
        node.dispatchEvent(new outer.Event("load"));
      }
    }
    return result;
  };

  // The fixture carries the viewer <script> tag (preview-interface.js needs
  // it), so onReady() takes the wait-for-'renderingComplete' branch and arms
  // a real ~180s timeout. Only short (poll/debounce) timers should fire
  // synchronously; the long readiness timeout must NOT fire before the
  // explicit 'folio:layout' dispatch above reaches it, or it discards the
  // frame as "timed out".
  const runShell = new Function("window", "document", "setTimeout", "clearTimeout", shellSource);
  runShell(outer, document, (callback, ms) => { if ((ms || 0) < 1000) callback(); }, clearTimeout);
  // The initial `active` frame carries the viewer <script> tag too (same as
  // every frame `installBook` produces), so it needs the same explicit
  // 'folio:layout' -> __GUTTERPRESS_RENDERED__ latch as the swap-in frames
  // below, or markActiveReady()'s onReady() call never resolves and the
  // shell never acknowledges the initial revision.
  active.contentWindow.dispatchEvent(new active.contentWindow.CustomEvent("folio:layout", { detail: {} }));
  active.dispatchEvent(new outer.Event("load"));

  onChange?.({ type: "reload-state", instance: "instance-a", revision: 0 });
  assert.equal(document.getElementById("gutterpress-active"), active, "current revision does not reload");
  onChange?.({ type: "full-reload", instance: "instance-a", revision: 1 });

  const fresh = [...document.querySelectorAll("iframe")].find((frame) => frame !== active);
  assert.ok(fresh, "full-reload swaps in a freshly paginated iframe");
  const api = fresh.contentWindow.previewAPI;
  const anchorElement = fresh.contentDocument.querySelector('[data-source-line="20"]');
  const anchorTop = () => anchorElement.getBoundingClientRect().top;
  const restoredAnchorTop = anchorTop();
  assert.equal(fresh.id, "gutterpress-active", "the replacement retains the active-frame identity");
  assert.equal(fresh.title, "preview", "the replacement retains the iframe title");
  assert.equal(fresh.contentDocument.body.classList.contains("view-single"), true, "view mode is copied before reveal");
  assert.equal(fresh.contentDocument.body.classList.contains("debug"), true, "debug state is copied before reveal");
  assert.equal(
    fresh.contentDocument.documentElement.style.getPropertyValue("--gutterpress-zoom"),
    "0.8",
    "zoom is copied before reveal",
  );
  assert.equal(
    fresh.contentDocument.querySelector("style[data-gutterpress-desktop-canvas]")?.textContent,
    desktopStyle.textContent,
    "host-injected canvas CSS is copied before reveal",
  );
  assert.deepEqual(api.getVisibleSource(), {
    sourceLine: 20,
    chapter: "chapter-2.md",
    page: 3,
  }, "preview-shell restore keeps the chapter-2/page-3 anchor before settle");
  assert.equal(api.getCurrentPage(), 3, "preview-shell restore updates the active frame page state");
  assert.deepEqual(hostEvents.find((message) => message?.name === "pageChanged")?.detail, {
    currentPage: 3,
    totalPages: 3,
  }, "refresh pageChanged is relayed from the active frame");

  // The bridge posts asynchronously. A reader event published just before the
  // swap may reach the shell after `active` changes, so the retiring frame stays
  // eligible for source-event relay until its two-frame removal.
  const queuedOutgoingEvent = new outer.Event("message");
  Object.defineProperties(queuedOutgoingEvent, {
    data: { value: { type: "gutterpress:event", name: "sourceLineChanged", detail: {
      sourceLine: 20,
      chapter: "chapter-2.md",
      page: 3,
    } } },
    source: { value: active.contentWindow },
  });
  outer.dispatchEvent(queuedOutgoingEvent);
  assert.deepEqual(
    hostEvents.find((message) => message?.name === "sourceLineChanged")?.detail,
    { sourceLine: 20, chapter: "chapter-2.md", page: 3 },
    "a queued source event from the retiring frame is not lost",
  );
  flushAnimationFrames();

  const staleReadyEvent = new outer.Event("message");
  Object.defineProperties(staleReadyEvent, {
    data: { value: { type: "gutterpress:event", name: "ready", detail: {} } },
    source: { value: fresh.contentWindow },
  });
  outer.dispatchEvent(staleReadyEvent);
  assert.equal(
    hostEvents.some((message) => message?.name === "ready"),
    false,
    "a hidden-frame ready event cannot flash the host loading overlay after the swap",
  );

  const completeEvent = new outer.Event("message");
  Object.defineProperties(completeEvent, {
    data: { value: { type: "gutterpress:event", name: "renderingComplete", detail: { totalPages: 3 } } },
    source: { value: fresh.contentWindow },
  });
  outer.dispatchEvent(completeEvent);
  const hotReloadDetail = hostEvents.find((message) => message?.name === "renderingComplete")?.detail;
  assert.equal(hotReloadDetail?.totalPages, 3);
  assert.equal(hotReloadDetail?.hotReload, true);
  assert.equal(typeof hotReloadDetail?.hotReloadMs, "number");
  assert.equal(hotReloadDetail.hotReloadMs >= 0, true);
  assert.equal(hotReloadDetail?.revision, 1);
  assert.equal(hotReloadDetail?.updateMode, "full-reload");

  // Presentation changes and delayed scroll delivery after the atomic swap must
  // not report the restored viewport as fresh reader navigation.
  const sourceChanges = [];
  fresh.contentWindow.addEventListener("sourceLineChanged", (event) => {
    sourceChanges.push(event.detail);
  });
  for (const mode of ["single", "two-column", "single", "two-column"]) {
    api.setViewMode(mode);
    assert.deepEqual(api.getVisibleSource(), {
      sourceLine: 20,
      chapter: "chapter-2.md",
      page: 3,
    }, `anchored ${mode} view-mode changes preserve the source position`);
    assert.equal(anchorTop(), restoredAnchorTop, `anchored ${mode} view-mode changes preserve the viewport anchor`);
  }
  for (const zoom of ["1.25", "0.8", "1.1"]) {
    api.setZoom(zoom);
    assert.deepEqual(api.getVisibleSource(), {
      sourceLine: 20,
      chapter: "chapter-2.md",
      page: 3,
    }, `anchored ${zoom} zoom changes preserve the source position`);
    assert.equal(anchorTop(), restoredAnchorTop, `anchored ${zoom} zoom changes preserve the viewport anchor`);
  }
  await new Promise((resolve) => setTimeout(resolve, 320));
  fresh.contentWindow.dispatchEvent(new fresh.contentWindow.Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 170));
  assert.deepEqual(api.getVisibleSource(), {
    sourceLine: 20,
    chapter: "chapter-2.md",
    page: 3,
  }, "post-render presentation changes preserve the chapter-2/page-3 anchor");
  assert.deepEqual(sourceChanges, [], "the restored viewport is the source-sync baseline");

  // Genuine reader movement still emits. Chapter is part of the baseline because
  // every source file restarts its line numbering.
  const chapterTwoStart = fresh.contentDocument.querySelector(
    '[data-chapter-src="chapter-2.md"] [data-source-line="1"]',
  );
  fresh.contentWindow.scrollBy({ top: chapterTwoStart.getBoundingClientRect().top });
  fresh.contentWindow.dispatchEvent(new fresh.contentWindow.Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 170));
  assert.deepEqual(sourceChanges[0], {
    sourceLine: 1,
    chapter: "chapter-2.md",
    page: 2,
  }, "reader movement to another source position emits");

  const chapterOneStart = fresh.contentDocument.querySelector(
    '[data-chapter-src="chapter-1.md"] [data-source-line="1"]',
  );
  fresh.contentWindow.scrollBy({ top: chapterOneStart.getBoundingClientRect().top });
  fresh.contentWindow.dispatchEvent(new fresh.contentWindow.Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 170));
  assert.deepEqual(sourceChanges[1], {
    sourceLine: 1,
    chapter: "chapter-1.md",
    page: 1,
  }, "the same line number in a different chapter still emits");

  const revisionOneFrame = document.getElementById("gutterpress-active");
  onChange?.({ type: "reload-state", instance: "instance-a", revision: 1 });
  assert.equal(
    document.getElementById("gutterpress-active"),
    revisionOneFrame,
    "an acknowledged revision is idempotent",
  );
  onChange?.({ type: "reload-state", instance: "instance-a", revision: 2 });
  assert.notEqual(
    document.getElementById("gutterpress-active"),
    revisionOneFrame,
    "a newer state observed after reconnect catches up the visible frame",
  );
  flushAnimationFrames();
  assert.equal(acknowledgedRevisions.includes("instance-a:0"), true);
  assert.equal(acknowledgedRevisions.includes("instance-a:1"), true);
  assert.equal(
    acknowledgedRevisions.at(-1),
    "instance-a:2",
    "the shell acknowledges its initial, applied, duplicate, and recovered revisions",
  );

  const oldInstanceFrame = document.getElementById("gutterpress-active");
  onChange?.({ type: "reload-state", instance: "instance-b", revision: 0 });
  assert.notEqual(
    document.getElementById("gutterpress-active"),
    oldInstanceFrame,
    "a restarted server applies its new instance even when its revision resets",
  );
  assert.equal(acknowledgedRevisions.at(-1), "instance-b:0");
  flushAnimationFrames();

  // A reader can scroll while a long replacement is paginating. If that scroll
  // is still inside the interface debounce when the swap finishes, the shell
  // must flush and relay it before the outgoing frame stops being active.
  const beforePendingScroll = hostEvents.length;
  const instanceBFrame = document.getElementById("gutterpress-active");
  const pendingTarget = instanceBFrame.contentDocument.querySelector(
    '[data-chapter-src="chapter-2.md"] [data-source-line="1"]',
  );
  instanceBFrame.contentWindow.scrollBy({ top: pendingTarget.getBoundingClientRect().top });
  instanceBFrame.contentWindow.dispatchEvent(new instanceBFrame.contentWindow.Event("scroll"));
  onChange?.({ type: "full-reload", instance: "instance-b", revision: 1 });
  assert.deepEqual(
    hostEvents.slice(beforePendingScroll).find((message) => message?.name === "sourceLineChanged")?.detail,
    { sourceLine: 1, chapter: "chapter-2.md", page: 2 },
    "the swap preserves pending reader movement for editor synchronization",
  );
  flushAnimationFrames();

  // A `content-update` message now goes through the exact same full-reload
  // swap as `full-reload` (Paged.js's incremental chapter splice was removed
  // along with Paged.js — see preview-shell.js's header comment on the
  // removed spliceChapter()).
  const beforeUpdate = document.getElementById("gutterpress-active");
  const beforeUpdateEvents = hostEvents.length;
  onChange?.({
    type: "content-update",
    instance: "instance-b",
    revision: 2,
    file: "chapter-2.md",
  });
  const afterUpdate = document.getElementById("gutterpress-active");
  assert.notEqual(afterUpdate, beforeUpdate, "a content-update triggers a full swap, same as full-reload");
  assert.equal(acknowledgedRevisions.at(-1), "instance-b:2");
  // preview-bridge.js (not loaded by this fixture — see the file header)
  // is what relays the swapped-in frame's own 'renderingComplete' DOM event
  // to the host via postMessage in production; simulate that one message so
  // the shell's hotReload-detail enrichment can be asserted directly.
  const updateCompleteEvent = new outer.Event("message");
  Object.defineProperties(updateCompleteEvent, {
    data: { value: { type: "gutterpress:event", name: "renderingComplete", detail: { totalPages: 3 } } },
    source: { value: afterUpdate.contentWindow },
  });
  outer.dispatchEvent(updateCompleteEvent);
  const updateComplete = hostEvents.slice(beforeUpdateEvents).find(
    (message) => message?.name === "renderingComplete",
  );
  assert.equal(updateComplete?.detail?.hotReload, true);
  assert.equal(updateComplete?.detail?.revision, 2);
  assert.equal(updateComplete?.detail?.updateMode, "full-reload");

  // A second source update arriving before the first swap's replacement frame
  // has loaded must reconcile through the latest authoritative revision, not
  // apply both in sequence.
  deferNextFrameLoad = true;
  onChange?.({
    type: "content-update",
    instance: "instance-b",
    revision: 3,
    file: "chapter-2.md",
  });
  assert.ok(deferredFrame?.isConnected, "the first rapid update is still paginating");
  const beforeOverlapRecovery = document.getElementById("gutterpress-active");
  onChange?.({
    type: "content-update",
    instance: "instance-b",
    revision: 4,
    file: "chapter-1.md",
  });
  assert.equal(deferredFrame.isConnected, false, "the superseded frame is discarded");
  assert.notEqual(
    document.getElementById("gutterpress-active"),
    beforeOverlapRecovery,
    "overlapping updates recover through a full-book swap",
  );
  assert.equal(acknowledgedRevisions.at(-1), "instance-b:4");
  flushAnimationFrames();

}

// ── Native engine: the same double-buffer swap + anchor-preservation core
// (the property this suite exists to guard), against `.folio-sheet` fixtures
// instead of `.pagedjs_page`. The chapter-splice scenario in main() above
// stays paged-only — see BOOK_NATIVE's comment.
async function runNativeCoreRegression() {
  const outer = new Window({ url: "http://localhost/" });
  const document = outer.document;
  const hostEvents = [];
  Object.defineProperty(outer, "parent", {
    configurable: true,
    value: { postMessage: (message) => hostEvents.push(message) },
  });
  const active = document.createElement("iframe");
  active.id = "gutterpress-active";
  active.title = "preview";
  document.body.appendChild(active);
  installBook(active, BOOK_NATIVE, "native");

  active.contentWindow.scrollBy({ top: 2016 });
  active.contentWindow.previewAPI.setViewMode("single");
  active.contentWindow.previewAPI.setZoom("0.8");
  active.contentDocument.body.classList.add("debug");
  const desktopStyle = active.contentDocument.createElement("style");
  desktopStyle.setAttribute("data-gutterpress-desktop-canvas", "true");
  desktopStyle.textContent = ".folio-sheet { box-shadow: 0 0 2px black; }";
  active.contentDocument.head.appendChild(desktopStyle);

  let onChange;
  outer.__GUTTERPRESS_INSTANCE = "instance-a";
  outer.__GUTTERPRESS_REVISION = 0;
  outer.__GUTTERPRESS_CHANGE_SOURCE = {
    subscribe(callback) {
      onChange = callback;
      return () => {};
    },
    acknowledge() {},
  };
  const animationFrames = [];
  outer.requestAnimationFrame = (callback) => animationFrames.push(callback);
  const flushAnimationFrames = () => {
    while (animationFrames.length) animationFrames.shift()();
  };

  const appendChild = document.body.appendChild.bind(document.body);
  document.body.appendChild = (node) => {
    const result = appendChild(node);
    if (node.tagName === "IFRAME" && node !== active) {
      installBook(node, BOOK_NATIVE, "native");
      const refresh = node.contentWindow.previewAPI.refresh;
      node.contentWindow.previewAPI.refresh = () => {
        const result = refresh();
        const event = new outer.Event("message");
        Object.defineProperties(event, {
          data: { value: { type: "gutterpress:event", name: "pageChanged", detail: {
            currentPage: node.contentWindow.previewAPI.getCurrentPage(),
            totalPages: node.contentWindow.previewAPI.getTotalPages(),
          } } },
          source: { value: node.contentWindow },
        });
        outer.dispatchEvent(event);
        return result;
      };
      // Real production: the viewer's mount() fires 'folio:layout' once its
      // own async fragmentDocument() resolves; preview-interface.js's
      // listener (installed by installBook() above) turns that into
      // 'renderingComplete' for preview-shell.js's onReady() to pick up —
      // see preview-interface.js's onRenderingComplete(). installBook has no
      // real viewer to await, so the fixture fires it directly.
      // Ordering matters and is measured, not assumed: the viewer mounts on
      // DOMContentLoaded, so on a small book it finishes BEFORE the iframe's
      // `load` event — i.e. before preview-shell.js attaches its
      // 'renderingComplete' listener. Only onRenderingComplete()'s
      // __GUTTERPRESS_RENDERED__ latch makes the swap complete at all.
      node.contentWindow.dispatchEvent(new node.contentWindow.CustomEvent("folio:layout", { detail: {} }));
      node.dispatchEvent(new outer.Event("load"));
    }
    return result;
  };

  // Unlike main()'s fixtures (which never carry an engine <script> tag, so
  // onReady() always takes the immediate `.pagedjs_page`-polling branch),
  // this fixture DOES carry the viewer <script> tag (preview-interface.js
  // needs it for NATIVE_ENGINE detection) — so onReady() takes the
  // wait-for-'renderingComplete' branch and arms a real ~180s timeout. Only
  // short (poll/debounce) timers should fire synchronously; the long
  // readiness timeout must NOT fire before the explicit 'folio:layout'
  // dispatch below reaches it, or it discards the frame as "timed out".
  const runShell = new Function("window", "document", "setTimeout", "clearTimeout", shellSource);
  runShell(outer, document, (callback, ms) => { if ((ms || 0) < 1000) callback(); }, clearTimeout);
  active.contentWindow.dispatchEvent(new active.contentWindow.CustomEvent("folio:layout", { detail: {} }));
  active.dispatchEvent(new outer.Event("load"));

  onChange?.({ type: "full-reload", instance: "instance-a", revision: 1 });

  const fresh = [...document.querySelectorAll("iframe")].find((frame) => frame !== active);
  assert.ok(fresh, "native: full-reload swaps in a freshly paginated iframe");
  const api = fresh.contentWindow.previewAPI;
  const anchorElement = fresh.contentDocument.querySelector('[data-source-line="20"]');
  const anchorTop = () => anchorElement.getBoundingClientRect().top;
  const restoredAnchorTop = anchorTop();
  assert.equal(fresh.id, "gutterpress-active", "native: the replacement retains the active-frame identity");
  assert.equal(
    fresh.contentDocument.body.classList.contains("view-single"),
    true,
    "native: view mode is copied before reveal",
  );
  assert.equal(
    fresh.contentDocument.documentElement.style.getPropertyValue("--gutterpress-zoom"),
    "0.8",
    "native: zoom is copied before reveal",
  );
  assert.deepEqual(api.getVisibleSource(), {
    sourceLine: 20,
    chapter: "chapter-2.md",
    page: 3,
  }, "native: preview-shell restore keeps the chapter-2/page-3 anchor before settle");
  assert.equal(api.getCurrentPage(), 3, "native: preview-shell restore updates the active frame page state");
  assert.deepEqual(hostEvents.find((message) => message?.name === "pageChanged")?.detail, {
    currentPage: 3,
    totalPages: 3,
  }, "native: refresh pageChanged is relayed from the active frame");

  const completeEvent = new outer.Event("message");
  Object.defineProperties(completeEvent, {
    data: { value: { type: "gutterpress:event", name: "renderingComplete", detail: { totalPages: 3 } } },
    source: { value: fresh.contentWindow },
  });
  outer.dispatchEvent(completeEvent);
  const hotReloadDetail = hostEvents.find((message) => message?.name === "renderingComplete")?.detail;
  assert.equal(hotReloadDetail?.totalPages, 3);
  assert.equal(hotReloadDetail?.hotReload, true);
  assert.equal(hotReloadDetail?.revision, 1);
  assert.equal(hotReloadDetail?.updateMode, "full-reload");

  const sourceChanges = [];
  fresh.contentWindow.addEventListener("sourceLineChanged", (event) => {
    sourceChanges.push(event.detail);
  });
  for (const mode of ["single", "two-column", "single"]) {
    api.setViewMode(mode);
    assert.deepEqual(api.getVisibleSource(), {
      sourceLine: 20,
      chapter: "chapter-2.md",
      page: 3,
    }, `native: anchored ${mode} view-mode changes preserve the source position`);
    assert.equal(anchorTop(), restoredAnchorTop, `native: anchored ${mode} view-mode changes preserve the viewport anchor`);
  }
  await new Promise((resolve) => setTimeout(resolve, 320));
  assert.deepEqual(sourceChanges, [], "native: the restored viewport is the source-sync baseline");

  // Genuine reader movement still emits, chapter-scoped.
  const chapterOneStart = fresh.contentDocument.querySelector(
    '[data-chapter-src="chapter-1.md"] [data-source-line="1"]',
  );
  fresh.contentWindow.scrollBy({ top: chapterOneStart.getBoundingClientRect().top });
  fresh.contentWindow.dispatchEvent(new fresh.contentWindow.Event("scroll"));
  await new Promise((resolve) => setTimeout(resolve, 170));
  assert.deepEqual(sourceChanges[0], {
    sourceLine: 1,
    chapter: "chapter-1.md",
    page: 1,
  }, "native: reader movement to another source position emits");
  flushAnimationFrames();

  console.log("[desktop-test] PASS native-engine preview-shell double-buffer swap + anchor preservation");
}

main()
  .then(runNativeCoreRegression)
  .catch((error) => {
    console.error("[desktop-test] FAIL", error);
    process.exit(1);
  });
