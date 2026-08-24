# Inline editing plan

> **Status 2026-08-24: rewritten.** The original 1128-line plan (six PRs against
> the Paged.js preview) has **shipped in full** — click-to-source,
> `data-source-range`, the bridge protocol, the commit engine, the right-click
> menu, selection formatting, and the click-to-edit block overlay are all in the
> product. This document is no longer that plan. It specifies the one change
> left: **replacing the floating block-edit overlay with true in-flow editing**,
> now that the native viewer has made it possible.
>
> Background and the decisions that survive: [ADR 0009](./adr/0009-inline-editing-source-ranges.md)
> (revised 2026-08-24).

## 1. Why this changes now

The overlay is a floating CodeMirror panel drawn in SPA coordinates on top of a
cross-origin iframe. Everything expensive about it exists to maintain that
illusion: fragment-rect geometry (`getRectsFor`), a dimming mask and scroll lock
on the book document (`setEditMask`), iframe-origin translation, pane clamping,
`maxHeight` math, and dismissal on every `renderingComplete` / page change /
viewport change. None of that is editing. It is compensation for the editor not
being *in* the page.

It was built that way because two properties of the Paged.js preview made in-flow
editing impossible:

1. a block spanning a page was **several cloned DOM elements**, so a caret could
   not cross a page boundary; and
2. **nothing re-paginated** after a DOM mutation, so any in-place edit silently
   overflowed into invisible columns.

Both died with Paged.js. The native viewer "never chunks the DOM"
(`packages/cli/src/engine/viewer/fragment.ts`), and `Gutterpress.refresh()` →
`relayout()` rebuilds the strips from scratch and re-measures. The overlay is now
solving a problem the product no longer has.

> Note: `preview-shell.js` still carries a comment claiming `relayout()` "only
> re-`measure()`s the EXISTING strips". That was true of an earlier revision and
> is false against the current `fragment.ts`, which calls `buildStrips()`. The
> comment is corrected as part of this work — it is the single most misleading
> sentence in the preview code for anyone evaluating in-place updates.

## 2. Evidence (spike-verified 2026-08-24, Chromium 1194)

Run against a faithful model of `viewer.css` — `.gp-run` (clips, sized to the
measured run width) wrapping `.gp-strip` (`width` = one content box,
`column-width` = the same, `column-fill: auto`, `overflow: visible`):

| Claim | Result |
|---|---|
| A block spanning a page break is one element | ✅ 1 element, 2 client rects |
| `contenteditable="plaintext-only"` works on it | ✅ `isContentEditable`, still 2 rects while editable |
| Caret crosses the page break with ArrowDown | ✅ caret x 0 → 876 across a 500px column pitch |
| Typing into the fragmented block works | ✅ |
| `scrollWidth` (what `measure()` reads) tracks growth | ✅ 900px → 2400px, i.e. 2 → 5 pages |
| The silent-overflow hazard is still real | ✅ run clipped at 900px while 2400px was needed |
| A re-measure fixes it | ✅ run resized to 2500px |
| Multi-line markdown round-trips exactly | ✅ `textContent` in === `textContent` out, with `white-space: pre-wrap` |
| Enter inserts a real `\n`, not `<div>`/`<br>` | ✅ `innerHTML` stays plain text |
| Rich HTML paste is stripped to plain text | ✅ automatic under `plaintext-only` |

The last three are what remove CodeMirror from the picture: the editing surface
is `el.textContent` in, `el.textContent` out, with no sanitisation step and no
serializer.

## 3. The design

**One sentence:** the block's own element becomes a plain-text editor holding
that block's markdown source, in the flow, and the viewer re-paginates around it
as the author types.

```
right-click → "Edit this block"        (unchanged entry point)
  └─ SPA reads the source slice        (unchanged: chapterPath + buildLineStarts/charRange)
  └─ bridge: beginBlockEdit({chapter, range, text})
       └─ iframe: stash innerHTML, textContent = text,
                  contenteditable="plaintext-only", white-space: pre-wrap, focus
       └─ iframe: on input (debounced ~120ms) → Gutterpress.refresh()
  └─ Escape / click-away / Cmd+Enter
       └─ bridge: endBlockEdit({commit}) → { text }
  └─ SPA: commitEngine.commitRangePatch({...})   (UNCHANGED — every gate intact)
```

Nothing about the write path changes. `commitRangePatch` still owns the
clean-buffer gate, the disk-freshness reconcile, the edit-generation counter, the
chapter-id validation, and the `EditorBuffer` / `applyRangeEdit` split. ADR 0009
decisions 1–3 are untouched.

### 3.1 Iframe side (`preview-interface.js`)

Two new commands, replacing two old ones:

- `beginBlockEdit({chapter, range, text})` — resolve via the existing
  `blocksMatchingRange()`, stash `innerHTML` and the inline `style`, write
  `textContent`, set `contenteditable="plaintext-only"` and
  `white-space: pre-wrap`, focus, place the caret from the click point with
  `caretRangeFromPoint`. Returns `{ ok }`.
- `endBlockEdit({commit})` — read `textContent`, restore the stashed HTML,
  `refresh()`, return `{ text }`.

Plus a debounced `input` listener calling `window.Gutterpress.refresh()` (the
module already reaches `window.Gutterpress` for `pageOf`/`setSpread`), and an
Escape / Cmd+Enter keydown handler — both **must** live iframe-side, for the same
physical reason the `Shift+F10` listener does (ADR 0009 §5: keyboard events in a
cross-origin iframe never reach the SPA).

Deleted: `nativeRectsFor()`, `getRectsFor()`, `setEditMask()`, and the
`.gutterpress-edit-mask` / `gutterpress-edit-scroll-lock` stylesheet.

### 3.2 Shell side (`preview-shell.js`)

A swap while the editor is live would destroy it mid-keystroke. The shell already
defers swaps for an unrelated reason (`pendingSwap` / `armPendingSwap`, gated on
scroll idleness); add "an inline edit is open" as a second hold condition, and
release it on `endBlockEdit`. This is a few lines on machinery that exists.

### 3.3 SPA side

`BlockOverlayController` and `BlockEditOverlay.svelte` are replaced by a ~70-line
controller that holds `{chapter, range, expected, generation}`, calls the two
bridge commands, and hands the returned text to the commit engine. It has no
geometry, no rects, no mask, no CodeMirror, no focus trap, no IME guard, no
dismissal subscription — the caret lives in the page, so the page owns all of it.

`ContextMenuController`'s "Edit this block" item, its gating, and its
`{chapter, range, anchor}` handoff are unchanged.

### 3.4 Cost

| | Removed | Added |
|---|---|---|
| `BlockEditOverlay.svelte` | 222 | — |
| `block-overlay-controller.svelte.ts` | 442 | ~70 (new controller) |
| `block-overlay-controller.test.ts` | 483 | ~150 |
| `preview-interface.js` rects/mask/CSS | ~90 | ~110 |
| `preview-client.ts` methods + rect types | ~35 | ~15 |
| `+page.svelte` wiring | ~10 sites | ~4 sites |
| `preview-shell.js` edit hold | — | ~10 |
| **Net** | **≈1280** | **≈360** |

## 4. What the author gets

- The caret is in the book, in the book's own typography, at the size and
  position the text actually occupies — not in a panel floating over it.
- Pages reflow live as the block grows or shrinks, including across page
  boundaries, because Chromium's fragmenter is doing it.
- A block that spans two pages is edited as one block; today the overlay covers
  one of the fragments and masks the rest.
- Nothing is dimmed, nothing is scroll-locked, the surrounding page stays legible
  while editing — which is the point of editing in a paginated view.

## 5. Rules this design must not break

1. **A DOM mutation is always followed by `refresh()`** (ADR 0009 decision 4, as
   revised). The silent-overflow hazard is unchanged; only the correction is new.
2. **Mid-edit pagination is a projection, never authoritative.** The parity gate
   (`scripts/native-parity-gate.ts`) compares committed renders against the PDF
   and is unaffected — but nothing may come to depend on the transient state. On
   commit, the normal write → regenerate → `swap()` path produces the
   authoritative layout, exactly as today.
3. **The bridge still writes nothing.** `endBlockEdit` returns text; the SPA
   decides whether it becomes a patch. Text out of the book document is untrusted
   input to the commit engine, which already treats it that way.
4. **No serializer, ever.** The editable surface holds markdown source. The moment
   it holds a rendered projection, ADR 0009 premise 3 applies and this design is
   void.
5. **Renderer stays PWA-clean** (CLAUDE.md §8). The new controller is
   fetch/bridge-based with no `node:*` and no lib value imports.

## 6. Open questions

- **Entry gesture.** v1 keeps the context-menu item, so the change is a pure
  implementation swap with no UX churn. Once the caret is genuinely in the page,
  double-click (or single click on an already-armed block) becomes the natural
  gesture — worth a follow-up, not worth blocking on. Making the whole strip
  editable at once is explicitly *not* the answer: Enter would mint blocks with
  no source range.
- **Refresh debounce.** 120ms is a starting guess. `relayout()` costs "the same
  order as mount (tens of ms on a real book)" per `fragment.ts`; measure on the
  34pp field guide and tune. If it proves too slow to run per-input, fall back to
  refreshing on a typing pause only.
- **Scroll anchoring.** A block growing above the viewport shifts what is on
  screen. The shell already has `capture()`/`restore()` for scroll across swaps;
  check whether it needs an in-edit equivalent, or whether pinning the edited
  block's own rect is enough.
- **Visual treatment** of the editing block (outline? tint?) is a design-review
  item, same as the mask treatment it replaces.

## 7. Test plan

- **Unit (SPA):** the new controller against a fake bridge + fake commit engine —
  open, commit, cancel, stale-generation refusal, dirty-buffer refusal. The
  existing commit-engine tests are untouched and must stay green.
- **Iframe (`tests/preview-interface.test.mjs`):** `beginBlockEdit` resolves and
  makes exactly one element editable; `endBlockEdit` returns the typed text and
  restores the original HTML byte-for-byte on cancel; multi-line source
  round-trips; an unresolvable range fails cleanly.
- **Integration:** edit a block that spans a page break; confirm the page count
  updates while typing and that the committed render matches the mid-edit
  pagination.
- **Parity:** `scripts/native-parity-gate.ts` stays green with an empty allowlist.
