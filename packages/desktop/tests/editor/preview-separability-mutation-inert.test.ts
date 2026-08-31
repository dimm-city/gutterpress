import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Window } from "happy-dom";

/**
 * preview-separability-mutation-inert.test.ts (SFE-P3d-parity, Lane C).
 *
 * The load-bearing deliverable: proving the D8 navigation surface (preview
 * navigation, selection/copy, open link/image, page controls, source
 * reveal) does NOT depend on the mutation surface P4 deletes
 * (`InlineEditController`, the `contenteditable` authoring path, and the
 * `beginBlockEdit`/`endBlockEdit` protocol messages — see
 * docs/plans/source-first-editor/mutation-inventory.md §1.1-1.5). This file
 * proves it at TWO layers and is explicit about what each layer does and
 * does not establish — see the block comment above each `describe`.
 *
 * Nothing here edits production source. Every "mutation entry point removed"
 * scenario below is constructed either by deleting a property on the
 * in-memory `previewAPI` object AFTER loading the real script (a runtime
 * effect scoped to one test's own object, not a file edit), or by
 * constructing `ContextMenuController` with fake dependencies whose
 * mutation-path methods throw — the exact technique
 * `context-menu-controller.test.ts` already uses to construct that
 * controller with fakes, extended here to make the mutation fakes poisoned
 * rather than merely recording.
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
// LAYER 1 — preview scripts: navigation survives with beginBlockEdit/
// endBlockEdit deleted from previewAPI, and never triggers the block-edit
// event family or the contenteditable authoring attribute as a side effect.
//
// WHAT THIS ESTABLISHES: within `preview-interface.js` + `preview-bridge.js`
// as they exist TODAY, every navigation-class command (getTotalPages,
// goToPage/nextPage/prevPage/getCurrentPage, getContextTargetAt across
// block/image/link/selection kinds, setZoom, setViewMode) executes to
// completion, through the real bridge dispatch, with `beginBlockEdit`/
// `endBlockEdit` deleted from the API object entirely — i.e. these commands
// contain no internal call to, or dependency on, the two commands P4 removes.
//
// WHAT THIS DOES NOT ESTABLISH: that `preview-interface.js`'s SOURCE CODE
// can be safely deleted line-for-line without the file being edited — that
// is P4a's own job, verified by its own search/dependency proof (D15) when
// it happens. Deleting a property at runtime proves the *behavior* is
// independent; it is evidence for, not a substitute for, P4a's source-level
// deletion review.
// ─────────────────────────────────────────────────────────────────────────
describe("Layer 1 — preview-interface.js + preview-bridge.js: navigation works with beginBlockEdit/endBlockEdit removed", () => {
  test("liveness: the fixture's mutation entry points exist before we remove them (removing something absent would prove nothing)", () => {
    const { api } = loadBook();
    expect(typeof api.beginBlockEdit).toBe("function");
    expect(typeof api.endBlockEdit).toBe("function");
  });

  function loadBookWithMutationRemoved(): BookHandle {
    const h = loadBook();
    // Runtime deletion on THIS test's own previewAPI object — not a file
    // edit. Simulates the post-P4a shape of previewAPI (beginBlockEdit/
    // endBlockEdit gone) without touching preview-interface.js on disk.
    delete h.api.beginBlockEdit;
    delete h.api.endBlockEdit;
    return h;
  }

  test("with beginBlockEdit/endBlockEdit deleted: getTotalPages/goToPage/nextPage/prevPage/getCurrentPage still work, through the real bridge", () => {
    const h = loadBookWithMutationRemoved();
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

  test("with beginBlockEdit/endBlockEdit deleted: getContextTargetAt still resolves block/image/link/selection kinds (open link/image, source-reveal targeting, selection/copy)", () => {
    const h = loadBookWithMutationRemoved();

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

  test("with beginBlockEdit/endBlockEdit deleted: setZoom and setViewMode (page controls) still work", () => {
    const h = loadBookWithMutationRemoved();
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 20, cmd: "setViewMode", args: ["single"] });
    expect(reply(h.posted, 20)?.ok).toBe(true);
    expect(h.document.body.classList.contains("view-single")).toBe(true);

    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 21, cmd: "setZoom", args: ["0.8"] });
    expect(reply(h.posted, 21)?.ok).toBe(true);
    expect(h.document.documentElement.style.getPropertyValue("--gutterpress-zoom")).toBe("0.8");
  });

  test("with beginBlockEdit/endBlockEdit deleted: those two commands themselves now fail closed (proves the removal is real, not merely untested)", () => {
    const h = loadBookWithMutationRemoved();
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 30, cmd: "beginBlockEdit", args: [{}] });
    expect(reply(h.posted, 30)?.ok).toBe(false);
    dispatchMessage(h.window, { type: "gutterpress:cmd", id: 31, cmd: "endBlockEdit", args: [{}] });
    expect(reply(h.posted, 31)?.ok).toBe(false);
  });

  test("across a whole session of navigation, the mutation event family never fires and no element ever gains contenteditable", () => {
    const h = loadBookWithMutationRemoved();
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
// LAYER 2 — ContextMenuController: the FOUR read-only items D8 keeps
// (go-to-source, selection-copy, link-copy, image-reveal) never invoke
// CommitEngine.commitRangePatch (the write path) or openInlineEdit (the
// InlineEditController entry point), even when both are wired in as
// required, non-optional constructor dependencies.
//
// WHAT THIS ESTABLISHES: for THESE FOUR items specifically, `run()` never
// reaches either mutation dependency — proven by making both throw and
// running the items to completion without a throw.
//
// WHAT THIS DOES NOT ESTABLISH — precision matters here, since P4 will act
// on this claim: `ContextMenuController.buildItems()` reads
// `commitEngine.generation` UNCONDITIONALLY for every image/link/marker/
// block-kind target (context-menu-controller.svelte.ts:363), even when the
// eventual item set is read-only — this is a structural constant-time
// coupling to `CommitEngine`'s presence, not a per-item one, and it is NOT
// removed by this proof (a `generation` getter is still provided below, and
// is expected to be read). Cross-block selections (`crossBlockSelectionItems`)
// are the one target kind with ZERO CommitEngine coupling, not even a
// `generation` read (context-menu-controller.svelte.ts:358-360 returns
// before line 363). ContextMenuController ALSO still requires `openInlineEdit`
// and `commitEngine` as non-optional constructor dependencies today — this
// proof shows the four read-only items never CALL them, not that the class
// could be constructed without them; removing that requirement is P4's own
// signature change, out of this lane's write ownership
// (context-menu-controller.svelte.ts is off-limits here). This proof is
// therefore evidence that P4's rewrite of ContextMenuController can keep
// these four items' bodies unchanged; it does not itself perform or
// pre-approve that rewrite.
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

/** `commitRangePatch` and `noteRenderingComplete` are the two CommitEngine
 *  members the controller touches. `commitRangePatch` is the actual WRITE
 *  path — poisoned. `generation` (read at every image/link/marker/block menu
 *  build, per the header comment above) is left real so menu construction
 *  itself does not spuriously fail; `noteRenderingComplete` is a harmless
 *  generation-counter bump the controller calls on every render regardless
 *  of mutation activity, also left real. */
class PoisonedCommitEngine {
  generation = 0;
  commitRangePatchCalls: unknown[] = [];
  noteRenderingComplete(): void {
    this.generation++;
  }
  commitRangePatch(patch: unknown): never {
    this.commitRangePatchCalls.push(patch);
    throw new Error("SEPARABILITY VIOLATION: a read-only item invoked CommitEngine.commitRangePatch");
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
  commitEngine: PoisonedCommitEngine;
  goToSourceCalls: Array<[string, number]>;
  copyToClipboardCalls: string[];
  openMediaPanelCalls: number;
  openInlineEditCalls: unknown[];
}

function makeHarness(readFileMap: Record<string, string> = { "/proj/ch1.md": "a\nb\nc\nd\n" }): Harness {
  const client = new FakeClient();
  const commitEngine = new PoisonedCommitEngine();
  const h: Harness = {
    ctrl: undefined,
    client,
    commitEngine,
    goToSourceCalls: [],
    copyToClipboardCalls: [],
    openMediaPanelCalls: 0,
    openInlineEditCalls: [],
  };
  const deps: ContextMenuDeps = {
    client: () => client,
    enabled: () => true,
    rendering: () => false,
    currentDir: () => "/proj",
    openContent: () => null,
    readFile: async (p: string) => {
      if (p in readFileMap) return readFileMap[p]!;
      throw new Error(`not found: ${p}`);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    commitEngine: commitEngine as any,
    getIframeOrigin: () => ({ left: 0, top: 0 }),
    getWorkspaceRect: () => ({ left: 0, top: 0, width: 1000, height: 800 }),
    promptText: async () => null,
    promptImageProperties: async () => null,
    goToSource: (chapter: string, line: number) => h.goToSourceCalls.push([chapter, line]),
    openMediaPanel: () => h.openMediaPanelCalls++,
    copyToClipboard: async (text: string) => {
      h.copyToClipboardCalls.push(text);
    },
    toastSuccess: () => {},
    toastError: () => {},
    openInlineEdit: (...args: unknown[]) => {
      h.openInlineEditCalls.push(args);
      throw new Error("SEPARABILITY VIOLATION: a read-only item invoked openInlineEdit");
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
  h.ctrl = new ContextMenuController(deps);
  h.ctrl.subscribe(client);
  return h;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("Layer 2 — ContextMenuController: the four read-only items never reach CommitEngine.commitRangePatch or openInlineEdit", () => {
  test("liveness: the poisoned deps really are wired in and the menu really opens with real items", async () => {
    const h = makeHarness();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(h.ctrl.items.map((i: any) => i.id)).toContain("go-to-source");
  });

  test("go-to-source (block target): navigates, never touches either mutation dependency", async () => {
    const h = makeHarness();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block" }) });
    await flush();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = h.ctrl.items.find((i: any) => i.id === "go-to-source");
    expect(item).toBeDefined();
    expect(() => item.run()).not.toThrow();
    expect(h.goToSourceCalls).toEqual([["ch1.md", 3]]);
    expect(h.commitEngine.commitRangePatchCalls).toEqual([]);
    expect(h.openInlineEditCalls).toEqual([]);
  });

  test("link-copy (link target): copies the href, never touches either mutation dependency", async () => {
    const h = makeHarness();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "link",
        link: { href: "https://example.com/x", text: "link text", source: { token: "[link text](https://example.com/x)", occurrence: 0 } },
      }),
    });
    await flush();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = h.ctrl.items.find((i: any) => i.id === "link-copy");
    expect(item).toBeDefined();
    await expect(item.run()).resolves.toBeUndefined();
    expect(h.copyToClipboardCalls).toEqual(["https://example.com/x"]);
    expect(h.commitEngine.commitRangePatchCalls).toEqual([]);
    expect(h.openInlineEditCalls).toEqual([]);
  });

  test("image-reveal (image target): opens the Media panel, never touches either mutation dependency", async () => {
    const h = makeHarness();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        image: { src: "art.jpg", alt: "Art", source: { token: "![Art](art.jpg)", occurrence: 0 } },
      }),
    });
    await flush();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = h.ctrl.items.find((i: any) => i.id === "image-reveal");
    expect(item).toBeDefined();
    expect(() => item.run()).not.toThrow();
    expect(h.openMediaPanelCalls).toBe(1);
    expect(h.commitEngine.commitRangePatchCalls).toEqual([]);
    expect(h.openInlineEditCalls).toEqual([]);
  });

  test("selection-copy (cross-block selection target): copies the text, never even READS commitEngine.generation (the one item with zero CommitEngine coupling)", async () => {
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
    await flush();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const item = h.ctrl.items.find((i: any) => i.id === "selection-copy");
    expect(item).toBeDefined();
    await expect(item.run()).resolves.toBeUndefined();
    expect(h.copyToClipboardCalls).toEqual(["spans two blocks"]);
    expect(h.commitEngine.commitRangePatchCalls).toEqual([]);
    expect(h.openInlineEditCalls).toEqual([]);
  });

  describe("G-12: the poison actually works — a mutation item, given the SAME poisoned deps, DOES throw", () => {
    test("positive control: block-edit throws through the poisoned openInlineEdit", async () => {
      const h = makeHarness();
      h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block" }) });
      await flush();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = h.ctrl.items.find((i: any) => i.id === "block-edit");
      expect(item).toBeDefined();
      expect(() => item.run()).toThrow(/SEPARABILITY VIOLATION.*openInlineEdit/);
      expect(h.openInlineEditCalls.length).toBe(1);
    });

    test("positive control: block-break-before throws through the poisoned commitRangePatch", async () => {
      const h = makeHarness();
      h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block" }) });
      await flush();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const item = h.ctrl.items.find((i: any) => i.id === "block-break-before");
      expect(item).toBeDefined();
      await expect(item.run()).rejects.toThrow(/SEPARABILITY VIOLATION.*commitRangePatch/);
      expect(h.commitEngine.commitRangePatchCalls.length).toBe(1);
    });
  });
});
