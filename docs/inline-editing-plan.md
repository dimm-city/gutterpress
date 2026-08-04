# Inline editing implementation plan

> **Status: draft for review.** Implementation plan for the tiered design chosen in
> [`docs/reviews/inline-editing-analysis-2026-08-04.md`](./reviews/inline-editing-analysis-2026-08-04.md):
> a custom right-click menu over the paginated preview, click-to-edit block
> overlays that commit through the existing editor buffer, and (later)
> Obsidian-style live preview in the editor pane. **No WYSIWYG framework is
> adopted** — see the analysis doc for why Milkdown/Tiptap/etc. were rejected
> for the paginated viewer.
>
> Verified against: this branch (desktop `0.9.0-alpha.2`, preview bridge
> protocol v3), 2026-08-04. Three implementation spikes were run against the
> live codebase to ground this plan; their findings are folded in below and
> marked **[spike-verified]**.

---

## 0. Scope, goals, non-goals

**Goals**

1. Right-click anywhere in the paginated preview gets a Gutterpress context
   menu with actions appropriate to the target (image, link, selected text,
   block, `@marker`), every action landing in the proper `.md` file with the
   proper syntax.
2. Click-to-edit: an author can edit a block's text directly over the preview;
   the commit flows through the **same** buffer/save/recovery machinery as the
   editor pane — same debounce, same crash-recovery snapshots, same
   external-edit conflict handling, same undo history when the editor is open.
3. Foundations (source mapping, bridge commands) are shared-lib work usable by
   the CLI preview, the desktop app, and the future PWA target alike.

**Non-goals (this plan)**

- No `contenteditable` on paginated DOM, ever. **[spike-verified]** A caret
  cannot cross a Paged.js split-fragment boundary (each fragment is an
  independent DOM island), and Paged.js never re-layouts after a mutation, so
  native typing desyncs layout immediately.
- No live per-keystroke re-pagination. Commits are per-block (blur/Enter);
  the existing settled-write → chapter-splice pipeline (median ≤ 1000 ms,
  enforced by `rerender-ci`) does the refresh.
- No WYSIWYG framework. A continuous-flow "Write" mode (Milkdown) stays
  deferred behind the criteria in the analysis doc §8.
- Web/PWA enablement of the *write* paths is out of scope (the editor stack is
  desktop-gated today); the read-side primitives are built browser-safe so the
  PWA can adopt them later.

---

## 1. Design principles

1. **The markdown file is the only document model.** Every feature here is a
   *projection* over the source plus a *patch generator* into it. No second
   document model, no serializer.
2. **One write path.** All mutations flow into `EditorBuffer`
   (`packages/desktop/src/lib/editor/buffer-state.svelte.ts`) — never a
   parallel filesystem write. When a CodeMirror view is mounted for the target
   file, mutations go through `view.dispatch` so undo history is shared.
3. **Fail safe, not fail wrong.** Every patch is validated against the *live
   buffer content at commit time*; on any mismatch the action degrades to
   "open this block in the editor", never a guessed edit. A wrong edit in an
   author's book is the worst outcome this feature can produce.
4. **Line ranges over char offsets on the wire.** Rendered blocks are
   annotated with their `token.map` line range; conversion to character
   offsets happens in the SPA against the authoritative buffer text. This
   makes the mapping immune to line-ending normalization drift (see §2.3
   gotchas — markdown-it LF-normalizes before parsing **[spike-verified]**,
   and CodeMirror normalizes document line breaks, so char offsets computed at
   render time against raw disk bytes would not reliably index the buffer).
5. **Additive, feature-detected.** New bridge commands ride protocol v4 with
   the existing `getProtocolVersion()` feature-detect; new attributes sit
   alongside `data-source-line`, whose semantics do not change.

---

## 2. Phase 0 — source-range primitive (shared lib)

Everything else depends on this. Two small changes in
`packages/cli/src/lib/markdown/`, both pure/node-free (they ship through
`gutterpress/render` and must pass `scripts/check-render-pure.mjs`).

### 2.1 Give `@marker` wrapper tokens a `token.map`

**[spike-verified]** Today every `layout_*` token emitted by
`markdown-it-paged.js` has `map === null` — the wrapper `<div>`s for
`@chapter`/`@spread`/`@page`/`@section` are invisible to source mapping. The
1-based marker line is *already computed and discarded*: `markerBlock` sets
`token.meta.__line`, and that `meta` flows into `openChapter` / `openSpread` /
`openPage` / `openSection`.

**Change:** in each of those four functions, set the open token's map from the
line it already receives:

```js
t.map = [meta.__line - 1, meta.__line]; // the marker's own line, [start, end)
```

Also set it on the standalone `layout_page_break` / `layout_column_break`
tokens where they are created. `layout_*_close` tokens stay unmapped — they
are synthesized (stack auto-close, EOF drain) and have no 1:1 source line.

**Side effect, deliberate:** `markdown-it-source-map` decorates any level-0
`*_open` token with a non-null map at render time, so wrapper divs now gain
`data-source-line` too. This *improves* scroll-sync fidelity (the preview's
`sourcedBlocks()` starts seeing wrappers) but is a behavior change — see
gotchas.

### 2.2 New annotation rule: `data-src-map`

New file `packages/cli/src/lib/markdown/src-ranges.ts` (pure), registered
inside `createMarkdownRenderer()` (renderer.ts) as a core rule via
`md.core.ruler.push("src_ranges", …)`, **registered after user plugins are
applied** so it runs after every plugin-added core rule (`.push` appends; the
factory currently applies `customPlugins` last — move the registration after
that call).

The rule walks `state.tokens` (and, at every nesting level, not just level 0)
and, for each `*_open` token — plus self-closing block tokens `fence`, `hr`,
`html_block` — with a non-null `map`, sets:

```
data-src-map="<map[0]>:<map[1]>"     // token.map verbatim: 0-based, half-open
```

Semantics are documented as **exactly `token.map`**: 0-based line index,
half-open `[start, end)`. No char offsets on the wire (principle 4). The
existing `data-source-line` (1-based start line, level-0 only) is untouched.

Why not extend `markdown-it-source-map`: **[spike-verified]** that plugin is a
`renderToken` monkeypatch which silently never fires for token types with
dedicated renderer rules (`fence`, `html_block`, `image`, …) and is hard-gated
to `level === 0`. A parse-time core rule that sets `token.attrs` sidesteps
both problems — `fence` *does* serialize `token.attrs` via `renderAttrs`
**[spike-verified]**, so fenced code becomes addressable for the first time.

**Nested annotation is on by default** (list items, nested blockquotes, table
rows get ranges). The context menu needs `<li>`-level targeting; the existing
sync code keys off `data-source-line` and is unaffected by extra attributes.

### 2.3 Line→offset resolution (SPA side, at write time)

New pure helper (desktop `src/lib/editor/src-ranges.ts`, PWA-clean, unit-
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

/** [from, to) char range in `text` for a data-src-map line range. */
export function charRange(text: string, starts: number[], map: [number, number]): [number, number];
```

The SPA resolves a block's `data-src-map` against `buffer.content` at the
moment it needs offsets (menu open, overlay open, commit). Line indices are
stable across LF/CRLF/lone-CR **[spike-verified]** — only the offsets differ,
and they are computed from the same string they will splice.

### 2.4 Files touched

| File | Change |
|---|---|
| `packages/cli/src/lib/markdown/markdown-it-paged.js` | set `map` on layout open + break tokens (§6 of CLAUDE.md — the plugin owns its contract; update its header docs) |
| `packages/cli/src/lib/markdown/src-ranges.ts` | new pure annotation rule |
| `packages/cli/src/lib/markdown/renderer.ts` | register the rule after custom plugins |
| `packages/cli/src/lib/markdown/*.test.ts` | new unit tests; update any HTML snapshots that now include `data-source-line` on wrappers / `data-src-map` everywhere |
| `packages/desktop/src/lib/editor/src-ranges.ts` | new pure line→offset helpers + tests |

### 2.5 Acceptance

- For a corpus chapter (headings, paragraphs, nested list in blockquote,
  fence, table, footnote definition, `@section`/`@page-break` markers, attrs
  syntax, typographer punctuation), every annotated element's
  `charRange(source, …)` slice reproduces its exact block source, at every
  nesting level, for LF, CRLF, and lone-CR fixtures.
- `bun run build` in `packages/cli` passes `check-render-pure.mjs` (rule is
  node-free).
- `packages/desktop` `npm run rerender-ci` stays within budget (attribute
  emission is O(tokens); expected impact ~nil).

### 2.6 Gotchas (Phase 0)

- **`state.src` is NOT the author's file.** markdown-it's `normalize` core
  rule rewrites `\r\n?` → `\n` (and `\0` → U+FFFD) before any other rule runs
  **[spike-verified]**. Never compute char offsets inside the plugin; that is
  *why* the wire format is line ranges.
- **A naive `split("\n")` line table breaks on lone-`\r`** (old-Mac endings):
  markdown-it still parses such files into multiple lines, a `\n`-only scanner
  sees one line, and offsets go out of bounds **[spike-verified]**. The helper
  must use `/\r\n?|\n/g` verbatim.
- **`html_block` / `html_inline` renderer rules discard `token.attrs`**
  (`return token.content`) — raw author-written HTML blocks can NOT carry
  `data-src-map` without overriding the renderer rule to wrap them in a
  synthetic div (a DOM-structure change with its own blast radius)
  **[spike-verified]**. Decision for this plan: raw HTML blocks stay
  unannotated; the context menu falls back to "open in editor" targeting the
  enclosing chapter + nearest annotated neighbor's line. Documented, deliberate.
- **Reference-style link/image definitions (`[id]: url`) emit zero tokens** —
  unrecoverable by token walking **[spike-verified]**. Actions on a
  reference-style link can edit the *usage* but not find the definition line;
  the "Edit link…" action must detect reference syntax in the block slice and
  degrade to open-in-editor.
- **Setext heading maps span two lines** (text + underline); the `inline`
  child maps only the text line **[spike-verified]**. Block-level patching is
  safe (we always patch whole block ranges); anyone later doing inline-level
  work must not mix the two.
- **Snapshot churn + sync behavior change from §2.1.** Wrapper divs gaining
  `data-source-line` changes `sourcedBlocks()` / `capture()` / `restore()`
  inputs in `pagedjs-interface.js` and `preview-shell.js`. Expected effect is
  neutral-to-better (markers are legitimate scroll anchors), but
  `tests/pagedjs-interface.test.mjs`, `preview-shell-regression.test.mjs`, and
  the desktop scroll-sync QA path must be re-run deliberately, not waved
  through.
- **Rule ordering vs user plugins.** `md.core.ruler.push` appends at
  registration time; registering `src_ranges` *after* `applyPlugins()` inside
  the factory guarantees it sees final tokens even if a user plugin pushed its
  own core rule. A user plugin that mutates tokens *at render time* could
  still bypass it — acceptable; such plugins already break `data-source-line`.
- **Idempotency:** use `token.attrSet` (not `attrPush`) so re-renders on a
  shared `md` instance can't stack duplicate attributes **[spike-verified —
  prototype ran repeatedly on one instance without duplication]**.

---

## 3. Phase 1 — bridge protocol v4

All inside the two embedded preview scripts (single source serving CLI and
desktop alike **[spike-verified]**: they are `with { type: "file" }` embedded
assets served under `/preview/scripts/`) plus the SPA client typings.

### 3.1 `pagedjs-interface.js` (book iframe)

New `previewAPI` members:

- `getContextTargetAt(x, y)` — pure read, also used internally by the
  `contextmenu` handler (below). Resolves the deepest annotated element at the
  point and returns:

  ```js
  {
    kind: "image" | "link" | "selection" | "block" | "marker" | "none",
    chapter,            // data-chapter-src of the enclosing wrapper
    srcMap,             // [start, end) of the innermost annotated block
    blockTag,           // tag name of that block
    split,              // data-split-from/-to present on the fragment
    ref,                // data-ref (Paged.js identity, stable across fragments)
    rect,               // fragment getBoundingClientRect() (post-zoom)
    image: { src, alt } | null,      // when kind === "image"
    link: { href, text } | null,     // when kind === "link"
    selection: {                     // when a non-collapsed selection exists
      text,                          //   selection.toString()
      withinSingleBlock,             //   both endpoints in one annotated block
      srcMap,                        //   that block's range (when single)
      chapter,
    } | null,
  }
  ```

- `getRectsFor({ ref } | { chapter, srcMap })` — all fragment rects for one
  logical block (a Paged.js-split block is multiple DOM fragments sharing one
  `data-ref` **[spike-verified]**), each `{ top, left, width, height, page }`.
- `setEditMask({ ref, on })` — toggle a masking class on every fragment of the
  block (used while an overlay covers it).
- `getProtocolVersion()` → **4**.

New event: a capture-phase `contextmenu` listener that builds the
`getContextTargetAt` payload, adds the click's viewport `x`/`y`, calls
`e.preventDefault()`, and dispatches `contextMenuRequested` on `window`.

### 3.2 `pagedjs-bridge.js` (book iframe)

Command dispatch is generic by name — **no change needed for commands**
**[spike-verified]**. One line to forward the new event:

```js
window.addEventListener('contextMenuRequested', function (e) {
  post({ type: 'gutterpress:event', name: 'contextMenuRequested', detail: e.detail });
});
```

### 3.3 `preview-shell.js` (shell iframe)

No change. The shell relays `gutterpress:event` from the **active** frame
transparently; events from the retiring frame are filtered to
`sourceLineChanged` only — correct here too (a menu request from a dying frame
should be dropped).

### 3.4 SPA client (`preview-client.ts`)

- Extend the `PreviewEvent` name union with `"contextMenuRequested"` and type
  its detail.
- Typed wrappers `getRectsFor(…)`, `setEditMask(…)` mirroring
  `getOutline`/`scrollTo`.

### 3.5 Gotchas (Phase 1)

- **Split fragments duplicate every data attribute** — `querySelectorAll`
  by `data-src-map` value returns one element *per fragment*, and the chapter
  wrapper itself is cloned once per page (N wrappers for N pages)
  **[spike-verified]**. All new commands must group by `data-ref` (the one
  identity Paged.js maintains across fragments) and must never assume
  uniqueness of any other attribute. Never key on `id`: Paged.js strips it
  from all fragments but the first (mirrored to `data-id`).
- **Rects are post-zoom and post-scroll but stale after zoom/view changes**
  **[spike-verified]**: CSS `zoom` means `getBoundingClientRect()` is already
  in visual coordinates — but any zoom/view-mode/page change invalidates
  cached rects. The SPA must re-query, never cache across `pageChanged` /
  `renderingComplete` / zoom operations.
- **Never use `Range.toString()` across fragments** — a cross-page range's
  raw text is polluted with inter-page structural whitespace, and a range
  spanning non-adjacent pages includes every intervening page's content
  **[spike-verified]**. Use `selection.toString()` for display only; the
  authoritative text is always the buffer slice. Cross-block selections get
  `withinSingleBlock: false` and formatting actions are disabled for them
  (v1).
- **Electron's native `context-menu` handler**
  (`packages/desktop/electron/main.ts:731`) shows a copy/paste menu when
  `params.selectionText` is non-empty — i.e. right-click on selected preview
  text currently pops the native menu. In-page `preventDefault()` stops
  Chromium from requesting a context menu, which should prevent the Electron
  event from firing at all; the DOM half is **[spike-verified]**
  (`defaultPrevented` honored in-page) but the Electron-process half was not
  testable headless. **Verify in `electron:dev` early**; fallback if needed:
  gate the `main.ts` handler on the event's frame origin (skip frames served
  from the preview server's origin).
- **URL-preview / locked mode:** `PreviewClient.lockDown()` disables the
  bridge entirely for third-party URLs. The context-menu controller must treat
  "no client / locked" as menu-disabled — it gets this for free by only
  listening through `PreviewClient`, but must not add any direct
  `window.addEventListener("message")` shortcuts.
- **The book document runs author content** (`html: true`, sandbox
  `allow-scripts`). Everything arriving in `contextMenuRequested` detail is
  **untrusted input**: validate shape, clamp coordinates to the frame rect,
  and rely on commit-time slice validation (§5.4) so a malicious/broken
  document can at worst pop a menu with wrong labels, never cause an
  unintended file edit outside the validated range.
- **Keep the payload JSON-cloneable** — the detail crosses two `postMessage`
  boundaries; no DOM nodes, no functions, no `DOMRect` instances (spread them
  into plain objects — `DOMRect` structured-clones, but the existing envelope
  code assumes plain data).

---

## 4. Phase 2 — Tier 0: the context menu (SPA)

### 4.1 Components and ownership

- **`ContextMenuController`** (`src/lib/routes/context-menu-controller.svelte.ts`)
  — single owner of menu state, following the injected-deps pattern of
  `PreviewEventController`/`EditorPreviewSyncController` (clock, client,
  editor accessors, buffer accessors injected; zero DOM/`node:*` imports;
  tests live in `tests/platform/` with fakes, matching
  `preview-event-controller.test.ts`) **[spike-verified pattern]**.
- **`ContextMenu.svelte`** (`src/lib/components/`) — presentational; renders
  absolutely positioned over the preview pane; ARIA `role="menu"`, arrow-key
  navigation, `Escape` closes, focus returns to the previously focused
  element. Reuses the app token system (no hardcoded colors).
- **Wiring in `+page.svelte`:** subscribe to `contextMenuRequested` via a
  second `client.on()` listener owned by the controller (the existing
  `PreviewEventController.handleEvent` switch stays untouched — note
  `elementActivated` is *already* delivered but currently unhandled
  **[spike-verified]**; this controller becomes its first consumer too).

### 4.2 Positioning

Menu anchor = event `x`/`y` + the PreviewFrame `<iframe>`'s own
`getBoundingClientRect()` in the SPA. No other terms: the shell fills its
iframe (`position:absolute; inset:0`), the book iframe fills the shell, the
book's own scroll/zoom are already baked into its viewport coordinates
**[spike-verified]**. `PreviewFrame.svelte` gains an exported accessor for its
iframe element (a `bind:this` ref) instead of the `document.querySelector("iframe")`
pattern used by `ZoomViewController`.

Clamp the menu into the workspace rect; flip above/left near edges.

### 4.3 Menu model

Menu items are computed from `kind` + capability checks, each item carrying an
`enabled` flag and a disabled-reason tooltip:

| Target | Items (v1) |
|---|---|
| image | Edit alt text…, Set width…, Set position (left/right/center), Replace image…, Reveal in Media panel, Edit block in editor |
| link | Edit link…, Copy link target, Edit block in editor |
| selection (single block) | Bold, Italic, Strikethrough, Inline code, Make link…, Edit block in editor |
| selection (cross-block) | Copy, Edit in editor (jump to start) |
| block | Edit this block (Tier 1 entry point), Insert page break before/after, Go to source |
| marker (`@page`/`@section`/… wrapper or break) | Edit marker…, Remove marker, Go to source |

Every item ultimately produces a **range patch** `{chapter, srcMap, expected,
replacement}` or an **editor jump**; both are executed by the commit engine
(§5.4) — the menu itself never touches files.

### 4.4 Resolving action parameters

- **Image:** find the markdown image token inside the block slice by matching
  the rendered `src`/`alt` attributes (`registerImageRule` does not rewrite
  `src` **[spike-verified]**, so attribute text matches author text). Width /
  position edits rewrite the `{…}` attrs suffix using the same vocabulary
  `applyImage` (`toolbar-actions.ts`) already emits — reuse its formatting
  helpers rather than re-inventing the syntax. If the block slice contains a
  raw HTML `<img>` instead, offer only "Edit block in editor".
- **Link:** same approach on `[text](href)`; reference-style links (`[text][id]`)
  detected and degraded (gotcha §2.6).
- **Selection formatting:** reverse the typographer substitutions in the
  selected string (`“ ” → "`, `‘ ’ → '`, `– → --`, `— → ---`, `… → ...`,
  NBSP), then search the block's buffer slice for a **unique** occurrence.
  Unique → wrap range (`**…**` etc.) via the commit engine. Zero or multiple
  matches → item disabled with tooltip "Couldn't locate this text uniquely in
  the source — open the editor".

### 4.5 Settings

New `AppSettings` field (e.g. `preview.contextMenu: boolean`, default `true`)
added to `$lib/platform` DTO + `DEFAULT_SETTINGS`; read reactively via
`useSettings().current`; any imperative teardown on toggle goes through the
existing `onSettingsChange()` + `settingsChangeGuard()` channel. `$effect` is
banned by eslint in this package — the controller uses the injected-callback
pattern instead **[spike-verified rule text]**.

### 4.6 Gotchas (Phase 2)

- **The editor is `{#if}`-UNMOUNTED, not hidden, whenever the pane is closed**
  (`editorPaneOpen` derived state), and `MarkdownEditor` may never have been
  lazy-imported at all in a preview-only session **[spike-verified]**. "No
  live CodeMirror view" is the *common* case, not an edge case. Menu actions
  must not assume `editorRef`; the commit engine (§5.4) handles both paths.
- **`EditorBuffer` may hold a different chapter than the clicked one** — or
  none. Cross-chapter actions must load the target file first; see the commit
  engine. Beware: `selectEditorFile` → `buffer.load()` **re-reads disk**; if
  the buffer already holds the target file with unsaved edits, calling it
  again must be skipped or edits could race the pending save (`load()` uses a
  generation counter but still replaces content).
- **Stale targets after a splice:** between menu open and action click, a
  save (from the open editor pane) can re-render and splice the chapter,
  changing line numbers. The commit engine's expected-slice check catches
  this; the menu should additionally close itself on `renderingComplete`.
- **Right-click during an in-flight render** (`rendering()` true): the DOM
  being inspected may be mid-swap; the controller should ignore
  `contextMenuRequested` while a render is in flight (same guard the sync
  controller uses).
- **Keyboard/a11y:** a context menu reachable only by mouse fails the app's
  a11y bar (`docs/ux-design-contract.md` accessibility checklist). v1 must
  include `Escape`/arrows/Home/End and a documented keyboard path (the
  existing "Go to source" flow via outline remains the keyboard alternative
  for target acquisition; note this explicitly in the contract update).
- **Touch:** long-press synthesis is deferred; on touch layouts the menu is
  simply not registered (the narrow-layout tab UI already separates edit and
  view modes).
- **Do not extend the native Electron menu instead** — it can't be styled,
  can't show disabled-reasons, and would fork behavior between desktop and
  future web. The SPA menu is the only implementation.

---

## 5. Phase 3 — Tier 1: click-to-edit block overlay

### 5.1 UX

- Entry: "Edit this block" from the context menu, or double-click on an
  annotated block (`elementActivated` already carries the needed detail;
  double-click detection added in `pagedjs-interface.js` alongside the click
  handler).
- An overlay editor opens positioned over the block's **first fragment rect**
  (from `getRectsFor`), sized to it (min-height clamp), styled like the app's
  inputs. All fragments of the block get `setEditMask(on)` so the stale
  rendered text doesn't show behind/beside the overlay (a split block has
  fragments on later pages **[spike-verified]** — masked, with a subtle
  "continues on page N" affordance out of scope for v1).
- The overlay contains the block's **source markdown** (buffer slice), not its
  rendered text.
- Commit on `Ctrl/Cmd+Enter` or blur; cancel on `Escape`. Commit dispatches
  the patch through the commit engine, closes the overlay, unmasks, and lets
  the normal settled-write → chapter-splice pipeline refresh the pages
  (≤ ~1 s median; the overlay does not wait for it).

### 5.2 Editor widget

v1 uses a minimal **CodeMirror 6 instance** (already a dependency; markdown
language + the existing theme tokens, no gutters, no lint) rather than a
`<textarea>` — it gives markdown highlighting and consistent keymaps for free
and avoids a later rewrite. It is a *second, short-lived* EditorView scoped to
the overlay component's lifetime; the "ONE EditorView" rule in
`MarkdownEditor.svelte` governs that component, not the app.

### 5.3 Overlay lifecycle vs the live preview

- While an overlay is open, the buffer receives **no edits** (typing stays in
  the overlay), so no save→re-render fires from this flow. But the editor
  pane may be open simultaneously: any `renderingComplete` while the overlay
  is open re-anchors it (`getRectsFor` again) or, if the block vanished,
  closes it with a toast ("This section changed — reopen to edit").
- External-edit conflicts remain the buffer's job: if
  `reconcileExternalChange` replaces content while an overlay is open, the
  commit-time slice check fails and the overlay refuses the commit with the
  standard conflict UI.

### 5.4 The commit engine (shared by menu actions and overlay)

One module (`src/lib/editor/inline-commit.ts`, pure logic + injected seams;
unit-tested with fakes) implementing:

```
commitRangePatch({ chapter, srcMap, expected, replacement }):
  1. Ensure the buffer holds `chapter`:
     - buffer.filePath endsWith chapter → proceed
     - else if buffer dirty for ANOTHER file → flush() first, then load(chapter)
     - else load(chapter)                      (buffer exists without the editor pane)
  2. Recompute offsets: starts = buildLineStarts(buffer.content);
     [from, to) = charRange(buffer.content, starts, srcMap)
  3. Validate: buffer.content.slice(from, to) === expected
     - mismatch → abort, toast, offer "Open in editor at line srcMap[0]+1"
  4. Apply:
     - if editorRef mounted AND editing the same file:
         editorRef.applyRangeEdit(from, to, replacement)   // NEW export;
         // dispatches view transaction → onChange → buffer.edit → shared undo
     - else:
         buffer.edit(content.slice(0, from) + replacement + content.slice(to))
  5. The buffer's existing 500 ms debounce → Platform.writeFile →
     /api/fs/write-file → notifyPreviewSettledWrite → rebuild → chapter splice.
     (No new plumbing — [spike-verified] this is the live path today.)
```

`expected` is captured when the menu/overlay *opens*, from the same buffer
content — so the check specifically detects "the file changed between look
and commit".

New `MarkdownEditor.svelte` export (trivially additive — `toolbar-actions.ts`
already dispatches arbitrary `{from,to,insert}` changes internally
**[spike-verified]**):

```ts
export function applyRangeEdit(from: number, to: number, insert: string): void {
  if (!view) return;
  view.dispatch({ changes: { from, to, insert } });
}
```

### 5.5 Trailing-boundary rule

A block's `[start, end)` range includes its trailing newline(s) up to the next
block's first line. Patches must preserve the boundary: the overlay strips the
trailing blank-line run from the editable text on open and re-appends the
exact original run on commit, so authors can't accidentally merge two blocks
by deleting the terminal newline. (The `expected` string still covers the full
range; the reconstruction is deterministic.)

### 5.6 Gotchas (Phase 3)

- **Do NOT patch the paginated DOM optimistically.** The natural idea —
  splice the edited HTML into the live page for instant feedback — fails
  *silently*: `.pagedjs_page_content` is a live CSS multicol container
  (`column-fill: auto` + fixed column width, baked into paged.js CSS), so
  overflowing content doesn't visibly overlap; it spills into **invisible
  columns thousands of pixels to the side** (`getClientRects().length > 1`)
  **[spike-verified]**. v1 renders no optimistic patch at all; if one is ever
  added, the guard is a `getClientRects().length` / measured-height check, not
  visual-overlap detection.
- **Paged.js will never correct a mutation** — no observer, no re-layout
  after initial pagination **[spike-verified]**. Any DOM the overlay touches
  (mask classes) must be purely cosmetic and reversible.
- **Splice can replace the DOM under an open overlay.** The overlay anchors
  to rects captured pre-splice; on `renderingComplete` it must re-resolve via
  `getRectsFor` (the new DOM has fresh `data-ref`s — resolve by
  `{chapter, srcMap}` fallback, not `ref`).
- **`buffer.load()` semantics:** step 1 must never call `load()` for a file
  the buffer already holds — `load()` re-reads disk and would clobber the
  500 ms-debounced not-yet-saved state (generation counter protects against
  *stale* loads, not against *unwanted* ones).
- **`flush()` before switching chapters** — without it, switching the buffer
  to another chapter silently drops pending edits or races the save timer.
  `flush()` is async; the engine awaits it and re-validates after.
- **Undo asymmetry:** with the editor mounted, a commit is one undoable
  CodeMirror transaction. Without it, `buffer.edit()` bypasses any undo
  history (there is no view). Document this; when the user later opens the
  editor, the pre-edit state is recoverable only via crash-recovery snapshots
  / VCS. (Acceptable for v1; a buffer-level undo stack is out of scope.)
- **IME / composition:** commit-on-blur must not fire mid-composition
  (`compositionend` guard in the overlay).
- **Focus trap:** the overlay must trap Tab within itself and restore focus
  to the preview on close — same discipline as the existing dialogs
  (`dialog-shell.css` consumers).
- **Very long blocks** (a 2000-word paragraph spans 9 pages
  **[spike-verified]**): the overlay is anchored to the first fragment but
  must cap its height to the visible pane and scroll internally.

---

## 6. Phase 4 — Tier 2: Obsidian-style live preview in the editor pane (outline)

Per the UX contract (`docs/ux-design-contract.md` §1): **opt-in toggle, never
the default**. This phase is deliberately outlined, not fully specified — it
should be planned in detail only after Tiers 0–1 ship.

- Mechanism: CodeMirror 6 **decorations** — `Decoration.replace` (hide
  syntax runs), `Decoration.mark` (styled spans), widget decorations (images,
  checkboxes), driven from the Lezer markdown tree, with
  `EditorView.atomicRanges` for caret behavior. Reveal syntax when the
  selection touches the construct's range (the standard live-preview pattern;
  same approach as Obsidian and the open-source CM6 implementations).
- The document stays byte-exact markdown — decorations are view-only; zero
  round-trip risk by construction.
- Scope v1: emphasis/strong/strikethrough/inline-code markers, headings
  (hide `#` run, size via line decoration), links (collapse to text), images
  (inline widget rendering the resolved asset), blockquote/list markers
  restyle. `@marker` lines get a styled "chip" line decoration (never hidden
  — layout markers must stay visible; they are the author's page-structure
  contract).
- Explicitly out: tables-as-grid, footnote popovers, embeds.
- New setting `editor.livePreview: boolean` (default false), same wiring as
  §4.5; toggle swaps a Compartment in the existing single EditorView (no
  second editor, matching the file's established compartment pattern).

**Gotchas (known in advance):** decoration ranges must be recomputed
incrementally (viewport-scoped, `syntaxTree`-driven) or large chapters will
jank; `Decoration.replace` across line boundaries is restricted (block-level
constructs need line decorations instead); atomic ranges change arrow-key
counts (test caret paths explicitly); the existing `markerCompletionSource`
and lint tooltips must keep working with decorations active.

---

## 7. Cross-cutting

### 7.1 Security posture

- The bridge stays **read + cosmetic**: new commands expose geometry and
  target metadata only. All file mutation happens SPA-side through the buffer,
  gated by the expected-slice check. Payloads from the book frame are treated
  as untrusted (validated shape, clamped coordinates) because the book runs
  author-supplied content with `allow-scripts`.
- `PreviewClient`'s origin pinning and `lockDown()` are unchanged and remain
  the outer gate.

### 7.2 Web/PWA

Phase 0/1 are browser-safe by construction (pure lib rule; bridge scripts are
plain DOM). Phases 2–3 land desktop-gated (`isDesktop()`), because the write
stack (buffer → `Platform.writeFile` → settled-write hook) is Electron-backed
today. The controller seams take the platform through injection, so the future
FSA-backed web write path slots in per `docs/pwa-webadapter-plan.md` without
redesign.

### 7.3 Performance

- Annotation: O(tokens) attribute writes; verify `rerender-ci` (≤ 1000 ms
  strict) and `perf-gate` before/after Phase 0.
- New bridge calls are on-demand (right-click / overlay open), never per
  scroll frame.
- The overlay's second CM instance mounts on open and destroys on close — no
  standing cost.

### 7.4 Test plan

| Layer | Tests |
|---|---|
| lib (bun) | `src-ranges` rule unit tests (fixtures: nested structures, markers, fences, tables, footnotes, attrs, LF/CRLF/CR); `markdown-it-paged` map-assignment tests; snapshot updates |
| lib (node) | existing `pagedjs-interface.test.mjs` harness extended: `getContextTargetAt` resolution (image/link/selection/block), `getRectsFor` fragment grouping by `data-ref`, `setEditMask`, protocol bump |
| desktop (bun, fakes) | `context-menu-controller.test.ts`, `inline-commit.test.ts` (all §5.4 branches: same-file, cross-file, dirty-other-file flush, mismatch abort, editor-mounted vs not) in `tests/platform/` using the established FakeClient/FakeScheduler pattern |
| desktop (happy-dom) | bridge round-trip for the new event/commands via the `preview-client.test.ts` pattern |
| integration | `tests/integration/run-ui.mjs` scenario: right-click → menu renders → bold a selection → file content asserted; overlay edit → file content asserted; scroll-sync regression after §2.1 |
| perf | `rerender-ci`, `perf-gate` unchanged budgets |

### 7.5 Sequencing and sizing

| Step | Contents | Size |
|---|---|---|
| PR 1 | Phase 0 (lib annotation + paged map fix + tests + snapshot updates) | S–M |
| PR 2 | Phase 1 (bridge v4 + client typings + script tests) | M |
| PR 3 | Phase 2 (menu controller + component + image/link/block actions + settings) | M–L |
| PR 4 | Phase 2 (selection formatting: typographer reverse-map + unique match) | S–M |
| PR 5 | Phase 3 (commit engine + `applyRangeEdit` + overlay) | L |
| PR 6 | Phase 4 (live preview decorations) — separately planned | L |

Dependencies are strictly linear PR1 → PR2 → PR3; PR4 and PR5 both depend on
PR3 but not on each other.

### 7.6 Open decisions (to resolve during PR review, not blockers)

1. Whether §2.1's wrapper `data-source-line` should also be consumed by
   `capture()`/`restore()` scroll anchoring immediately, or be attribute-only
   until the sync behavior is re-QA'd.
2. Raw HTML block annotation (renderer-rule override wrapping in a synthetic
   div) — deferred here; revisit if real projects show heavy raw-HTML usage.
3. Double-click-to-edit vs menu-only entry for the overlay (double-click may
   conflict with text selection habits; could ship menu-only first).
4. Whether "Remove marker" belongs in v1 (destructive; needs undo story
   without a mounted editor — see §5.6 undo asymmetry).

---

## 8. Documentation and contract updates shipped with the work

- `docs/ux-design-contract.md`: new sections for the preview context menu and
  block overlay (status PROPOSED→SHIPPED per phase), keyboard model, the
  opt-in rule for Tier 2 (already present).
- `CLAUDE.md` §6 note: `markdown-it-paged` now owns marker `token.map`.
- `packages/cli` README / plugin guide: document `data-src-map` semantics
  (token.map verbatim) as part of the rendered-HTML contract, protocol v4
  command list.
- The analysis doc (`docs/reviews/inline-editing-analysis-2026-08-04.md`)
  gains a pointer to this plan; its §6.1 char-offset recommendation is
  superseded by the line-range design here (rationale in §1 principle 4).
