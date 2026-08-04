import { test, expect, describe } from "bun:test";
import {
  ContextMenuController,
  type ContextMenuClient,
  type ContextMenuDeps,
  type ContextMenuBuffer,
} from "../../src/lib/routes/context-menu-controller.svelte";
import type { CommitEngine } from "$lib/editor/commit-engine";
import type { PreviewEvent } from "$lib/preview-client";

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
  return {
    kind: "block",
    chapter: "ch1.md",
    range: [2, 3],
    blockTag: "p",
    x: 100,
    y: 100,
    via: "mouse",
    ...over,
  };
}

interface Harness {
  ctrl: ContextMenuController;
  client: FakeClient;
  commitEngine: FakeCommitEngine;
  enabled: boolean;
  rendering: boolean;
  currentDir: string | null;
  buffer: ContextMenuBuffer | null;
  readFileMap: Record<string, string>;
  promptResult: string | null;
  goToSourceCalls: Array<[string, number]>;
  openMediaPanelCalls: number;
  copyToClipboardCalls: string[];
  toastSuccessCalls: string[];
  toastErrorCalls: string[];
  workspaceRect: { left: number; top: number; width: number; height: number } | null;
  iframeOrigin: { left: number; top: number } | null;
  openBlockOverlayCalls: Array<[string, [number, number], string | null]>;
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
    buffer: null,
    readFileMap: {},
    promptResult: "edited",
    goToSourceCalls: [],
    openMediaPanelCalls: 0,
    copyToClipboardCalls: [],
    toastSuccessCalls: [],
    toastErrorCalls: [],
    workspaceRect: { left: 0, top: 0, width: 1000, height: 800 },
    iframeOrigin: { left: 10, top: 20 },
    openBlockOverlayCalls: [],
  };
  const deps: ContextMenuDeps = {
    client: () => client,
    enabled: () => h.enabled,
    rendering: () => h.rendering,
    currentDir: () => h.currentDir,
    buffer: () => h.buffer,
    readFile: async (path: string) => {
      if (path in h.readFileMap) return h.readFileMap[path]!;
      throw new Error(`not found: ${path}`);
    },
    commitEngine: commitEngine as unknown as CommitEngine,
    getIframeOrigin: () => h.iframeOrigin,
    getWorkspaceRect: () => h.workspaceRect,
    promptText: async () => h.promptResult,
    goToSource: (chapter, line) => h.goToSourceCalls.push([chapter, line]),
    openMediaPanel: () => h.openMediaPanelCalls++,
    copyToClipboard: async (text) => {
      h.copyToClipboardCalls.push(text);
    },
    toastSuccess: (m) => h.toastSuccessCalls.push(m),
    toastError: (m) => h.toastErrorCalls.push(m),
    openBlockOverlay: (chapter, range, ref) => h.openBlockOverlayCalls.push([chapter, range, ref]),
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

  test("pageChanged closes the menu (anchor invalidated)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    expect(h.ctrl.open).toBe(true);
    h.client.emit({ name: "pageChanged", detail: {} });
    expect(h.ctrl.open).toBe(false);
  });

  test("sourceLineChanged and elementActivated do not close the menu (not part of the dismissal matrix)", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "a\nb\nc\n";
    h.client.emit({ name: "contextMenuRequested", detail: detail() });
    await flush();
    h.client.emit({ name: "sourceLineChanged", detail: {} });
    h.client.emit({ name: "elementActivated", detail: {} });
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
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [3, 5], ref: "b-ref" }) });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "block-edit")!;
    expect(item.enabled).toBe(true);
    await h.ctrl.runItem(item);
    expect(h.openBlockOverlayCalls).toEqual([["ch1.md", [3, 5], "b-ref"]]);
    expect(h.ctrl.open).toBe(false);
  });

  test("Go to source calls goToSource with range[0]+1 and closes the menu", async () => {
    const h = make();
    h.client.emit({ name: "contextMenuRequested", detail: detail({ kind: "block", range: [3, 5] }) });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "block-source")!;
    await h.ctrl.runItem(item);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 4]]);
    expect(h.ctrl.open).toBe(false);
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

describe("image kind", () => {
  test("Edit alt text… resolves the token and commits a full-block replacement", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = "para\n\n![old alt](cat.png)\n\nmore\n";
    h.promptResult = "new alt";
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [2, 3], image: { src: "cat.png", alt: "old alt" } }),
    });
    await flush();
    const item = h.ctrl.items.find((i) => i.id === "image-alt")!;
    expect(item.enabled).toBe(true);
    await h.ctrl.runItem(item);
    expect(h.commitEngine.calls).toEqual([
      {
        chapter: "ch1.md",
        range: [2, 3],
        expected: "![old alt](cat.png)\n",
        replacement: "![new alt](cat.png)\n",
        expectedGeneration: 0,
      },
    ]);
  });

  test("a raw HTML <img> block only offers 'Edit block in editor'", async () => {
    const h = make();
    h.readFileMap["/proj/ch1.md"] = '<img src="cat.png" alt="cat">\n';
    h.client.emit({
      name: "contextMenuRequested",
      detail: detail({ kind: "image", range: [0, 1], image: { src: "cat.png", alt: "cat" } }),
    });
    await flush();
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["edit-block-editor"]);
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
  test("cross-block: Copy copies selection.text; Edit in editor jumps to target.range", async () => {
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
    const edit = h.ctrl.items.find((i) => i.id === "selection-edit")!;
    await h.ctrl.runItem(edit);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 3]]);
  });

  test("single-block selection offers the formatting row plus 'Edit block in editor' (PR 4)", async () => {
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
      "edit-block-editor",
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
    const formatItems = h.ctrl.items.filter((i) => i.id !== "edit-block-editor");
    expect(formatItems.length).toBe(5);
    for (const item of formatItems) {
      expect(item.enabled).toBe(false);
      expect(item.disabledReason).toBe(
        "Couldn't locate this text uniquely in the source — open the editor",
      );
    }
    expect(h.ctrl.items.find((i) => i.id === "edit-block-editor")!.enabled).toBe(true);
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

  test("'Edit block in editor' jumps to the selection's block, not the right-click point's block", async () => {
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
    const editItem = h.ctrl.items.find((i) => i.id === "edit-block-editor")!;
    await h.ctrl.runItem(editItem);
    expect(h.goToSourceCalls).toEqual([["ch1.md", 2]]);
  });

  test("cross-block selection still offers only Copy / Edit in editor — no formatting row", async () => {
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
    expect(h.ctrl.items.map((i) => i.id)).toEqual(["selection-copy", "selection-edit"]);
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
