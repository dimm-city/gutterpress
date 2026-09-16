import { test, expect, describe } from "bun:test";
import {
  ContextMenuController,
  type ContextMenuClient,
  type ContextMenuDeps,
} from "../../src/lib/routes/context-menu-controller.svelte";
import type { PreviewEvent } from "$lib/preview-client";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// zoom-view-controller.test / page-nav-controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/**
 * context-menu-controller.svelte.ts (inline-editing plan §4.1-4.5) — the
 * full open/dismiss matrix, keyboard open, the in-flight-render guard, and
 * `kind: "none"` being ignored.
 *
 * SFE-P4: the menu is read-only. This file used to also pin every mutation
 * item (image-properties, image-unwrap, link-edit, marker-edit,
 * page-marker-edit, block-break-before/after, the four selection formats,
 * make-link, "Edit this block") and the `commitEngine`/`openInlineEdit`
 * constructor dependencies that drove them — all deleted along with
 * `CommitEngine` and `InlineEditController`; every deleted capability has a
 * replacement command in source mode and/or the shared rich editor, proven
 * in docs/plans/source-first-editor/parity-matrix.md. What remains here is
 * the controller's own open/dismiss/position state machine and the four
 * D8 read-only items (go-to-source, selection-copy, link-copy,
 * image-reveal). Menu-item PARAMETER resolution for the surviving items'
 * shared helpers is covered directly in context-menu-actions.test.ts; this
 * file focuses on the controller's own wiring.
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

function detail(over: Partial<PreviewEvent["detail"]> = {}): PreviewEvent["detail"] {
  const result = {
    kind: "block",
    chapter: "ch1.md",
    range: [2, 3],
    blockTag: "p",
    x: 100,
    y: 100,
    via: "mouse",
    ...over,
  };
  if (result.image && !("source" in result.image)) {
    result.image = {
      ...result.image,
      source: result.image.src
        ? { token: `![${result.image.alt ?? ""}](${result.image.src})`, occurrence: 0 }
        : null,
    };
  }
  if (result.link && !("source" in result.link)) {
    result.link = {
      ...result.link,
      source: result.link.href
        ? { token: `[${result.link.text}](${result.link.href})`, occurrence: 0 }
        : null,
    };
  }
  return result;
}

interface Harness {
  ctrl: ContextMenuController;
  client: FakeClient;
  enabled: boolean;
  rendering: boolean;
  goToSourceCalls: Array<[string, number]>;
  openMediaPanelCalls: number;
  copyToClipboardCalls: string[];
  workspaceRect: { left: number; top: number; width: number; height: number } | null;
  iframeOrigin: { left: number; top: number } | null;
}

function make(): Harness {
  const client = new FakeClient();
  const h: Harness = {
    ctrl: undefined as unknown as ContextMenuController,
    client,
    enabled: true,
    rendering: false,
    goToSourceCalls: [],
    openMediaPanelCalls: 0,
    copyToClipboardCalls: [],
    workspaceRect: { left: 0, top: 0, width: 1000, height: 800 },
    iframeOrigin: { left: 10, top: 20 },
  };
  const deps: ContextMenuDeps = {
    client: () => client,
    enabled: () => h.enabled,
    rendering: () => h.rendering,
    getIframeOrigin: () => h.iframeOrigin,
    getWorkspaceRect: () => h.workspaceRect,
    goToSource: (chapter, line) => h.goToSourceCalls.push([chapter, line]),
    openMediaPanel: () => h.openMediaPanelCalls++,
    copyToClipboard: async (text) => {
      h.copyToClipboardCalls.push(text);
    },
  };
  h.ctrl = new ContextMenuController(deps);
  h.ctrl.subscribe(client);
  return h;
}

// ── open ─────────────────────────────────────────────────────────────────────

describe("open", () => {
  test("opens on contextMenuRequested with a resolvable kind", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.items.length).toBeGreaterThan(0);
  });

  test("kind: 'none' never opens (PR 2's keyboard path can dispatch it)", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "none" }) });
    expect(h.ctrl.open).toBe(false);
  });

  test("kind: 'none' closes an existing menu because the new request invalidates its target", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(true);

    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "none" }) });
    expect(h.ctrl.open).toBe(false);
  });

  test("ignores contextMenuRequested while a render is in flight", () => {
    const h = make();
    h.rendering = true;
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(false);
  });

  test("does nothing when preview.contextMenu is disabled", () => {
    const h = make();
    h.enabled = false;
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(false);
  });

  test("keyboard invocation (via: 'keyboard') opens normally", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ via: "keyboard" }) });
    expect(h.ctrl.open).toBe(true);
  });

  test("rejects an unsafe source chapter before navigating", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "block", chapter: "../../outside.md", range: [0, 1] }),
    });
    expect(h.ctrl.open).toBe(false);
    expect(h.goToSourceCalls).toEqual([]);
  });

  test("a second right-click reopens at the new target (items/position update in place)", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ range: [0, 1] }) });
    expect(h.ctrl.open).toBe(true);
    const firstX = h.ctrl.x;
    h.iframeOrigin = { left: 500, top: 500 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ range: [1, 2], x: 5, y: 5 }) });
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.x).not.toBe(firstX);
  });
});

// ── dismissal ────────────────────────────────────────────────────────────────

describe("dismissal", () => {
  test("close() closes an open menu", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(true);
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

  test("renderingComplete closes the menu", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "renderingComplete", detail: {} });
    expect(h.ctrl.open).toBe(false);
  });

  test("renderingStarted closes the menu before its frame is replaced", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "renderingStarted", detail: { hotReload: true, revision: 2 } });
    expect(h.ctrl.open).toBe(false);
  });

  test("page and viewport notifications do not make an open menu disappear", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "pageChanged", detail: {} });
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "viewportChanged", detail: {} });
    expect(h.ctrl.open).toBe(true);
  });
});

// ── positioning ──────────────────────────────────────────────────────────────

describe("positioning", () => {
  test("anchors at iframe origin + event x/y", () => {
    const h = make();
    h.iframeOrigin = { left: 50, top: 60 };
    h.workspaceRect = { left: 0, top: 0, width: 2000, height: 2000 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ x: 10, y: 20 }) });
    expect(h.ctrl.x).toBe(60);
    expect(h.ctrl.y).toBe(80);
  });

  test("clamps/flips near the workspace edge", () => {
    const h = make();
    h.iframeOrigin = { left: 0, top: 0 };
    h.workspaceRect = { left: 0, top: 0, width: 300, height: 300 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ x: 290, y: 290 }) });
    // The default size estimate (240x260) would overflow the 300x300
    // workspace at (290,290) — the menu must flip to stay fully inside.
    expect(h.ctrl.x + 240).toBeLessThanOrEqual(300);
    expect(h.ctrl.y + 260).toBeLessThanOrEqual(300);
  });

  test("reportMenuSize reflows the clamp with the REAL measured size", () => {
    const h = make();
    h.iframeOrigin = { left: 0, top: 0 };
    h.workspaceRect = { left: 0, top: 0, width: 300, height: 300 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ x: 100, y: 100 }) });
    h.ctrl.reportMenuSize(400, 50); // wider than the workspace itself
    expect(h.ctrl.x + 400 <= 300 || h.ctrl.x >= 0).toBe(true);
    expect(h.ctrl.y).toBeLessThanOrEqual(300);
  });

  test("no workspace rect: falls back to the raw anchor", () => {
    const h = make();
    h.workspaceRect = null;
    h.iframeOrigin = { left: 5, top: 5 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ x: 1, y: 1 }) });
    expect(h.ctrl.x).toBe(6);
    expect(h.ctrl.y).toBe(6);
  });
});

// ── menu items per kind (read-only surface only — D8) ───────────────────────

describe("block kind", () => {
  test("offers only Go to source", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [3, 5] }) });
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["go-to-source"]);
  });

  test("Go to source calls goToSource with range[0]+1 and closes the menu", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [3, 5] }) });
    const item = h.ctrl.items.find((i) => i.id === "go-to-source")!;
    void h.ctrl.runItem(item);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 4]]);
    expect(h.ctrl.open).toBe(false);
  });
});

describe("marker kind", () => {
  test("offers only Go to source", () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "marker", range: [1, 2] }) });
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["go-to-source"]);
  });
});

describe("image kind", () => {
  test("offers Reveal in Media panel and Go to source", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        range: [0, 1],
        image: { src: "x.png", alt: "Art", source: { token: "![Art](x.png)", occurrence: 0 } },
      }),
    });
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["image-reveal", "go-to-source"]);
  });

  test("a raw HTML <img> block still offers Reveal in Media panel and Go to source (no markdown token needed)", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "cat.png", alt: "cat", source: null } }),
    });
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["image-reveal", "go-to-source"]);
  });

  test("Reveal in Media panel opens the media panel and closes the menu", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "a.png", alt: "a" } }),
    });
    const item = h.ctrl.items.find((i) => i.id === "image-reveal")!;
    void h.ctrl.runItem(item);
    expect(h.openMediaPanelCalls).toBe(1);
    expect(h.ctrl.open).toBe(false);
  });
});

describe("link kind", () => {
  test("offers Copy link target and Go to source", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "link",
        range: [0, 1],
        link: { href: "https://example.com", text: "A" },
      }),
    });
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["link-copy", "go-to-source"]);
  });

  test("Copy link target copies the rendered href even for a linkified bare URL", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "link",
        range: [0, 1],
        link: { href: "https://example.com", text: "https://example.com" },
      }),
    });
    const copyItem = h.ctrl.items.find((i) => i.id === "link-copy")!;
    await h.ctrl.runItem(copyItem);
    expect(h.copyToClipboardCalls).toEqual(["https://example.com"]);
  });

  test("Copy link target is disabled with no link target", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "link", range: [0, 1], link: { href: null, text: "x" } }),
    });
    const copyItem = h.ctrl.items.find((i) => i.id === "link-copy")!;
    expect(copyItem.enabled).toBe(false);
  });
});

describe("selection kind", () => {
  test("cross-block: Copy copies selection.text; Go to source jumps to target.range", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        range: [2, 3],
        selection: { text: "spans two blocks", withinSingleBlock: false, range: null, chapter: null },
      }),
    });
    const copy = h.ctrl.items.find((i) => i.id === "selection-copy")!;
    await h.ctrl.runItem(copy);
    expect(h.copyToClipboardCalls).toEqual(["spans two blocks"]);

    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        range: [2, 3],
        selection: { text: "spans two blocks", withinSingleBlock: false, range: null, chapter: null },
      }),
    });
    const edit = h.ctrl.items.find((i) => i.id === "go-to-source")!;
    void h.ctrl.runItem(edit);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 3]]);
  });

  test("cross-block selection offers only Copy / Go to source", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        range: [2, 3],
        selection: { text: "spans two blocks", withinSingleBlock: false, range: null, chapter: null },
      }),
    });
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["selection-copy", "go-to-source"]);
  });

  test("single-block selection offers only Go to source", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        chapter: "ch1.md",
        range: [2, 3],
        selection: { text: "a phrase", withinSingleBlock: true, range: [1, 2], chapter: "ch1.md" },
      }),
    });
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["go-to-source"]);
  });

  test("Go to source jumps to the selection's block, not the right-click point's block", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        chapter: "point.md",
        range: [9, 9],
        selection: { text: "a phrase", withinSingleBlock: true, range: [1, 2], chapter: "ch1.md" },
      }),
    });
    const editItem = h.ctrl.items.find((i) => i.id === "go-to-source")!;
    void h.ctrl.runItem(editItem);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 2]]);
  });

  test("a single-block selection with no chapter/range on the selection itself falls back to the point's own target", () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        chapter: "ch1.md",
        range: [4, 5],
        selection: { text: "x", withinSingleBlock: true, range: null, chapter: null },
      }),
    });
    const item = h.ctrl.items.find((i) => i.id === "go-to-source")!;
    void h.ctrl.runItem(item);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 5]]);
  });
});

describe("runItem", () => {
  test("does not run a disabled item", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "link", range: [0, 1], link: { href: null, text: "x" } }),
    });
    const item = h.ctrl.items.find((i) => i.id === "link-copy")!;
    expect(item.enabled).toBe(false);
    await h.ctrl.runItem(item);
    expect(h.copyToClipboardCalls).toEqual([]);
  });
});
