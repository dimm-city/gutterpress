import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

/**
 * preview-navigation-protocol.test.ts (SFE-P3d-parity, Lane C).
 *
 * Coverage audit (parity-gate condition 4, "Preview navigation"; D8):
 *
 *   - `packages/desktop/tests/preview-interface.test.mjs` pins native-engine
 *     page navigation (getTotalPages/goToPage/nextPage/prevPage/
 *     getPageDimensions) and getContextTargetAt (block/image/link/marker/
 *     selection/none kind resolution, the gp-behind hit-stack probe, and the
 *     mouse/keyboard contextmenu listeners) — but EVERY assertion there calls
 *     `window.previewAPI.*` DIRECTLY, in-process. It never sends a
 *     `gutterpress:cmd` message and never loads the real preview-bridge.js
 *     against a real book.
 *   - `packages/desktop/tests/preview-bridge.test.mjs` pins chapter-scoped
 *     scrollTo/getVisibleSource/getOutline/queryDom — also all in-process,
 *     also never through the bridge.
 *   - `packages/desktop/tests/preview-interface.test.mjs`'s own "bridge
 *     forwards protocol v8 edit events" section (its final block) DOES load
 *     the real preview-bridge.js, but only to prove the book→host EVENT
 *     direction (viewportChanged/blockEditRequested/blockEditFinished/
 *     blockEditStateChanged) forwards correctly. It stubs
 *     `previewAPI: {}` (an empty object) — the host→book COMMAND direction
 *     (`gutterpress:cmd` → `preview-bridge.js`'s `call()` → a REAL
 *     `previewAPI` method → `gutterpress:reply`) is never exercised there
 *     for ANY command, navigation or otherwise.
 *   - `packages/desktop/tests/editor/preview-mutation-protocol-characterization.test.ts`
 *     (SFE-P0a) pins preview-shell.js's host→book relay and its
 *     `beginBlockEdit`-only focus special case — but its "ordinary command"
 *     control case (`cmd: "getTotalPages"`) stubs the active book iframe as
 *     a bare `{ postMessage: (m) => forwarded.push(m) }` spy. It proves the
 *     MESSAGE reaches the iframe's `postMessage`; it does not prove a real
 *     book document RECEIVES and ANSWERS it.
 *
 * GAP (this file closes it): no existing test proves that a host-initiated
 * NAVIGATION command completes a real round trip — `gutterpress:cmd` in,
 * `gutterpress:reply` out, with the reply computed by the REAL
 * `previewAPI` running the REAL `preview-interface.js` against a REAL book
 * DOM — either (a) through `preview-bridge.js` alone, or (b) through the
 * full `preview-shell.js` (host relay) → `preview-bridge.js` (book dispatch)
 * → `preview-interface.js` (real command) → reply → `preview-shell.js`
 * (relay back) → host chain, using every real script together. That full
 * chain is exactly what P4 will still ship (D8: preview keeps navigation);
 * everything else in that chain (`beginBlockEdit`/`endBlockEdit` and the
 * shell's focus special case for them) is exactly what P4 deletes.
 *
 * "Diagnostics" (the sixth D8 capability) is not exercised here: it is not
 * part of the preview-interface/bridge/shell protocol at all. It is the
 * desktop app's own build/render-failure banner
 * (`project-lifecycle-controller.svelte.ts`'s `previewError`, fed into the
 * Problems panel via `problems.ts`'s `"desktop.preview"` source), already
 * covered by `packages/desktop/tests/platform/project-lifecycle-controller.test.ts`
 * (asserts `ctrl.previewError` transitions) and
 * `packages/desktop/tests/platform/problems.test.ts`. See this run's lane
 * report for the full per-capability audit table.
 */

const scriptDir = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "cli",
  "src",
  "assets",
  "preview",
  "scripts",
);
const interfaceSource = readFileSync(path.join(scriptDir, "preview-interface.js"), "utf8");
const bridgeSource = readFileSync(path.join(scriptDir, "preview-bridge.js"), "utf8");
const shellSource = readFileSync(path.join(scriptDir, "preview-shell.js"), "utf8");

// A two-page native-engine book: page 1 carries a heading, a paragraph with
// both a link and an image (for getContextTargetAt), and a layout marker;
// page 2 carries a second chapter block. Two REAL `.gp-sheet` pages (not one)
// so goToPage/nextPage/prevPage have somewhere real to navigate between.
const NATIVE_BOOK_HTML = `
  <div class="gp-sheet" data-page="1">
    <div class="gutterpress-chapter" data-chapter-src="a.md">
      <div class="page" data-source-range="0:10">
        <h1 data-source-line="1" data-source-range="0:1">Alpha</h1>
        <p id="para" data-source-line="2" data-source-range="1:2">Hello <a id="lnk" href="https://example.com/x" data-gp-source-token="[link text](https://example.com/x)" data-gp-source-occurrence="0">link text</a> and <img id="img" src="art.jpg" alt="Art" data-gp-source-token="![Art](art.jpg)" data-gp-source-occurrence="0"> world.</p>
        <div class="gp-page-break" data-source-range="2:3" aria-hidden="true"></div>
      </div>
    </div>
  </div>
  <div class="gp-sheet" data-page="2">
    <div class="gutterpress-chapter" data-chapter-src="a.md">
      <div class="page" data-source-range="10:20">
        <p id="para2" data-source-line="20" data-source-range="10:11">Beta body</p>
      </div>
    </div>
  </div>`;

interface BookHandle {
  window: Window;
  document: Document;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  api: any;
  scrollCalls: Array<{ page: string | null; opts: unknown }>;
  posted: unknown[];
}

/** Loads the REAL preview-interface.js (and, unless `bridge: false`, the
 *  REAL preview-bridge.js too) into a fresh happy-dom window standing in for
 *  the book iframe — the exact loader pattern `preview-bridge.test.mjs` and
 *  `preview-interface.test.mjs` already use for this script (native-engine
 *  detection tag + `window.Gutterpress.pageOf` stub + real `.gp-sheet` DOM). */
function loadBook(opts: { bridge?: boolean; markup?: string } = {}): BookHandle {
  const win = new Window({ url: "http://localhost/" }) as unknown as Window;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const document = win.document as any;
  document.head.innerHTML = '<script src="/engine/gutterpress-viewer.js"></script>';
  (win as unknown as { Gutterpress: unknown }).Gutterpress = {
    pageOf(el: { closest?: (sel: string) => { getAttribute(name: string): string | null } | null } | null) {
      const sheet = el && el.closest ? el.closest(".gp-sheet") : null;
      return sheet ? parseInt(sheet.getAttribute("data-page") as string, 10) - 1 : -1;
    },
  };
  document.body.innerHTML = opts.markup ?? NATIVE_BOOK_HTML;
  document.elementFromPoint = () => null;

  const scrollCalls: Array<{ page: string | null; opts: unknown }> = [];
  for (const sheet of Array.from(document.querySelectorAll(".gp-sheet")) as Array<{
    getAttribute(name: string): string | null;
    scrollIntoView?: (opts: unknown) => void;
  }>) {
    sheet.scrollIntoView = (scrollOpts: unknown) =>
      scrollCalls.push({ page: sheet.getAttribute("data-page"), opts: scrollOpts });
  }

  const runInterface = new Function(
    "window",
    "document",
    "CustomEvent",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    interfaceSource,
  );
  runInterface(
    win,
    document,
    (win as unknown as { CustomEvent: unknown }).CustomEvent,
    (win as unknown as { MutationObserver: unknown }).MutationObserver,
    setTimeout,
    clearTimeout,
  );

  const posted: unknown[] = [];
  if (opts.bridge !== false) {
    Object.defineProperty(win, "parent", {
      configurable: true,
      value: { postMessage: (message: unknown) => posted.push(message) },
    });
    const runBridge = new Function("window", "document", "setTimeout", bridgeSource);
    runBridge(win, document, setTimeout);
  }

  return { window: win, document, api: (win as unknown as { previewAPI: unknown }).previewAPI, scrollCalls, posted };
}

/** Dispatches a `message` event at `win` the way a real cross-origin
 *  postMessage arrives, with `data`/`source` set the way `Window.postMessage`
 *  would — matches the pattern `preview-mutation-protocol-characterization.test.ts`'s
 *  `loadShell().fromHost` and `preview-shell-regression.test.mjs`'s
 *  `installBridge` both already use for this exact scripting family. */
function dispatchMessage(win: Window, data: unknown, source: unknown = null): void {
  const event = new (win as unknown as { Event: new (type: string) => Event }).Event("message");
  Object.defineProperties(event, { data: { value: data }, source: { value: source } });
  (win as unknown as { dispatchEvent(e: Event): void }).dispatchEvent(event);
}

function reply(posted: unknown[], id: number): { ok: boolean; result?: unknown; error?: string } | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return posted.find((m: any) => m && m.type === "gutterpress:reply" && m.id === id) as
    | { ok: boolean; result?: unknown; error?: string }
    | undefined;
}

describe("preview-bridge.js dispatches host navigation commands to the REAL previewAPI", () => {
  test("liveness: the fixture has 2 real .gp-sheet pages and a real, callable previewAPI", () => {
    const { document, api } = loadBook();
    expect(document.querySelectorAll(".gp-sheet").length).toBe(2);
    expect(typeof api.getTotalPages).toBe("function");
    expect(typeof api.goToPage).toBe("function");
    expect(typeof api.getContextTargetAt).toBe("function");
  });

  test("getTotalPages: the reply carries the REAL page count from the REAL DOM, not a stub value", () => {
    const { window, posted } = loadBook();
    dispatchMessage(window, { type: "gutterpress:cmd", id: 1, cmd: "getTotalPages", args: [] });
    const r = reply(posted, 1);
    expect(r).toBeDefined();
    expect(r!.ok).toBe(true);
    expect(r!.result).toBe(2);
  });

  test("goToPage(2): the reply matches notifyPageChange's real shape AND the real sheet's scrollIntoView actually fired", () => {
    const { window, posted, scrollCalls } = loadBook();
    dispatchMessage(window, { type: "gutterpress:cmd", id: 7, cmd: "goToPage", args: [2] });
    const r = reply(posted, 7);
    expect(r?.ok).toBe(true);
    expect(r?.result).toEqual({ currentPage: 2, totalPages: 2 });
    expect(scrollCalls).toEqual([
      { page: "2", opts: { behavior: "instant", block: "start", inline: "start" } },
    ]);
  });

  test("nextPage/prevPage/getCurrentPage round-trip through the bridge and agree with each other", () => {
    const { window, posted } = loadBook();
    dispatchMessage(window, { type: "gutterpress:cmd", id: 1, cmd: "goToPage", args: [1] });
    dispatchMessage(window, { type: "gutterpress:cmd", id: 2, cmd: "nextPage", args: [] });
    expect(reply(posted, 2)?.result).toEqual({ currentPage: 2, totalPages: 2 });
    dispatchMessage(window, { type: "gutterpress:cmd", id: 3, cmd: "prevPage", args: [] });
    expect(reply(posted, 3)?.result).toEqual({ currentPage: 1, totalPages: 2 });
    dispatchMessage(window, { type: "gutterpress:cmd", id: 4, cmd: "getCurrentPage", args: [] });
    expect(reply(posted, 4)?.result).toBe(1);
  });

  test("getContextTargetAt(image): the reply carries the REAL resolved image payload (open-image / go-to-source targeting)", () => {
    const { window, document, posted } = loadBook();
    const img = document.getElementById("img");
    document.elementFromPoint = () => img;
    dispatchMessage(window, { type: "gutterpress:cmd", id: 9, cmd: "getContextTargetAt", args: [{ x: 1, y: 1 }] });
    const r = reply(posted, 9);
    expect(r?.ok).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = r!.result as any;
    expect(result.kind).toBe("image");
    expect(result.image).toEqual({ src: "art.jpg", alt: "Art", source: { token: "![Art](art.jpg)", occurrence: 0 } });
  });

  test("getContextTargetAt(link): the reply carries the REAL resolved link payload (open-link targeting)", () => {
    const { window, document, posted } = loadBook();
    const lnk = document.getElementById("lnk");
    document.elementFromPoint = () => lnk;
    dispatchMessage(window, { type: "gutterpress:cmd", id: 10, cmd: "getContextTargetAt", args: [{ x: 1, y: 1 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = reply(posted, 10)!.result as any;
    expect(result.kind).toBe("link");
    expect(result.link.href).toBe("https://example.com/x");
  });

  test("an unknown command replies ok:false and never touches previewAPI", () => {
    const { window, posted } = loadBook();
    dispatchMessage(window, { type: "gutterpress:cmd", id: 3, cmd: "notAThing", args: [] });
    const r = reply(posted, 3);
    expect(r?.ok).toBe(false);
    expect(r?.error).toContain("Unknown command");
  });

  describe("G-12: this bridge-dispatch mechanism is provably sensitive to real breakage (not vacuously green)", () => {
    test("sabotaging preview-bridge.js's own command-dispatch line changes the round-trip result", () => {
      // In-memory only: the STRING read from the real file is patched before
      // being compiled with `new Function`. The file on disk is never
      // touched — this lane owns no production source. Per
      // docs/plans/source-first-editor/pr158-lessons.md §11.2, the sabotage
      // "may be performed locally and documented; it does not need to remain
      // committed" as a literal red test — the differential assertion below
      // is the committed, permanently-green proof that the mechanism reacts
      // to real breakage.
      const marker = "return api[cmd].apply(api, args || []);";
      expect(bridgeSource).toContain(marker); // liveness: the sabotage targets code that really exists
      const sabotaged = bridgeSource.replace(marker, "return 'SABOTAGED';");
      expect(sabotaged).not.toBe(bridgeSource);

      const good = loadBook();
      dispatchMessage(good.window, { type: "gutterpress:cmd", id: 1, cmd: "getTotalPages", args: [] });
      const goodResult = reply(good.posted, 1)?.result;
      expect(goodResult).toBe(2); // the real behavior this file's other tests pin

      const broken = loadBook({ bridge: false });
      const posted: unknown[] = [];
      Object.defineProperty(broken.window, "parent", {
        configurable: true,
        value: { postMessage: (m: unknown) => posted.push(m) },
      });
      const runSabotagedBridge = new Function("window", "document", "setTimeout", sabotaged);
      runSabotagedBridge(broken.window, broken.document, setTimeout);
      dispatchMessage(broken.window, { type: "gutterpress:cmd", id: 1, cmd: "getTotalPages", args: [] });
      const brokenResult = reply(posted, 1)?.result;
      expect(brokenResult).toBe("SABOTAGED");
      expect(brokenResult).not.toBe(goodResult); // the exact divergence a real regression here would produce
    });
  });
});

describe("preview-shell.js + preview-bridge.js + preview-interface.js: the FULL real relay chain for a host navigation command", () => {
  interface ShellBookHarness {
    outer: Window;
    hostEvents: unknown[];
    fromHost: (data: unknown) => void;
    getFocusCalls: () => number;
    document: Document;
  }

  /** The three-layer harness: a shell window (running the real
   *  preview-shell.js) with a REAL `<iframe>` child running the REAL
   *  preview-interface.js + preview-bridge.js together — mirrors
   *  `preview-shell-regression.test.mjs`'s `installBook`/`installBridge`
   *  pair and `preview-mutation-protocol-characterization.test.ts`'s
   *  `loadShell` globals setup, combined so the book iframe is real instead
   *  of a stub. */
  function loadShellWithBook(markup = NATIVE_BOOK_HTML): ShellBookHarness {
    const outer = new Window({ url: "http://localhost/" }) as unknown as Window;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const document = outer.document as any;
    const hostEvents: unknown[] = [];
    const hostParent = { postMessage: (m: unknown) => hostEvents.push(m) };
    Object.defineProperty(outer, "parent", { configurable: true, value: hostParent });

    const active = document.createElement("iframe");
    active.id = "gutterpress-active";
    active.title = "preview";
    document.body.appendChild(active);

    const frameWindow = active.contentWindow;
    const frameDocument = active.contentDocument;
    frameDocument.head.innerHTML = '<script src="/engine/gutterpress-viewer.js"></script>';
    frameWindow.Gutterpress = {
      pageOf(el: { closest?: (sel: string) => { getAttribute(name: string): string | null } | null } | null) {
        const sheet = el && el.closest ? el.closest(".gp-sheet") : null;
        return sheet ? parseInt(sheet.getAttribute("data-page") as string, 10) - 1 : -1;
      },
    };
    frameDocument.body.innerHTML = markup;
    for (const sheet of Array.from(frameDocument.querySelectorAll(".gp-sheet")) as Array<{
      scrollIntoView?: (opts: unknown) => void;
    }>) {
      sheet.scrollIntoView = () => {};
    }

    const runInterface = new Function(
      "window",
      "document",
      "CustomEvent",
      "MutationObserver",
      "setTimeout",
      "clearTimeout",
      interfaceSource,
    );
    runInterface(frameWindow, frameDocument, frameWindow.CustomEvent, frameWindow.MutationObserver, setTimeout, clearTimeout);

    // Route the book iframe's window.parent.postMessage back into the shell
    // window as a genuine `message` event carrying the frame as `source` —
    // the same technique preview-shell-regression.test.mjs's installBridge
    // uses for this exact script pairing.
    Object.defineProperty(frameWindow, "parent", {
      configurable: true,
      value: {
        postMessage(message: unknown) {
          const event = new outer.Event("message");
          Object.defineProperties(event, { data: { value: message }, source: { value: frameWindow } });
          outer.dispatchEvent(event);
        },
      },
    });
    // happy-dom's REAL `window.postMessage()` delivers asynchronously (a
    // task-queue tick), which would make preview-shell.js's
    // `active.contentWindow.postMessage(e.data, '*')` relay (the
    // shell→book/host→book direction) invisible to a synchronous assertion.
    // Every other harness in this file/family (installBridge in
    // preview-shell-regression.test.mjs, loadShell in
    // preview-mutation-protocol-characterization.test.ts) sidesteps this the
    // same way: replace postMessage with a synchronous direct dispatch so
    // the relay is deterministic and test-observable without timer ticks.
    frameWindow.postMessage = (message: unknown) => {
      const event = new frameWindow.Event("message");
      Object.defineProperties(event, { data: { value: message } });
      frameWindow.dispatchEvent(event);
    };
    const runBridge = new Function("window", "document", "setTimeout", bridgeSource);
    runBridge(frameWindow, frameDocument, setTimeout);

    let focusCalls = 0;
    active.focus = () => {
      focusCalls += 1;
    };

    // preview-shell.js unconditionally wires a change-source at load time;
    // without these globals it falls through to a real WebSocket attempt
    // this DOM cannot serve (same precondition
    // preview-mutation-protocol-characterization.test.ts's loadShell uses).
    (outer as unknown as { __GUTTERPRESS_INSTANCE: string }).__GUTTERPRESS_INSTANCE = "cli";
    (outer as unknown as { __GUTTERPRESS_REVISION: number }).__GUTTERPRESS_REVISION = 0;
    (outer as unknown as { __GUTTERPRESS_CHANGE_SOURCE: unknown }).__GUTTERPRESS_CHANGE_SOURCE = {
      subscribe: () => () => {},
      acknowledge: () => {},
    };
    const noDelaySetTimeout = ((cb: (...args: unknown[]) => void) => {
      cb();
      return 1;
    }) as unknown as typeof setTimeout;
    const noopClearTimeout = (() => {}) as typeof clearTimeout;
    const runShell = new Function("window", "document", "setTimeout", "clearTimeout", shellSource);
    runShell(outer, document, noDelaySetTimeout, noopClearTimeout);

    function fromHost(data: unknown): void {
      const event = new outer.Event("message");
      Object.defineProperties(event, { data: { value: data }, source: { value: hostParent } });
      outer.dispatchEvent(event);
    }

    return { outer, hostEvents, fromHost, getFocusCalls: () => focusCalls, document };
  }

  test("liveness: the harness really wires a shell window around a real book iframe with a real previewAPI", () => {
    const h = loadShellWithBook();
    expect(h.document.getElementById("gutterpress-active")).toBeTruthy();
    const active = h.document.getElementById("gutterpress-active") as unknown as { contentWindow: { previewAPI: unknown } };
    expect(typeof (active.contentWindow.previewAPI as { getTotalPages?: unknown }).getTotalPages).toBe("function");
  });

  test("getTotalPages from the host reaches the REAL book through shell relay + bridge dispatch, and the REAL reply returns to the host", () => {
    const h = loadShellWithBook();
    h.fromHost({ type: "gutterpress:cmd", id: 42, cmd: "getTotalPages", args: [] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = h.hostEvents.find((m: any) => m && m.type === "gutterpress:reply" && m.id === 42) as
      | { ok: boolean; result: unknown }
      | undefined;
    expect(r).toBeDefined();
    expect(r!.ok).toBe(true);
    expect(r!.result).toBe(2); // the real book's real page count, round-tripped through all three real scripts
    expect(h.getFocusCalls()).toBe(0); // getTotalPages is not the beginBlockEdit special case
  });

  test("getContextTargetAt from the host round-trips the REAL resolved target through the full relay chain", () => {
    const h = loadShellWithBook();
    const active = h.document.getElementById("gutterpress-active") as unknown as {
      contentDocument: { getElementById(id: string): unknown; elementFromPoint?: unknown };
    };
    const img = active.contentDocument.getElementById("img");
    active.contentDocument.elementFromPoint = () => img;
    h.fromHost({ type: "gutterpress:cmd", id: 43, cmd: "getContextTargetAt", args: [{ x: 1, y: 1 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const r = h.hostEvents.find((m: any) => m && m.type === "gutterpress:reply" && m.id === 43) as
      | { ok: boolean; result: { kind: string; image: unknown } }
      | undefined;
    expect(r?.ok).toBe(true);
    expect(r?.result.kind).toBe("image");
    expect(h.getFocusCalls()).toBe(0);
  });

  test("G-12 contrast: a beginBlockEdit command through the SAME harness DOES trigger the focus special case — proving getFocusCalls() is live, not stuck at 0", () => {
    const h = loadShellWithBook();
    h.fromHost({ type: "gutterpress:cmd", id: 1, cmd: "beginBlockEdit", args: [{ chapter: "a.md", range: [0, 1], text: "x" }] });
    expect(h.getFocusCalls()).toBe(1);
  });
});
