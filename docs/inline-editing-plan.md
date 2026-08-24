# Inline editing plan

> **Status 2026-08-24: SHIPPED.** The original 1128-line plan (six PRs against
> the Paged.js preview) shipped in full — click-to-source, `data-source-range`,
> the bridge protocol, the commit engine, the right-click menu, selection
> formatting, and the click-to-edit block overlay. Then the native viewer made
> the overlay unnecessary, and **in-flow editing replaced it** (bridge protocol
> v8). This document records that design as built.
>
> Entry points: the context menu's "Edit this block" **and** double-click on any
> annotated block. Both land on the same host handler.
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

> Note: `preview-shell.js` used to carry a comment claiming `relayout()` "only
> re-`measure()`s the EXISTING strips" — true of an earlier revision, false
> against the current `fragment.ts`, which calls `buildStrips()`. It was the
> single most misleading sentence in the preview code for anyone evaluating
> in-place updates, and it is corrected in place.

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

**Three things the end-to-end test found that no fake could.** All three are
consequences of the caret living in a cross-origin frame the host opens by
message, and each is now covered by a test:

1. **"Clicked away" is a pointer press, not a `blur`.** Opening from the context
   menu is a postMessage with no user activation, so the frame takes focus a
   moment later and Chromium settles `activeElement` back to `BODY` — firing a
   blur the box never earned. Measured: the editor opened and committed 7ms
   later, so both entry points looked like they did nothing. `document.hasFocus()`
   does not separate the cases either (a real click on another paragraph also
   lands on BODY with the document focused). A `mousedown` outside the box is
   unambiguous and needs no focus bookkeeping.
2. **Focus has to be walked down the frame chain, before the command.** The host
   focuses the preview iframe (`focusPreview`), `preview-shell.js` hands that to
   the active book frame as it relays `beginBlockEdit`, and the book seats the
   caret. Order matters: focusing the preview *after* the round-trip pulls focus
   back up to the shell and leaves the keyboard one frame short of the caret.
3. **`relayout()` re-parents the edit box, which drops focus and the selection.**
   So the caret is captured in TEXT space before every refresh and restored
   after — otherwise it died on the first debounced refresh after the author
   started typing, and every keystroke after that went nowhere.

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

### 3.4 Cost (measured, not estimated)

| | Added | Removed |
|---|---|---|
| `BlockEditOverlay.svelte` | — | 222 |
| `block-overlay-controller.svelte.ts` | — | 442 |
| `inline-edit-controller.svelte.ts` | 339 | — |
| `preview-interface.js` | 274 | 90 |
| `preview-client.ts` | 52 | 41 |
| `preview-shell.js` (swap hold) | 24 | — |
| `preview-bridge.js` (event forwarding) | 15 | — |
| `+page.svelte` wiring | 19 | 30 |
| `context-menu-controller.svelte.ts` | 7 | 6 |
| **Production total** | **730** | **831** |
| Tests (unit + iframe + shell + e2e) | 740 | 619 |

**Production code is ~100 lines smaller — not the ~900 first projected.** That
estimate assumed a ~70-line controller; the real one is 339, because the parts
that are genuinely SPA-side work (reading the authoritative source, capturing
the gate inputs, the `pendingRender` guard, host-initiated end) did not shrink
just because the panel went away — only the panel did.

The win is in the KIND of complexity, not the line count. What is gone:
geometry synchronisation between two documents, a second CodeMirror with its own
focus trap and IME guard, a dismissal matrix over `renderingComplete` / page /
viewport events, and a mask+scroll-lock that had to be reverted on every exit
path. What replaced it is a text box the browser positions. Judge this change on
that, not on the diff size.

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
5. **Renderer stays PWA-clean** (CLAUDE.md §8). The controller is
   fetch/bridge-based with no `node:*` and no lib value imports.
6. **No edit may open between a commit and the re-render**
   (`InlineEditController.pendingRender`). Found while building this, and not
   obvious: after a commit lands, every `data-source-range` still on screen was
   computed from PRE-commit content, so a range arriving from a double-click
   indexes the wrong lines of the new buffer. The slice captured at that range
   would then be compared against ITSELF at commit time and match trivially —
   ADR 0009 §3's failure mode reached by a different route. The generation
   counter does NOT catch it, because the capture happens after the commit that
   bumped the generation. Chaining edits is reachable in one gesture
   (double-clicking from one block to the next commits the first via blur), so
   this is a live path. The guard clears on the next `renderingComplete`, and on
   a refused commit (nothing was written, so nothing is stale).

## 6. Shipped, and still open

**Shipped:** both entry points — the context-menu item and double-click.
Double-click emits `blockEditRequested` from the book document; the host answers
with `beginBlockEdit`, because only the host can read the authoritative buffer.
Making the whole strip editable at once is explicitly *not* on the table: Enter
would mint blocks with no source range.

Still open:

- **Refresh debounce.** `EDIT_REFRESH_MS = 120` in `preview-interface.js` is a
  starting value, to be tuned by local measurement. `relayout()` costs "the same
  order as mount (tens of ms on a real book)" per `fragment.ts`, so it cannot run
  per keystroke on a long book. If 120ms proves too aggressive, refresh on a
  typing pause instead — the constant is the only thing that has to change.
- **Scroll anchoring.** A block growing above the viewport shifts what is on
  screen. The shell already has `capture()`/`restore()` for scroll across swaps;
  an in-edit equivalent may be needed, or pinning the edited block's own rect
  may be enough.
- **Visual treatment** of the editing block is a design-review item, same as the
  mask treatment it replaces. Today: a `Highlight`-coloured outline plus a soft
  ring. Both are deliberately layout-neutral — a border or padding here would
  change the block's extent and repaginate the book on merely entering edit
  mode.

## 7. Tests

- **Unit** — `tests/editor/inline-edit-controller.test.ts` (25 tests): both entry
  points, commit/cancel, the captured gate inputs, a refused commit, the
  trailing-blank boundary rule, host-initiated end, the `pendingRender` guard
  (including that a refused commit does not brick the next edit), and the
  fail-safe when a render lands mid-edit. The commit-engine tests are untouched
  and stay green.
- **Iframe** — `tests/preview-interface.test.mjs`: exactly one element becomes
  editable; `refresh()` is called on open AND close; multi-line source
  round-trips byte-for-byte; rendered HTML is restored on both paths with no
  inline-style residue; a pre-existing `white-space` is restored rather than
  clobbered; unresolved ranges refuse cleanly; `endBlockEdit` is idempotent; a
  second `beginBlockEdit` finishes its predecessor rather than dropping it;
  Escape cancels and Cmd/Ctrl+Enter commits while plain Enter inserts a newline;
  double-click requests (never starts) an edit, and does not re-request while
  one is live; the rects/mask commands are gone. Plus bridge forwarding for all
  three new events.
- **Shell** — `tests/preview-shell-regression.test.mjs`: an open edit holds a
  `content-update` swap, and closing it applies the revision that arrived
  meanwhile.
- **End-to-end** — `tests/integration/inline-editing.pw.mjs`: the menu action and
  double-click both edit in the page, under real Electron.
- **Parity** — `scripts/native-parity-gate.ts` must stay green with an empty
  allowlist.
