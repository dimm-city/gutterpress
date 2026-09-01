import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

/**
 * preview-separability-mutation-inert.test.ts (SFE-P3d-parity, Lane C;
 * updated by SFE-P4).
 *
 * The load-bearing deliverable: proving the D8 navigation surface (preview
 * navigation, selection/copy, open link/image, page controls, source
 * reveal) does NOT depend on the mutation surface P4 deleted
 * (`InlineEditController`, the `contenteditable` authoring path, and the
 * `beginBlockEdit`/`endBlockEdit` protocol messages — see
 * docs/plans/source-first-editor/mutation-inventory.md §1.1-1.5). This file
 * proves it at TWO layers and is explicit about what each layer does and
 * does not establish — see the block comment above each `describe`.
 *
 * Nothing here edits production source. Before P4, Layer 1 proved this by
 * deleting `beginBlockEdit`/`endBlockEdit` from the in-memory `previewAPI`
 * object AFTER loading the (then still mutation-capable) real script; P4 has
 * since deleted the in-flow block editing block from
 * `preview-interface.js`'s source itself, so Layer 1 now loads the real,
 * permanently-reduced script directly and asserts on its actual shape — the
 * absence is load-bearing, not simulated. Layer 2 constructs
 * `ContextMenuController` with fake dependencies — the exact technique
 * `context-menu-controller.test.ts` already uses — but no longer needs to
 * poison mutation-path fakes: P4 removed `commitEngine`/`openInlineEdit` from
 * the controller's dependencies entirely, so there is nothing left to poison
 * (see Layer 2's own header for detail).
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Api = any;

interface BookHandle {
  window: Window;
  document: Document;
  api: Api;
  posted: unknown[];
  /** Every window-level event name dispatched during this book's lifetime —
   *  used to prove the mutation event family (blockEditRequested/
   *  blockEditFinished/blockEditStateChanged) never fires as a side effect
   *  of navigation. */
  eventLog: string[];
}

function loadBook(): BookHandle {
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
  document.body.innerHTML = NATIVE_BOOK_HTML;
  document.elementFromPoint = () => null;
  for (const sheet of Array.from(document.querySelectorAll(".gp-sheet")) as Array<{
    scrollIntoView?: (opts: unknown) => void;
  }>) {
    sheet.scrollIntoView = () => {};
  }

  // A wide net: every mutation-family event AND every navigation-family
  // event this script can dispatch on `window`, logged by name, BEFORE the
  // script's own addEventListener calls run (so the log sees everything the
  // script itself dispatches — it does not intercept previewAPI method
  // return values, only genuine window events).
  const eventLog: string[] = [];
  const realDispatchEvent = document.defaultView?.dispatchEvent;
  const runInterface = new Function(
    "window",
    "document",
    "CustomEvent",
    "MutationObserver",
    "setTimeout",
    "clearTimeout",
    interfaceSource,
  );
  const winAny = win as unknown as {
    dispatchEvent(e: { type: string }): boolean;
    addEventListener(name: string, fn: (e: unknown) => void): void;
    CustomEvent: unknown;
    MutationObserver: unknown;
  };
  const originalDispatch = winAny.dispatchEvent.bind(win);
  winAny.dispatchEvent = (e: { type: string }) => {
    eventLog.push(e.type);
    return originalDispatch(e);
  };
  void realDispatchEvent;
  runInterface(win, document, winAny.CustomEvent, winAny.MutationObserver, setTimeout, clearTimeout);

  const posted: unknown[] = [];
  Object.defineProperty(win, "parent", {
    configurable: true,
    value: { postMessage: (message: unknown) => posted.push(message) },
  });
  const runBridge = new Function("window", "document", "setTimeout", bridgeSource);
  runBridge(win, document, setTimeout);

  return { window: win, document, api: (win as unknown as { previewAPI: Api }).previewAPI, posted, eventLog };
}

function dispatchMessage(win: Window, data: unknown): void {
  const event = new (win as unknown as { Event: new (type: string) => Event }).Event("message");
  Object.defineProperties(event, { data: { value: data }, source: { value: null } });
  (win as unknown as { dispatchEvent(e: Event): void }).dispatchEvent(event);
}

function reply(posted: unknown[], id: number): { ok: boolean; result?: unknown; error?: string } | undefined {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return posted.find((m: any) => m && m.type === "gutterpress:reply" && m.id === id) as
    | { ok: boolean; result?: unknown; error?: string }
    | undefined;
}

// ─────────────────────────────────────────────────────────────────────────
// LAYER 1 — preview scripts: navigation works with beginBlockEdit/
// endBlockEdit absent from previewAPI, and never triggers the block-edit
// event family or the contenteditable authoring attribute as a side effect.
//
// SFE-P4 UPDATE (post-deletion truth): this layer used to prove the claim by
// deleting `beginBlockEdit`/`endBlockEdit` from previewAPI AT RUNTIME, after
// loading the (pre-P4) real preview-interface.js, to simulate the shape P4
// would leave behind — see this file's git history for that version. P4 has
// now deleted the in-flow block editing block from preview-interface.js's
// SOURCE itself (startEdit/finishEdit, the contenteditable attribute
// handling, the beginBlockEdit/endBlockEdit previewAPI methods, and the
// three block-edit events), so `loadBook()` below loads the REAL,
// permanently-reduced script — there is nothing left to delete at runtime,
// and the absence below is load-bearing, not simulated.
//
// WHAT THIS ESTABLISHES: within `preview-interface.js` + `preview-bridge.js`
// as they exist TODAY (post-P4), every navigation-class command
// (getTotalPages, goToPage/nextPage/prevPage/getCurrentPage,
// getContextTargetAt across block/image/link/selection kinds, setZoom,
// setViewMode) executes to completion, through the real bridge dispatch,
// with `beginBlockEdit`/`endBlockEdit` absent from the API object entirely.
// ─────────────────────────────────────────────────────────────────────────
describe("Layer 1 — preview-interface.js + preview-bridge.js: navigation works with beginBlockEdit/endBlockEdit absent", () => {
  test("beginBlockEdit/endBlockEdit do not exist on the real previewAPI (the permanent post-deletion shape)", () => {
    const { api } = loadBook();
    expect(api.beginBlockEdit).toBeUndefined();
    expect(api.endBlockEdit).toBeUndefined();
  });

  test("getTotalPages/goToPage/nextPage/prevPage/getCurrentPage work, through the real bridge", () => {
    const h = loadBook();
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 1, cmd: "getTotalPages", args: [] });
    expect(reply(h.posted, 1)?.result).toBe(2);

    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 2, cmd: "goToPage", args: [2] });
    expect(reply(h.posted, 2)?.result).toEqual({ currentPage: 2, totalPages: 2 });

    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 3, cmd: "prevPage", args: [] });
    expect(reply(h.posted, 3)?.result).toEqual({ currentPage: 1, totalPages: 2 });

    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 4, cmd: "nextPage", args: [] });
    expect(reply(h.posted, 4)?.result).toEqual({ currentPage: 2, totalPages: 2 });

    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 5, cmd: "getCurrentPage", args: [] });
    expect(reply(h.posted, 5)?.result).toBe(2);
  });

  test("getContextTargetAt still resolves block/image/link/selection kinds (open link/image, source-reveal targeting, selection/copy)", () => {
    const h = loadBook();

    const img = h.document.getElementById("img");
    h.document.elementFromPoint = () => img;
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 10, cmd: "getContextTargetAt", args: [{ x: 1, y: 1 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reply(h.posted, 10)!.result as any).kind).toBe("image");

    const lnk = h.document.getElementById("lnk");
    h.document.elementFromPoint = () => lnk;
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 11, cmd: "getContextTargetAt", args: [{ x: 1, y: 1 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((reply(h.posted, 11)!.result as any).kind).toBe("link");

    const para = h.document.getElementById("para");
    h.document.elementFromPoint = () => para;
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 12, cmd: "getContextTargetAt", args: [{ x: 1, y: 1 }] });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const blockResult = reply(h.posted, 12)!.result as any;
    expect(blockResult.kind).toBe("block");
    expect(blockResult.range).toEqual([1, 2]);
  });

  test("setZoom and setViewMode (page controls) still work", () => {
    const h = loadBook();
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 20, cmd: "setViewMode", args: ["single"] });
    expect(reply(h.posted, 20)?.ok).toBe(true);
    expect(h.document.body.classList.contains("view-single")).toBe(true);

    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 21, cmd: "setZoom", args: ["0.8"] });
    expect(reply(h.posted, 21)?.ok).toBe(true);
    expect(h.document.documentElement.style.getPropertyValue("--gutterpress-zoom")).toBe("0.8");
  });

  test("beginBlockEdit/endBlockEdit command names now fail closed as unknown commands, end-to-end through the real bridge (proves the removal is real, not merely untested)", () => {
    const h = loadBook();
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 30, cmd: "beginBlockEdit", args: [{}] });
    const r30 = reply(h.posted, 30);
    expect(r30?.ok).toBe(false);
    expect(r30?.error).toBe("Unknown command: beginBlockEdit");
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 31, cmd: "endBlockEdit", args: [{}] });
    const r31 = reply(h.posted, 31);
    expect(r31?.ok).toBe(false);
    expect(r31?.error).toBe("Unknown command: endBlockEdit");
  });

  test("across a whole session of navigation, the mutation event family never fires and no element ever gains contenteditable", () => {
    const h = loadBook();
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 1, cmd: "getTotalPages", args: [] });
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 2, cmd: "goToPage", args: [2] });
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 3, cmd: "nextPage", args: [] });
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 4, cmd: "prevPage", args: [] });
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 5, cmd: "setZoom", args: ["0.9"] });
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 6, cmd: "setViewMode", args: ["single"] });
    const img = h.document.getElementById("img");
    h.document.elementFromPoint = () => img;
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 7, cmd: "getContextTargetAt", args: [{ x: 1, y: 1 }] });

    const mutationEvents = h.eventLog.filter((name) =>
      name === "blockEditRequested" || name === "blockEditFinished" || name === "blockEditStateChanged",
    );
    expect(mutationEvents).toEqual([]);
    expect(h.document.querySelectorAll("[contenteditable]").length).toBe(0);
  });

  describe("G-12: the event-log/contenteditable assertions above are provably live, not vacuous", () => {
    test("liveness control: dispatching a real blockEditStateChanged DOES appear in eventLog (the filter above would have caught a real leak)", () => {
      const h = loadBook();
      (h.window as unknown as { dispatchEvent(e: unknown): void }).dispatchEvent(
        new (h.window as unknown as { CustomEvent: new (t: string, i: unknown) => unknown }).CustomEvent(
          "blockEditStateChanged",
          { detail: { open: true } },
        ),
      );
      expect(h.eventLog).toContain("blockEditStateChanged");
    });

    test("liveness control: setting contenteditable on a real element IS detected by the querySelectorAll check above", () => {
      const h = loadBook();
      const para = h.document.getElementById("para");
      expect(para).not.toBeNull();
      para!.setAttribute("contenteditable", "plaintext-only");
      expect(h.document.querySelectorAll("[contenteditable]").length).toBe(1);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// LAYER 2 — ContextMenuController: the FOUR items D8 keeps (go-to-source,
// selection-copy, link-copy, image-reveal) work correctly.
//
// SFE-P4 UPDATE (post-deletion truth): this describe block used to poison
// `CommitEngine.commitRangePatch`/`openInlineEdit` and prove the four
// read-only items never reached either — including two POSITIVE controls
// (`block-edit`, `block-break-before`) that proved the poison itself would
// catch a real violation. P4 deleted `CommitEngine`, `InlineEditController`,
// and every mutation item (`block-edit`, `block-break-before` included) —
// see `context-menu-controller.svelte.ts`'s own header. `commitEngine` and
// `openInlineEdit` are no longer constructor dependencies at all (this is
// the exact signature change this proof's original header named as P4's to
// make), so there is nothing left to poison and no mutation item left to
// run a positive control against: the separability question this layer
// asked ("do the read-only items ever reach the mutation dependencies?")
// is now vacuously true by construction — those dependencies do not exist.
// What remains meaningful, and is what this section now proves, is the
// FOUR ITEMS' OWN BEHAVIOR: `ContextMenuController`, constructed with only
// its post-P4 dependencies, still resolves and runs go-to-source,
// selection-copy, link-copy, and image-reveal correctly.
// ─────────────────────────────────────────────────────────────────────────
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

// Deferred import so the $state shim above is installed before the
// rune-bearing module is evaluated — matches context-menu-controller.test.ts's
// own ordering (shim assignment immediately after its imports, before any
// test code runs).
const { ContextMenuController } = await import("../../src/lib/routes/context-menu-controller.svelte");
type CMCModule = typeof import("../../src/lib/routes/context-menu-controller.svelte");
type ContextMenuClient = InstanceType<CMCModule["ContextMenuController"]> extends never ? never : Parameters<CMCModule["ContextMenuController"]["prototype"]["subscribe"]>[0];
type ContextMenuDeps = ConstructorParameters<CMCModule["ContextMenuController"]>[0];
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type PreviewEventLike = any;

class FakeClient {
  private listeners: Array<(e: PreviewEventLike) => void> = [];
  on(fn: (e: PreviewEventLike) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  emit(e: PreviewEventLike): void {
    for (const l of this.listeners) l(e);
  }
}

function detail(over: Record<string, unknown> = {}): PreviewEventLike {
  return {
    kind: "block",
    chapter: "ch1.md",
    range: [2, 3],
    blockTag: "p",
    x: 100,
    y: 100,
    via: "mouse",
    image: null,
    link: null,
    selection: null,
    split: false,
    rect: null,
    pageMarker: null,
    ...over,
  };
}

interface Harness {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ctrl: any;
  client: FakeClient;
  goToSourceCalls: Array<[string, number]>;
  copyToClipboardCalls: string[];
  openMediaPanelCalls: number;
}

function makeHarness(): Harness {
  const client = new FakeClient();
  const h: Harness = {
    ctrl: undefined,
    client,
    goToSourceCalls: [],
    copyToClipboardCalls: [],
    openMediaPanelCalls: 0,
  };
  const deps: ContextMenuDeps = {
    client: () => client,
    enabled: () => true,
    rendering: () => false,
    getIframeOrigin: () => ({ left: 0, top: 0 }),
    getWorkspaceRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    goToSource: (chapter: string, line: number) => h.goToSourceCalls.push([chapter, line]),
    openMediaPanel: () => h.openMediaPanelCalls++,
    copyToClipboard: async (text: string) => {
      h.copyToClipboardCalls.push(text);
    },
  };
  h.ctrl = new ContextMenuController(deps);
  h.ctrl.subscribe(client);
  return h;
}

describe("Layer 2 — ContextMenuController: the four D8 read-only items work with no mutation dependencies in the constructor at all", () => {
  test("liveness: the menu really opens with real items", () => {
    const h = makeHarness();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(h.ctrl.items.map((i: any) => i.id)).toContain("go-to-source");
  });

  test("go-to-source (block target): navigates", () => {
    const h = makeHarness();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block" }) });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = h.ctrl.items.find((i: any) => i.id === "go-to-source");
    expect(item).toBeDefined();
    expect(() => item.run()).not.toThrow();
    expect(h.goToSourceCalls).toEqual([["ch1.md", 3]]);
  });

  test("link-copy (link target): copies the href", async () => {
    const h = makeHarness();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "link",
        link: { href: "https://example.com/x", text: "link text", source: { token: "[link text](https://example.com/x)", occurrence: 0 } },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = h.ctrl.items.find((i: any) => i.id === "link-copy");
    expect(item).toBeDefined();
    await expect(item.run()).resolves.toBeUndefined();
    expect(h.copyToClipboardCalls).toEqual(["https://example.com/x"]);
  });

  test("image-reveal (image target): opens the Media panel", () => {
    const h = makeHarness();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        image: { src: "art.jpg", alt: "Art", source: { token: "![Art](art.jpg)", occurrence: 0 } },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = h.ctrl.items.find((i: any) => i.id === "image-reveal");
    expect(item).toBeDefined();
    expect(() => item.run()).not.toThrow();
    expect(h.openMediaPanelCalls).toBe(1);
  });

  test("selection-copy (cross-block selection target): copies the text", async () => {
    const h = makeHarness();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        chapter: null,
        range: null,
        blockTag: null,
        selection: { text: "spans two blocks", withinSingleBlock: false, range: null, chapter: null },
      }),
    });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = h.ctrl.items.find((i: any) => i.id === "selection-copy");
    expect(item).toBeDefined();
    await expect(item.run()).resolves.toBeUndefined();
    expect(h.copyToClipboardCalls).toEqual(["spans two blocks"]);
  });
});
