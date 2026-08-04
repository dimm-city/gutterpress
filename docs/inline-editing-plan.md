# Inline editing implementation plan

> **Status: reviewed, ready to schedule.** Implementation plan for the tiered
> design chosen in
> [`docs/reviews/inline-editing-analysis-2026-08-04.md`](./reviews/inline-editing-analysis-2026-08-04.md):
> a custom right-click menu over the paginated preview, click-to-edit block
> overlays that commit through the existing editor buffer, and (later)
> Obsidian-style live preview in the editor pane. **No WYSIWYG framework is
> adopted** — see the analysis doc for why Milkdown/Tiptap/etc. were rejected
> for the paginated viewer.
>
> Verified against: this branch (desktop `0.9.0-alpha.2`, preview bridge
> protocol v3), 2026-08-04. Three implementation spikes were run against the
> live codebase (findings marked **[spike-verified]**), and the document went
> through two cycles of three independent critical reviews each; the material
> corrections from all six reviews are folded in.

**TL;DR.** Six PRs, all targeting **`release/0.10.0`** (§7.8). PR 0 ships
click-to-source on plumbing that already exists. PR 1 adds a
`data-source-range` attribute to rendered blocks (shared lib). PR 2 adds two
bridge events/commands (protocol v4). PR 3 ships the commit engine **and**
the right-click context menu (image/link/block/marker actions). PR 4 adds
selected-text formatting. PR 5 ships the click-to-edit block overlay
(protocol v5). Deferred with their own issues: touch long-press, editor-pane
live preview (Tier 2), any WYSIWYG mode (Tier 3). Open items live in §7.6;
governance/tracking issues in §7.7.

**Complexity justification (CLAUDE.md Primary Goals).** This plan adds real
engineering complexity — a render-core annotation rule, a bridge protocol
bump, a commit engine, an overlay editor — and it must therefore pay for
itself in author-facing simplicity. It does: today a non-technical author who
wants to bold a phrase, fix alt text, or resize an image must locate the right
line in a markdown source pane; after this plan they right-click the thing
they can see. Every phase reuses an existing primitive (the source-line
mapping, the postMessage bridge, the editor buffer, CodeMirror) rather than
introducing a parallel one, and the plan's central refusal — no second
document model, no WYSIWYG framework — is itself the complexity ceiling. The
zero-new-npm-dependencies property is deliberate and load-bearing (CLAUDE.md
§1 "No bundlers at runtime" / §3 "Keep the binary free of deps that need
filesystem resolution at runtime"): nothing here adds anything to the
compiled binary or the desktop bundle beyond our own code.

> [!ALERT]
> **Three load-bearing safety rules run through this plan.** Each is easy to
> "simplify away" later without local context, and each protects against a
> silent wrong edit or silent layout corruption:
>
> 1. **Layout tokens get `token.meta.line`, never `token.map`** — setting
>    `map` silently breaks preview scroll-sync via a rect tie-break (§2.1).
> 2. **The commit engine's clean-buffer gate cannot be replaced by slice
>    comparison** — the slice check validates drift *since* menu-open, not
>    misalignment *at* menu-open (§4.7 gate, §4.9).
> 3. **Never patch the paginated DOM optimistically** — Paged.js page boxes
>    are live CSS multicol containers that absorb overflow into invisible
>    off-page columns; nothing visibly overlaps (§5.5).
>
> Each rule is also mandated as an inline comment at its code site and
> recorded in ADR 0009 (§8), so it survives this document going stale.

---

## 0. Scope, goals, non-goals

**Goals**

1. Right-click (or `Shift+F10`) anywhere in the paginated preview gets a
   Gutterpress context menu with actions appropriate to the target (image,
   link, selected text, block, `@marker`), every action landing in the proper
   `.md` file with the proper syntax.
2. Click-to-edit: an author can edit a block's source directly over the
   preview; the commit flows through the **same** buffer/save/recovery
   machinery as the editor pane — same save pipeline, same crash-recovery
   snapshots, same external-edit conflict handling, same undo history when the
   editor is open.
3. Foundations (source mapping, bridge commands) are shared-lib work usable by
   the CLI preview, the desktop app, and the future PWA target alike.

**Non-goals (this plan)**

- No `contenteditable` on paginated DOM, ever. **[spike-verified]** A caret
  cannot cross a Paged.js split-fragment boundary (each fragment is an
  independent DOM island), and Paged.js never re-layouts after a mutation, so
  native typing desyncs layout immediately.
- No live per-keystroke re-pagination. Commits are per-block; the existing
  settled-write → chapter-splice pipeline (median ≤ 1000 ms, enforced by
  `rerender-ci`) does the refresh.
- No WYSIWYG framework. A continuous-flow "Write" mode (Milkdown) stays
  deferred per the analysis doc §8.
- Web/PWA enablement of the *write* paths is out of scope (the editor stack is
  desktop-gated today); the read-side primitives are built browser-safe so the
  PWA can adopt them later.
- Touch long-press menu invocation is deferred (tracking issue in §7.7; the
  UX contract's "long-press on touch" requirement applies when the menu
  reaches touch layouts — on those layouts the menu is not registered in v1).

---

## 1. Design principles

1. **The markdown file is the only document model.** Every feature here is a
   *projection* over the source plus a *patch generator* into it. No second
   document model, no serializer.
2. **One write path.** All mutations flow into `EditorBuffer`
   (`packages/desktop/src/lib/editor/buffer-state.svelte.ts`) — never a
   parallel filesystem write. When a CodeMirror view is mounted for the target
   file, mutations go through `view.dispatch` so undo history is shared. The
   commit engine (§4.7) reuses the app's existing file-selection machinery
   rather than reimplementing it.
3. **Fail safe, not fail wrong.** A patch is applied only when the target
   chapter's buffer is **clean and disk-fresh** and the target slice matches
   what the author saw; on any doubt the action degrades to "open this block
   in the editor", never a guessed edit. A wrong edit in an author's book is
   the worst outcome this feature can produce.
4. **Line ranges over char offsets on the wire.** Rendered blocks are
   annotated with their source line range; conversion to character offsets
   happens in the SPA against the authoritative buffer text. This makes the
   mapping immune to line-ending normalization drift (markdown-it
   LF-normalizes before parsing **[spike-verified]**, and CodeMirror
   normalizes document line breaks, so char offsets computed at render time
   against raw disk bytes would not reliably index the buffer).
5. **Additive, feature-detected.** New bridge commands ride protocol bumps
   with the existing `getProtocolVersion()` feature-detect; new attributes sit
   alongside `data-source-line`, whose semantics and coverage **do not
   change** (see §2.1 — deliberate regression avoidance, not an accident).

---

## PR 0 — click-to-source on existing plumbing

The `elementActivated` event (click on any `[data-source-line]` block in the
preview) is already emitted, bridged, and typed end-to-end — and then
silently dropped: `PreviewEventController.handleEvent`'s switch has no case
for it **[spike-verified]**. PR 0 adds that case. It is the smallest
shippable win, validates the event path with real users before the larger
investment, and its behavior spec doubles as the menu's "Go to source"
action.

**Spec (decided, not open):**

- Add `case "elementActivated":` to `PreviewEventController.handleEvent`
  (`preview-event-controller.ts`) — this switch is PR 0's to modify; the
  later `ContextMenuController` (§4.1) subscribes via its own second
  `client.on()` listener and does **not** touch or duplicate this case.
- The case mirrors the existing `sourceLineChanged` branch logic: same
  chapter open → `revealEditorLine(line)`; different chapter and buffer clean
  → the existing `followChapterInEditor` machinery (poll/retry/echo
  suppression already built); buffer dirty → skip the cross-chapter switch
  (same guard `onSourceLineChanged` uses).
- Editor pane closed/unmounted: a click on a block is an explicit "go here"
  intent — call the existing `openEditorPane({ focus: true, ensureFile })`
  flow (`+page.svelte`), which lazy-loads the editor module, mounts the pane,
  and then reveals. No silent no-op.
- Always-on (it is navigation, not mutation) — not gated behind the §4.5
  setting.
- Scope note: `data-source-line` is level-0-only, so PR 0 jumps to a line; it
  cannot select the clicked block. That precision arrives with
  `data-source-range` (PR 1) and is not retrofitted here.

Size: **S** (the pane-open path and cross-chapter branch push it past XS).
Tests: `tests/platform/preview-event-controller.test.ts` gains the new case's
branch matrix with the existing fakes.

---

## 2. PR 1 — source-range primitive (shared lib)

Everything else depends on this. Changes live in
`packages/cli/src/lib/markdown/`, all pure/node-free (they ship through
`gutterpress/render` and must pass `scripts/check-render-pure.mjs`).

### 2.1 Thread marker line info onto `layout_*` tokens — via `token.meta`, NOT `token.map`

**[spike-verified]** Today every `layout_*` token emitted by
`markdown-it-paged.js` has `map === null` — the wrapper `<div>`s for
`@chapter`/`@spread`/`@page`/`@section` are invisible to source mapping. The
1-based marker line is *already computed and discarded*: `markerBlock` sets
`token.meta.__line` on the placeholder marker token, and that `meta` object
flows into `openChapter` / `openSpread` / `openPage` / `openSection`
(review-verified: `meta.__line` is genuinely in scope at all four sites and
at the `layout_page_break` / `layout_column_break` creation sites, including
the implicit-page synthetic-meta path; markdown-it core and the other
bundled plugins never touch `token.meta`, so there is no conflict).

**Change (inside `markdown-it-paged.js`, which owns its contract per
CLAUDE.md §6):** at each `layout_*_open` creation site and at the standalone
break-token creation sites, attach the line to the emitted token:

```js
t.meta = { line: meta.__line };   // 1-based marker line, from the parser
```

**`@continue` fix (review finding):** the `@continue` branch builds a
`contMeta` copying only `name`/`attrs` — `__line` is dropped, so a
continuation section's line would be `undefined`. The fix is one line using
the loop's existing `line` const (already in scope at the branch):
`contMeta.__line = line;`. Consumers must additionally reject non-finite
line values rather than trusting presence (a `NaN`/`undefined` range
silently resolves to whole-document offsets downstream — the exact "fail
wrong" this plan bans).

**Why NOT `t.map = [line-1, line]`** (the superficially cleaner fix): setting
`map` makes the existing `markdown-it-source-map` render patch stamp
`data-source-line` onto the wrapper divs, which changes the *candidate set* of
the shipped scroll-sync code. `sourcedBlocks()` in `pagedjs-interface.js`
selects `[data-source-line]`, and `topVisibleSourceEl()` keeps the best
candidate only on a **strictly greater** top — a wrapper div's rect top ties
exactly with its first child's top, the wrapper comes first in document
order, and a tie never replaces it. Scroll-sync anchors would resolve to the
`@chapter` marker's line instead of the paragraph actually on screen, on
every page of a multi-page chapter (the wrapper is cloned per page
**[spike-verified]**). `preview-shell.js`'s `capture()`/`restore()` scroll
anchoring has the same exposure. Threading `meta` instead gives the new
annotation rule (§2.2) what it needs while leaving `data-source-line`
coverage — and therefore every shipped sync behavior and test snapshot —
identical. **This rationale must land as an inline comment at the
`t.meta = …` assignment sites** ("do not set token.map here — see ADR 0009"),
not only in the file header.

### 2.2 New annotation rule: `data-source-range`

New file `packages/cli/src/lib/markdown/source-range.ts` (pure), registered
inside `createMarkdownRenderer()` (renderer.ts) as a core rule via
`md.core.ruler.push("source_range", …)` — placed **unconditionally after the
`if (customPlugins…) applyPlugins(…)` block** (not inside it; projects with
zero custom plugins must still get the rule) so it runs after every
plugin-added core rule (`.push` appends in registration order
**[spike-verified]**).

The rule walks `state.tokens` at **every nesting level** and sets, on each
`*_open` token — plus self-closing block tokens `fence`, `hr`, `html_block` —
that has a usable range:

```
data-source-range="<start>:<end>"    // token.map verbatim: 0-based, half-open
```

Range source, in priority order:

1. `token.map` (ordinary markdown blocks — semantics are **exactly
   `token.map`**: 0-based line index, half-open `[start, end)`).
2. `token.meta.line` from §2.1 (layout tokens) → range `[line-1, line)`;
   skipped unless `Number.isFinite`.

The attribute name spells out "source" like its siblings
(`data-source-line`, `data-chapter-src`) and avoids the established
"source map" web term. The existing `data-source-line` (1-based start line,
level-0 only) is untouched.

Why not extend `markdown-it-source-map`: **[spike-verified]** that plugin is a
`renderToken` monkeypatch which silently never fires for token types with
dedicated renderer rules (`fence`, `html_block`, `image`, …) and is hard-gated
to `level === 0`. A parse-time core rule that sets `token.attrs` sidesteps
both problems — `fence` *does* serialize `token.attrs` via `renderAttrs`
**[spike-verified]**, so fenced code becomes addressable for the first time.

**Nested annotation is on by default** (list items, nested blockquotes, table
rows get ranges): the context menu needs `<li>`-level targeting, and the
existing sync code keys off `data-source-line` only, so extra attributes
cannot affect it.

Idempotency: use `token.attrSet` (not `attrPush`) so repeated renders on a
shared `md` instance can't stack duplicates **[spike-verified]**.

### 2.3 Line→offset resolution (SPA side, at write time)

New pure helper (desktop `src/lib/editor/source-range.ts`, PWA-clean, unit-
testable under `bun test`):

```ts
/** Line-start table using markdown-it's exact line-break rule. */
export function buildLineStarts(text: string): number[] {
  const starts = [0];
  const re = /\r\n?|\n/g;              // MUST match markdown-it's NEWLINES_RE
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) starts.push(m.index + m[0].length);
  return starts;
}

/**
 * [from, to) char range in `text` for a data-source-range line range.
 * MUST clamp: `to` at or past starts.length (last block, file with no
 * trailing newline) resolves to text.length, and non-finite/negative/
 * inverted inputs throw rather than clamp (a malformed range must abort the
 * action, not "work").
 */
export function charRange(text: string, starts: number[], range: [number, number]): [number, number];
```

The SPA resolves a block's `data-source-range` against `buffer.content` at
the moment it needs offsets (menu open, overlay open, commit). Line indices
are stable across LF/CRLF/lone-CR **[spike-verified]** — only the offsets
differ, and they are computed from the same string they will splice.

### 2.4 Files touched

| File | Change |
|---|---|
| `packages/cli/src/lib/markdown/markdown-it-paged.js` | attach `token.meta.line` at layout-token creation sites (with the §2.1 do-not-use-map inline comment at each site); `contMeta.__line = line;` in the `@continue` branch; update the file's header contract docs |
| `packages/cli/src/lib/markdown/source-range.ts` | new pure annotation rule |
| `packages/cli/src/lib/markdown/renderer.ts` | register the rule unconditionally after the custom-plugin block |
| `packages/cli/src/lib/markdown/*.test.ts` | new unit tests (fixtures below); existing snapshots gain only the new attribute |
| `packages/desktop/src/lib/editor/source-range.ts` | new pure line→offset helpers + tests |

### 2.5 Acceptance

- For a corpus chapter (headings, paragraphs, nested list in blockquote,
  fence, table, footnote definition, `@section`/`@continue`/`@page-break`
  markers, attrs syntax, typographer punctuation), every annotated element's
  `charRange(source, …)` slice reproduces its exact block source, at every
  nesting level, for **LF, CRLF, and lone-CR** fixtures, **including**: a
  file whose last block has no trailing newline; the last item of a list; a
  block immediately followed by an `@marker` line.
- A **negative fixture** asserts raw `html_block` output carries **no**
  `data-source-range` (locks in the §2.6 decision as a regression test).
- **`data-source-line` regression check, precisely defined:** regex-extract
  all `data-source-line="\d+"` occurrences in document order from the
  renderer test corpus, before and after this change, and diff the two lists
  — they must be identical. (Do **not** byte-diff full output; the new
  attribute makes that fail by construction.)
- `bun run build` in `packages/cli` passes `check-render-pure.mjs`.
- `packages/desktop` `npm run rerender-ci` stays within budget.

### 2.6 Gotchas (PR 1)

- **`state.src` is NOT the author's file.** markdown-it's `normalize` core
  rule rewrites `\r\n?` → `\n` (and `\0` → U+FFFD) before any other rule runs
  **[spike-verified]**. Never compute char offsets inside the plugin; that is
  *why* the wire format is line ranges.
- **A naive `split("\n")` line table breaks on lone-`\r`** (old-Mac endings):
  markdown-it still parses such files into multiple lines, a `\n`-only scanner
  sees one line, and offsets go out of bounds **[spike-verified]**. The helper
  must use `/\r\n?|\n/g` verbatim.
- **Fence attributes land on `<code>`, not `<pre>`** — markdown-it's default
  fence renderer applies token attrs to the inner `<code>` element; the
  `<pre>` wrapper never receives them. Hit-testing a right-click on a code
  block's padding hits `<pre>`'s box, so target resolution (§3.1) must handle
  the annotated-descendant case; `blockTag` may read `"code"`. Covered by a
  dedicated test.
- **`html_block` / `html_inline` renderer rules discard `token.attrs`**
  (`return token.content`) — raw author-written HTML blocks can NOT carry
  `data-source-range` without overriding the renderer rule to wrap them in a
  synthetic div (a DOM-structure change with its own blast radius)
  **[spike-verified]**. **Decision: raw HTML blocks stay unannotated** in
  this plan; the context menu falls back to "open in editor" targeting the
  enclosing chapter. Documented, deliberate, not revisited per-PR.
- **Reference-style link/image definitions (`[id]: url`) emit zero tokens** —
  unrecoverable by token walking **[spike-verified]**. Actions on a
  reference-style link can edit the *usage* but not find the definition line;
  "Edit link…" must detect reference syntax in the block slice and degrade to
  open-in-editor.
- **Footnotes:** reference-style footnote definitions (`[^1]: …`), including
  multi-paragraph ones, retain their true source `token.map` after
  `footnote_tail` relocates them to the document end (review-verified) — so
  right-clicking a rendered footnote correctly resolves to its definition
  line. **Inline footnotes (`^[...]`) do not**: `footnote_tail` synthesizes a
  fresh unmapped paragraph for them, so their rendered body carries no
  `data-source-range` and degrades to the nearest annotated ancestor. Safe,
  documented, accepted.
- **Setext heading maps span two lines** (text + underline); the `inline`
  child maps only the text line **[spike-verified]**. Block-level patching is
  safe (we always patch whole block ranges); anyone later doing inline-level
  work must not mix the two.
- **Rule ordering vs user plugins.** Registering after `applyPlugins()`
  guarantees the rule sees final tokens even if a user plugin pushed its own
  core rule. A user plugin that mutates tokens *at render time* could still
  bypass it — acceptable; such plugins already break `data-source-line`.
- **Non-finite guards everywhere.** Both the annotation rule (skip) and
  `charRange` (throw) must reject non-finite values independently — the
  `@continue` bug class must be caught even if reintroduced later.

---

## 3. PR 2 — bridge protocol v4

All inside the two embedded preview scripts (single source serving CLI and
desktop alike **[spike-verified]**: they are `with { type: "file" }` embedded
assets served under `/preview/scripts/`) plus the SPA client typings.
**Scope discipline:** PR 2 ships only what the context menu (PR 3) consumes.
The overlay's commands (`getRectsFor`, `setEditMask`) ship with the overlay
in PR 5 as protocol v5.

### 3.1 `pagedjs-interface.js` (book iframe)

New `previewAPI` member (object-parameter style, matching
`queryDom(spec)`/`highlight(spec)`):

- `getContextTargetAt({ x, y })` — pure read, also used internally by the
  event listeners below. Resolves the annotated element at the point
  (deepest `[data-source-range]`, accepting the fence `<code>`-descendant
  case, §2.6) and returns:

  ```js
  {
    kind: "selection" | "image" | "link" | "marker" | "block" | "none",
    chapter,            // data-chapter-src of the enclosing wrapper
    range,              // data-source-range [start, end) of the innermost annotated block
    blockTag,           // tag name of that block
    split,              // data-split-from/-to present on the fragment
    ref,                // data-ref (Paged.js identity, stable across fragments)
    rect,               // fragment getBoundingClientRect() as a plain object (post-zoom)
    image: { src, alt } | null,      // when kind === "image"
    link: { href, text } | null,     // when kind === "link"
    selection: {                     // when a non-collapsed selection exists
      text,                          //   selection.toString()
      withinSingleBlock,             //   both endpoints in one annotated block
      range,                         //   that block's line range (when single)
      chapter,
    } | null,
  }
  ```

  **`kind` precedence (decided):** `selection` (a non-collapsed selection
  exists) → `image` (point element is/inside `<img>`) → `link` (inside
  `<a>`) → `marker` (innermost annotated element is a layout wrapper/break)
  → `block` (any other annotated element) → `none` (no
  `[data-source-range]`/`[data-chapter-src]` ancestor — margin boxes,
  running headers, page numbers). The `selection`/`image`/`link` fields are
  populated whenever applicable regardless of the winning `kind`, so the
  menu can offer secondary items.

- `getProtocolVersion()` → **4**.

Two new event sources, both dispatching the same `contextMenuRequested`
window event carrying the `getContextTargetAt` payload plus viewport
`x`/`y` and `via: "mouse" | "keyboard"`:

- A capture-phase `contextmenu` listener. **`preventDefault()` is called
  ONLY when `kind !== "none"`** — right-clicks on page furniture (margin
  boxes, running headers) keep native behavior (text there is selectable and
  copyable; killing native copy with no replacement menu would be a strict
  regression), and no event is dispatched for them.
- A `keydown` listener for `Shift+F10` and the dedicated `ContextMenu` key.
  **This must live inside the book iframe:** keyboard events targeted at a
  focused element in a cross-origin iframe never reach the parent — an
  SPA-side keydown listener cannot implement this (review finding; the
  earlier draft's SPA-side phrasing was wrong). Anchor resolution for the
  keyboard path: the current selection's focus position if non-collapsed,
  else the block at the viewport top (`topVisibleSourceEl()` already
  exists); the payload is built with the same `getContextTargetAt` logic at
  that anchor.

Note: the right mouse button fires `contextmenu` only — never `click` — so
these listeners cannot double-fire with the existing `elementActivated`
click listener (review-verified).

### 3.2 `pagedjs-bridge.js` (book iframe)

Command dispatch is generic by name — **no change needed for commands**
**[spike-verified]**. One line to forward the new event:

```js
window.addEventListener('contextMenuRequested', function (e) {
  post({ type: 'gutterpress:event', name: 'contextMenuRequested', detail: e.detail });
});
```

### 3.3 `preview-shell.js` (shell iframe)

No change. The shell relays messages from the **active** frame transparently;
from the **retiring** frame it forwards only `gutterpress:reply` messages and
the `sourceLineChanged` event — `contextMenuRequested` from a dying frame is
correctly dropped by the existing filter.

### 3.4 SPA client (`preview-client.ts`)

- Extend the `PreviewEvent` name union with `"contextMenuRequested"` and type
  its detail.
- Typed wrapper for `getContextTargetAt` mirroring `getOutline`/`scrollTo`.

### 3.5 Gotchas (PR 2)

- **Split fragments duplicate every data attribute** — `querySelectorAll` by
  `data-source-range` value returns one element *per fragment*, and the
  chapter wrapper itself is cloned once per page (N wrappers for N pages)
  **[spike-verified]**. All commands must group by `data-ref` (the one
  identity Paged.js maintains across fragments) and must never assume
  uniqueness of any other attribute. Never key on `id`: Paged.js strips it
  from all fragments but the first (mirrored to `data-id`).
- **Rects are post-zoom, post-scroll snapshots** — accurate when captured,
  stale after any zoom/view-mode/page change **[spike-verified]**. The SPA
  must re-query, never cache across `pageChanged` / `renderingComplete` /
  zoom operations.
- **Never use `Range.toString()` across fragments** — a cross-page range's
  raw text is polluted with inter-page structural whitespace, and a range
  spanning non-adjacent pages includes every intervening page's content
  **[spike-verified]**. Use `selection.toString()` for display only; the
  authoritative text is always the buffer slice. Cross-block selections get
  `withinSingleBlock: false` and formatting actions are disabled for them
  (v1).
- **Electron's native `context-menu` handler**
  (`packages/desktop/electron/main.ts:731`) shows a copy/paste menu when
  `params.selectionText` is non-empty, and is bound at `webContents` scope
  (fires for all frames). In-page `preventDefault()` stops Chromium from
  requesting a context menu, which should prevent the Electron event from
  firing; the DOM half is **[spike-verified]** but the Electron-process half
  was not testable headless. **This is a go/no-go gate item at the top of
  PR 3** — verify under `electron:dev` before building the menu UI. Fallback
  if suppression fails: gate the `main.ts` handler on the event's frame
  (skip frames served from the preview server's origin).
- **URL-preview / locked mode:** `PreviewClient.lockDown()` disables the
  bridge entirely for third-party URLs. The context-menu controller must
  treat "no client / locked" as menu-disabled — it gets this for free by only
  listening through `PreviewClient`, and must not add any direct
  `window.addEventListener("message")` shortcuts.
- **The book document runs author content** (`html: true`, sandbox
  `allow-scripts`). Everything arriving in `contextMenuRequested` detail is
  **untrusted input**: validate shape, clamp coordinates to the frame rect,
  and rely on the commit engine's gates (§4.7) so a malicious/broken document
  can at worst pop a menu with wrong labels, never cause an unintended file
  edit.
- **Keep the payload JSON-cloneable** — the detail crosses two `postMessage`
  boundaries; no DOM nodes, no functions, no `DOMRect` instances (spread
  rects into plain objects).

---

## 4. PRs 3–4 — commit engine + context menu (Tier 0)

**Sequencing correction from review:** the commit engine ships **in PR 3
with the menu**, not later. Nearly every menu write action (image attrs,
link edits, page-break insertion, marker edits) bottoms out in
`commitRangePatch`, and no existing write path works without a mounted
editor (`toolbar-actions.ts` functions all require a live `EditorView`
**[spike-verified]**, and the editor being unmounted is the common case).
The overlay-specific machinery (rects, masking, protocol v5) stays in PR 5.

### 4.1 Components and ownership

- **`ContextMenuController`**
  (`src/lib/routes/context-menu-controller.svelte.ts` — the `.svelte.ts`
  suffix is deliberate: menu open/position/target are `$state` consumed by
  the component, matching `page-nav-controller.svelte.ts` /
  `zoom-view-controller.svelte.ts`; the plain-`.ts` controllers cited for
  the *injected-deps* pattern, `preview-event-controller.ts` /
  `editor-preview-sync-controller.ts`, carry no runes) — single owner of
  menu state. Deps injected (clock, client, editor/buffer accessors, commit
  engine); zero DOM/`node:*` imports.
- **`ContextMenu.svelte`** (`src/lib/components/`) — presentational; renders
  absolutely positioned over the preview pane; ARIA `role="menu"`, arrow-key
  navigation, `Escape` closes, focus returns to the previously focused
  element. Reuses the app token system (no hardcoded colors).
- **`commit-engine.ts`** (`src/lib/editor/`) — §4.7.
- **Wiring in `+page.svelte`:** the controller subscribes via a second
  `client.on()` listener. The `PreviewEventController.handleEvent` switch is
  not modified by this phase — PR 0 already added its `elementActivated`
  case there, independently; this phase neither touches nor duplicates it.

### 4.2 Opening, positioning, dismissal

**Open** on `contextMenuRequested` — mouse and keyboard variants both arrive
through the bridge (§3.1; the keyboard listener lives inside the book iframe
because iframe-focused keystrokes never reach the SPA).

**Position:** menu anchor = event `x`/`y` + the PreviewFrame `<iframe>`'s own
`getBoundingClientRect()` in the SPA. No other terms: the shell fills its
iframe (`position:absolute; inset:0`), the book iframe fills the shell, the
book's own scroll/zoom are already baked into its viewport coordinates
**[spike-verified]**. `PreviewFrame.svelte` gains an exported accessor for
its iframe element (replacing the `document.querySelector("iframe")` pattern
currently used by `+page.svelte`'s `measureContainerWidth` closure). Clamp
into the workspace rect; flip near edges.

**Dismissal — enumerated, all handled by the controller:** `Escape`;
click/mousedown outside the menu; a **second right-click** (closes the first,
opens at the new target); any `renderingComplete` (content changed under the
menu); `pageChanged` / zoom / view-mode change (anchor invalidated); window
blur; opening any dialog. The "opening click must not immediately dismiss via
bubbling" race reuses the `justOpened`-flag pattern already proven in
`EditorToolbar.svelte`'s outside-click popover handling.

### 4.3 Menu model

Menu items are computed from `kind` + capability checks, each item carrying an
`enabled` flag and a disabled-reason tooltip:

| Target | Items (v1) |
|---|---|
| image | Edit alt text…, Set width…, Set position (left/right/center), Replace image…, Reveal in Media panel, Edit block in editor |
| link | Edit link…, Copy link target, Edit block in editor |
| selection (single block) | Bold, Italic, Strikethrough, Inline code, Make link… *(all PR 4)*, Edit block in editor |
| selection (cross-block) | Copy, Edit in editor (jump to start) |
| block | Edit this block *(disabled until PR 5 — needs the overlay, not the engine)*, Insert page break before/after, Go to source |
| marker (`@page`/`@section`/… wrapper or break) | Edit marker…, Go to source |
| none | *(no menu — native behavior preserved, §3.1)* |

**Destructive actions are excluded from v1.** "Remove marker" was cut: with
no editor mounted, `buffer.edit()` commits have **no undo** (§4.9), and a
destructive single-click affordance with no undo fails the safety bar. It
returns when a buffer-level undo story exists (or as an editor-mounted-only
item).

Every item ultimately produces a **range patch**
`{chapter, range, expected, replacement}` or an **editor jump**; both are
executed by the commit engine (§4.7) — the menu itself never touches files.

### 4.4 Resolving action parameters

- **Image:** find the markdown image token inside the block slice by matching
  the rendered `src`/`alt` attributes (`registerImageRule` records refs but
  does not rewrite `src` **[spike-verified]**, so attribute text matches
  author text). Width / position edits rewrite the `{…}` attrs suffix. The
  attrs-string builder currently lives **inlined** in `applyImage`
  (`toolbar-actions.ts`) — it must be **extracted into a shared pure helper**
  first and used by both call sites; `applyImage` itself inserts a *new*
  image at the cursor and is not directly reusable for editing an existing
  token. "Replace image…" reuses the existing image-picker dialog flow that
  backs the toolbar's image action (`insertImageIntoChapter` in
  `+page.svelte`), swapping only the final step (patch the existing token's
  `src` instead of inserting a new snippet). If the block slice contains a
  raw HTML `<img>` instead, offer only "Edit block in editor".
- **Link:** same approach on `[text](href)`. Two degrade cases, both
  explicit: reference-style links (`[text][id]`) — definition line is
  unrecoverable (§2.6); and **linkified bare URLs** (`linkify: true` renders
  plain URLs as anchors with no bracket syntax in the source at all) — every
  link action except "Copy link target" (which reads only the rendered
  `href`) degrades to "Edit block in editor" when the block slice contains no
  `[…](…)` for the href.
- **Marker ("Edit marker…"):** the marker's range covers exactly its own
  line (§2.2); the action opens a small prompt pre-filled with the raw
  marker line (the buffer slice) and commits the edited line through the
  engine — no marker-specific parser in the SPA.

### 4.5 Settings

New `AppSettings` field (`preview.contextMenu: boolean`, default `true` —
the existing `preview` settings group already holds `defaultZoom` /
`viewMode` / `paneMode` / `splitRatio`, review-verified; the menu is an
explicit-invocation affordance, not seamless WYSIWYG, so the UX contract's
opt-in rule for the latter does not apply) added to the `$lib/platform` DTO +
`DEFAULT_SETTINGS`; read reactively via `useSettings().current`; imperative
teardown on toggle goes through the existing `onSettingsChange()` +
`settingsChangeGuard()` channel. `$effect` is banned by eslint in this
package — the controller uses the injected-callback pattern instead
**[spike-verified rule text]**.

### 4.6 Selection formatting (PR 4)

The selection items (Bold/Italic/Strikethrough/Inline code/Make link…) need
rendered-text → source mapping. Ship them one PR after the menu so PR 3
stays reviewable; they are commit-engine consumers like everything else.

**Matching algorithm (specified — review found the earlier draft
under-specified and missing the formatted-span case entirely):**

```ts
/** Collapse whitespace + reverse typographer + strip inline delimiters,
 *  with an index map from normalized positions back to raw offsets. */
export function normalizeForSearch(raw: string, opts: { stripDelimiters: boolean }):
  { normalized: string; indexMap: number[] };

/** Case-sensitive search of needle in haystack (both normalized).
 *  Returns the raw [from, to) range iff EXACTLY ONE match exists;
 *  overlapping or substring/superstring duplicates count as ambiguous. */
export function findUniqueRange(...): [number, number] | null;
```

- **Whitespace:** collapse `[ \t\r\n]+` runs to a single space on both sides
  (authors hard-wrap prose, so a selection spanning a source line break
  renders with a space where the source has `\n` — a literal search fails on
  the *common* case, not an edge case).
- **Typographer reverse map** — the **full** `replacements.mjs` +
  `smartquotes.mjs` rule set: `©`→`(c)`, `™`→`(tm)`, `®`→`(r)`, `±`→`+-`,
  `“”`→`"`, `‘’`→`'`, `–`→`--`, `—`→`---`; collapsed punctuation runs
  (`…`, `!!!`, `???`, `,`) are one-to-many — any occurrence in the needle
  marks the search ambiguous, item disabled. (No NBSP rule exists in this
  configuration — an earlier draft listed one in error.) Unit fixtures cover
  each.
- **Formatted spans (review blocker in the earlier draft):**
  `selection.toString()` contains no `**`/`_`/`` ` ``/link syntax, so a
  selection spanning an already-formatted span can never literal-match the
  source. Fix: the **source side** is normalized with
  `stripDelimiters: true`, removing emphasis/strong/strikethrough delimiter
  runs (`**`, `*`, `_`, `__`, `~~`) via the index map so "a **bold** word"
  matches a selection reading "a bold word". Guardrails, all fail-safe:
  - If the matched raw region contains a backtick or link syntax
    (`[`/`](…)`), the item is disabled (code spans render escaped text and
    link text/URL duality is ambiguous — do not fuzzy-match those).
  - If the matched raw region already contains the **same** delimiter being
    applied (bolding a region that contains `**`), disable — nesting the
    same emphasis is invalid markdown. A **different** delimiter is fine:
    bolding `a *b* c` yields `**a *b* c**`, valid.
  - Zero or multiple matches → disabled with tooltip "Couldn't locate this
    text uniquely in the source — open the editor".
- **Selections containing footnote reference markers** (rendered `<sup>`
  labels have no literal source correspondence to `[^id]`) will fail the
  match. Accepted degrade — do NOT "fix" with fuzzy matching.
- Apply = wrap the matched raw region via the commit engine (the patch's
  `expected` is the block slice, `replacement` the block slice with the
  wrapped region).

### 4.7 The commit engine (`src/lib/editor/commit-engine.ts`, ships in PR 3)

Pure logic + injected seams (`selectEditorFile`, buffer, editor accessors,
clock), unit-tested with fakes. Implements `commitRangePatch({ chapter,
range, expected, replacement })`:

```
0. GATE — refuse unless ALL hold (else degrade to
   "Open in editor at line range[0]+1"):
   a. target chapter resolves inside the project dir via the shared
      path-join helper (§4.8) — never match by basename
   b. no render in flight; the menu/overlay was opened after the last
      renderingComplete AND the edit-generation counter (§4.9) captured at
      open time is unchanged
   c. FRESHNESS: await buffer.reconcileExternalChange() for the target file
      first (live stat+read — the in-memory diskContent may be stale if the
      watcher event hasn't fired yet), then require: phase !== "error",
      externalChange == null, and buffer.content === buffer.diskContent
      (CLEAN). This ordering matters: reconcile BEFORE composing the patch,
      so an external edit degrades the action instead of being fought
      through the conflict banner after a stale-base buffer mutation.
1. ENSURE the buffer + editor state hold `chapter`, via the app's EXISTING
   selection machinery — not a reimplementation:
   - absPath = chapterPath(currentDir, chapter)        // shared helper §4.8
   - if buffer.filePath === absPath → proceed
   - else:
     - if the buffer is dirty for ANOTHER file: await buffer.flush()
       DIRECTLY first — its thrown error carries the real reason, which
       +page.svelte's flushEditorBuffer wrapper swallows to a boolean
       (review-verified). On throw, abort with a distinct message naming
       the outgoing file ("Couldn't save pending changes to <A> — resolve
       that first"), not the generic block-changed toast.
     - await selectEditorFile(absPath)   // async, resolves after
       // buffer.load() AND editorRef.switchFile() complete
       // (review-verified) — it owns the load-epoch/in-flight guards and
       // the load()+switchFile() pairing. Calling buffer.load() directly
       // is FORBIDDEN: every existing call site pairs load() with
       // switchFile(); skipping the pairing dispatches offsets computed
       // for chapter B into a view still showing chapter A.
     - selectEditorFile can resolve true with phase === "error" (load()
       records the path even when the read fails, review-verified) —
       re-check gate (c) after the switch; a failed load aborts with the
       load error, not a generic mismatch message.
2. RESOLVE offsets: starts = buildLineStarts(buffer.content);
   [from, to) = charRange(buffer.content, starts, range)   // throws on bad range
3. VALIDATE: buffer.content.slice(from, to) === expected
   // `expected` was captured at menu/overlay open FROM BUFFER CONTENT,
   // with gates (b)/(c) holding at open time too — so expected reflects
   // the same content the preview DOM was rendered from. The gates are
   // what make this check meaningful; see §4.9.
4. APPLY:
   - if the mounted editor's applied file is absPath — ask the EDITOR via
     the new MarkdownEditor.getAppliedPath() export; never infer from
     buffer.filePath alone:
       editorRef.applyRangeEdit(from, to, replacement)
       // view transaction → onChange → buffer.edit → shared undo history
   - else:
       buffer.edit(content.slice(0, from) + replacement + content.slice(to))
   - increment the edit-generation counter (§4.9)
5. FLUSH: await buffer.flush()
   // Discrete committed actions must not sit behind the autosave debounce —
   // which is settings.editor.autoSaveDelay, DEFAULT 2500 ms (the 500 ms in
   // EditorBuffer's class fallback is never used by the desktop app,
   // review-verified). An immediate flush gives the ~1 s preview refresh
   // the UX story promises. flush() can throw (external change detected by
   // performSave's live disk compare): surface the buffer's conflict UI —
   // the patch stays in the buffer as a dirty edit, which is the normal
   // conflict flow, and gate (c)'s pre-reconcile makes this a rare
   // double-external-write race rather than a routine path.
6. The existing pipeline takes over: Platform.writeFile → /api/fs/write-file
   → notifyPreviewSettledWrite → rebuild → chapter splice. (No new plumbing —
   [spike-verified] this is the live path today.)
```

**The clean-buffer gate carries a mandatory inline comment** stating its
failure mode (§4.9) and pointing at ADR 0009.

New `MarkdownEditor.svelte` exports (additive; the dispatch pattern is
already how `toolbar-actions.ts` works **[spike-verified]**; `appliedPath`
is real, private, and updated synchronously inside `switchFile`,
review-verified):

```ts
export function applyRangeEdit(from: number, to: number, insert: string): void {
  if (!view) return;
  view.dispatch({ changes: { from, to, insert } });
}
export function getAppliedPath(): string | null { return appliedPath; }
```

`+page.svelte`'s hand-written `editorRef` structural type must gain both
members (it is not derived from the component's exports).

### 4.8 Shared path helper

`data-chapter-src` values are canonical forward-slash project-relative ids
(`canonicalChapterId`); `buffer.filePath` is an absolute OS-native path. The
codebase already solved this join once — the separator-aware construction in
`EditorPreviewSyncController.followChapterInEditor`
(`dir + sep + chapter.replaceAll("/", sep)`) — and that logic is
**extracted to a shared helper** (`chapterPath(dir, chapter)`) used by both
the sync controller and the commit engine, compared with `===`. A naive
`endsWith` comparison is wrong on Windows (separators never match) and
ambiguous on same-named files. Related: `+page.svelte`'s `editorChapter`
falls back to a bare basename for files outside the project dir — the engine
treats "buffer file outside the project dir" as not-the-target (degrade),
never matches by basename.

### 4.9 Gotchas (PRs 3–4)

- **The clean-buffer gate is load-bearing — do not weaken it.** The failure
  it prevents: preview DOM is rendered from *saved* content; if the buffer is
  dirty (author typed in the editor pane), DOM line ranges index the OLD
  content while offsets resolve against the NEW — `expected` gets captured
  from the misaligned slice, the commit-time equality check passes trivially,
  and the patch lands on the wrong text. With repeated identical blocks
  (boilerplate captions, disclaimers) even a human eyeball check passes. No
  slice comparison can detect this; only the gate can. Dirty chapter → every
  DOM-anchored action degrades to "open in editor".
- **The edit-generation counter closes the clean-but-stale window:** commit
  #1 lands, flush completes (buffer clean again) *before* the splice
  refreshes the DOM; a second action whose `range`/`expected` were captured
  from the pre-commit DOM would pass the clean gate with stale coordinates.
  A monotonic counter (incremented on every engine apply and every
  `renderingComplete`), captured at open and re-checked at apply, closes
  this cheaply — paralleling the existing `editorFileSelectionEpoch`
  pattern.
- **Freshness is checked live, not from memory.** `diskContent` in the
  buffer can lag a just-written external change until the watcher fires;
  `performSave`'s own live disk compare would catch the eventual write, but
  only *after* `buffer.edit()` mutated the buffer — leaving a confusing
  conflict banner whose "Keep mine" resolves to a stale-base patch. Gate
  (c)'s `reconcileExternalChange()`-first ordering prevents the mutation
  from ever happening on a stale base.
- **The editor is `{#if}`-UNMOUNTED, not hidden, whenever the pane is
  closed** (`editorPaneOpen` derived state), and `MarkdownEditor` may never
  have been lazy-imported at all in a preview-only session
  **[spike-verified]**. "No live CodeMirror view" is the *common* case. Menu
  actions must not assume `editorRef`; the commit engine owns both paths.
- **Stale targets after a splice:** between menu open and action click, a
  save can re-render and splice the chapter. The menu closes on
  `renderingComplete` (§4.2), and the generation counter + slice check guard
  the commit — all three, not any one.
- **Right-click during an in-flight render** (`rendering()` true): ignore
  `contextMenuRequested` while a render is in flight (same guard the sync
  controller uses).
- **Undo asymmetry:** with the editor mounted, a commit is one undoable
  CodeMirror transaction. Without it, `buffer.edit()` has no undo (no view).
  This is why destructive menu items are cut from v1 (§4.3); for
  content-editing commits the prior text is recoverable (visible in the
  action's own prompt or the overlay). Documented in the user guide.
- **Touch:** long-press synthesis is deferred with a tracking issue (§7.7).

---

## 5. PR 5 — Tier 1: click-to-edit block overlay

### 5.1 UX

- Entry: **"Edit this block" from the context menu only** (v1 decision —
  double-click entry was considered and rejected for v1: it conflicts with
  text-selection habits and adds a second activation path before the first
  has user feedback; revisit with usage data).
- Components: **`BlockEditOverlay.svelte`** (`src/lib/components/`) owned by
  **`BlockOverlayController`** (`src/lib/routes/block-overlay-controller.svelte.ts`
  — runes for open/position state, same convention rationale as §4.1).
- The overlay opens positioned over the block's **first fragment rect**
  (from `getRectsFor`), sized to it (min-height clamp; height capped to the
  visible pane with internal scroll — a split block can span 9+ pages
  **[spike-verified]**). It is `position:absolute` within `.preview-pane`
  and **clamped/flipped at pane edges like the menu** — `.preview-pane` has
  `overflow: auto`, so an unclamped overlay could engage the pane's own
  scrollbar. All fragments of the block get `setEditMask` so the stale
  rendered text doesn't show behind/beside the overlay.
- **The book document's scroll is locked while an overlay is open** (part of
  `setEditMask`; restored on close). Rationale: the overlay is positioned in
  SPA coordinates from a rect snapshot, the book scrolls independently inside
  its iframe, and the only scroll signal crossing the bridge is a
  150 ms-debounced line event — an unlocked scroll silently drifts the
  overlay over unrelated content. Scroll-lock is the simple, complete fix;
  live reposition-on-scroll was rejected as machinery v1 doesn't need.
- The overlay contains the block's **source markdown** (buffer slice), not
  its rendered text.
- Commit on `Ctrl/Cmd+Enter` or blur; cancel on `Escape`. Commit dispatches
  the patch through the commit engine (§4.7), closes the overlay, unmasks,
  unlocks scroll, and lets the settled-write → chapter-splice pipeline
  refresh the pages; the overlay does not wait for it.
- **Dismissal:** reuses §4.2's list with overlay-appropriate outcomes —
  `Escape` cancels; blur commits; `renderingComplete` re-anchors via
  `getRectsFor` (by `{chapter, range}` — fresh DOM means fresh `data-ref`s)
  or closes with a toast ("This section changed — reopen to edit");
  `pageChanged`/zoom/view-mode change re-anchors; window blur commits;
  opening a dialog commits. The controller's `onDestroy` **always** issues
  `setEditMask({masked:false})` as defense-in-depth — the "iframe reload
  clears masks anyway" argument is true for splice/swap but is not relied on
  for SPA-side teardown paths (project switch, error unmount).

### 5.2 Editor widget

A minimal **CodeMirror 6 instance** (already a dependency; markdown language
+ the existing theme tokens, no gutters, no lint). This does not violate
`MarkdownEditor.svelte`'s "ONE EditorView" doctrine — that rule (UX review
M8) forbids *recreating the main editor's view on file switch*; it is not an
app-wide singleton rule. The overlay's instance is an **input widget only**:
its content is discarded on cancel, and on commit the mutation flows through
the commit engine exactly like a menu action — the widget never writes
anything itself. (A plain `<textarea>` was considered and rejected: CM gives
markdown highlighting, consistent keymaps, and IME handling for free, at
zero dependency cost.)

### 5.3 Bridge additions (protocol v5)

- `getRectsFor({ ref } | { chapter, range })` — all fragment rects for one
  logical block (fragments share one `data-ref` **[spike-verified]**), each
  `{ top, left, width, height, page }`.
- `setEditMask({ ref, masked })` — toggles a masking class on every fragment
  of the block AND applies/removes the scroll lock (`overflow: hidden` on
  the book document element).
- `getProtocolVersion()` → **5**.

### 5.4 Files touched (PR 5)

| File | Change |
|---|---|
| `packages/cli/src/assets/preview/scripts/pagedjs-interface.js` | `getRectsFor`, `setEditMask`, protocol → 5 |
| `packages/desktop/src/lib/preview-client.ts` | typed wrappers for both v5 commands |
| `packages/desktop/src/lib/components/BlockEditOverlay.svelte` | new |
| `packages/desktop/src/lib/routes/block-overlay-controller.svelte.ts` | new |
| `packages/desktop/src/routes/+page.svelte` | wiring; "Edit this block" enabled |
| `packages/desktop/tests/` | script + controller tests (§7.4) |

### 5.5 Boundary rules

A block's `[start, end)` range includes its trailing newline(s) up to the
next block's first line. Patches must preserve both boundaries:

- **Trailing:** the overlay strips the trailing blank-line run from the
  editable text on open and re-appends the exact original run on commit, so
  authors can't merge two blocks by deleting the terminal newline.
- **Leading:** "insert before" actions (e.g. page break before) insert at
  `from` with their own trailing newline, never modifying the target block's
  first line; the patch text must end with `\n` so the block's start line is
  preserved verbatim.
- Fence blocks: the closing fence line is inside the range; the overlay does
  not strip it (only *blank* trailing lines are stripped).

> [!ALERT]
> **Do NOT patch the paginated DOM optimistically — now or later.** The
> natural idea — splice edited HTML into the live page for instant feedback
> — fails *silently*: `.pagedjs_page_content` is a live CSS multicol
> container (`column-fill: auto` + fixed column width, baked into paged.js),
> so overflow doesn't visibly overlap; it spills into **invisible columns
> thousands of pixels to the side** (`getClientRects().length > 1`)
> **[spike-verified]**. v1 renders no optimistic patch; the overlay module
> carries a code comment explaining why (pointing at ADR 0009) so a future
> "instant feedback" attempt inherits the warning. If one is ever built, the
> guard is a `getClientRects().length` / measured-height check — never
> visual-overlap detection.

### 5.6 Gotchas (PR 5)

- **Paged.js never corrects a mutation** — no observer, no re-layout after
  initial pagination **[spike-verified]**. Overlay-touched DOM (mask
  classes, scroll lock) must be purely cosmetic and reversible.
- **IME / composition:** commit-on-blur must not fire mid-composition
  (`compositionend` guard in the overlay).
- **Focus trap:** the overlay traps Tab within itself and restores focus on
  close — same discipline as the existing dialogs (`dialog-shell.css`
  consumers).
- All of §4.9's engine gotchas apply to overlay commits identically.

---

## 6. Phase 4 — Tier 2: editor-pane live preview (deferred; separately planned)

Obsidian-style live preview in the **editor pane** — CodeMirror 6
decorations over the Lezer markdown tree; the document stays byte-exact
markdown, so round-trip risk is zero by construction. Per the UX contract it
is **opt-in, never the default**. It is deliberately *not* specified here:
it gets its own tracking issue and its own plan after Tiers 0–1 ship (the
contract requires PROPOSED features to be issue-linked before
implementation). Nothing in PRs 0–5 blocks or prejudges it.

---

## 7. Cross-cutting

### 7.1 Security posture

- The bridge stays **read + cosmetic**: commands expose geometry and target
  metadata; masking/scroll-lock are reversible presentation. All file
  mutation happens SPA-side through the commit engine's gates. Payloads from
  the book frame are treated as untrusted (validated shape, clamped
  coordinates) because the book runs author-supplied content with
  `allow-scripts`.
- `PreviewClient`'s origin pinning and `lockDown()` are unchanged and remain
  the outer gate.

### 7.2 Web/PWA

PRs 1–2 are browser-safe by construction (pure lib rule; bridge scripts are
plain DOM). PRs 0 and 3–5 land desktop-gated (`isDesktop()`), because the
write stack (buffer → `Platform.writeFile` → settled-write hook) is
Electron-backed today. The controller seams take the platform through
injection, so a future FSA-backed web write path slots in per
`docs/pwa-webadapter-plan.md` without redesign.

### 7.3 Performance

- Annotation: O(tokens) attribute writes; verify `rerender-ci` (≤ 1000 ms
  strict, gated on the median) and `perf-gate` before/after PR 1.
- New bridge calls are on-demand (right-click / overlay open), never per
  scroll frame.
- The overlay's CM instance mounts on open and destroys on close — no
  standing cost.

### 7.4 Test plan

| Layer | Where it runs | Tests |
|---|---|---|
| lib unit (bun, CI) | `packages/cli` | `source-range` rule tests (fixtures per §2.5 incl. the `html_block` negative and the `data-source-line` extraction diff); `markdown-it-paged` meta-threading + `@continue` tests |
| script tests (node, CI) | `packages/desktop/tests/` (these node harnesses live in the **desktop** package even though they test the cli-owned scripts) | `pagedjs-interface.test.mjs`: `getContextTargetAt` resolution (kind precedence, image/link/selection/fence-`<code>`/`none`), keyboard event, protocol bumps; PR 5 adds `getRectsFor` fragment grouping + `setEditMask`; `preview-bridge` event forwarding; `preview-shell-regression` unchanged |
| desktop unit (bun + fakes, CI) | `tests/editor/` — the convention that governs here is "consumes editor/buffer seams", matching `editor-preview-sync-controller.test.ts` / `toolbar-actions.test.ts` / `buffer-state.test.ts` (NOT `tests/platform/`, despite the `PreviewEventController` analogy — the repo's split is by consumed seam) | `context-menu-controller.test.ts` (open/dismiss matrix of §4.2, keyboard open, in-flight-render guard), `commit-engine.test.ts` (every §4.7 branch: gate refusals incl. freshness + generation, same-file, cross-file via injected selectEditorFile fake, flush-throw messaging, error-phase load, mismatch abort, editor-mounted vs not, the dirty-buffer misalignment repro), `block-overlay-controller.test.ts` (PR 5), `normalizeForSearch`/`findUniqueRange` fixtures (PR 4) |
| desktop unit (happy-dom, CI) | `tests/platform/` | bridge round-trip for the new event/commands via the `preview-client.test.ts` pattern |
| integration (manual — **not CI-gated**; `run-ui.mjs` drives a locally packaged app) | `tests/integration/` | right-click → menu renders → bold a selection → file content asserted; overlay edit → file content asserted. The CI regression gate is the fake-based unit layer above — review PRs 3/5 with that in mind |
| perf (CI) | desktop | `rerender-ci`, `perf-gate` unchanged budgets |

### 7.5 Sequencing and sizing

| Step | Contents | Size |
|---|---|---|
| **PR 0** | `elementActivated` → reveal-in-editor case in `PreviewEventController` (spec above; opens the pane when closed) | S |
| PR 1 | Source-range primitive (lib annotation + `meta` threading + `@continue` fix + fixtures) | M |
| PR 2 | Bridge v4: `getContextTargetAt` + `contextMenuRequested` (mouse + keyboard) + client typings + script tests | S–M |
| PR 3 | **Commit engine** (§4.7–4.8, `applyRangeEdit`/`getAppliedPath`, shared path helper) **+ context menu** (controller, component, image/link/block/marker actions, settings). **Opens with the Electron `preventDefault` go/no-go check (§3.5)** | L |
| PR 4 | Selection formatting (`normalizeForSearch`/`findUniqueRange` + reverse map + menu items) | S–M |
| PR 5 | Overlay + protocol v5 (§5) | L |
| PR 6 | Phase 4 — separately planned, own issue | — |

Dependencies: PR 0 independent; PR 1 → PR 2 → PR 3 linear; PR 4 and PR 5
depend on PR 3, not on each other.

**Every PR in this table targets `release/0.10.0`, not `main`** — see §7.8.

### 7.6 Open decisions

Resolved during review (recorded here so they are not reopened): raw-HTML
annotation (**stays unannotated**, §2.6); overlay entry (**menu-only**,
§5.1); destructive actions (**cut from v1**, §4.3); PR 0 gating
(**always-on**, PR 0 spec); commit-engine placement (**PR 3**, §4). Remaining:

1. Exact visual treatment of `setEditMask` (dim vs blank) — a design call
   for PR 5 review with screenshots.

### 7.7 Governance and tracking issues

Per the UX contract's PROPOSED-feature rule ("must be linked to a tracking
issue… before implementation"), file these before the corresponding PR and
cross-reference them from each PR:

1. **Preview context menu (Tier 0)** — before PR 3 (covers PRs 2–4).
2. **Click-to-edit block overlay (Tier 1)** — before PR 5.
3. **Touch long-press context-menu invocation** — deferred from v1 (§0).
4. **Tier 2: editor-pane live preview** — Phase 4 (§6).

Contract-update PRs (§8) are cross-referenced from these issues per the
contract's own deviation process.

### 7.8 Branching and release target

**All six PRs target `release/0.10.0`.** This work ships as a 0.10.0
feature set, alongside the other 0.10.0-milestone items (e.g. issue #37,
the visual layout editor) — it is not a series of independent
main-targeting changes.

- **The branch does not exist yet** (`git ls-remote --heads origin` shows
  only `main` and working branches as of 2026-08-04). Create it from `main`
  before PR 0: `git checkout -b release/0.10.0 main && git push -u origin
  release/0.10.0`.
- Feature branches follow the CONTRIBUTING.md convention
  (`feature/<name>`), cut **from `release/0.10.0`** rather than `main`, and
  open their PR against `release/0.10.0`.
- Each PR's base must be verified at open time — a PR silently opened
  against `main` would ship a half-built feature (e.g. the bridge protocol
  bump without its consumer) into an unrelated release.
- `release/0.10.0` merges to `main` once the tier is complete; the
  `CHANGELOG.md` Unreleased entries (§8) accumulate on the release branch
  and land as one 0.10.0 section.
- **Rebase, don't diverge:** the linear dependency chain (PR 1 → PR 2 →
  PR 3) means each PR should be rebased onto the current
  `release/0.10.0` before review, so reviewers see only that PR's diff.
- Deferred work (Tier 2 live preview, touch long-press) is **not** part of
  this release branch — those issues get their own branches against
  whatever release is current when they are scheduled.

---

## 8. Documentation and contract updates shipped with the work

- `docs/ux-design-contract.md`: new sections for the preview context menu
  (including the `Shift+F10`/menu-key model and the touch-long-press
  deferral with its tracking issue) and the block overlay, status per phase.
  Per the contract's governance, these land as PRs against the contract
  document alongside the feature PRs.
- **New ADR `docs/adr/0009-inline-editing-source-ranges.md`** (numbered 0009
  — only 0008 exists in this checkout; 0002/0004/0005/0006/0007 are
  referenced by CLAUDE.md/the contract but absent, so the ADR's header notes
  the missing predecessors and records the bridge-protocol v3→v5 delta
  self-containedly). Scope: `data-source-range` semantics (token.map
  verbatim); the `token.meta.line` threading **and its NOT-`token.map`
  rationale** (the scroll-sync tie-break in `topVisibleSourceEl()`); the
  commit engine's clean-buffer gate — its exact failure mode and why no
  slice comparison substitutes for it; the optimistic-DOM-patch multicol
  overflow trap; bridge protocol v4/v5.
- Inline code comments mandated at the three landmine sites (§2.1
  assignment sites, §4.7 gate, §5.5 overlay module), each pointing at ADR
  0009.
- `CLAUDE.md` §6 note: `markdown-it-paged` now threads marker line meta.
- `CHANGELOG.md` (Unreleased) entries per PR.
- `packages/desktop/README.md`: context menu / inline editing section.
- `examples/gutterpress-user-guide/05-plugins.md`: the "Source map" row gains
  the `data-source-range` attribute next to `data-source-line`.
- The analysis doc (`docs/reviews/inline-editing-analysis-2026-08-04.md`)
  gains a pointer here; its §6.1 char-offset recommendation is superseded by
  the line-range design (rationale: §1 principle 4).
