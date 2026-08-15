/**
 * Galley frame entry — `window.GutterpressGalley`, the preview-only bundle
 * (gutterpress-galley.js) that turns the paginated book into the editor.
 *
 * Mount orchestration: the preview server injects `window.__GP_MANUAL__=1`,
 * so the viewer does NOT auto-mount. This module decides the mode:
 *
 *   pending ──setEditMode({on:true})──▶ editing   (PM takeover, then viewer
 *           │                                      mounts over the PM root)
 *           ├─setEditMode({on:false})─▶ readonly  (plain viewer mount —
 *           │                                      identical to today)
 *           └─grace timeout (400ms)──▶ readonly   (no bridge host: CLI
 *                                                  browser preview)
 *
 * readonly⇄editing after the fact is a reload (the server re-serves
 * book.html and the host re-issues setEditMode) — a deliberate v1
 * simplification for the rare kill-switch flip.
 *
 * Events out (window CustomEvents, forwarded by preview-bridge):
 *   editSelection, editStateChanged  — same names/shapes as protocol v7
 *   galleyContent {chapter, markdown, expected} — whole-file save proposals
 *   galleyOpaqueEdit {chapter, pos, src, rect} — source-edit request
 */
import { createGalleyEditor, type GalleyEditor, type GalleyChapter } from "./editor.ts";
import type { GalleyToken } from "./markdown.ts";

type Mode = "pending" | "readonly" | "editing";

const GRACE_MS = 400;

let mode: Mode = "pending";
let graceTimer: ReturnType<typeof setTimeout> | null = null;
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
  mode = "readonly";
  await viewerGlobal()?.mount();
}

/**
 * The takeover: fetch the book's token streams, replace the server-rendered
 * flow with a ProseMirror render of the same content, and let the viewer
 * paginate the editor's DOM.
 */
async function mountEditing(): Promise<void> {
  mode = "editing";
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
}

function armGrace(): void {
  // Test hook: a page that sets __GP_GALLEY_HOLD__ drives the mode switch
  // itself and must never race the readonly fallback.
  if ((window as unknown as { __GP_GALLEY_HOLD__?: boolean }).__GP_GALLEY_HOLD__) return;
  graceTimer = setTimeout(() => {
    graceTimer = null;
    if (mode === "pending") void mountReadonly();
  }, GRACE_MS);
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", armGrace, { once: true });
} else {
  armGrace();
}

const api = {
  /** Bridge-facing mode switch (previewAPI.setEditMode delegates here). */
  setEditMode(spec: { on: boolean }): { on: boolean } {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
    if (spec.on) {
      if (mode === "editing") return { on: true };
      if (mode === "readonly") {
        // Kill-switch flip after a readonly mount — reload; the host
        // re-issues setEditMode when the fresh frame reports ready.
        location.reload();
        return { on: false };
      }
      void mountEditing();
      return { on: true };
    }
    if (mode === "editing") {
      active?.saveNow();
      location.reload();
      return { on: false };
    }
    if (mode === "pending") void mountReadonly();
    return { on: false };
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

  targetAt(spec: { x: number; y: number }) {
    return active ? active.targetAt(spec.x, spec.y) : null;
  },
};

(window as unknown as { GutterpressGalley: typeof api }).GutterpressGalley = api;

export type GutterpressGalleyApi = typeof api;
