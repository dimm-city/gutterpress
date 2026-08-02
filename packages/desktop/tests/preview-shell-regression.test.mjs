#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptDir = path.resolve(__dirname, "..", "..", "cli", "src", "assets", "preview", "scripts");
const shellSource = readFileSync(path.join(scriptDir, "preview-shell.js"), "utf8");
const interfaceSource = readFileSync(path.join(scriptDir, "pagedjs-interface.js"), "utf8");

const BOOK = `
  <div class="pagedjs_pages">
    <div class="pagedjs_page"><div class="gutterpress-chapter" data-chapter-src="chapter-1.md">
      <p data-source-line="1">Chapter one</p>
    </div></div>
    <div class="pagedjs_page"><div class="gutterpress-chapter" data-chapter-src="chapter-2.md">
      <p data-source-line="1">Chapter two start</p>
    </div></div>
    <div class="pagedjs_page"><div class="gutterpress-chapter" data-chapter-src="chapter-2.md">
      <p data-source-line="20">Chapter two anchor</p>
    </div></div>
  </div>`;

function installBook(frame, markup = BOOK) {
  const frameWindow = frame.contentWindow;
  const frameDocument = frame.contentDocument;
  const scroll = { y: 0 };
  frameDocument.body.innerHTML = markup;
  const pages = [...frameDocument.querySelectorAll(".pagedjs_page")];
  const blocks = [...frameDocument.querySelectorAll("[data-source-line]")];
  let zoom = 1;

  frameWindow.innerHeight = 900;
  Object.defineProperty(frameWindow, "scrollY", { configurable: true, get: () => scroll.y });
  frameWindow.scrollBy = (xOrOptions, y) => {
    const top = typeof xOrOptions === "number" ? y : xOrOptions?.top;
    scroll.y += typeof top === "number" ? top : 0;
    frameDocument.documentElement.scrollTop = scroll.y;
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
  blocks.forEach((block, index) => {
    const page = index === 0 ? 0 : index === 1 ? 1 : 2;
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
  desktopStyle.textContent = ".pagedjs_page { box-shadow: 0 0 2px black; }";
  active.contentDocument.head.appendChild(desktopStyle);

  let onChange;
  outer.__GUTTERPRESS_CHANGE_SOURCE = {
    subscribe(callback) {
      onChange = callback;
      return () => {};
    },
  };
  outer.requestAnimationFrame = (callback) => callback();

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
      node.dispatchEvent(new outer.Event("load"));
    }
    return result;
  };

  const runShell = new Function("window", "document", "setTimeout", "clearTimeout", shellSource);
  runShell(outer, document, (callback) => callback(), clearTimeout);

  onChange?.({ type: "full-reload" });

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

  // This is the normal renderingComplete settle call made by the desktop host.
  let sourceLineChanged;
  fresh.contentWindow.addEventListener("sourceLineChanged", (event) => {
    sourceLineChanged = event.detail;
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
  assert.deepEqual({
    visible: api.getVisibleSource(),
    emitted: sourceLineChanged,
  }, {
    visible: {
      sourceLine: 20,
      chapter: "chapter-2.md",
      page: 3,
    },
    emitted: {
      sourceLine: 20,
      chapter: "chapter-2.md",
      page: 3,
    },
  }, "post-render view-mode application must preserve the chapter-2/page-3 anchor in the viewer and editor sync event");

}

main().catch((error) => {
  console.error("[desktop-test] FAIL", error);
  process.exit(1);
});
