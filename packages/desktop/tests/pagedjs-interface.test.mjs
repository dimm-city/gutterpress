#!/usr/bin/env node
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Resolve relative to THIS FILE, not process.cwd() — the test must pass no
// matter where bun/node is invoked from (zero-tolerance: bare `bun test`
// from the repo root previously failed on this).
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

function loadPreviewApi(pages, pagesWidth = 808) {
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
  const source = readFileSync(scriptPath, "utf8");
  const run = new Function(
    "window",
    "document",
    "CustomEvent",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    source
  );
  run(windowObj, document, CustomEventStub, MutationObserverStub, setTimeout, clearTimeout);

  return { windowObj, pages, api: windowObj.previewAPI };
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
}

main().catch((error) => {
  console.error("[desktop-test] FAIL", error);
  process.exit(1);
});
