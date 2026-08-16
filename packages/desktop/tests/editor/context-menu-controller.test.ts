import { test, expect, describe } from "bun:test";
import {
  ContextMenuController,
  type ContextMenuClient,
  type ContextMenuDeps,
} from "../../src/lib/routes/context-menu-controller.svelte";
import type { PreviewEvent } from "$lib/preview-client";
import type { ImagePropertiesValue } from "$lib/editor/image-classes";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// zoom-view-controller.test / page-nav-controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/**
 * context-menu-controller.svelte.ts — the open/dismiss matrix, positioning,
 * and the galley item sets (ADR 0011).
 *
 * Every target is node-addressed: the galley owns the document and its
 * rendered DOM carries no `data-source-range`. Menu actions mutate the
 * DOCUMENT through the frame; the editor's own whole-file save writes the
 * change to disk. The pre-galley suite that exercised source-token splices
 * and rect/mask geometry went with the code it covered.
 */

class FakeClient implements ContextMenuClient {
  private listeners: Array<(e: PreviewEvent) => void> = [];
  on(fn: (e: PreviewEvent) => void): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }
  emit(e: PreviewEvent): void {
    for (const l of this.listeners) l(e);
  }
}

/** A galley target: `galley.pos` present, `range` always null. */
function detail(over: Partial<PreviewEvent["detail"]> = {}): PreviewEvent["detail"] {
  return {
    kind: "block",
    chapter: "ch1.md",
    range: null,
    blockTag: "paragraph",
    galley: { pos: 12, src: null },
    x: 100,
    y: 100,
    via: "mouse",
    ...over,
  } as PreviewEvent["detail"];
}

interface Harness {
  ctrl: ContextMenuController;
  client: FakeClient;
  enabled: boolean;
  rendering: boolean;
  promptResult: string | null;
  promptCalls: Array<{ title: string; label: string; initialValue: string }>;
  imagePropertiesResult: ImagePropertiesValue | null;
  imagePropertiesCalls: ImagePropertiesValue[];
  openMediaPanelCalls: number;
  copyToClipboardCalls: string[];
  toastSuccessCalls: string[];
  toastErrorCalls: string[];
  workspaceRect: { left: number; top: number; width: number; height: number } | null;
  iframeOrigin: { left: number; top: number } | null;
  setImageAttrsCalls: Array<Record<string, unknown>>;
  setImageAttrsOk: boolean;
  setLinkCalls: Array<{ pos?: number; href: string | null }>;
  setLinkOk: boolean;
  openOpaqueCalls: Array<[string, number, string]>;
}

function make(): Harness {
  const client = new FakeClient();
  const h: Harness = {
    ctrl: undefined as unknown as ContextMenuController,
    client,
    enabled: true,
    rendering: false,
    promptResult: "edited",
    promptCalls: [],
    imagePropertiesResult: null,
    imagePropertiesCalls: [],
    openMediaPanelCalls: 0,
    copyToClipboardCalls: [],
    toastSuccessCalls: [],
    toastErrorCalls: [],
    workspaceRect: { left: 0, top: 0, width: 1000, height: 800 },
    iframeOrigin: { left: 10, top: 20 },
    setImageAttrsCalls: [],
    setImageAttrsOk: true,
    setLinkCalls: [],
    setLinkOk: true,
    openOpaqueCalls: [],
  };
  const deps: ContextMenuDeps = {
    client: () => client,
    enabled: () => h.enabled,
    rendering: () => h.rendering,
    getIframeOrigin: () => h.iframeOrigin,
    getWorkspaceRect: () => h.workspaceRect,
    promptText: async (opts) => {
      h.promptCalls.push(opts);
      return h.promptResult;
    },
    promptImageProperties: async (initial) => {
      h.imagePropertiesCalls.push(initial);
      return h.imagePropertiesResult;
    },
    openMediaPanel: () => h.openMediaPanelCalls++,
    copyToClipboard: async (text) => {
      h.copyToClipboardCalls.push(text);
    },
    toastSuccess: (m) => h.toastSuccessCalls.push(m),
    toastError: (m) => h.toastErrorCalls.push(m),
    galley: {
      setImageAttrs: async (spec) => {
        h.setImageAttrsCalls.push(spec as Record<string, unknown>);
        return { ok: h.setImageAttrsOk };
      },
      setLink: async (spec) => {
        h.setLinkCalls.push(spec);
        return { ok: h.setLinkOk };
      },
      openOpaqueEditor: (chapter, pos, src) => h.openOpaqueCalls.push([chapter, pos, src]),
    },
  };
  h.ctrl = new ContextMenuController(deps);
  h.ctrl.subscribe(client);
  return h;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

const imageDetail = (attrsRaw = "{.gp-right width=40%}") =>
  detail({
    kind: "image",
    blockTag: "image",
    galley: { pos: 64, src: null },
    image: { src: "cover.png", alt: "Cover", attrsRaw, source: null },
  });

const run = async (h: Harness, id: string) => {
  const item = h.ctrl.items.find((i) => i.id === id);
  expect(item, `item ${id} present`).toBeDefined();
  await item!.run();
};

// ── lifecycle ────────────────────────────────────────────────────────────────

describe("open", () => {
  test("opens on a resolvable galley target", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.items.length).toBeGreaterThan(0);
  });

  test("kind 'none' never opens, and closes an already-open menu", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "none" }) });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });

  test("ignores requests while a render is in flight", async () => {
    const h = make();
    h.rendering = true;
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });

  test("does nothing when the preview.contextMenu setting is off", async () => {
    const h = make();
    h.enabled = false;
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });

  test("keyboard invocation opens the same way", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: { ...imageDetail(), via: "keyboard" } as PreviewEvent["detail"],
    });
    await flush();
    expect(h.ctrl.open).toBe(true);
  });

  test("a second request reopens at the new target", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    const firstX = h.ctrl.x;
    h.client.emit({
      name: "contextMenuRequested",
      detail: { ...imageDetail(), x: 400, y: 300 } as PreviewEvent["detail"],
    });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.x).not.toBe(firstX);
  });
});

describe("dismissal", () => {
  test("close() closes an open menu and clears its items", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    h.ctrl.close();
    expect(h.ctrl.open).toBe(false);
    expect(h.ctrl.items.length).toBe(0);
  });

  test("close() is idempotent", () => {
    const h = make();
    h.ctrl.close();
    h.ctrl.close();
    expect(h.ctrl.open).toBe(false);
  });

  test("renderingComplete closes it — the anchor geometry is now stale", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    h.client.emit({ name: "renderingComplete", detail: {} });
    expect(h.ctrl.open).toBe(false);
  });

  test("renderingStarted closes it before the frame is replaced", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    h.client.emit({ name: "renderingStarted", detail: { hotReload: true } });
    expect(h.ctrl.open).toBe(false);
  });

  test("page and viewport notifications leave it open", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    h.client.emit({ name: "pageChanged", detail: { currentPage: 2 } });
    h.client.emit({ name: "viewportChanged", detail: {} });
    expect(h.ctrl.open).toBe(true);
  });
});

describe("positioning", () => {
  const at = (x: number, y: number) =>
    ({ ...imageDetail(), x, y }) as PreviewEvent["detail"];

  test("anchors at iframe origin + event point", async () => {
    const h = make();
    h.iframeOrigin = { left: 10, top: 20 };
    h.client.emit({ name: "contextMenuRequested", detail: at(100, 100) });
    await flush();
    expect(h.ctrl.x).toBe(110);
    expect(h.ctrl.y).toBe(120);
  });

  test("flips and clamps near the workspace edge", async () => {
    const h = make();
    h.iframeOrigin = { left: 0, top: 0 };
    h.workspaceRect = { left: 0, top: 0, width: 300, height: 300 };
    h.client.emit({ name: "contextMenuRequested", detail: at(295, 295) });
    await flush();
    expect(h.ctrl.x).toBeLessThanOrEqual(300);
    expect(h.ctrl.y).toBeLessThanOrEqual(300);
    expect(h.ctrl.x).toBeGreaterThanOrEqual(0);
    expect(h.ctrl.y).toBeGreaterThanOrEqual(0);
  });

  test("reportMenuSize reflows the clamp with the measured size", async () => {
    const h = make();
    h.iframeOrigin = { left: 0, top: 0 };
    h.workspaceRect = { left: 0, top: 0, width: 300, height: 300 };
    h.client.emit({ name: "contextMenuRequested", detail: at(280, 280) });
    await flush();
    h.ctrl.reportMenuSize(400, 50);
    expect(h.ctrl.x).toBeGreaterThanOrEqual(0);
    expect(h.ctrl.y).toBeLessThanOrEqual(300);
  });

  test("no workspace rect: falls back to the raw anchor", async () => {
    const h = make();
    h.workspaceRect = null;
    h.iframeOrigin = { left: 5, top: 5 };
    h.client.emit({ name: "contextMenuRequested", detail: at(1, 1) });
    await flush();
    expect(h.ctrl.x).toBe(6);
    expect(h.ctrl.y).toBe(6);
  });
});

describe("runItem", () => {
  test("does not run a disabled item", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "link",
        galley: { pos: 43, src: null },
        // No href — "Copy link target" is the disabled item.
        link: { href: null, text: "bare", source: null },
      }),
    });
    await flush();
    const copy = h.ctrl.items.find((i) => i.id === "link-copy")!;
    expect(copy.enabled).toBe(false);
    await h.ctrl.runItem(copy);
    expect(h.copyToClipboardCalls).toEqual([]);
  });

  test("runs an enabled item", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    const reveal = h.ctrl.items.find((i) => i.id === "image-reveal")!;
    await h.ctrl.runItem(reveal);
    expect(h.openMediaPanelCalls).toBe(1);
  });
});

// ── galley item sets ─────────────────────────────────────────────────────────

describe("image targets", () => {
  test("offer properties + reveal, and write the doc — never the file", async () => {
    const h = make();
    h.imagePropertiesResult = {
      src: "cover.png",
      alt: "Cover",
      width: "",
      position: "gp-left",
      pinAlignment: "center",
      size: "",
      spacing: "",
      shape: false,
      layer: "",
    };
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["image-properties", "image-reveal"]);

    await run(h, "image-properties");
    // The modal is seeded from the node's OWN authored braces.
    expect(h.imagePropertiesCalls[0]!.position).toBe("gp-right");
    expect(h.imagePropertiesCalls[0]!.width).toBe("40%");
    // The write addresses the node and carries rewritten braces.
    expect(h.setImageAttrsCalls).toHaveLength(1);
    expect(h.setImageAttrsCalls[0]!.pos).toBe(64);
    expect(String(h.setImageAttrsCalls[0]!.attrsRaw)).toContain("gp-left");
    expect(h.toastSuccessCalls).toEqual(["Updated."]);
  });

  test("a cancelled modal writes nothing", async () => {
    const h = make();
    h.imagePropertiesResult = null;
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    await run(h, "image-properties");
    expect(h.setImageAttrsCalls).toHaveLength(0);
  });

  test("an unchanged modal result writes nothing", async () => {
    const h = make();
    h.imagePropertiesResult = {
      src: "cover.png",
      alt: "Cover",
      width: "40%",
      position: "gp-right",
      pinAlignment: "center",
      size: "",
      spacing: "",
      shape: false,
      layer: "",
    };
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    await run(h, "image-properties");
    expect(h.setImageAttrsCalls).toHaveLength(0);
  });

  test("width and a preset size together are refused before any write", async () => {
    const h = make();
    h.imagePropertiesResult = {
      src: "cover.png",
      alt: "Cover",
      width: "50%",
      position: "",
      pinAlignment: "center",
      size: "gp-medium",
      spacing: "",
      shape: false,
      layer: "",
    };
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    await run(h, "image-properties");
    expect(h.setImageAttrsCalls).toHaveLength(0);
    expect(h.toastErrorCalls[0]).toContain("either a custom width or a preset size");
  });

  test("a refused write is reported", async () => {
    const h = make();
    h.setImageAttrsOk = false;
    h.imagePropertiesResult = {
      src: "other.png",
      alt: "Cover",
      width: "",
      position: "gp-right",
      pinAlignment: "center",
      size: "",
      spacing: "",
      shape: false,
      layer: "",
    };
    h.client.emit({ name: "contextMenuRequested", detail: imageDetail() });
    await flush();
    await run(h, "image-properties");
    expect(h.toastErrorCalls).toEqual(["Couldn't update this image."]);
  });
});

describe("link targets", () => {
  const linkDetail = () =>
    detail({
      kind: "link",
      blockTag: "link",
      galley: { pos: 43, src: null },
      link: { href: "https://example.com/a", text: "the link", source: null },
    });

  test("edit rewrites the mark at the node position", async () => {
    const h = make();
    h.promptResult = "https://example.com/changed";
    h.client.emit({ name: "contextMenuRequested", detail: linkDetail() });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["link-edit", "link-remove", "link-copy"]);
    await run(h, "link-edit");
    expect(h.promptCalls[0]!.initialValue).toBe("https://example.com/a");
    expect(h.setLinkCalls).toEqual([{ pos: 43, href: "https://example.com/changed" }]);
  });

  test("a cancelled prompt writes nothing", async () => {
    const h = make();
    h.promptResult = null;
    h.client.emit({ name: "contextMenuRequested", detail: linkDetail() });
    await flush();
    await run(h, "link-edit");
    expect(h.setLinkCalls).toHaveLength(0);
  });

  test("remove unlinks with href null", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: linkDetail() });
    await flush();
    await run(h, "link-remove");
    expect(h.setLinkCalls).toEqual([{ pos: 43, href: null }]);
  });

  test("copy puts the target on the clipboard", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: linkDetail() });
    await flush();
    await run(h, "link-copy");
    expect(h.copyToClipboardCalls).toEqual(["https://example.com/a"]);
  });
});

describe("opaque and plain blocks", () => {
  test("an opaque block opens the source editor at its node position", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ blockTag: "rawBlock", galley: { pos: 88, src: "<div>raw</div>" } }),
    });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["block-edit-source"]);
    await run(h, "block-edit-source");
    expect(h.openOpaqueCalls).toEqual([["ch1.md", 88, "<div>raw</div>"]]);
  });

  test("a plain block has no menu — the caret is already in it", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });
});

describe("selection targets", () => {
  // The frame preventDefaults for every non-"none" target, so a selection MUST
  // get a menu — otherwise right-clicking selected text offers nothing at all.
  test("offer Copy", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        galley: { pos: 5, src: null },
        selection: { text: "chosen words", withinSingleBlock: true, range: null, chapter: "ch1.md" },
      }),
    });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["selection-copy"]);
    await run(h, "selection-copy");
    expect(h.copyToClipboardCalls).toEqual(["chosen words"]);
  });
});

describe("non-galley frames", () => {
  test("a target without a node handle builds no menu", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: { ...detail(), galley: null, range: [2, 3] } as PreviewEvent["detail"],
    });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });
});
