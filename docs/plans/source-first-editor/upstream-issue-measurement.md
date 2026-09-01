# Upstream issue draft — whole-document measurement on every keystroke

> **Status:** ready to file at <https://github.com/microsoft/vscode-packages/issues>.
> Not yet submitted. Filing this (or the PR it offers) is condition 2 of this
> patch's removal trigger — see `packages/vscode-markdown-editor/PATCHES.md`,
> "Patch 2 upstreaming / removal trigger".
>
> Everything below the rule is the issue body verbatim; the title is above it.
> It is written for upstream maintainers: no internal plan vocabulary, no run
> IDs, no references to our private docs.

**Title:** `[markdown-editor] Performance: EditorView._publishMeasurements remeasures every mounted block on every keystroke, regardless of what changed`

---

## Summary

`EditorView._renderAutorun` calls `_publishMeasurements()` on every accepted
edit, and `_publishMeasurements` unconditionally remeasures **every mounted
top-level block** — one `getBoundingClientRect()`/`getComputedStyle()` pair,
plus a full per-text-leaf walk (`Pe.measure()`, one `document.createRange()`
+ `Range.getClientRects()` call per leaf) — regardless of how much of the
document the keystroke actually changed. For a large, mostly-static document,
typing a single character costs a measurement pass proportional to the
*whole document's* rendered line count, not to the edit.

We measured this directly: a 250 KB document (roughly 800 blocks) costs
~2 ms of edit-to-paint latency per KB of document size, per ordinary
keystroke, almost entirely inside this one method. A 1 MB document costs
over a second per keystroke. We've implemented and shipped a fix that skips
the expensive per-leaf walk for a block whose view node your own renderer
already reused unchanged, and would like to offer it upstream.

## Motivation

We build a rich Markdown editor for a print/publishing product on top of
`@vscode/markdown-editor`, and authors routinely work with real book-length
manuscripts — 100 KB to several hundred KB of Markdown is an ordinary
chapter, not an edge case. At that size, the measurement cost we describe
here is the dominant contributor to typing latency by a wide margin (roughly
half of total edit-to-paint time in our own measurements), and it scales
with total document size rather than with what the author is actually
doing — a document that is otherwise completely static gets noticeably
*slower* to type in as it grows, even though nothing about a single
keystroke's own cost should depend on how much unrelated content sits above
or below it.

## Where the cost is, precisely

In the published `0.0.2-84` bundle (line numbers from the unminified
source names we could recover; happy to re-cite against the real source
tree once we have access to it for the PR):

```js
_publishMeasurements(e) {
  const t = this.coordinateSpace.capture(), s = [];
  for (const r of e.blocks) {                          // every top-level block, every render
    const c = t.toLocalRect(r.node.element.getBoundingClientRect());
    r.node.recordMeasuredHeight(c.height);
    const a = r.node.scrollElement;
    let l;
    const d = getComputedStyle(a).overflowX;
    if ((d === "auto" || d === "scroll" || d === "hidden" || d === "clip") && a.scrollWidth > a.clientWidth + 1) {
      const m = t.toLocalRect(a.getBoundingClientRect()).left + a.clientLeft;
      l = { left: m, right: m + a.clientWidth };
    }
    const h = Pe.measure([{                              // the expensive part
      absoluteStart: r.absoluteStart,
      viewNode: r.node
    }], this.coordinateSpace, t);
    s.push({ /* ... BlockMeasurement ... */ });
  }
  /* pending-paragraph handling, unrelated */
  this.measuredLayout.setMeasurements(s, o);
}
```

`Pe.measure()` (internally `mo()`) walks **every text leaf** in the block via
`forEachTextLeaf` and, for each, creates a `Range`, calls `.getClientRects()`
(one rect per wrapped visual line for a multi-line run), and for a multi-line
leaf additionally binary-searches character-split points with more
`Range`/`getBoundingClientRect()` calls. None of this depends on whether the
block's rendered DOM changed since the last render.

We isolated this two ways before concluding it was the dominant cost:

1. **Block-count invariance.** The same total document size, reshaped into 8
   giant blocks instead of ~800 small ones, cost the same (if anything
   slightly more) — ruling out "number of blocks" and confirming "total
   rendered line/leaf count" as the driver, which is exactly what
   `Pe.measure()`'s per-leaf walk is proportional to.
2. **A no-adapter floor.** Mounting `EditorModel`/`EditorView`/
   `EditorController` directly, with none of our own integration code in the
   loop at all, reproduced the same cost — confirming it lives inside this
   package, not in how we call it.

## What we checked before concluding there's no existing escape hatch

Every field of `EditorViewOptions`/`BlockViewOptions` was read; none gates,
skips, debounces, or virtualizes measurement. `document`'s own memoized
parse (`EditorModel.document`) is already correctly incremental — unchanged
source reuses the cached parse, and a real edit passes the exact edit
through to `this._parser.parse(text, previous, edit)` — so the parse side
already does the right thing; the render/measurement side simply never
consults that same "was this reused" signal.

## Our fix

`Y(n, e, t)` — the view-node factory — already implements block-level DOM
reuse: `if (t instanceof T && t.canReuse(n, e)) return t;`, where `canReuse`
is a reference check against the block's `ViewData`. Your own `ViewData`
builder already preserves that reference only when a block's entire
subtree — AST, `showMarkup`, every nested mark's own visibility — is
unchanged. So when `_publishMeasurements` sees the *same view-node object*
at a given position as the previous render, that already means (by an
invariant your own DOM-reuse correctness already depends on) that block's
rendered DOM, and therefore its internal line geometry, did not change.

We use that signal to skip the per-leaf walk, and instead translate the
block's previously computed visual-line map by its own freshly (and cheaply)
remeasured position delta — a plain `getBoundingClientRect()` call we keep
making for every block regardless (it isn't the bottleneck; see above), just
no longer followed by the expensive walk when nothing could have changed:

```js
const cache = incremental ? node.__cache : undefined;
const reusable = cache !== undefined && cache.className === node.element.className;
const visualLineMap = reusable
  ? translateVisualLineMap(cache.visualLineMap, freshRect.x - cache.rect.x, freshRect.y - cache.rect.y)
  : Pe.measure([{ absoluteStart, viewNode: node }], coordinateSpace, snapshot);
node.__cache = { rect: freshRect, visualLineMap, className: node.element.className };
```

`translateVisualLineMap` is a small, pure function built entirely from your
own existing, unmodified primitives — the rect class's own `translate(dx,
dy)` method, and the same `Pe`/line/run constructors `mo()` itself already
uses fresh on every call:

```js
function translateVisualLineMap(map, dx, dy) {
  if (dx === 0 && dy === 0) return map;
  return new Pe(map.lines.map((line) => new Line(
    line.rect.translate(dx, dy),
    line.runs.map((run) => new Run(run.sourceRange, run.rect.translate(dx, dy), run.source, run.isVisualLineAnchor)),
    line.virtualCursorLine,
  )));
}
```

Why the translation is exact, not approximate: your own
`MeasuredLayoutModel.visualLineMap` getter already documents the invariant
this relies on — "every per-block map uses the same editor-local coordinate
space, so concatenation is well-formed without translation or re-sorting."
A block whose rendered DOM is provably unchanged has unchanged *internal*
geometry (line wraps, run positions relative to its own top-left); the only
thing that can differ between renders is *where* that unchanged subtree now
sits, because something above it in document order grew or shrank. We
measure that shift directly from a real, fresh DOM read (never modeled via
margin/gap arithmetic) and apply it uniformly.

We deliberately only gate this on the per-keystroke render path. Your own
`ResizeObserver` callback and scroll listener, which also call
`_publishMeasurements`, are untouched — a container resize can change every
block's available width (and therefore its wrapping) without touching a
single view node's identity, so that path needs the full walk regardless;
we saw no reason to build the more invasive case (viewport-scoped, on-demand
measurement) once the identity-based skip already reached this result with
no observable behavior change.

## What we validated

Against the exact published `0.0.2-84` runtime in headless Chromium, driven
with real keyboard and pointer input, our full pre-existing browser test
suite — caret placement, pointer-to-offset resolution, drag selection,
selection-rect painting, IME/`EditContext` input, table editing, our own
custom-block-render integration — passes identically with and without this
patch applied. We also added a dedicated regression test that counts real
`document.createRange()` calls across ordinary appended keystrokes in a
250 KB document: unpatched, it costs on the order of 3,000+ calls per
keystroke; patched, well under 100.

Measured effect: roughly a 45-50% reduction in per-keystroke edit-to-paint
latency at 250 KB in our own harness, with no change at small document
sizes (where the per-leaf walk was already cheap in absolute terms).

## An open question we did not chase down

Fixing this surfaced a second, separately sized cost that we have **not**
root-caused or patched, and want to flag rather than claim credit for
solving: even with this fix applied, a meaningful fraction of per-keystroke
latency at large document sizes (roughly comparable in magnitude to what
this fix removed) sits *before* `_renderAutorun` runs at all — between the
raw `keydown` event and the render actually starting. We noticed that
ordinary character input is delivered through `EditContext`'s native
`textupdate` event rather than synchronously inside `keydown`, and that
`this.editContext`'s own text buffer mirrors the *entire* document
(`editContext.updateText(0, editContext.text.length, newText)` on every
render). We did not instrument inside the browser's own `EditContext`
implementation, so we can't say whether this is inherent to how `EditContext`
processes a large buffer, or something in your own `_handleTextUpdate`
path that could be tightened — but if you've seen this before, or have
guidance on `EditContext` buffer-size scaling, we'd be glad to hear it.

## Offer

We're carrying this as part of a small internal fork of the published
artifact (alongside an unrelated, separately-offered custom-block-render
seam), which we'd rather delete. Same two caveats as our other report:

1. Our patch is against the **published bundle**, because we don't have
   access to the source tree. A PR would need to be written against
   `vscode-team-tools/packages/markdown-editor` source — happy to do that
   work once we know the shape is acceptable.
2. This is a pure internal optimization with no observable behavior change
   and no new public API surface — we'd expect it to land as a normal
   performance fix, not a feature addition.

If you'd rather solve this a different way (e.g. moving the reuse check
into `Y()`/the view-node base class itself, so every consumer of block
geometry benefits without `_publishMeasurements` needing its own cache), we
would happily adapt to whatever shape you consider the right long-term
design — our fix is intentionally the smallest change that reaches the
result, not a claim that it's the only correct one.

**Environment:** `@vscode/markdown-editor@0.0.2-84` (dist-tag `next`), Chromium
141, TypeScript 5.9.
