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
 *    external mutation of its own DOM — the trap `engine/viewer/live-document.ts`'s header
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
 * upstream re-reads the modifier at the DROP anyway, so what matters here is
 * that the field is non-null and carries the right slice. From there
 * `editHandlers.dragover` and `prosemirror-dropcursor` do the rest; the DROP
 * itself is `onDrop` below, which upstream calls (with the modifier already
 * resolved) before it would run its own, and which returns "handled" so only
 * one insertion happens. See the next section for why that had to be ours.
 *
 * Leaving `view.dragging` null would be the data-corrupting failure: PM then
 * re-parses the DataTransfer's HTML, and this schema's `gp_chapter`/`gp_spread`
 * /`gp_page`/`gp_section`/`html_block` specs declare `toDOM` with no
 * `parseDOM`, so a dropped `@section` would come back as a plain div with its
 * marker line gone — and `move` is computed from `dragging` too, so the
 * original would not be removed either. Hence: on any failure the handler
 * calls `preventDefault()` and no drag starts at all.
 *
 * ## The one narrowing: the block lands among its own siblings
 *
 * `onDrop` below performs the drop itself instead of letting upstream's run,
 * and the difference is where the block ends up: upstream inserts at
 * `dropPoint()`, the DEEPEST node under the pointer that can hold the block;
 * this inserts at the nearest slot in the block's OWN parent. Two reasons:
 *
 * 1. **A drop into a different parent is a move the keyboard cannot make.**
 *    `moveBlock` only exchanges siblings, so an unrestricted drag would put a
 *    paragraph INSIDE a `@section` with no keystroke that does the same —
 *    against `docs/ux-design-contract.md`'s "drag-and-drop always has a
 *    keyboard alternative (SC 2.5.7)", and against what this PR's own user
 *    guide tells authors ("the two always pick the same one", "only the order
 *    changes"). Retargeting is what makes those sentences true.
 * 2. **It keeps the emptied-wrapper deletion unreachable by construction.**
 *    `layoutWrapper()` is `content: "block+"`, so `deleteRange` removes a
 *    wrapper whose last child leaves — taking `@section`/`@end-section` and
 *    its classes out of the .md, cascading through nested wrappers. Today the
 *    grip already cannot reach that: `isReorderable()` refuses a block that is
 *    its parent's only child, so the walk in `blockAtDom` offers the WRAPPER
 *    instead (verified headlessly on the three shapes a reviewer proposed —
 *    all three either offer no grip or move the wrapper intact). That safety
 *    is a side effect of a predicate chosen for a different reason; keeping
 *    the block in its parent states it directly, so loosening
 *    `isReorderable()` later cannot silently re-open a content-destroying path.
 *
 * **Retarget, never refuse — and this is where the first attempt was wrong.**
 * That version returned "handled, do nothing" whenever the drop point resolved
 * outside the parent, which reads as a narrow guard and is not: `posAtCoords`
 * always lands INSIDE a textblock, so for a `@section` dropped over a
 * neighbouring `@section`'s text the innermost node that can hold it is the
 * NEIGHBOUR — refused. Measured on `examples/gutterpress-user-guide/00-cover.md`
 * (`@page cover` wrapping two `@section`s, the ordinary book shape): both
 * sections offered a grip and NO pointer-reachable position moved either one,
 * while Alt+ArrowDown swapped them. An affordance that promises an edit which
 * cannot happen is the exact defect `isReorderable()` exists to prevent.
 *
 * The one thing genuinely refused is a drop into a document that changed under
 * the drag, which is a live corruption path rather than a hypothetical one:
 * upstream's `handleDrop` deletes the source with `tr.deleteSelection()`, and
 * after any wholesale state replacement (the folder watcher's external-edit
 * reload is the ordinary way to get one) the selection is no longer the dragged
 * block. Verified headlessly: `setContent` between dragstart and drop left the
 * block inserted at the destination AND still in place at the source, i.e. a
 * duplicate that autosave then wrote to disk.
 *
 * The cost of retargeting is that `prosemirror-dropcursor` draws its line at
 * `dropPoint()`'s position, so over a sibling WRAPPER's interior the line sits
 * one level deeper than where the block will actually land — a few lines off,
 * on the same side of that wrapper the pointer is on. The cursor has no hook to
 * override, and a cursor that points a little high beats a drag that silently
 * does nothing.
 */
import type { Node as PMNode, ResolvedPos, Slice } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { isReorderable } from "./rich-move-block";

/** Gap between the handle and the block it points at, in px. */
const GAP = 6;
/** The VISIBLE grip, in px. These live here rather than only in the stylesheet
 *  because `point()` positions the element from them, so the two have to
 *  agree. */
const WIDTH = 14;
const HEIGHT = 20;
/**
 * Transparent padding around the grip, so the element a pointer must hit is
 * 32×32 — `docs/ux-design-contract.md`'s pointer floor ("Interactive targets:
 * ≥44×44px on touch; ≥32×32px on pointer"). The grip itself stays 14px wide: a
 * 32px block of grey in the page margin would read as part of the page.
 *
 * The horizontal padding is all on the LEFT, and that asymmetry is the whole
 * point. Centring it put the element's right edge 3px INSIDE the block
 * (`left` backed out one PAD_X but the element had grown by two), so
 * `elementFromPoint` returned the handle for the first 3 CSS px of every line
 * and a click there selected the whole block instead of placing the caret.
 * Growing leftwards puts the extra hit area in the page margin, which is empty,
 * and leaves the element's right edge exactly where the grip's is — `GAP` px
 * clear of the text, which is what the visual was always meant to be.
 */
const PAD_LEFT = 32 - WIDTH;
const PAD_Y = (32 - HEIGHT) / 2;

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
 * outrank the UA rule and pin the handle on screen. `box-sizing` is stated for
 * the same reason — `* { box-sizing: border-box }` is one of the commonest
 * lines in a stylesheet, and under it the padding below would eat the grip
 * rather than surround it.
 */
const HANDLE_CSS = `
.gp-drag-handle {
  position: absolute;
  top: 0;
  left: 0;
  box-sizing: content-box;
  width: ${WIDTH}px;
  height: ${HEIGHT}px;
  margin: 0;
  /* Transparent hit area, painted-in grip: see PAD_LEFT/PAD_Y. */
  padding: ${PAD_Y}px 0 ${PAD_Y}px ${PAD_LEFT}px;
  border: 0;
  border-radius: 4px;
  cursor: grab;
  user-select: none;
  -webkit-user-select: none;
  /* Both content-box, so the dot grid is laid out from the 14px FACE and the
     transparent hit area neither shows nor shifts it. */
  background-clip: content-box;
  background-origin: content-box;
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

/* The grip is revealed by hovering and dragged with a pointer, so it exists
   only where hovering does — docs/ux-design-contract.md: "Hover-dependent UI
   only via @media (hover: hover)". On a touch target a tap synthesizes a
   mousemove, which would reveal a drag affordance a finger cannot use.

   KNOWN GAP, recorded so it is not invisible: where hover:none matches —
   a touch-primary tablet running the packaged app, and the PWA target the
   contract's own "touch alternatives per §2" clause names — block reordering
   has NO pointer or touch path at all. Alt+Up/Alt+Down still works, but that
   needs a hardware keyboard. The real touch spelling is long-press drag, which
   is a feature to build rather than a media query to delete: removing this rule
   would put back a grip a finger still cannot drag. */
@media (hover: none) {
  .gp-drag-handle { display: none; }
}

/* The block the grip has hold of. Both the click and the drag put a
   NodeSelection on it and prosemirror-view ships no default appearance for
   one, so without this the author cannot see what they are about to move.

   An outline, and nothing else, on purpose: it is the one visual that takes no
   space, so this cannot move a page break — the rule engine/viewer/live-document.ts keeps for its
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
   * What the current drag picked up, or null when no drag of ours is running.
   *
   * The DOCUMENT is held alongside the position because the position is only
   * meaningful in it: PM keeps the same `doc` object across selection-only
   * transactions, so identity here is an exact "has the document been replaced
   * under this drag" test, and a stale position is what makes upstream's
   * `tr.deleteSelection()` delete the wrong thing. See the module header.
   */
  let dragged: { doc: PMNode; pos: number } | null = null;

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
    //
    // The vertical padding is backed out so the GRIP lines up with the block's
    // top; horizontally the whole element — hit area included — sits `GAP` px
    // clear of the block, because the padding is all on its left (see
    // PAD_LEFT). Deliberately NOT clamped to 0: a block whose left edge is
    // under 38px from the frame's own edge (`@page cover { margin: 0 }`,
    // `.gp-bleed`) used to pull the 32px hit area on top of its first line, and
    // an overlapping dead zone over the author's text is worse than a grip that
    // runs off the side. Alt+Up/Alt+Down reorders those blocks either way.
    handle.style.top = `${rect.top + win.scrollY - PAD_Y}px`;
    handle.style.left = `${rect.left + win.scrollX - GAP - WIDTH - PAD_LEFT}px`;
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
    // this element exists to start (measured: with it, no `dragstart` fires at
    // all). The cost is that mousedown's default action then moves focus to
    // `body`, because this element is not focusable — so every editor binding,
    // Alt+Arrow included, stops reaching the view until the author clicks back
    // into the text. `onClick` below puts it back. Calling `view.focus()` HERE
    // does not work: the default action runs after the listener and undoes it
    // (measured in Chromium 153 — activeElement was BODY either way).
    const pos = current && blockPosFor(view, current);
    if (pos == null) return;
    try {
      view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)));
    } catch {
      /* the block stopped being selectable between hover and click */
    }
  }

  /**
   * A press that did NOT become a drag — put focus back in the editor.
   *
   * `click` fires only when the pointer went down and up without a drag
   * starting, which is exactly the case `onDragEnd` does not cover.
   */
  function onClick(): void {
    view.focus();
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
      dragged = { doc: view.state.doc, pos };
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

  /**
   * Re-insert the dragged block at the nearest slot in its OWN parent.
   *
   * Returning true means "handled" — upstream's `handleDrop` stops there, so
   * this owns the whole edit and there is no second insertion to reconcile.
   * `moved` is PM's own reading of the copy modifier at the drop (Ctrl, Option
   * on macOS), taken as given rather than re-derived.
   *
   * Returning FALSE for a drag that is not ours matters: a file dragged in from
   * the desktop, or text from another application, is upstream's business and
   * must keep working.
   *
   * The depth is the block's parent's, and `$to` is walked out to it with the
   * same midpoint bias `dropPoint()` uses — the pointer in the top half of a
   * sibling puts the block before it, the bottom half after it. Only a drop
   * whose ancestor chain never reaches that parent is refused, which after the
   * walk means a drop somewhere the block's family does not extend to.
   */
  function onDrop(v: EditorView, event: DragEvent, _slice: Slice, moved: boolean): boolean {
    if (!dragged) return false;
    const { doc: at, pos } = dragged;
    // The document was replaced under the drag; `pos` describes a tree that is
    // gone. See the module header — this is the duplicate-on-reload path.
    if (v.state.doc !== at) return true;
    const node = at.nodeAt(pos);
    const found = v.posAtCoords({ left: event.clientX, top: event.clientY });
    if (!node || !found) return true;
    const $from = at.resolve(pos);
    const $to = at.resolve(found.pos);
    // `$from` sits BEFORE the node, so its own depth is already the parent's.
    const depth = $from.depth;
    if ($to.depth < depth || $to.start(depth) !== $from.start()) return true;
    const landing =
      $to.depth === depth
        ? $to.pos
        : $to.pos <= ($to.start(depth + 1) + $to.end(depth + 1)) / 2
          ? $to.before(depth + 1)
          : $to.after(depth + 1);
    const to = pos + node.nodeSize;
    // Dropped on itself. Only a MOVE is a no-op — a copy dropped on its own
    // block is a duplicate the author asked for.
    if (moved && landing >= pos && landing <= to) return true;

    const tr = v.state.tr;
    if (moved) tr.delete(pos, to);
    // Mapped, not arithmetic: a move DOWN puts the landing point after the
    // deleted range, so it has shifted by the node's size. Same two steps
    // `moveBlock` performs, for the same reason (see its header).
    const insertAt = tr.mapping.map(landing);
    tr.insert(insertAt, node);
    // Keep the author with the block they moved, as upstream's drop does.
    tr.setSelection(NodeSelection.create(tr.doc, insertAt));
    v.dispatch(tr.setMeta("uiEvent", "drop"));
    v.focus();
    return true;
  }

  function onDragEnd(): void {
    view.dragging = null;
    dragged = null;
    // The press that started this drag left focus on `body` (see
    // `onMouseDown`), and a refused drop does not restore it the way upstream's
    // completed drop does.
    view.focus();
  }

  // A direct prop, not a plugin: `setContent` builds a whole new state, and a
  // plugin-carried handler would be torn down and rebuilt with it, while this
  // handle's lifetime is the VIEW's. Direct props also win over plugin props in
  // `someProp`, so nothing can register a drop handler ahead of this one.
  view.setProps({ handleDrop: onDrop });

  doc.addEventListener("mousemove", onMove, { passive: true });
  doc.documentElement?.addEventListener("mouseleave", hide);
  handle.addEventListener("mousedown", onMouseDown);
  handle.addEventListener("click", onClick);
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
