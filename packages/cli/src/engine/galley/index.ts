/**
 * Galley frame entry — `window.GutterpressGalley`, the preview-only bundle
 * (gutterpress-galley.js) that turns the paginated book into the editor.
 *
 * Mount orchestration: the preview server injects `window.__GP_MANUAL__=1`,
 * so the viewer does NOT auto-mount. This module decides the mode with NO
 * timing races (a grace-timer design lost the setEditMode race on loaded
 * runners and reload-looped — the render-perf gate caught it):
 *
 *   boot ──DOMContentLoaded──▶ readonly   (plain viewer mount, immediately —
 *          │                               the CLI browser preview IS this)
 *          └─setEditMode({on:true}) before DOMContentLoaded──▶ editing
 *
 *   readonly ──setEditMode({on:true})──▶ editing   IN PLACE: the old flow
 *            DOM is discarded, ProseMirror renders the same content from
 *            tokens, and the viewer re-mounts over the PM root. No reload.
 *   editing ──setEditMode({on:false})─▶ flush + location.reload() (the
 *            rare kill-switch direction; a reload here cannot loop because
 *            the off state needs no timing).
 *
 * A failed editing mount always falls back to readonly — layout must
 * complete no matter what.
 *
 * Events out (window CustomEvents, forwarded by preview-bridge):
 *   editSelection, editStateChanged  — same names/shapes as protocol v7
 *   galleyContent {chapter, markdown, expected} — whole-file save proposals
 *   galleyOpaqueEdit {chapter, pos, src, rect} — source-edit request
 */
import { createGalleyEditor, type GalleyEditor, type GalleyChapter } from "./editor.ts";
import type { GalleyToken } from "./markdown.ts";

type Mode = "boot" | "readonly" | "editing";

let mode: Mode = "boot";
let transitioning = false;
let active: GalleyEditor | null = null;

function emit(name: string, detail: unknown): void {
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

async function json<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`galley: ${url} → ${res.status}`);
  return (await res.json()) as T;
}

function viewerGlobal(): { mount(opts?: object): Promise<unknown> } | null {
  const g = (window as unknown as { Gutterpress?: { mount?: (o?: object) => Promise<unknown> } })
    .Gutterpress;
  return g?.mount ? (g as { mount(opts?: object): Promise<unknown> }) : null;
}

/** Plain read-only viewer, exactly what a published book or CLI preview shows. */
async function mountReadonly(): Promise<void> {
  await viewerGlobal()?.mount();
  mode = "readonly";
}

/**
 * Desired-state reconciliation — the single place mounts happen, so a
 * setEditMode arriving while another mount is in flight can never overlap
 * it; the loop re-checks `desired` after every transition.
 *
 * readonly→editing is IN PLACE: the old flow DOM (server-rendered content,
 * or a readonly mount's strips — the content nodes live inside them) is
 * discarded wholesale; ProseMirror re-renders the same content from the
 * server's tokens and the viewer re-mounts over the PM root
 * (`Gutterpress.mount` replaces its own global state). A failed editing
 * mount falls back to readonly — layout must ALWAYS complete.
 */
let desired: "readonly" | "editing" | null = null;

async function reconcile(): Promise<void> {
  if (transitioning) return;
  const target = desired ?? (mode === "boot" ? "readonly" : mode);
  if (target === mode) return;
  transitioning = true;
  try {
    if (target === "editing") {
      try {
        await mountEditing();
        mode = "editing";
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error("[galley] editing mount failed — staying read-only:", err);
        active?.destroy();
        active = null;
        desired = "readonly";
        try {
          await mountReadonly();
        } catch {
          /* the viewer global is missing entirely — nothing left to show */
        }
      }
    } else if (mode === "boot") {
      await mountReadonly();
    } else {
      // editing → readonly: the rare kill-switch direction. Flush and
      // reload; this cannot loop because the off state needs no timing.
      active?.saveNow();
      location.reload();
      return;
    }
  } finally {
    transitioning = false;
  }
  if ((desired ?? mode) !== mode) void reconcile();
}

/**
 * The takeover: fetch the book's token streams, replace the server-rendered
 * flow with a ProseMirror render of the same content, and let the viewer
 * paginate the editor's DOM.
 */
async function mountEditing(): Promise<void> {
  const { chapters } = await json<{ chapters: GalleyChapter[] }>("/__galley/book");

  // Replace the rendered flow with the editor root. Scripts/styles stay;
  // the PM render of the same tokens takes the content's place.
  const host = document.createElement("div");
  host.className = "gp-galley-host";
  const doomed: Element[] = [];
  for (const el of [...document.body.children]) {
    const tag = el.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "LINK" || tag === "TEMPLATE") continue;
    doomed.push(el);
  }
  if (doomed.length) doomed[0]!.before(host);
  else document.body.appendChild(host);
  for (const el of doomed) el.remove();

  active = createGalleyEditor({
    chapters,
    container: host,
    fragmentHtml: async (markdown) =>
      (await json<{ html: string }>("/__galley/fragment", { markdown })).html,
    parseTokens: async (markdown) =>
      (await json<{ tokens: GalleyToken[] }>("/__galley/tokens", { markdown })).tokens,
    onContentChanged: (spec) => emit("galleyContent", spec),
    onSelection: (payload) => emit("editSelection", payload),
    onDirtyChanged: (dirty) => emit("editStateChanged", { dirty }),
    onOpaqueEdit: (payload) => emit("galleyOpaqueEdit", payload),
  });
  // A viewer-mount failure must surface here (enterEditing falls back to
  // readonly), never hang layout as an unhandled rejection.
  await active.ready;
}

function bootMount(): void {
  // Test hook: a page that sets __GP_GALLEY_HOLD__ drives the mode switch
  // itself (no automatic readonly mount).
  if ((window as unknown as { __GP_GALLEY_HOLD__?: boolean }).__GP_GALLEY_HOLD__) return;
  void reconcile();
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", bootMount, { once: true });
} else {
  bootMount();
}

const api = {
  /** Bridge-facing mode switch (previewAPI.setEditMode delegates here). */
  setEditMode(spec: { on: boolean }): { on: boolean } {
    desired = spec.on ? "editing" : "readonly";
    void reconcile();
    return { on: spec.on };
  },

  isEditing(): boolean {
    return mode === "editing" && active !== null;
  },

  getSelectionState() {
    return active ? active.selectionState() : null;
  },

  applyInlineFormat(spec: { format: "bold" | "italic" | "strike" | "code" }) {
    return { applied: active ? active.applyFormat(spec.format) : false };
  },

  async insertMarkdown(spec: { markdown: string }) {
    return { inserted: active ? await active.insertMarkdown(spec.markdown) : false };
  },

  setOpaqueSource(spec: { pos: number; src: string }) {
    return { ok: active ? active.setOpaqueSource(spec.pos, spec.src) : false };
  },

  saveNow() {
    active?.saveNow();
    return { flushed: active !== null };
  },

  /** Host verdict on a galleyContent proposal — the expected-chain advances
   * only on ok:true (a refused chapter suspends until reload). */
  ackContent(spec: { chapter: string; ok: boolean }) {
    active?.ackContent(spec.chapter, !!spec.ok);
    return { ok: active !== null };
  },

  targetAt(spec: { x: number; y: number }) {
    return active ? active.targetAt(spec.x, spec.y) : null;
  },
};

(window as unknown as { GutterpressGalley: typeof api }).GutterpressGalley = api;

export type GutterpressGalleyApi = typeof api;
