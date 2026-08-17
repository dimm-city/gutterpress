/**
 * The block drag handle — a grip that appears beside the block under the
 * pointer and drags it to a new place in the document.
 *
 * Keyboard equivalent: `moveBlockUp`/`moveBlockDown` in `rich-move-block.ts`,
 * bound to Alt-ArrowUp / Alt-ArrowDown. Both spellings must exist, and both
 * stop their outward search on `isReorderable()` — the command's WHOLE search
 * condition, not just its "are these children in authored order" half. Sharing
 * the weaker half was not enough: in a bulleted list the grip stopped at the
 * paragraph inside the list item and offered to drag it out of its bullet,
 * where Alt-Arrow moved the list item. One predicate, one search, one block.
 *
 * ## Where the handle lives, and why it is not a decoration
 *
 * It is ONE reused `<div>` appended to the frame's `<body>`, a sibling of the
 * editable flow — deliberately not any of the three obvious alternatives:
 *
 * 1. **Not a `Decoration.widget`.** A widget at a block boundary renders as a
 *    real element interleaved with the author's top-level blocks, and this
 *    frame applies the book's own stylesheet verbatim — that is the whole
 *    point of the iframe. Counted across the checked-in example books' CSS:
 *    17 `:last-child`, 14 `h? + p`, 6 `+ ul`, 6 `+ ol`, 5 `+ pre`, 4
 *    `:nth-child(even)`, 4 `:first-child`. `h2 + p { margin-top: 0 }` is the
 *    single most common shape, so a widget before that paragraph stops the
 *    rule matching, the paragraph jumps on hover, and — because pagination
 *    here is CSS multicol — the page break can move with it. That breaks the
 *    one promise this surface makes at exactly the moment the author is
 *    looking at it. `rich-editor.ts` keeps decorations for content that
 *    PRINTS (the chapter opener); a handle is tooling chrome and is neither
 *    document nor print.
 * 2. **Not appended inside `view.dom`.** ProseMirror's `DOMObserver` reverts
 *    external mutation of its own DOM — the trap `paginate.ts`'s header
 *    records from the previous attempt. Living on `body` sidesteps the
 *    observer entirely, needs no `ignoreMutation`, and inherits no
 *    `contenteditable`.
 * 3. **Not host chrome like `EditorChrome.svelte`.** `prosemirror-view`
 *    registers every drag handler on `view.dom`, which is inside the iframe;
 *    a `dragstart` fired from a host-document element never reaches it. And
 *    the host overlay would have to re-translate frame coordinates on every
 *    scroll — hovering IS a scroll-time interaction — while sitting between
 *    the pointer and the frame's own margin.
 *
 * Because it is outside the document tree in both senses — not a ProseMirror
 * node, not inside `view.dom` — there is no path from this element to the
 * serializer. That is the correctness property `rich-editor.test.ts` asserts.
 *
 * ## How the drag itself works: PM's own machinery, three lines of wiring
 *
 * `EditorView.dragging` is public and writable. Setting it to
 * `{ slice, move: true }` in our `dragstart` is what PM's own `dragstart`
 * handler does — its `move` comes from the modifier held at that instant, and
 * `handleDrop` re-reads the modifier at the DROP anyway, so what matters here
 * is that the field is non-null and carries the right slice. From there
 * `editHandlers.dragover`/`drop` plus
 * `prosemirror-dropcursor` do the rest — including deleting the source, which
 * `handleDrop` performs as `tr.deleteSelection()` against the `NodeSelection`
 * we set. No custom drop code exists here, so the drop path is upstream's.
 *
 * Leaving `view.dragging` null would be the data-corrupting failure: PM then
 * re-parses the DataTransfer's HTML, and this schema's `gp_chapter`/`gp_spread`
 * /`gp_page`/`gp_section`/`html_block` specs declare `toDOM` with no
 * `parseDOM`, so a dropped `@section` would come back as a plain div with its
 * marker line gone — and `move` is computed from `dragging` too, so the
 * original would not be removed either. Hence: on any failure the handler
 * calls `preventDefault()` and no drag starts at all.
 */
import type { ResolvedPos } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { isReorderable } from "./rich-move-block";

/** Gap between the handle and the block it points at, in px. */
const GAP = 6;
/** The handle's width, in px. Both live here because `point()` subtracts them
 *  from the block's left edge and the stylesheet has to agree. */
const WIDTH = 14;

/**
 * The handle's own stylesheet, injected into the frame's head.
 *
 * Fixed mid-grey rather than a theme: this frame carries no app tokens (see
 * `tools/check-app-tokens.mjs`) and the handle sits over the author's own
 * canvas colour, which may be anything. A translucent 50% grey reads against
 * both a white page and the default `#2a2a2e` backdrop, so there is no
 * colour-scheme to guess at — and `light-dark()` would resolve to its light
 * arm anyway, since nothing in this document declares `color-scheme`.
 *
 * The `[hidden]` rule is stated rather than left to the UA sheet: the book's
 * CSS is in the same cascade and a bare `div { display: block }` in it would
 * outrank the UA rule and pin the handle on screen.
 */
const HANDLE_CSS = `
.gp-drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  width: ${WIDTH}px;
  height: 20px;
  margin: 0;
  padding: 0;
  border: 0;
  border-radius: 4px;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  background-color: rgba(128, 128, 128, 0.14);
  background-image: radial-gradient(circle, rgba(128, 128, 128, 0.95) 1px, rgba(0, 0, 0, 0) 1.4px);
  background-size: 5px 5px;
  background-position: 2px 4px;
  background-repeat: repeat;
  /* The author utility vocabulary's depth ladder tops out at
     --gp-z-front: 2, so this clears everything a book can stack. */
  z-index: 100;
}
.gp-drag-handle:hover { background-color: rgba(128, 128, 128, 0.3); }
.gp-drag-handle:active { cursor: grabbing; }
.gp-drag-handle[hidden] { display: none; }

/* The block the grip has hold of. Both the click and the drag put a
   NodeSelection on it and prosemirror-view ships no default appearance for
   one, so without this the author cannot see what they are about to move.

   An outline, and nothing else, on purpose: it is the one visual that takes no
   space, so this cannot move a page break — the rule paginate.ts keeps for its
   own stylesheet. ProseMirror-selectednode is a view class, never part of the
   author's vocabulary, so no book can come to depend on it. */
.ProseMirror-selectednode {
  outline: 2px solid rgba(128, 128, 128, 0.55);
  outline-offset: 2px;
}
`;

/**
 * The document position of the block whose DOM is exactly `el`, or null.
 *
 * `posAtDOM` + a walk outward through the resolved chain, NOT `posAtCoords`:
 * a hit test always returns something, so it cannot report "the pointer is not
 * over a block", it is the expensive path (a binary search over text), it
 * cannot tell a widget decoration from a document node, and it does not hand
 * back the element — which the handle needs anyway to position itself.
 *
 * Exported for the tests, which run this against real parsed documents under
 * happy-dom; no layout is involved, so it is fully checkable headlessly.
 */
export function blockPosFor(view: EditorView, el: HTMLElement): number | null {
  let pos: number;
  let $pos: ResolvedPos;
  try {
    pos = view.posAtDOM(el, 0);
    // Resolved inside the guard, not after it. `posAtDOM` reads the
    // `pmViewDesc` ProseMirror hangs off the element, and a DETACHED element
    // still carries a stale one — so it answers with a position from a tree
    // that no longer exists rather than refusing. Measured in Chromium 153:
    // hover a block, replace the document, touch the stale element, and
    // `resolve()` throws "Position -1 out of range" out of a mousemove
    // listener. Every ordinary document swap reaches this — an external-edit
    // reload, a file switch, an undo.
    $pos = view.state.doc.resolve(pos);
  } catch {
    return null;
  }
  // A leaf (`@page-break`, a raw HTML block): `posAtDOM` reports the position
  // BEFORE it, because it has no content to be inside of.
  if (view.nodeDOM(pos) === el) {
    return isReorderable($pos.parent, $pos.index()) ? pos : null;
  }
  for (let depth = $pos.depth; depth >= 1; depth--) {
    const before = $pos.before(depth);
    if (view.nodeDOM(before) !== el) continue;
    return isReorderable($pos.node(depth - 1), $pos.index(depth - 1)) ? before : null;
  }
  return null;
}

/**
 * An event target as the element it is, or the element containing it.
 *
 * `nodeType` rather than `instanceof HTMLElement`, and the reason is this
 * surface specifically: the editor spans TWO realms. `RichEditor.svelte`
 * creates the flow with the frame's `document`, while ProseMirror builds every
 * node's DOM with the bare global `document` — the host's — and appending
 * those into the frame adopts them without changing their prototype. An
 * `instanceof` against either realm's constructor is therefore false for half
 * the elements this walk crosses.
 */
function elementOf(target: EventTarget | null): HTMLElement | null {
  const node = target as Node | null;
  if (!node || typeof node.nodeType !== "number") return null;
  return node.nodeType === 1 ? (node as HTMLElement) : node.parentElement;
}

/**
 * The innermost REORDERABLE block under `target`, walking up from the hovered
 * node.
 *
 * Walking up means hovering text inside a `@section` finds the PARAGRAPH, and
 * hovering the section's own padding finds the section. The walk does not stop
 * at a block with nowhere to go, though — `blockPosFor` refuses that one and
 * the walk continues outward, which is what makes the grip beside a bullet
 * grab the list ITEM rather than the paragraph inside it. That is the same
 * block Alt-Arrow moves from the same spot, and the reason a hover can come
 * back with nothing at all: the only block in a document has no sibling to
 * trade places with, so offering to drag it would promise an edit that cannot
 * happen.
 */
export function blockAtDom(
  view: EditorView,
  target: EventTarget | null,
): { el: HTMLElement; pos: number } | null {
  let el = elementOf(target);
  while (el && el !== view.dom && view.dom.contains(el)) {
    const pos = blockPosFor(view, el);
    if (pos != null) return { el, pos };
    el = el.parentElement;
  }
  return null;
}

export interface DragHandleControl {
  destroy(): void;
}

/**
 * Attach the drag handle to a mounted view.
 *
 * Called from `mountRichEditor` rather than from `RichEditor.svelte`: the
 * handle belongs to the editing surface, not to the Svelte shell, and tying
 * its lifetime to the view's means there is no second teardown path to get
 * wrong. It needs the frame's document, which it takes from `view.dom` — so
 * this works unchanged whether the view is mounted in an iframe (the app) or
 * in a bare document (the tests).
 */
export function mountDragHandle(view: EditorView): DragHandleControl {
  const doc = view.dom.ownerDocument;
  if (!doc?.defaultView || !doc.body) return { destroy: () => {} };
  const win = doc.defaultView;

  const style = doc.createElement("style");
  style.textContent = HANDLE_CSS;
  doc.head.appendChild(style);

  const handle = doc.createElement("div");
  handle.className = "gp-drag-handle";
  handle.draggable = true;
  handle.hidden = true;
  // The keyboard equivalent is a command, not this element, so there is
  // nothing here for a screen reader to operate.
  handle.setAttribute("aria-hidden", "true");
  doc.body.appendChild(handle);

  /** The element the handle currently points at. */
  let current: HTMLElement | null = null;

  /**
   * An ELEMENT, never a position.
   *
   * Positions go stale across transactions — the lesson `chromePlugin`'s
   * header already records — so the position is re-derived from the element at
   * the moment of use, on both the click and the drag.
   */
  function point(el: HTMLElement): void {
    current = el;
    const rect = el.getBoundingClientRect();
    // Frame-document coordinates: `body` is unpositioned, so an absolutely
    // positioned child is placed against the initial containing block. The
    // handle therefore scrolls with the content and needs no scroll listener.
    handle.style.top = `${rect.top + win.scrollY}px`;
    handle.style.left = `${Math.max(0, rect.left + win.scrollX - GAP - WIDTH)}px`;
    handle.hidden = false;
  }

  function onMove(event: MouseEvent): void {
    if (event.target === handle) return;
    const found = blockAtDom(view, event.target);
    // Deliberately no `else hide()`: the pointer crosses bare page margin on
    // its way TO the handle, and hiding there would make the handle
    // unreachable. It goes away when the pointer leaves the frame.
    if (found) point(found.el);
  }

  function hide(): void {
    current = null;
    handle.hidden = true;
  }

  /** Select the block, so a click makes the keyboard commands act on it. */
  function onMouseDown(): void {
    // No `preventDefault()` here — in Chromium that cancels the native drag
    // this element exists to start.
    const pos = current && blockPosFor(view, current);
    if (pos == null) return;
    try {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    } catch {
      /* the block stopped being selectable between hover and click */
    }
  }

  function onDragStart(event: DragEvent): void {
    const dt = event.dataTransfer;
    const block = current;
    const pos = block && blockPosFor(view, block);
    try {
      if (!dt || pos == null) throw new Error("no block under the handle");
      const selection = NodeSelection.create(view.state.doc, pos);
      view.dispatch(view.state.tr.setSelection(selection));
      const slice = selection.content();
      dt.clearData();
      // Enough for the browser to start a drag, and a sensible payload for a
      // drop into another application. PM never reads it for a drop back into
      // this editor — `handleDrop` parses the DataTransfer only when
      // `view.dragging` is null.
      dt.setData("text/plain", selection.node.textContent);
      // `copyMove`, not `move` — the same value prosemirror-view's own
      // `dragstart` sets, and for the same reason. Ctrl (Option on macOS)
      // held at the DROP makes this a copy: `handleDrop` recomputes `move`
      // from the drop event's modifier (`dragMoves()`) rather than reading
      // the flag below. Declaring only `move` tells the user agent a copy is
      // not permitted, and a modified drag it cannot resolve can end with no
      // drop event at all — losing the operation rather than the modifier.
      dt.effectAllowed = "copyMove";
      view.dragging = { slice, move: true };
    } catch {
      // Never let a drag proceed that PM has no slice for; see this module's
      // header for what that would do to an `@section`.
      view.dragging = null;
      event.preventDefault();
      return;
    }
    // Cosmetic, and deliberately OUTSIDE the guard above: the drag is already
    // valid here, and an environment whose `setDragImage` is missing or throws
    // must still be able to move a block. The browser's default drag image —
    // a snapshot of the grip — is a worse picture, not a broken drag.
    try {
      event.dataTransfer?.setDragImage(block!, 8, 8);
    } catch {
      /* keep the default drag image */
    }
  }

  function onDragEnd(): void {
    view.dragging = null;
  }

  doc.addEventListener("mousemove", onMove, { passive: true });
  doc.documentElement?.addEventListener("mouseleave", hide);
  handle.addEventListener("mousedown", onMouseDown);
  handle.addEventListener("dragstart", onDragStart);
  handle.addEventListener("dragend", onDragEnd);

  return {
    destroy() {
      doc.removeEventListener("mousemove", onMove);
      doc.documentElement?.removeEventListener("mouseleave", hide);
      handle.remove();
      style.remove();
    },
  };
}
