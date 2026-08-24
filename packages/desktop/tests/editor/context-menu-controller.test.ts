import { test, expect, describe } from "bun:test";
import {
  ContextMenuController,
  type ContextMenuClient,
  type ContextMenuDeps,
} from "../../src/lib/routes/context-menu-controller.svelte";
import type { CommitEngine } from "$lib/editor/commit-engine";
import type { PreviewEvent } from "$lib/preview-client";
import type { ImagePropertiesValue } from "$lib/editor/image-classes";

// Bun imports the rune-bearing .svelte.ts module without Svelte's compiler in
// these unit tests. The production compiler replaces $state; the class only
// needs plain values for these behavior tests (same shim as
// zoom-view-controller.test / page-nav-controller.test / buffer-state.test).
(globalThis as unknown as { $state?: <T>(value: T) => T }).$state ??= (value) => value;

/**
 * context-menu-controller.svelte.ts (inline-editing plan §4.1-4.5) — the
 * full open/dismiss matrix, keyboard open, the in-flight-render guard, and
 * `kind: "none"` being ignored. Menu-item PARAMETER resolution (image/link
 * token matching, degrade cases) is covered directly in
 * context-menu-actions.test.ts; this file focuses on the controller's own
 * state machine and wiring.
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

class FakeCommitEngine {
  generation = 0;
  calls: unknown[] = [];
  result: { ok: true; flushed: boolean } | { ok: false; reason: string; message: string; degradeLine: number | null } = {
    ok: true,
    flushed: true,
  };
  noteRenderingComplete(): void {
    this.generation++;
  }
  async commitRangePatch(patch: unknown) {
    this.calls.push(patch);
    return this.result;
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
  commitEngine: FakeCommitEngine;
  enabled: boolean;
  rendering: boolean;
  currentDir: string | null;
  /** Live in-editor content for the one open path. */
  openContent: Map<string, string>;
  readFileMap: Record<string, string>;
  readFileImpl: ((path: string) => Promise<string>) | null;
  promptResult: string | null;
  promptCalls: Array<{
    title: string;
    label: string;
    initialValue: string;
    options?: readonly { value: string; label: string }[];
  }>;
  imagePropertiesResult: ImagePropertiesValue | null;
  imagePropertiesCalls: ImagePropertiesValue[];
  goToSourceCalls: Array<[string, number]>;
  openMediaPanelCalls: number;
  copyToClipboardCalls: string[];
  toastSuccessCalls: string[];
  toastErrorCalls: string[];
  workspaceRect: { left: number; top: number; width: number; height: number } | null;
  iframeOrigin: { left: number; top: number } | null;
  openInlineEditCalls: Array<[string, [number, number], { x: number; y: number }]>;
}

function make(): Harness {
  const client = new FakeClient();
  const commitEngine = new FakeCommitEngine();
  const h: Harness = {
    ctrl: undefined as unknown as ContextMenuController,
    client,
    commitEngine,
    enabled: true,
    rendering: false,
    currentDir: "/proj",
    openContent: new Map<string, string>(),
    readFileMap: {},
    readFileImpl: null,
    promptResult: "edited",
    promptCalls: [],
    imagePropertiesResult: null,
    imagePropertiesCalls: [],
    goToSourceCalls: [],
    openMediaPanelCalls: 0,
    copyToClipboardCalls: [],
    toastSuccessCalls: [],
    toastErrorCalls: [],
    workspaceRect: { left: 0, top: 0, width: 1000, height: 800 },
    iframeOrigin: { left: 10, top: 20 },
    openInlineEditCalls: [],
  };
  const deps: ContextMenuDeps = {
    client: () => client,
    enabled: () => h.enabled,
    rendering: () => h.rendering,
    currentDir: () => h.currentDir,
    openContent: (path: string) => h.openContent.get(path) ?? null,
    readFile: async (path: string) => {
      if (h.readFileImpl) return h.readFileImpl(path);
      if (path in h.readFileMap) return h.readFileMap[path]!;
      throw new Error(`not found: ${path}`);
    },
    commitEngine: commitEngine as unknown as CommitEngine,
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
    goToSource: (chapter, line) => h.goToSourceCalls.push([chapter, line]),
    openMediaPanel: () => h.openMediaPanelCalls++,
    copyToClipboard: async (text) => {
      h.copyToClipboardCalls.push(text);
    },
    toastSuccess: (m) => h.toastSuccessCalls.push(m),
    toastError: (m) => h.toastErrorCalls.push(m),
    openInlineEdit: (chapter, range, anchor) => h.openInlineEditCalls.push([chapter, range, anchor]),
  };
  h.ctrl = new ContextMenuController(deps);
  h.ctrl.subscribe(client);
  return h;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

// ── open ─────────────────────────────────────────────────────────────────────

describe("open", () => {
  test("opens on contextMenuRequested with a resolvable kind", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.items.length).toBeGreaterThan(0);
  });

  test("kind: 'none' never opens (PR 2's keyboard path can dispatch it)", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "none" }) });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });

  test("kind: 'none' closes an existing menu because the new request invalidates its target", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(true);

    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "none" }) });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });

  test("ignores contextMenuRequested while a render is in flight", async () => {
    const h = make();
    h.rendering = true;
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });

  test("does nothing when preview.contextMenu is disabled", async () => {
    const h = make();
    h.enabled = false;
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(false);
  });

  test("keyboard invocation (via: 'keyboard') opens normally", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail({ via: "keyboard" }) });
    await flush();
    expect(h.ctrl.open).toBe(true);
  });

  test("rejects an unsafe source chapter before reading or navigating", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "block", chapter: "../../outside.md", range: [0, 1] }),
    });
    await flush();
    expect(h.ctrl.open).toBe(false);
    expect(h.goToSourceCalls).toEqual([]);
  });

  test("a second right-click reopens at the new target (items/position update in place)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail({ range: [0, 1] }) });
    await flush();
    expect(h.ctrl.open).toBe(true);
    const firstX = h.ctrl.x;
    h.iframeOrigin = { left: 500, top: 500 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ range: [1, 2], x: 5, y: 5 }) });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.x).not.toBe(firstX);
  });

  test("an older async request cannot overwrite a newer context menu", async () => {
    const h = make();
    const pending: Array<(source: string) => void> = [];
    h.readFileImpl = () => new Promise((resolve) => pending.push(resolve));
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "image", range: [0, 1], x: 100 }) });
    await flush();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "image", range: [1, 2], x: 700 }) });
    await flush();

    pending[1]!("![Second](second.png)\n");
    await flush();
    expect(h.ctrl.x).toBe(710);
    pending[0]!("![First](first.png)\n");
    await flush();
    expect(h.ctrl.x).toBe(710);
  });

  test("an ignored request cancels an older asynchronous menu build", async () => {
    const h = make();
    let resolveRead!: (source: string) => void;
    h.readFileImpl = () => new Promise((resolve) => (resolveRead = resolve));
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "image" }) });
    await flush();

    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "none" }) });
    resolveRead("![Late](late.png)\n");
    await flush();
    expect(h.ctrl.open).toBe(false);
    expect(h.ctrl.items).toEqual([]);
  });
});

// ── dismissal ────────────────────────────────────────────────────────────────

describe("dismissal", () => {
  test("close() closes an open menu", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
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

  test("renderingComplete closes the menu AND bumps the commit engine's generation", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "renderingComplete", detail: {} });
    expect(h.ctrl.open).toBe(false);
    expect(h.commitEngine.generation).toBe(1);
  });

  test("renderingStarted closes the menu before its frame is replaced", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "renderingStarted", detail: { hotReload: true, revision: 2 } });
    expect(h.ctrl.open).toBe(false);
  });

  test("page and viewport notifications do not make an open menu disappear", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "pageChanged", detail: {} });
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "viewportChanged", detail: {} });
    expect(h.ctrl.open).toBe(true);
  });
});

// ── positioning ──────────────────────────────────────────────────────────────

describe("positioning", () => {
  test("anchors at iframe origin + event x/y", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.iframeOrigin = { left: 50, top: 60 };
    h.workspaceRect = { left: 0, top: 0, width: 2000, height: 2000 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ x: 10, y: 20 }) });
    await flush();
    expect(h.ctrl.x).toBe(60);
    expect(h.ctrl.y).toBe(80);
  });

  test("clamps/flips near the workspace edge", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.iframeOrigin = { left: 0, top: 0 };
    h.workspaceRect = { left: 0, top: 0, width: 300, height: 300 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ x: 290, y: 290 }) });
    await flush();
    // The default size estimate (240x260) would overflow the 300x300
    // workspace at (290,290) — the menu must flip to stay fully inside.
    expect(h.ctrl.x + 240).toBeLessThanOrEqual(300);
    expect(h.ctrl.y + 260).toBeLessThanOrEqual(300);
  });

  test("reportMenuSize reflows the clamp with the REAL measured size", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.iframeOrigin = { left: 0, top: 0 };
    h.workspaceRect = { left: 0, top: 0, width: 300, height: 300 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ x: 100, y: 100 }) });
    await flush();
    h.ctrl.reportMenuSize(400, 50); // wider than the workspace itself
    expect(h.ctrl.x + 400 <= 300 || h.ctrl.x >= 0).toBe(true);
    expect(h.ctrl.y).toBeLessThanOrEqual(300);
  });

  test("no workspace rect: falls back to the raw anchor", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.workspaceRect = null;
    h.iframeOrigin = { left: 5, top: 5 };
    h.client.emit({ name: "contextMenuRequested", detail: detail({ x: 1, y: 1 }) });
    await flush();
    expect(h.ctrl.x).toBe(6);
    expect(h.ctrl.y).toBe(6);
  });
});

// ── menu items per kind (wiring, not the pure-matcher logic) ────────────────

describe("block kind", () => {
  test("Insert page break before/after commit zero-width boundary patches", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [3, 5] }) });
    await flush();
    const before = h.ctrl.items.find((i) => i.id === "block-break-before")!;
    await h.ctrl.runItem(before);
    expect(h.commitEngine.calls).toEqual([
      { chapter: "ch1.md", range: [3, 3], expected: "", replacement: "@page-break\n\n", expectedGeneration: 0 },
    ]);
  });

  test("Edit this block opens the block overlay and closes the menu (PR 5)", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [3, 5] }) });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "block-edit")!;
    expect(item.enabled).toBe(true);
    await h.ctrl.runItem(item);
    expect(h.openInlineEditCalls).toEqual([["ch1.md", [3, 5], { x: 100, y: 100 }]]);
    expect(h.ctrl.open).toBe(false);
  });

  test("Go to source calls goToSource with range[0]+1 and closes the menu", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [3, 5] }) });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "go-to-source")!;
    await h.ctrl.runItem(item);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 4]]);
    expect(h.ctrl.open).toBe(false);
  });

  test("Go to source remains enabled and opens the editor when its pane is closed", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [3, 5] }) });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "go-to-source")!;
    expect(item.enabled).toBe(true);
    await h.ctrl.runItem(item);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 4]]);
  });
});

describe("marker kind", () => {
  test("Edit marker… prompts with the raw line and commits the edited line, preserving the trailing newline", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\n@page-break\nafter\n";
    h.promptResult = "@page-break .foo";
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "marker", range: [1, 2] }) });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "marker-edit")!;
    await h.ctrl.runItem(item);
    expect(h.commitEngine.calls).toEqual([
      {
        chapter: "ch1.md",
        range: [1, 2],
        expected: "@page-break\n",
        replacement: "@page-break .foo\n",
        expectedGeneration: 0,
      },
    ]);
  });

  test("cancelling the prompt (null) does not commit", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\n@page-break\nafter\n";
    h.promptResult = null;
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "marker", range: [1, 2] }) });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "marker-edit")!;
    await h.ctrl.runItem(item);
    expect(h.commitEngine.calls.length).toBe(0);
  });
});

// ── page marker (protocol v7's secondary `pageMarker` field) ─────────────────

/** detail() plus a v7 `pageMarker` field (not yet in PreviewEvent's detail
 *  type — the controller reads it tolerantly, so the tests inject it the same
 *  way the wire payload delivers it). */
function detailWithPageMarker(
  over: Partial<PreviewEvent["detail"]>,
  pageMarker: { chapter: string | null; range: [number, number] | null; blockTag: string | null } | null,
): PreviewEvent["detail"] {
  return { ...detail(over), pageMarker } as unknown as PreviewEvent["detail"];
}

describe("page marker (protocol v7)", () => {
  test("a block inside a @section offers Edit page marker… and edits the enclosing @page line", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "@page .cover\n\np1\np2\n";
    h.promptResult = "@page .cover.dark";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detailWithPageMarker({ kind: "block", range: [2, 3] }, {
        chapter: "ch1.md",
        range: [0, 1],
        blockTag: "div",
      }),
    });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "page-marker-edit")!;
    expect(item).toBeDefined();
    expect(item.enabled).toBe(true);
    await h.ctrl.runItem(item);
    expect(h.promptCalls).toEqual([
      { title: "Edit page marker", label: "Marker line", initialValue: "@page .cover" },
    ]);
    expect(h.commitEngine.calls).toEqual([
      {
        chapter: "ch1.md",
        range: [0, 1],
        expected: "@page .cover\n",
        replacement: "@page .cover.dark\n",
        expectedGeneration: 0,
      },
    ]);
  });

  test("a @section marker target also offers the enclosing @page marker", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "@page\n\n@section .gp-columns-2\n\ntext\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detailWithPageMarker({ kind: "marker", range: [2, 3] }, {
        chapter: "ch1.md",
        range: [0, 1],
        blockTag: "div",
      }),
    });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["marker-edit", "page-marker-edit", "go-to-source"]);
  });

  test("suppressed when the primary target IS the page marker (same chapter + range)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "@page\np1\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detailWithPageMarker({ kind: "marker", range: [0, 1] }, {
        chapter: "ch1.md",
        range: [0, 1],
        blockTag: "div",
      }),
    });
    await flush();
    expect(h.ctrl.items.some((i) => i.id === "page-marker-edit")).toBe(false);
    expect(h.ctrl.items.some((i) => i.id === "marker-edit")).toBe(true);
  });

  test("an older preview payload without pageMarker still builds the normal menu (tolerant read)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [1, 2] }) });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.items.some((i) => i.id === "page-marker-edit")).toBe(false);
  });

  test("rejects an unsafe page-marker chapter before reading or committing", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detailWithPageMarker({ kind: "block", range: [1, 2] }, {
        chapter: "../../etc/passwd",
        range: [0, 1],
        blockTag: "div",
      }),
    });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.items.some((i) => i.id === "page-marker-edit")).toBe(false);
  });
});

describe("image kind", () => {
  test("offers one Set properties action instead of separate image facet actions", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] =
      '![Art](x.png "Caption"){width="40%" .gp-right .gp-small .gp-tight .gp-shape}\n';
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        range: [0, 1],
        image: { src: "x.png", alt: "Art", source: { token: '![Art](x.png "Caption")', occurrence: 0 } },
      }),
    });
    await flush();
    expect(h.ctrl.items.map((item) => item.id).filter((id) => id.startsWith("image-"))).toEqual([
      "image-properties",
      "image-reveal",
    ]);
  });

  test("a gp-behind image buried under page text still opens the image menu", async () => {
    // Regression companion to preview-interface.test.mjs's hit-stack probe:
    // a right-click over a `.gp-behind` (z-index:-1) plate covered by a text
    // block resolves to kind:"image" with the IMAGE's own block range. The
    // controller must build the ordinary image menu from that payload, and
    // Set properties must seed the Layer facet from the buried image's
    // source — not from the covering paragraph the pointer actually hit.
    const h = make();
    h.readFileMap["/proj/ch1.md"] =
      "Body text that visually covers the plate.\n" +
      "![Backdrop](plate.jpg){.gp-pin .gp-behind}\n";
    h.imagePropertiesResult = null; // cancel the dialog — seeding is the assertion
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        range: [1, 2],
        image: { src: "plate.jpg", alt: "Backdrop", source: { token: "![Backdrop](plate.jpg)", occurrence: 0 } },
      }),
    });
    await flush();
    expect(h.ctrl.open).toBe(true);
    expect(h.ctrl.items.map((item) => item.id)).toEqual(["image-properties", "image-reveal", "go-to-source"]);
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);
    expect(h.imagePropertiesCalls).toEqual([{
      src: "plate.jpg",
      alt: "Backdrop",
      width: "",
      position: "gp-pin",
      pinAlignment: "center",
      size: "",
      spacing: "",
      shape: false,
      flush: false,
      layer: "gp-behind",
    }]);
    expect(h.commitEngine.calls).toEqual([]);
  });

  test("Set properties seeds every supported option and applies multiple changes in one commit", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] =
      '![Art](x.png "Caption"){width="40%" .gp-right .gp-small .gp-tight .gp-shape .custom #hero data-x="y"}\n';
    h.imagePropertiesResult = {
      src: "new path.png",
      alt: "New ] alt",
      width: "",
      position: "gp-pin",
      pinAlignment: "bottom-right",
      size: "gp-large",
      spacing: "gp-loose",
      shape: true,
      flush: false,
      layer: "gp-front",
    };
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        range: [0, 1],
        image: { src: "x.png", alt: "Art", source: { token: '![Art](x.png "Caption")', occurrence: 0 } },
      }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);

    expect(h.imagePropertiesCalls).toEqual([{
      src: "x.png",
      alt: "Art",
      width: "40%",
      position: "gp-right",
      pinAlignment: "center",
      size: "gp-small",
      spacing: "gp-tight",
      shape: true,
      flush: false,
      layer: "",
    }]);
    expect(h.commitEngine.calls).toEqual([{
      chapter: "ch1.md",
      range: [0, 1],
      expected: '![Art](x.png "Caption"){width="40%" .gp-right .gp-small .gp-tight .gp-shape .custom #hero data-x="y"}\n',
      replacement:
        String.raw`![New \] alt](<new path.png> "Caption"){.gp-pin .gp-bottom .gp-right .gp-large .gp-loose .gp-shape .custom #hero data-x="y" .gp-front}` + "\n",
      expectedGeneration: 0,
    }]);
  });

  test("Set properties can flush a pinned image to the page edge", async () => {
    // The point of the facet: a non-technical author reaches page-edge art
    // from this dialog. Nothing else in the token set changes, and the class
    // core keys its `:has()` page assignment off is what lands in the source.
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "![Art](x.png){.gp-pin .gp-bottom .gp-behind}\n";
    h.imagePropertiesResult = {
      src: "x.png",
      alt: "Art",
      width: "",
      position: "gp-pin",
      pinAlignment: "bottom",
      size: "",
      spacing: "",
      shape: false,
      flush: true,
      layer: "gp-behind",
    };
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        range: [0, 1],
        image: { src: "x.png", alt: "Art", source: { token: "![Art](x.png)", occurrence: 0 } },
      }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);

    // Seeded from the source: an unflushed pin reads back as unchecked.
    expect(h.imagePropertiesCalls[0]!.flush).toBe(false);
    expect(h.commitEngine.calls[0]!.replacement).toBe(
      "![Art](x.png){.gp-pin .gp-bottom .gp-behind .gp-flush}\n",
    );
  });

  test("Set properties seeds flush from the source and can clear it", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "![Art](x.png){.gp-pin .gp-bottom .gp-flush}\n";
    h.imagePropertiesResult = {
      src: "x.png",
      alt: "Art",
      width: "",
      position: "gp-pin",
      pinAlignment: "bottom",
      size: "",
      spacing: "",
      shape: false,
      flush: false,
      layer: "",
    };
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        range: [0, 1],
        image: { src: "x.png", alt: "Art", source: { token: "![Art](x.png)", occurrence: 0 } },
      }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);

    expect(h.imagePropertiesCalls[0]!.flush).toBe(true);
    expect(h.commitEngine.calls[0]!.replacement).toBe("![Art](x.png){.gp-pin .gp-bottom}\n");
  });

  test("changing only size preserves the exact escaped destination, formatted alt, and title", async () => {
    const h = make();
    const source = String.raw`![A *b*](media/a\(b\).png "Caption"){.gp-small .custom}` + "\n";
    h.readFileMap["/proj/ch1.md"] = source;
    h.imagePropertiesResult = {
      src: "media/a(b).png",
      alt: "A b",
      width: "",
      position: "",
      pinAlignment: "center",
      size: "gp-large",
      spacing: "",
      shape: false,
      flush: false,
      layer: "",
    };
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        range: [0, 1],
        image: {
          src: "media/a(b).png",
          alt: "A b",
          source: { token: String.raw`![A *b*](media/a\(b\).png "Caption")`, occurrence: 0 },
        },
      }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);
    expect(h.commitEngine.calls[0]).toMatchObject({
      expected: source,
      replacement: String.raw`![A *b*](media/a\(b\).png "Caption"){.gp-large .custom}` + "\n",
    });
  });

  test("cancelling Set properties leaves the source unchanged", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "![Art](x.png){.gp-center}\n";
    h.imagePropertiesResult = null;
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "x.png", alt: "Art" } }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);
    expect(h.commitEngine.calls).toEqual([]);
  });

  test("Set properties presents a legacy image position as its canonical supported class", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "![Art](x.png){.float-right}\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "x.png", alt: "Art" } }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);
    expect(h.imagePropertiesCalls[0]?.position).toBe("gp-right");
  });

  test.each([
    {
      source: "![Art](x.png){.gp-center}\n",
      value: { width: "", position: "gp-center", pinAlignment: "center", layer: "" },
    },
    {
      source: "![Art](x.png){width=160px .custom .gp-right .gp-pin .gp-raised}\n",
      value: { width: "160px", position: "gp-pin", pinAlignment: "right", layer: "gp-raised" },
    },
    {
      source: "![Art](x.png){width=160px   .custom}{.gp-pin .gp-right}\n",
      value: { width: "160px", position: "gp-pin", pinAlignment: "right", layer: "" },
    },
  ])("unchanged properties preserve source bytes and do not rebuild: $source", async ({ source, value }) => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = source;
    h.imagePropertiesResult = {
      src: "x.png",
      alt: "Art",
      size: "",
      spacing: "",
      shape: false,
      flush: false,
      ...value,
    };
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "x.png", alt: "Art" } }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);
    expect(h.commitEngine.calls).toEqual([]);
    expect(h.ctrl.open).toBe(false);
  });

  test("rejects image values outside the dialog's option lists", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "![Art](x.png)\n";
    h.imagePropertiesResult = {
      src: "x.png",
      alt: "Art",
      width: "",
      position: "gp-diagonal",
      pinAlignment: "center",
      size: "",
      spacing: "",
      shape: false,
      flush: false,
      layer: "",
    };
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "x.png", alt: "Art" } }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((item) => item.id === "image-properties")!);
    expect(h.commitEngine.calls).toEqual([]);
    expect(h.toastErrorCalls).toEqual(["Choose image options from the lists."]);
  });

  test("Unwrap image removes a surrounding markdown link and preserves image properties", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = '[![Art](x.png){width="50%" .gp-right}](https://example.com)\n';
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "x.png", alt: "Art" } }),
    });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "image-unwrap")!;
    expect(item?.label).toBe("Unwrap image");
    await h.ctrl.runItem(item);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe(
      '![Art](x.png){width="50%" .gp-right}\n',
    );
  });

  test("Unwrap image handles balanced link parentheses and link titles", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] =
      '[![Art](x.png "Caption"){width="50%"}](https://example.com/a_(b) "title ) retained")\n';
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "image",
        range: [0, 1],
        image: { src: "x.png", alt: "Art", source: { token: '![Art](x.png "Caption")', occurrence: 0 } },
      }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((i) => i.id === "image-unwrap")!);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe(
      '![Art](x.png "Caption"){width="50%"}\n',
    );
  });

  test("a raw HTML <img> block only offers Go to source", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = '<img src="cat.png" alt="cat">\n';
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "cat.png", alt: "cat", source: null } }),
    });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["go-to-source"]);
  });

  test("Reveal in Media panel opens the media panel and closes the menu", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "![a](a.png)\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "a.png", alt: "a" } }),
    });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "image-reveal")!;
    await h.ctrl.runItem(item);
    expect(h.openMediaPanelCalls).toBe(1);
    expect(h.ctrl.open).toBe(false);
  });
});

describe("link kind", () => {
  test("Edit link preserves an escaped label and markdown title", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = String.raw`See [A \[link\]](old "Title") now.` + "\n";
    h.promptResult = "new";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "link",
        range: [0, 1],
        link: { href: "old", text: "A [link]", source: { token: String.raw`[A \[link\]](old "Title")`, occurrence: 0 } },
      }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((i) => i.id === "link-edit")!);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe(
      String.raw`See [A \[link\]](new "Title") now.` + "\n",
    );
  });

  test("Edit link safely wraps a destination containing spaces", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = '[A](old "Title")\n';
    h.promptResult = "new path";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "link",
        range: [0, 1],
        link: { href: "old", text: "A", source: { token: '[A](old "Title")', occurrence: 0 } },
      }),
    });
    await flush();
    await h.ctrl.runItem(h.ctrl.items.find((i) => i.id === "link-edit")!);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe(
      '[A](<new path> "Title")\n',
    );
  });

  test("Copy link target copies the rendered href even for a linkified bare URL", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "Visit https://example.com now.\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "link",
        range: [0, 1],
        link: { href: "https://example.com", text: "https://example.com" },
      }),
    });
    await flush();
    const editItem = h.ctrl.items.find((i) => i.id === "link-edit")!;
    expect(editItem.enabled).toBe(false); // linkified — degrades
    const copyItem = h.ctrl.items.find((i) => i.id === "link-copy")!;
    await h.ctrl.runItem(copyItem);
    expect(h.copyToClipboardCalls).toEqual(["https://example.com"]);
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
    await flush();
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
    await flush();
    const edit = h.ctrl.items.find((i) => i.id === "go-to-source")!;
    await h.ctrl.runItem(edit);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 3]]);
  });

  test("single-block selection offers the formatting row plus Go to source", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\na phrase here\nafter\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        chapter: "ch1.md",
        range: [2, 3],
        selection: { text: "a phrase", withinSingleBlock: true, range: [1, 2], chapter: "ch1.md" },
      }),
    });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual([
      "format-bold",
      "format-italic",
      "format-strike",
      "format-code",
      "format-link",
      "go-to-source",
    ]);
    expect(h.ctrl.items.every((i) => i.enabled)).toBe(true);
  });
});

describe("selection formatting (plan §4.6, PR 4)", () => {
  test("Bold commits the block slice wrapped in **…** through the commit engine", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\na phrase here\nafter\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        chapter: "point.md", // deliberately different from selection.chapter
        range: [9, 9],
        selection: { text: "a phrase", withinSingleBlock: true, range: [1, 2], chapter: "ch1.md" },
      }),
    });
    await flush();
    const bold = h.ctrl.items.find((i) => i.id === "format-bold")!;
    expect(bold.enabled).toBe(true);
    await h.ctrl.runItem(bold);
    expect(h.commitEngine.calls).toEqual([
      {
        chapter: "ch1.md",
        range: [1, 2],
        expected: "a phrase here\n",
        replacement: "**a phrase** here\n",
        expectedGeneration: 0,
      },
    ]);
  });

  test("Italic wraps only the matched region, preserving surrounding text", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a phrase here\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "phrase", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const italic = h.ctrl.items.find((i) => i.id === "format-italic")!;
    await h.ctrl.runItem(italic);
    const call = h.commitEngine.calls[0] as { replacement: string };
    expect(call.replacement).toBe("a *phrase* here\n");
  });

  test("Strikethrough and Inline code wrap correctly", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a phrase here\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "phrase", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const strike = h.ctrl.items.find((i) => i.id === "format-strike")!;
    await h.ctrl.runItem(strike);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe("a ~~phrase~~ here\n");

    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "phrase", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const code = h.ctrl.items.find((i) => i.id === "format-code")!;
    await h.ctrl.runItem(code);
    expect((h.commitEngine.calls[1] as { replacement: string }).replacement).toBe("a `phrase` here\n");
  });

  test("whitespace across a hard-wrapped source line matches", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a phrase\nspanning a line break here\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: {
          text: "phrase spanning",
          withinSingleBlock: true,
          range: [0, 2],
          chapter: "ch1.md",
        },
      }),
    });
    await flush();
    const bold = h.ctrl.items.find((i) => i.id === "format-bold")!;
    expect(bold.enabled).toBe(true);
    await h.ctrl.runItem(bold);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe(
      "a **phrase\nspanning** a line break here\n",
    );
  });

  test("typographer substitutions (em dash, smart quotes) match the ASCII source", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = 'She said "wait---really" then left.\n';
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: {
          text: "“wait—really”",
          withinSingleBlock: true,
          range: [0, 1],
          chapter: "ch1.md",
        },
      }),
    });
    await flush();
    const bold = h.ctrl.items.find((i) => i.id === "format-bold")!;
    expect(bold.enabled).toBe(true);
    await h.ctrl.runItem(bold);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe(
      'She said **"wait---really"** then left.\n',
    );
  });

  test("a selection spanning an already-bold word matches with delimiters stripped", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a **bold** word here\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "a bold word", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    // Bolding a region that already contains ** would be invalid nesting.
    const bold = h.ctrl.items.find((i) => i.id === "format-bold")!;
    expect(bold.enabled).toBe(false);
    expect(bold.disabledReason).toMatch(/already contains bold/);
    // A DIFFERENT delimiter over the same matched region is fine.
    const italic = h.ctrl.items.find((i) => i.id === "format-italic")!;
    expect(italic.enabled).toBe(true);
    await h.ctrl.runItem(italic);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe(
      "*a **bold** word* here\n",
    );
  });

  test("Make link… prompts for a URL and wraps the matched region", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a phrase here\n";
    h.promptResult = "https://example.com";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "phrase", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const link = h.ctrl.items.find((i) => i.id === "format-link")!;
    await h.ctrl.runItem(link);
    expect((h.commitEngine.calls[0] as { replacement: string }).replacement).toBe(
      "a [phrase](https://example.com) here\n",
    );
  });

  test("Make link… does nothing when the prompt is cancelled", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a phrase here\n";
    h.promptResult = null;
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "phrase", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const link = h.ctrl.items.find((i) => i.id === "format-link")!;
    await h.ctrl.runItem(link);
    expect(h.commitEngine.calls.length).toBe(0);
  });

  test("zero matches (text not found in source) disables every format item with the ambiguity reason", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "nothing matches this at all\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "a phrase", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const formatItems = h.ctrl.items.filter((i) => i.id !== "go-to-source");
    expect(formatItems.length).toBe(5);
    for (const item of formatItems) {
      expect(item.enabled).toBe(false);
      expect(item.disabledReason).toBe(
        "Couldn't locate this text uniquely in the source — open the editor",
      );
    }
    expect(h.ctrl.items.find((i) => i.id === "go-to-source")!.enabled).toBe(true);
  });

  test("multiple matches (ambiguous) disables every format item", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a phrase here and a phrase there\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "a phrase", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const bold = h.ctrl.items.find((i) => i.id === "format-bold")!;
    expect(bold.enabled).toBe(false);
  });

  test("collapsed-punctuation needle (ellipsis) disables every format item", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "wait... really\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "wait… really", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const bold = h.ctrl.items.find((i) => i.id === "format-bold")!;
    expect(bold.enabled).toBe(false);
    expect(bold.disabledReason).toBe(
      "Couldn't locate this text uniquely in the source — open the editor",
    );
  });

  test("a selection spanning INTO a code span (matched text includes a backtick) disables ALL format items", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "see `code` here\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        // No match at all is also possible here (backticks aren't stripped,
        // breaking substring contiguity for a wider selection) — this case
        // specifically covers the narrower guarantee: IF a match is found
        // whose matched text itself contains a backtick, every item blocks.
        selection: { text: "`code`", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    for (const id of ["format-bold", "format-italic", "format-strike", "format-code", "format-link"]) {
      const item = h.ctrl.items.find((i) => i.id === id)!;
      expect(item.enabled).toBe(false);
      expect(item.disabledReason).toBe(
        "This selection includes code or link syntax — edit it in the editor.",
      );
    }
  });

  test("a selection landing ENTIRELY INSIDE a code span (no backtick in the matched text itself) still disables every item", async () => {
    // The dangerous case: selection.text is "code" (the code span's plain
    // rendered content — no backticks, since inline code doesn't render its
    // delimiters). A naive check of the matched text alone would find no
    // backtick and wave this through, silently nesting **markup** INSIDE the
    // code span (which never parses nested markdown) instead of formatting
    // it. `touchesStructuralSyntax` must catch this via backtick adjacency.
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "see `code` here\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "code", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    for (const id of ["format-bold", "format-italic", "format-strike", "format-code", "format-link"]) {
      const item = h.ctrl.items.find((i) => i.id === id)!;
      expect(item.enabled).toBe(false);
      expect(item.disabledReason).toBe(
        "This selection includes code or link syntax — edit it in the editor.",
      );
    }
  });

  test("a selection landing entirely inside a link's text (no bracket in the matched text) still disables every item", async () => {
    // Same failure class as the code-span case above: selecting just "a
    // link" out of `[a link](https://x)` matches without ever showing a
    // bracket in the matched text.
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "see [a link](https://x) here\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        selection: { text: "a link", withinSingleBlock: true, range: [0, 1], chapter: "ch1.md" },
      }),
    });
    await flush();
    const bold = h.ctrl.items.find((i) => i.id === "format-bold")!;
    expect(bold.enabled).toBe(false);
    expect(bold.disabledReason).toBe(
      "This selection includes code or link syntax — edit it in the editor.",
    );
  });

  test("Go to source jumps to the selection's block, not the right-click point's block", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "before\na phrase here\nafter\n";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        chapter: "point.md",
        range: [9, 9],
        selection: { text: "a phrase", withinSingleBlock: true, range: [1, 2], chapter: "ch1.md" },
      }),
    });
    await flush();
    const editItem = h.ctrl.items.find((i) => i.id === "go-to-source")!;
    await h.ctrl.runItem(editItem);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 2]]);
  });

  test("cross-block selection still offers only Copy / Go to source — no formatting row", async () => {
    const h = make();
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({
        kind: "selection",
        range: [2, 3],
        selection: { text: "spans two blocks", withinSingleBlock: false, range: null, chapter: null },
      }),
    });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["selection-copy", "go-to-source"]);
  });
});

describe("runItem", () => {
  test("does not run a disabled item", async () => {
    const h = make();
    // No readFileMap entry for ch1.md: the source read fails, so the block
    // slice is unavailable and link-edit resolves disabled (§4.4 degrade).
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "link", range: [0, 1], link: { href: "https://example.com", text: "x" } }),
    });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "link-edit")!;
    expect(item.enabled).toBe(false);
    await h.ctrl.runItem(item);
    expect(h.commitEngine.calls.length).toBe(0);
  });
});
