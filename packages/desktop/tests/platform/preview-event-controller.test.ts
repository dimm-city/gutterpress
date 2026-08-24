import { expect, test } from "bun:test";
import { PreviewEventController } from "../../src/lib/routes/preview-event-controller";
import type { PreviewEvent } from "../../src/lib/preview-client";

/** Flush the microtask/macrotask queue so `.then().catch()`/`await` chains settle. */
const flush = () => new Promise((r) => setTimeout(r, 0));

interface Harness {
  ctrl: PreviewEventController;
  log: string[];
  /** Every injectStyles(id, css) the controller made, in order. */
  injectedCss: Array<{ id: string; css: string }>;
  client: {
    calls: Array<{ cmd: string; args: unknown[] }>;
    rejectSetZoom: boolean;
    getTotalPagesResult: number;
    listener?: (e: PreviewEvent) => void;
    on(fn: (e: PreviewEvent) => void): () => void;
  };
  pageNav: {
    totalPages: number;
    restoreProjectPage: (page: number) => void;
    syncPageState: (detail: unknown) => void;
  };
  zoomView: {
    userSetViewMode: boolean;
    rejectFit: boolean;
    applyViewMode: (mode: "single" | "two-column", fromUser: boolean) => void;
    applyFitWidthZoom: () => Promise<void>;
  };
  // Mutable ambient state the controller reads through injected getters.
  hasClient: boolean;
  zoom: string;
  viewMode: "single" | "two-column";
  rendering: boolean;
  renderProgressPage: number;
  overlay: boolean;
  updating: boolean;
  viewportWidth: number;
  pendingRestore: { page: number | null; viewMode: "single" | "two-column" | null };
}

function make(): Harness {
  const log: string[] = [];
  const injectedCss: Array<{ id: string; css: string }> = [];
  const h = {
    log,
    injectedCss,
    hasClient: true,
    zoom: "fit-width",
    viewMode: "two-column" as "single" | "two-column",
    rendering: false,
    renderProgressPage: 0,
    overlay: false,
    updating: false,
    viewportWidth: 1400,
    pendingRestore: { page: null, viewMode: null } as {
      page: number | null;
      viewMode: "single" | "two-column" | null;
    },
  } as Harness;

  h.client = {
    calls: [],
    rejectSetZoom: false,
    getTotalPagesResult: 0,
    on(fn) {
      h.client.listener = fn;
      return () => {
        h.client.listener = undefined;
      };
    },
    // extra methods added below so `this` isn't needed for call/injectStyles
  } as Harness["client"];
  // call + injectStyles are on the same object the controller reads.
  const client = h.client as unknown as {
    call: (cmd: string, args?: unknown[]) => Promise<unknown>;
    injectStyles: (id: string, css: string) => void;
  } & Harness["client"];
  client.call = (cmd: string, args: unknown[] = []) => {
    client.calls.push({ cmd, args });
    log.push(`call:${cmd}`);
    if (cmd === "setZoom" && client.rejectSetZoom) return Promise.reject(new Error("boom"));
    if (cmd === "getTotalPages") return Promise.resolve(client.getTotalPagesResult);
    return Promise.resolve(undefined);
  };
  client.injectStyles = (id: string, css: string) => {
    log.push(`inject:${id}`);
    injectedCss.push({ id, css });
  };

  h.pageNav = {
    totalPages: 0,
    restoreProjectPage: (page: number) => log.push(`restorePage:${page}`),
    syncPageState: (detail: unknown) => log.push(`syncPageState:${JSON.stringify(detail)}`),
  };

  h.zoomView = {
    userSetViewMode: false,
    rejectFit: false,
    applyViewMode: (mode, fromUser) => log.push(`applyViewMode:${mode}:${fromUser}`),
    applyFitWidthZoom: () => {
      log.push("applyFitWidth");
      return h.zoomView.rejectFit ? Promise.reject(new Error("fit-boom")) : Promise.resolve();
    },
  };

  h.ctrl = new PreviewEventController({
    client: () => (h.hasClient ? (client as never) : undefined),
    pageNav: h.pageNav,
    zoomView: h.zoomView,
    editorSync: {
      invalidatePending: () => log.push("invalidateEditorSync"),
      updateActiveOutline: (line) => log.push(`updateActiveOutline:${line}`),
    },
    zoom: () => h.zoom,
    viewMode: () => h.viewMode,
    bgColor: () => "#123456",
    setRendering: (v) => {
      h.rendering = v;
      log.push(`setRendering:${v}`);
    },
    getRendering: () => h.rendering,
    setRenderProgressPage: (v) => {
      h.renderProgressPage = v;
      log.push(`setProgress:${v}`);
    },
    getRenderProgressPage: () => h.renderProgressPage,
    setRenderCompleteOverlay: (v) => {
      h.overlay = v;
      log.push(`overlay:${v}`);
    },
    setPreviewUpdating: (v) => {
      h.updating = v;
      log.push(`updating:${v}`);
    },
    resetOutline: () => log.push("resetOutline"),
    consumePendingRestore: () => {
      const r = h.pendingRestore;
      h.pendingRestore = { page: null, viewMode: null };
      return r;
    },
    refreshOutline: () => log.push("refreshOutline"),
    refreshProblems: () => log.push("refreshProblems"),
    revealSettledPages: () => log.push("reveal"),
    toastSuccess: (m) => log.push(`toast:${m}`),
    viewportWidth: () => h.viewportWidth,
    scheduleMicrotask: (fn) => queueMicrotask(fn),
  });
  return h;
}

const rc = (totalPages?: number): PreviewEvent => ({
  name: "renderingComplete",
  detail: { totalPages },
});

// ── renderingComplete: settle sequence ordering + reveal gating ──────────────

test("renderingComplete runs the settle sequence in the JUMP-preventing order", async () => {
  const h = make();
  h.zoom = "0.5"; // numeric-zoom path
  h.viewportWidth = 1400; // auto → two-column
  h.ctrl.handleEvent(rc(12));

  // The synchronous portion must have run in exactly this order, and the
  // reveal must NOT have happened yet (it is gated on the async zoom promise).
  expect(h.log).toEqual([
    "updating:false",
    "setProgress:12",
    "setRendering:false",
    "overlay:true",
    "inject:desktop-canvas",
    "applyViewMode:two-column:false",
    "call:setZoom",
    "toast:Your book is ready — 12 pages",
    "refreshOutline",
    "refreshProblems",
  ]);
  expect(h.pageNav.totalPages).toBe(12);
  expect(h.log).not.toContain("reveal");

  await flush();
  // Reveal is the LAST thing to happen, only after the zoom round-trip settles.
  expect(h.log[h.log.length - 1]).toBe("reveal");
  expect(h.client.calls).toContainEqual({ cmd: "setZoom", args: [0.5] });

  // Only the engine-agnostic preview canvas background is injected. The rest
  // of the native viewer's chrome (zoom, sheet background, view modes, debug
  // guides) lives in decorate.ts + viewer.css, not injected from the toolbar.
  const canvas = h.injectedCss.filter((i) => i.id === "desktop-canvas");
  expect(canvas.length).toBe(1);
  expect(canvas[0]!.css).toContain("background-color: #123456 !important");
});

test("renderingComplete fit-width path measures-and-fits, never assumes 100%", async () => {
  const h = make();
  h.zoom = "fit-width";
  h.ctrl.handleEvent(rc(3));
  await flush();
  expect(h.log).toContain("applyFitWidth");
  // fit-width must NOT go through the raw setZoom path.
  expect(h.client.calls.find((c) => c.cmd === "setZoom")).toBeUndefined();
  expect(h.log[h.log.length - 1]).toBe("reveal");
  // singular "page" copy for 1, plural otherwise.
  expect(h.log).toContain("toast:Your book is ready — 3 pages");
});

test("renderingComplete singular page copy for a one-page book", () => {
  const h = make();
  h.ctrl.handleEvent(rc(1));
  expect(h.log).toContain("toast:Your book is ready — 1 page");
});

test("hot-reload completion stays ambient without reapplying settled presentation", async () => {
  const h = make();
  h.ctrl.handleEvent({ name: "renderingComplete", detail: { totalPages: 6, hotReload: true } });
  expect(h.log).toContain("overlay:false");
  expect(h.log).not.toContain("overlay:true");
  await flush();
  expect(h.log).not.toContain("reveal");
  expect(h.log.some((entry) => entry.startsWith("inject:"))).toBe(false);
  expect(h.log.some((entry) => entry.startsWith("applyViewMode:"))).toBe(false);
  expect(h.client.calls).toEqual([]);
  expect(h.log).toContain("refreshOutline");
  expect(h.log).toContain("refreshProblems");
});

// ── renderingComplete: first-render-only toast gate (M3) ─────────────────────
// The success toast must fire once per project session — not on every
// watcher-triggered rebuild (500ms auto-save debounce), which would otherwise
// stack "Your book is ready" toasts nearly permanently on screen.

test("renderingComplete toasts success only on the first render of a session", () => {
  const h = make();
  h.ctrl.handleEvent(rc(5));
  h.ctrl.handleEvent(rc(6)); // watcher-triggered rebuild — must stay ambient
  h.ctrl.handleEvent(rc(7)); // another rebuild
  const toasts = h.log.filter((l) => l.startsWith("toast:"));
  expect(toasts).toEqual(["toast:Your book is ready — 5 pages"]);
});

test("resetFirstRenderGate re-arms the toast for a newly opened project", () => {
  const h = make();
  h.ctrl.handleEvent(rc(5));
  h.ctrl.handleEvent(rc(6));
  h.ctrl.resetFirstRenderGate();
  h.ctrl.handleEvent(rc(9)); // first render of the NEW project session
  h.ctrl.handleEvent(rc(10)); // rebuild of the new session — still gated
  const toasts = h.log.filter((l) => l.startsWith("toast:"));
  expect(toasts).toEqual([
    "toast:Your book is ready — 5 pages",
    "toast:Your book is ready — 9 pages",
  ]);
});

test("reveal still fires when the numeric zoom call rejects (pages never stranded hidden)", async () => {
  const h = make();
  h.zoom = "0.75";
  h.client.rejectSetZoom = true;
  h.ctrl.handleEvent(rc(5));
  await flush();
  expect(h.log[h.log.length - 1]).toBe("reveal");
});

test("reveal still fires when fit-width zoom rejects", async () => {
  const h = make();
  h.zoom = "fit-width";
  h.zoomView.rejectFit = true;
  h.ctrl.handleEvent(rc(5));
  await flush();
  expect(h.log[h.log.length - 1]).toBe("reveal");
});

// ── renderingComplete: view-mode auto-selection ──────────────────────────────

test("view mode auto-selects single below 1280px and two-column above", () => {
  const narrow = make();
  narrow.viewportWidth = 1000;
  narrow.ctrl.handleEvent(rc(2));
  expect(narrow.log).toContain("applyViewMode:single:false");

  const wide = make();
  wide.viewportWidth = 1400;
  wide.ctrl.handleEvent(rc(2));
  expect(wide.log).toContain("applyViewMode:two-column:false");
});

test("a user-locked view mode overrides the responsive auto default", () => {
  const h = make();
  h.viewportWidth = 1000; // auto would be single
  h.zoomView.userSetViewMode = true;
  h.viewMode = "two-column";
  h.ctrl.handleEvent(rc(2));
  expect(h.log).toContain("applyViewMode:two-column:false");
});

test("a pending restore view mode wins over both auto and the user lock", () => {
  const h = make();
  h.viewportWidth = 1400; // auto two-column
  h.zoomView.userSetViewMode = true;
  h.viewMode = "two-column";
  h.pendingRestore = { page: null, viewMode: "single" };
  h.ctrl.handleEvent(rc(2));
  expect(h.log).toContain("applyViewMode:single:false");
});

// ── renderingComplete: page restore ──────────────────────────────────────────

test("a pending restore page > 1 is restored via a microtask", async () => {
  const h = make();
  h.pendingRestore = { page: 4, viewMode: null };
  h.ctrl.handleEvent(rc(10));
  // Not restored synchronously.
  expect(h.log).not.toContain("restorePage:4");
  await flush();
  expect(h.log).toContain("restorePage:4");
});

test("page 1 (or no) restore does not schedule a restore", async () => {
  const h = make();
  h.pendingRestore = { page: 1, viewMode: null };
  h.ctrl.handleEvent(rc(10));
  await flush();
  expect(h.log.some((l) => l.startsWith("restorePage:"))).toBe(false);
});

// ── pageChanged ──────────────────────────────────────────────────────────────

test("pageChanged during render updates the progress page count", () => {
  const h = make();
  h.rendering = true;
  h.ctrl.handleEvent({ name: "pageChanged", detail: { totalPages: 7 } });
  expect(h.log).toContain("setProgress:7");
  expect(h.pageNav.totalPages).toBe(7);
});

test("pageChanged when idle syncs the toolbar page state", () => {
  const h = make();
  h.rendering = false;
  h.ctrl.handleEvent({ name: "pageChanged", detail: { currentPage: 2, totalPages: 9 } });
  expect(h.log).toContain('syncPageState:{"currentPage":2,"totalPages":9}');
});

// ── ready ────────────────────────────────────────────────────────────────────

test("ready flips into rendering, clears outline, and peeks total pages", async () => {
  const h = make();
  h.client.getTotalPagesResult = 6;
  h.ctrl.handleEvent({ name: "ready", detail: {} });
  expect(h.log).toContain("setRendering:true");
  expect(h.log).toContain("invalidateEditorSync");
  expect(h.log).toContain("setProgress:0");
  expect(h.log).toContain("resetOutline");
  await flush();
  expect(h.pageNav.totalPages).toBe(6);
});

test("renderingStarted invalidates pending editor scroll commands before frame replacement", () => {
  const h = make();
  h.ctrl.handleEvent({ name: "renderingStarted", detail: { hotReload: true, revision: 2 } });
  expect(h.log).toEqual(["invalidateEditorSync", "updating:true"]);
});

test("hot reload exposes a non-blocking updating state until the replacement is visible", () => {
  const h = make();
  h.ctrl.handleEvent({ name: "renderingStarted", detail: { hotReload: true, revision: 2 } });
  expect(h.updating).toBe(true);
  expect(h.rendering).toBe(false);

  h.ctrl.handleEvent({ name: "renderingComplete", detail: { totalPages: 4, hotReload: true, revision: 2 } });
  expect(h.updating).toBe(false);
});

// The pill was the visible half of a dropped `renderingComplete`; the chapter
// outline and the Problems panel were the quiet half. A hot reload rebuilds
// both — it is a whole new document, so anything derived from the old one is
// stale.
test("a hot reload rebuilds the chapter outline and re-lints the project", () => {
  const h = make();
  h.ctrl.handleEvent({ name: "renderingStarted", detail: { hotReload: true, revision: 2 } });
  h.ctrl.handleEvent({ name: "renderingComplete", detail: { totalPages: 4, hotReload: true, revision: 2 } });
  expect(h.log).toContain("refreshOutline");
  expect(h.log).toContain("refreshProblems");
});

test("a cancelled replacement clears the non-blocking updating state", () => {
  const h = make();
  h.ctrl.handleEvent({ name: "renderingStarted", detail: { hotReload: true, revision: 2 } });
  expect(h.updating).toBe(true);

  h.ctrl.handleEvent({ name: "renderingCancelled", detail: { hotReload: true, revision: 2 } });
  expect(h.updating).toBe(false);
});

// ── preview → editor policy ──────────────────────────────────────────────────

test("sourceLineChanged updates outline state but never moves the editor", () => {
  const h = make();
  h.ctrl.handleEvent({ name: "sourceLineChanged", detail: { sourceLine: 42, chapter: "ch2.md" } });
  expect(h.log).toContain("updateActiveOutline:42");
  expect(h.log.some((line) => line.startsWith("revealEditorLine:"))).toBe(false);
});

test("normal preview activation never moves or opens the editor; Go to source owns navigation", () => {
  const h = make();
  h.ctrl.handleEvent({ name: "elementActivated", detail: { sourceLine: 12, chapter: "ch1.md" } });
  expect(h.log.some((line) => line.startsWith("revealEditorLine:"))).toBe(false);
});

// ── subscribe wiring ─────────────────────────────────────────────────────────

test("subscribe routes the client's event stream through handleEvent", () => {
  const h = make();
  h.ctrl.subscribe(h.client);
  expect(h.client.listener).toBeDefined();
  h.client.listener?.({ name: "pageChanged", detail: { currentPage: 3, totalPages: 5 } });
  expect(h.log).toContain('syncPageState:{"currentPage":3,"totalPages":5}');
});

test("renderingComplete tolerates a missing client (no crash, still reveals)", async () => {
  const h = make();
  h.hasClient = false;
  h.zoom = "0.5";
  h.ctrl.handleEvent(rc(2));
  // No inject/setZoom calls, but the settle sequence still completes + reveals.
  expect(h.log).not.toContain("inject:desktop-canvas");
  await flush();
  expect(h.log).toContain("reveal");
});
