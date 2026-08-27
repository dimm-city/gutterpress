import {
  diagnosticForEditRejection,
  type Diagnostic,
  type DocumentSnapshot,
  type EditorDocumentHost,
} from "../core/index.ts";
import { computeMinimalEdit } from "./diff.ts";

/**
 * SFE-P1a Lane B — framework-free web mount shell.
 *
 * "Add a minimal mount/dispose API with no Svelte, Electron, VS Code, or
 * Node dependency. Add memory-host integration tests. Do not implement
 * Gutterpress projections yet" (run spec, Lane B). This file is the ENTIRE
 * production surface: `mountEditor()` renders a host's current snapshot
 * into an editor surface it owns, wires `host.subscribe` so external
 * replacements re-render, translates user input into `SourceEdit`s applied
 * through `host.applyEdit`, and surfaces rejections as `Diagnostic`s.
 *
 * Deliberately thin (run spec: "for this run a plain `<textarea>` ... is
 * ACCEPTABLE and preferred — the real rich surface arrives in P1b via
 * `@vscode/markdown-editor`; keep this shell so thin that replacing its
 * internals in P1b changes no public API"): the surface is a single
 * `<textarea>`, there is no toolbar, no formatting, no Gutterpress
 * projection (D6/P2b), and no undo/redo beyond whatever the host and the
 * browser's native textarea history already provide. `mountEditor` and
 * `EditorMount` are the only exports later runs may depend on; everything
 * else here is a private implementation detail.
 */

/** Options accepted by `mountEditor`. */
export interface EditorMountOptions {
  /**
   * Called whenever a submitted edit is REJECTED by the host (stale,
   * readonly, or invalid-range) — see `diagnosticForEditRejection` in
   * `../core/diagnostics.ts`, the single place that reason -> category
   * pairing is defined. `mountEditor` never throws on a rejection; this is
   * the only channel a caller has for observing one.
   */
  readonly onDiagnostic?: (diagnostic: Diagnostic) => void;
}

/** Handle returned by `mountEditor`. */
export interface EditorMount {
  /**
   * Removes the mount's DOM (the surface element it appended to
   * `container`) and its `host.subscribe` listener. Idempotent — calling
   * `dispose()` more than once is a no-op, not a throw. After `dispose()`,
   * any notification the host later delivers on the same subscription is
   * impossible (the subscription itself is gone) and, defensively, is also
   * ignored by the mount's own listener body should it ever run anyway
   * (G-02: "the mount owns its subtree, nothing else touches it" — a
   * disposed mount must not resurrect DOM or fire diagnostics after the
   * caller has moved on).
   */
  dispose(): void;
}

/**
 * Mounts a minimal source-edit-backed editor surface into `container`.
 *
 * `container` must be a real, attached-or-detached DOM `Element` with a
 * non-null `ownerDocument` (true of every `Element` a real browser or
 * webview ever hands out) — `mountEditor` creates its surface via
 * `container.ownerDocument.createElement(...)` rather than the `document`
 * global, so the mount works correctly inside an iframe or a document other
 * than the host page's own (a later run's presentation host, D7/G-03, is
 * expected to mount into an isolated document).
 *
 * Mounting is synchronous: `mountEditor` renders the host's CURRENT
 * snapshot (`host.getSnapshot()`) into the surface before returning.
 */
export function mountEditor(
  container: Element,
  host: EditorDocumentHost,
  options: EditorMountOptions = {},
): EditorMount {
  const doc = container.ownerDocument;
  if (!doc) {
    // Not a rejection this run's D3/D14 diagnostic taxonomy covers (it is a
    // caller-usage error, not a document/edit-lifecycle event) — every real
    // Element has an ownerDocument, so reaching this is a broken caller, and
    // failing loudly here is more honest than silently no-oping.
    throw new Error("mountEditor: container has no ownerDocument");
  }

  const surface = doc.createElement("textarea");
  // The shell's only styling hook for now (D7/G-03 presentation context is
  // a later run's concern) — a stable selector lets a future host wrapper
  // (P3a's thin Svelte shell) find and style the surface without reaching
  // into this module's internals.
  surface.classList.add("gp-editor-surface");

  // The text/version this mount currently believes is authoritative — kept
  // in sync by `render()`, called both after our own accepted edits and on
  // every `host.subscribe` notification (D2: "External changes replace or
  // patch the authoritative snapshot, then update mounted views"). Every
  // `SourceEdit` this mount submits is diffed and versioned against this
  // value, never against a value read fresh from `host.getSnapshot()` at
  // submit time — so a host that changed underneath this mount without
  // going through `subscribe` (impossible for a spec-compliant host, but
  // not something this module assumes) would surface as a rejected,
  // diagnosed edit rather than a silently wrong one.
  let known: DocumentSnapshot = host.getSnapshot();
  surface.value = known.text;

  let disposed = false;

  function render(snapshot: DocumentSnapshot): void {
    known = snapshot;
    // Avoid clobbering the surface (and any in-progress IME composition or
    // caret position a real browser would have) when the incoming snapshot
    // already matches what's on screen — true after every self-originated
    // accepted edit, since we computed `newText` from the surface's own
    // current value.
    if (surface.value !== snapshot.text) {
      surface.value = snapshot.text;
    }
  }

  function handleInput(): void {
    if (disposed) return;
    const newText = surface.value;
    if (newText === known.text) return; // no-op input notification; nothing to submit
    const edit = computeMinimalEdit(known.text, newText, known.version);
    const result = host.applyEdit(edit);
    if (result.ok) {
      render(result.snapshot);
      return;
    }
    // Rejected: D3 — "A stale or invalid edit changes nothing and returns
    // the current snapshot." `result.snapshot` IS that current, unchanged
    // snapshot, so re-rendering it resyncs the surface to the truth rather
    // than leaving the user's rejected keystroke sitting on screen looking
    // accepted (G-01: exact source is the only writable authority).
    render(result.snapshot);
    options.onDiagnostic?.(diagnosticForEditRejection(result.reason));
  }

  surface.addEventListener("input", handleInput);

  const unsubscribe = host.subscribe((snapshot) => {
    if (disposed) return;
    render(snapshot);
  });

  container.appendChild(surface);

  return {
    dispose(): void {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      surface.removeEventListener("input", handleInput);
      surface.remove();
    },
  };
}
