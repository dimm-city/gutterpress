# Inline editing implementation plan

> **Status: draft for review (revision 2).** Implementation plan for the tiered
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
> live codebase to ground this plan (findings marked **[spike-verified]**),
> and the draft went through two cycles of three independent critical reviews;
> the material corrections from those reviews are folded in.

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
zero-new-npm-dependencies property is deliberate and load-bearing (§1/§3 of
CLAUDE.md): nothing here adds anything to the compiled binary or the desktop
bundle beyond our own code.

---

## 0. Scope, goals, non-goals

**Goals**

1. Right-click anywhere in the paginated preview gets a Gutterpress context
   menu with actions appropriate to the target (image, link, selected text,
   block, `@marker`), every action landing in the proper `.md` file with the
   proper syntax.
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
- Touch long-press menu invocation is deferred (tracking issue to be filed;
  the UX contract's "long-press on touch" requirement applies when the menu
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
   commit engine (§5.4) reuses the app's existing file-selection machinery
   rather than reimplementing it.
3. **Fail safe, not fail wrong.** A patch is applied only when the target
   chapter's buffer is **clean** (content === disk content) and the target
   slice matches what the author saw; on any doubt the action degrades to
   "open this block in the editor", never a guessed edit. A wrong edit in an
   author's book is the worst outcome this feature can produce.
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
   change** (see §2.1 — this is deliberate regression avoidance, not an
   accident).

---

## 2. Phase 0 (PR 1) — source-range primitive (shared lib)

Everything else depends on this. Changes live in
`packages/cli/src/lib/markdown/`, all pure/node-free (they ship through
`gutterpress/render` and must pass `scripts/check-render-pure.mjs`).

### 2.1 Thread marker line info onto `layout_*` tokens — via `token.meta`, NOT `token.map`

**[spike-verified]** Today every `layout_*` token emitted by
`markdown-it-paged.js` has `map === null` — the wrapper `<div>`s for
`@chapter`/`@spread`/`@page`/`@section` are invisible to source mapping. The
1-based marker line is *already computed and discarded*: `markerBlock` sets
`token.meta.__line` on the placeholder marker token, and that `meta` object
flows into `openChapter` / `openSpread` / `openPage` / `openSection`.

**Change (inside `markdown-it-paged.js`, which owns its contract per
CLAUDE.md §6):** at each `layout_*_open` creation site (the four `openX`
functions) and at the standalone `layout_page_break` / `layout_column_break`
creation sites, attach the line to the emitted token:

```js
t.meta = { line: meta.__line };   // 1-based marker line, from the parser
```

**`@continue` fix (review finding):** the `@continue` branch builds a
`contMeta` from the enclosing section's meta and copies only `name`/`attrs` —
`__line` is dropped, so a continuation section's meta would be `undefined`.
The branch must add `__line: <the marker's own line>` (in scope where
`contMeta` is built) so continuation sections carry their real line. Any
consumer must additionally reject non-finite line values rather than trusting
presence (a `[NaN, undefined]`-style range silently resolves to
whole-document offsets downstream — the exact "fail wrong" this plan bans).

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
byte-identical.

### 2.2 New annotation rule: `data-source-range`

New file `packages/cli/src/lib/markdown/source-range.ts` (pure), registered
inside `createMarkdownRenderer()` (renderer.ts) as a core rule via
`md.core.ruler.push("source_range", …)`, **registered after
`applyPlugins()`** so it runs after every plugin-added core rule (`.push`
appends in registration order; user plugins are applied inside the factory
before this registration **[spike-verified]**).

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
| `packages/cli/src/lib/markdown/markdown-it-paged.js` | attach `token.meta.line` at layout-token creation sites; `@continue` `__line` fix; update the file's header contract docs |
| `packages/cli/src/lib/markdown/source-range.ts` | new pure annotation rule |
| `packages/cli/src/lib/markdown/renderer.ts` | register the rule after `applyPlugins()` |
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
- `data-source-line` output is byte-identical before/after (no coverage
  change — asserted, not assumed).
- `bun run build` in `packages/cli` passes `check-render-pure.mjs`.
- `packages/desktop` `npm run rerender-ci` stays within budget.

### 2.6 Gotchas (Phase 0)

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
  block's padding hits `<pre>`'s box, so target resolution (§3.1) must accept
  `closest('[data-source-range]')` finding the `<code>` **descendant** case:
  resolve via the point's element *and* its children, or simply document that
  `blockTag` may read `"code"` and pad-area clicks fall through to the parent
  block. Covered by a dedicated test.
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
- **Setext heading maps span two lines** (text + underline); the `inline`
  child maps only the text line **[spike-verified]**. Block-level patching is
  safe (we always patch whole block ranges); anyone later doing inline-level
  work must not mix the two.
- **Rule ordering vs user plugins.** Registering `source_range` after
  `applyPlugins()` guarantees it sees final tokens even if a user plugin
  pushed its own core rule. A user plugin that mutates tokens *at render
  time* could still bypass it — acceptable; such plugins already break
  `data-source-line`.
- **Non-finite guards everywhere.** Both the annotation rule (skip) and
  `charRange` (throw) must reject non-finite values independently — the
  `@continue` bug class must be caught even if reintroduced later.

---

## 3. Phase 1 (PR 2) — bridge protocol v4

All inside the two embedded preview scripts (single source serving CLI and
desktop alike **[spike-verified]**: they are `with { type: "file" }` embedded
assets served under `/preview/scripts/`) plus the SPA client typings.
**Scope discipline:** PR 2 ships only what the context menu (PR 3) consumes.
The overlay's commands (`getRectsFor`, `setEditMask`) ship with the overlay
in PR 5 as protocol v5 — building them two PRs before their first consumer
locks in an untested contract.

### 3.1 `pagedjs-interface.js` (book iframe)

New `previewAPI` members (object-parameter style, matching
`queryDom(spec)`/`highlight(spec)`):

- `getContextTargetAt({ x, y })` — pure read, also used internally by the
  `contextmenu` handler (below). Resolves the deepest annotated element at
  the point (accounting for the fence `<pre>`/`<code>` case, §2.6) and
  returns:

  ```js
  {
    kind: "image" | "link" | "selection" | "block" | "marker" | "none",
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

No change. The shell relays messages from the **active** frame transparently;
from the **retiring** frame it forwards only `gutterpress:reply` messages and
the `sourceLineChanged` event — `contextMenuRequested` from a dying frame is
correctly dropped by the existing filter.

### 3.4 SPA client (`preview-client.ts`)

- Extend the `PreviewEvent` name union with `"contextMenuRequested"` and type
  its detail.
- Typed wrapper for `getContextTargetAt` mirroring `getOutline`/`scrollTo`.

### 3.5 Gotchas (Phase 1)

- **Split fragments duplicate every data attribute** — `querySelectorAll` by
  `data-source-range` value returns one element *per fragment*, and the
  chapter wrapper itself is cloned once per page (N wrappers for N pages)
  **[spike-verified]**. All commands must group by `data-ref` (the one
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
  text currently pops the native menu, and the handler is bound at
  `webContents` scope (fires for all frames). In-page `preventDefault()`
  stops Chromium from requesting a context menu, which should prevent the
  Electron event from firing; the DOM half is **[spike-verified]**
  (`defaultPrevented` honored in-page) but the Electron-process half was not
  testable headless. **This is a go/no-go gate item at the top of PR 3** —
  verify under `electron:dev` before building the menu UI. Fallback if
  suppression fails: gate the `main.ts` handler on the event's frame (skip
  frames served from the preview server's origin).
- **URL-preview / locked mode:** `PreviewClient.lockDown()` disables the
  bridge entirely for third-party URLs. The context-menu controller must
  treat "no client / locked" as menu-disabled — it gets this for free by only
  listening through `PreviewClient`, and must not add any direct
  `window.addEventListener("message")` shortcuts.
- **The book document runs author content** (`html: true`, sandbox
  `allow-scripts`). Everything arriving in `contextMenuRequested` detail is
  **untrusted input**: validate shape, clamp coordinates to the frame rect,
  and rely on the commit engine's clean-buffer + slice validation (§5.4) so a
  malicious/broken document can at worst pop a menu with wrong labels, never
  cause an unintended file edit.
- **Keep the payload JSON-cloneable** — the detail crosses two `postMessage`
  boundaries; no DOM nodes, no functions, no `DOMRect` instances (spread
  rects into plain objects).

---

## 4. Phase 2 (PRs 3–4) — Tier 0: the context menu (SPA)

**Ships after PR 0** (see §7.5): PR 0 is a same-day change wiring the
already-delivered-but-unhandled `elementActivated` event
**[spike-verified: plumbed end-to-end, dropped by `PreviewEventController`'s
switch today]** to "reveal clicked block in the editor" — a shippable win on
existing plumbing that validates the event path before the menu investment.

### 4.1 Components and ownership

- **`ContextMenuController`** (`src/lib/routes/context-menu-controller.svelte.ts`)
  — single owner of menu state, following the injected-deps pattern of
  `PreviewEventController`/`EditorPreviewSyncController` (clock, client,
  editor/buffer accessors injected; zero DOM/`node:*` imports; tests in
  `tests/platform/` with fakes, matching `preview-event-controller.test.ts`)
  **[spike-verified pattern]**.
- **`ContextMenu.svelte`** (`src/lib/components/`) — presentational; renders
  absolutely positioned over the preview pane; ARIA `role="menu"`, arrow-key
  navigation, `Escape` closes, focus returns to the previously focused
  element. Reuses the app token system (no hardcoded colors).
- **Wiring in `+page.svelte`:** subscribe via a second `client.on()` listener
  owned by the controller; the existing `PreviewEventController.handleEvent`
  switch stays untouched.

### 4.2 Opening, positioning, dismissal

**Open** on `contextMenuRequested` (mouse) — and on **`Shift+F10` / the menu
key** when preview-originated focus context exists: the controller keeps the
last activated target (from `elementActivated` / the last menu open) and
opens the menu for it at its stored anchor point. This satisfies the UX
contract's explicit "context menus reachable via keyboard menu key /
`Shift+F10`" requirement — the outline "Go to source" flow is *not* an
acceptable substitute (it jumps to a line; it cannot invoke Bold at a block).
The contract's context-menu section gains a matching update in §8.

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
| selection (single block) | Bold, Italic, Strikethrough, Inline code, Make link…, Edit block in editor |
| selection (cross-block) | Copy, Edit in editor (jump to start) |
| block | Edit this block (Tier 1 entry point; disabled until PR 5), Insert page break before/after, Go to source |
| marker (`@page`/`@section`/… wrapper or break) | Edit marker…, Go to source |

**Destructive actions are excluded from v1.** "Remove marker" was cut: with
no editor mounted, `buffer.edit()` commits have **no undo** (§5.6), and a
destructive single-click affordance with no undo fails the safety bar. It
returns when a buffer-level undo story exists (or as an editor-mounted-only
item).

Every item ultimately produces a **range patch**
`{chapter, range, expected, replacement}` or an **editor jump**; both are
executed by the commit engine (§5.4) — the menu itself never touches files.

### 4.4 Resolving action parameters

- **Image:** find the markdown image token inside the block slice by matching
  the rendered `src`/`alt` attributes (`registerImageRule` records refs but
  does not rewrite `src` **[spike-verified]**, so attribute text matches
  author text). Width / position edits rewrite the `{…}` attrs suffix. The
  attrs-string builder currently lives **inlined** in `applyImage`
  (`toolbar-actions.ts`) — it must be **extracted into a shared pure helper**
  first and used by both call sites; `applyImage` itself inserts a *new*
  image at the cursor and is not directly reusable for editing an existing
  token. If the block slice contains a raw HTML `<img>` instead, offer only
  "Edit block in editor".
- **Link:** same approach on `[text](href)`. Two degrade cases, both
  explicit: reference-style links (`[text][id]`) — definition line is
  unrecoverable (§2.6); and **linkified bare URLs** (`linkify: true` renders
  plain URLs as anchors with no bracket syntax in the source at all) — every
  link action except "Copy link target" (which reads only the rendered
  `href`) degrades to "Edit block in editor" when the block slice contains no
  `[…](…)` for the href.
- **Selection formatting:** normalize the selected string — reverse the
  typographer substitutions **and collapse whitespace runs** — then search
  the block's buffer slice (equally whitespace-normalized, mapping normalized
  indices back to raw offsets) for a **unique** occurrence. Unique → wrap
  range (`**…**` etc.) via the commit engine. Zero or multiple matches → item
  disabled with tooltip "Couldn't locate this text uniquely in the source —
  open the editor".
  - The whitespace collapse is required, not optional: authors hard-wrap
    prose, so a selection spanning a source line break renders with a space
    where the source has `\n` — a literal search would fail on the *common*
    case, not an edge case.
  - The reverse map must cover the **full** `replacements.mjs` +
    `smartquotes.mjs` rule set, not just quotes/dashes/ellipsis:
    `©`→`(c)`, `™`→`(tm)`, `®`→`(r)`, `±`→`+-`, collapsed punctuation runs
    (`…`→`....` variants, `!!!`/`???`/`,` collapses — these are one-to-many;
    treat any occurrence as "ambiguous, disable"), `“”`→`"`, `‘’`→`'`,
    `–`→`--`, `—`→`---`. (No NBSP rule exists in this configuration — an
    earlier draft listed one in error.) Unit-test fixtures cover each.
  - **Selections containing footnote reference markers** (`<sup
    class="footnote-ref">` renders a label with no literal source
    correspondence to `[^id]`) will fail the unique-match search. This is an
    accepted degrade — do NOT "fix" it with fuzzy matching; document it in
    the disabled-reason tooltip path.

### 4.5 Settings

New `AppSettings` field (`preview.contextMenu: boolean`, default `true` —
the menu is an explicit-invocation affordance, not seamless WYSIWYG, so the
UX contract's opt-in rule for the latter does not apply) added to the
`$lib/platform` DTO + `DEFAULT_SETTINGS`; read reactively via
`useSettings().current`; imperative teardown on toggle goes through the
existing `onSettingsChange()` + `settingsChangeGuard()` channel. `$effect` is
banned by eslint in this package — the controller uses the injected-callback
pattern instead **[spike-verified rule text]**.

### 4.6 Gotchas (Phase 2)

- **The editor is `{#if}`-UNMOUNTED, not hidden, whenever the pane is closed**
  (`editorPaneOpen` derived state), and `MarkdownEditor` may never have been
  lazy-imported at all in a preview-only session **[spike-verified]**. "No
  live CodeMirror view" is the *common* case. Menu actions must not assume
  `editorRef`; the commit engine (§5.4) owns both paths.
- **Chapter identity is not a string suffix match.** `data-chapter-src`
  values are canonical forward-slash project-relative ids
  (`canonicalChapterId`); `buffer.filePath` is an absolute OS-native path. The
  codebase already solved this join once — the separator-aware absolute-path
  construction in `EditorPreviewSyncController.followChapterInEditor`
  (`dir + sep + chapter.replaceAll("/", sep)`) — and that logic must be
  **extracted to a shared helper** used by both the sync controller and the
  commit engine, compared with `===` against `buffer.filePath`. A naive
  `endsWith` comparison is wrong on Windows (separators never match) and
  ambiguous on same-named files.
- **`editorChapter`'s basename fallback:** `+page.svelte` derives the open
  chapter id relative to the project dir but falls back to a bare basename
  for files outside it. The commit engine must treat "buffer file is outside
  the project dir" as not-the-target (degrade), never match by basename.
- **Stale targets after a splice:** between menu open and action click, a
  save can re-render and splice the chapter. The menu closes on
  `renderingComplete` (§4.2) and the commit engine re-validates (§5.4); both
  guards are required, not either/or.
- **Right-click during an in-flight render** (`rendering()` true): ignore
  `contextMenuRequested` while a render is in flight (same guard the sync
  controller uses).
- **Touch:** long-press synthesis is deferred with a tracking issue (§0
  non-goals; UX contract long-press requirement applies when touch layouts
  get the menu).

---

## 5. Phase 3 (PR 5) — Tier 1: click-to-edit block overlay

### 5.1 UX

- Entry: **"Edit this block" from the context menu only** (v1 decision —
  double-click entry was considered and rejected for v1: it conflicts with
  text-selection habits and adds a second activation path before the first
  has user feedback; revisit with usage data).
- An overlay editor opens positioned over the block's **first fragment rect**
  (from `getRectsFor`), sized to it (min-height clamp; height capped to the
  visible pane with internal scroll — a split block can span 9+ pages
  **[spike-verified]**). All fragments of the block get `setEditMask` so the
  stale rendered text doesn't show behind/beside the overlay.
- **The book document's scroll is locked while an overlay is open** (part of
  `setEditMask`; restored on close). Rationale: the overlay is positioned in
  SPA coordinates from a rect snapshot, the book scrolls independently inside
  its iframe, and the only scroll signal crossing the bridge is a
  150 ms-debounced line event — an unlocked scroll silently drifts the
  overlay over unrelated content, an authoring-trust hazard. Scroll-lock is
  the simple, complete fix; live reposition-on-scroll was rejected as
  machinery v1 doesn't need.
- The overlay contains the block's **source markdown** (buffer slice), not
  its rendered text.
- Commit on `Ctrl/Cmd+Enter` or blur; cancel on `Escape`. Commit dispatches
  the patch through the commit engine, closes the overlay, unmasks, unlocks
  scroll, and lets the settled-write → chapter-splice pipeline refresh the
  pages; the overlay does not wait for it.

### 5.2 Editor widget

A minimal **CodeMirror 6 instance** (already a dependency; markdown language
+ the existing theme tokens, no gutters, no lint). This does not violate
`MarkdownEditor.svelte`'s "ONE EditorView" doctrine — that rule (UX review
M8) forbids *recreating the main editor's view on file switch*; it is not an
app-wide singleton rule. The overlay's instance is an **input widget only**:
its content is discarded on cancel, and on commit the mutation flows through
the commit engine exactly like a menu action — the widget never writes
anything itself. (A plain `<textarea>` was considered and rejected: CM gives
markdown highlighting, consistent keymaps, and IME handling for free, at zero
dependency cost.)

### 5.3 Bridge additions (protocol v5, shipped in this PR)

- `getRectsFor({ ref } | { chapter, range })` — all fragment rects for one
  logical block (fragments share one `data-ref` **[spike-verified]**), each
  `{ top, left, width, height, page }`. Resolution by `{chapter, range}` is
  the post-splice fallback (fresh DOM has fresh `data-ref`s).
- `setEditMask({ ref, masked })` — toggles a masking class on every fragment
  of the block AND applies/removes the scroll lock (`overflow: hidden` on the
  book document element).
- `getProtocolVersion()` → **5**.

### 5.4 The commit engine (shared by menu actions and overlay)

One module (`src/lib/editor/commit-engine.ts` — noun-phrase name matching
`toolbar-actions.ts`/`buffer-state.svelte.ts`; pure logic + injected seams;
unit-tested with fakes) implementing `commitRangePatch({ chapter, range,
expected, replacement })`:

```
0. GATE — refuse unless ALL hold (else degrade to "Open in editor at line range[0]+1"):
   a. target chapter resolves inside the project dir (shared path-join helper, §4.6)
   b. no render in flight; the menu/overlay was opened after the last
      renderingComplete (both already enforced by §4.2 dismissal — re-checked here)
   c. the target chapter's buffer, once loaded, is CLEAN
      (buffer.content === buffer.diskContent)
1. ENSURE the buffer + editor state hold `chapter`, via the app's EXISTING
   selection machinery — not a reimplementation:
   - absPath = chapterPath(currentDir, chapter)        // shared helper
   - if buffer.filePath === absPath → proceed
   - else → await selectEditorFile(absPath)            // the +page.svelte flow:
     // it already owns flush-before-switch, the load-epoch/in-flight
     // guards, and the load()+editorRef.switchFile() pairing that keeps the
     // live CodeMirror doc in sync with buffer.filePath. Calling load()
     // directly is FORBIDDEN here: every existing call site pairs load()
     // with switchFile(), and skipping that pairing dispatches offsets
     // computed for chapter B into a view still showing chapter A.
   - if flush-inside-selection rejects (external conflict on the OUTGOING
     file), abort with a DISTINCT message naming that file ("Couldn't save
     pending changes to <A> — resolve that first"), not the generic
     block-changed toast.
   - re-check gate (c) after the switch.
2. RESOLVE offsets: starts = buildLineStarts(buffer.content);
   [from, to) = charRange(buffer.content, starts, range)   // throws on bad range
3. VALIDATE: buffer.content.slice(from, to) === expected
   - `expected` was captured at menu/overlay open FROM BUFFER CONTENT, and
     gate (c) held at open time too — so expected reflects the same content
     the preview DOM was rendered from. The clean gate is what makes the
     slice check meaningful; without it the check validates only "nothing
     changed since open", not "the mapping was right at open" (see gotchas).
4. APPLY:
   - if the mounted editor's applied file is absPath (ask the EDITOR —
     a new `MarkdownEditor.getAppliedPath()` export or equivalent — never
     infer from buffer.filePath alone):
       editorRef.applyRangeEdit(from, to, replacement)
       // view transaction → onChange → buffer.edit → shared undo history
   - else:
       buffer.edit(content.slice(0, from) + replacement + content.slice(to))
5. FLUSH: await buffer.flush()
   // Discrete committed actions must not sit behind the autosave debounce —
   // which is settings.editor.autoSaveDelay, DEFAULT 2500 ms (the 500 ms in
   // EditorBuffer's class fallback is never used by the desktop app). An
   // immediate flush gives the ~1 s preview refresh the UX story promises.
6. The existing pipeline takes over: Platform.writeFile → /api/fs/write-file
   → notifyPreviewSettledWrite → rebuild → chapter splice. (No new plumbing —
   [spike-verified] this is the live path today.)
```

New `MarkdownEditor.svelte` exports (additive; the dispatch pattern is
already how `toolbar-actions.ts` works **[spike-verified]**):

```ts
export function applyRangeEdit(from: number, to: number, insert: string): void {
  if (!view) return;
  view.dispatch({ changes: { from, to, insert } });
}
export function getAppliedPath(): string | null { return appliedPath; }
```

`+page.svelte`'s hand-written `editorRef` structural type must gain both
members (it is not derived from the component's exports), and the commit
engine's `selectEditorFile` dependency is injected the same way the sync
controller receives it.

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

### 5.6 Gotchas (Phase 3)

- **The clean-buffer gate is load-bearing — do not weaken it.** The failure
  it prevents: preview DOM is rendered from *saved* content; if the buffer is
  dirty (author typed in the editor pane), DOM line ranges index the OLD
  content while offsets resolve against the NEW — `expected` gets captured
  from the misaligned slice, the commit-time equality check passes trivially,
  and the patch lands on the wrong text. With repeated identical blocks
  (boilerplate captions, disclaimers) even a human eyeball check passes. No
  slice comparison can detect this; only the gate can. Dirty chapter →
  every DOM-anchored action degrades to "open in editor". (The clean-gate +
  close-menu-on-renderingComplete pair also covers the save-just-landed,
  splice-in-flight window.)
- **Do NOT patch the paginated DOM optimistically.** The natural idea —
  splice edited HTML into the live page for instant feedback — fails
  *silently*: `.pagedjs_page_content` is a live CSS multicol container
  (`column-fill: auto` + fixed column width, baked into paged.js), so
  overflow doesn't visibly overlap; it spills into **invisible columns
  thousands of pixels to the side** (`getClientRects().length > 1`)
  **[spike-verified]**. v1 renders no optimistic patch; if ever added, the
  guard is a `getClientRects().length` / measured-height check, not
  visual-overlap detection.
- **Paged.js never corrects a mutation** — no observer, no re-layout after
  initial pagination **[spike-verified]**. Overlay-touched DOM (mask
  classes, scroll lock) must be purely cosmetic and reversible.
- **Splice can replace the DOM under an open overlay.** On
  `renderingComplete` the overlay re-resolves via `getRectsFor` with the
  `{chapter, range}` fallback (fresh `data-ref`s) or closes with a toast
  ("This section changed — reopen to edit").
- **Undo asymmetry:** with the editor mounted, a commit is one undoable
  CodeMirror transaction. Without it, `buffer.edit()` has no undo (no view).
  This is why destructive menu items are cut from v1 (§4.3); for
  content-editing commits the overlay itself shows the prior text, making
  accidental loss recoverable by re-editing. Documented in the user guide.
- **IME / composition:** commit-on-blur must not fire mid-composition
  (`compositionend` guard in the overlay).
- **Focus trap:** the overlay traps Tab within itself and restores focus on
  close — same discipline as the existing dialogs (`dialog-shell.css`
  consumers).

---

## 6. Phase 4 — Tier 2: editor-pane live preview (deferred; separately planned)

Obsidian-style live preview in the **editor pane** — CodeMirror 6
decorations over the Lezer markdown tree; the document stays byte-exact
markdown, so round-trip risk is zero by construction. Per the UX contract it
is **opt-in, never the default**. It is deliberately *not* specified here:
it gets its own tracking issue and its own plan after Tiers 0–1 ship (the
contract requires PROPOSED features to be issue-linked before
implementation). Nothing in Phases 0–3 blocks or prejudges it.

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

Phase 0/1 are browser-safe by construction (pure lib rule; bridge scripts are
plain DOM). Phases 2–3 land desktop-gated (`isDesktop()`), because the write
stack (buffer → `Platform.writeFile` → settled-write hook) is
Electron-backed today. The controller seams take the platform through
injection, so a future FSA-backed web write path slots in per
`docs/pwa-webadapter-plan.md` without redesign.

### 7.3 Performance

- Annotation: O(tokens) attribute writes; verify `rerender-ci` (≤ 1000 ms
  strict) and `perf-gate` before/after Phase 0.
- New bridge calls are on-demand (right-click / overlay open), never per
  scroll frame.
- The overlay's CM instance mounts on open and destroys on close — no
  standing cost.

### 7.4 Test plan

| Layer | Where it runs | Tests |
|---|---|---|
| lib unit (bun, CI) | `packages/cli` | `source-range` rule tests (fixtures: nested structures, all markers incl. `@continue`, fences, tables, footnotes, attrs, LF/CRLF/CR, EOF-no-newline, last-list-item, marker-adjacent); `markdown-it-paged` meta-threading tests; assertion that `data-source-line` output is unchanged |
| script tests (node, CI) | `packages/desktop/tests/` (note: these node harnesses live in the **desktop** package even though they test the cli-owned scripts) | `pagedjs-interface.test.mjs`: `getContextTargetAt` resolution (image/link/selection/block/fence-`<code>` case), protocol bump; PR 5 adds `getRectsFor` fragment grouping + `setEditMask`; `preview-bridge` event forwarding; `preview-shell-regression` unchanged |
| desktop unit (bun + fakes, CI) | `tests/platform/` | `context-menu-controller.test.ts` (open/dismiss matrix of §4.2, keyboard open, in-flight-render guard), `commit-engine.test.ts` (every §5.4 branch: gate refusals, same-file, cross-file via injected selectEditorFile fake, flush-reject messaging, mismatch abort, editor-mounted vs not, clean-gate scenarios incl. the dirty-buffer misalignment repro) |
| desktop unit (happy-dom, CI) | `tests/platform/` | bridge round-trip for the new event/commands via the `preview-client.test.ts` pattern |
| integration (manual — **not CI-gated**; `run-ui.mjs` drives a locally packaged app) | `tests/integration/` | right-click → menu renders → bold a selection → file content asserted; overlay edit → file content asserted. The CI regression gate is the fake-based unit layer above — review PRs 3/5 with that in mind |
| perf (CI) | desktop | `rerender-ci`, `perf-gate` unchanged budgets |

### 7.5 Sequencing and sizing

| Step | Contents | Size |
|---|---|---|
| **PR 0** | Wire `elementActivated` → reveal clicked block in editor (one controller case + tests). Zero protocol/lib change; validates the event path end-to-end | XS |
| PR 1 | Phase 0 (lib annotation + `meta` threading + `@continue` fix + tests) | S–M |
| PR 2 | Phase 1 (bridge v4: `getContextTargetAt` + `contextMenuRequested` + client typings + script tests) | S–M |
| PR 3 | Phase 2 (menu controller + component + keyboard open + image/link/block actions + settings). **Opens with the Electron `preventDefault` go/no-go check (§3.5)** | M–L |
| PR 4 | Phase 2 (selection formatting: normalization + reverse map + unique match) | S–M |
| PR 5 | Phase 3 (protocol v5 commands + commit engine + `applyRangeEdit`/`getAppliedPath` + overlay) | L |
| PR 6 | Phase 4 — separately planned, own issue | — |

Dependencies: PR 0 independent; PR 1 → PR 2 → PR 3 linear; PR 4 and PR 5
depend on PR 3, not on each other.

### 7.6 Open decisions

Resolved in this revision (previously listed as open): raw-HTML annotation
(**stays unannotated**, §2.6); overlay entry (**menu-only**, §5.1);
destructive actions (**cut from v1**, §4.3). Remaining:

1. Whether PR 0's click-to-reveal should be gated behind the same
   `preview.contextMenu` setting or always-on (leaning always-on: it is
   navigation, not mutation).
2. Exact visual treatment of `setEditMask` (dim vs blank) — a design call for
   PR 5 review with screenshots.

---

## 8. Documentation and contract updates shipped with the work

- `docs/ux-design-contract.md`: new sections for the preview context menu
  (including the `Shift+F10` keyboard model and the touch-long-press deferral
  with its tracking issue) and the block overlay, status per phase. Per the
  contract's own governance, these land as PRs against the contract document
  alongside the feature PRs.
- **New ADR** (`docs/adr/000N-inline-editing-source-ranges.md`): documents
  `data-source-range` semantics (token.map verbatim), the `token.meta.line`
  threading, and bridge protocol v4/v5. Note: the contract binds
  bridge-protocol changes to ADR 0005, which is referenced throughout but not
  present in this checkout — the new ADR records the v3→v5 delta
  self-containedly rather than amending a missing file.
- `CLAUDE.md` §6 note: `markdown-it-paged` now threads marker line meta.
- `CHANGELOG.md` (Unreleased) entries per PR.
- `packages/desktop/README.md`: context menu / inline editing section.
- `examples/gutterpress-user-guide/05-plugins.md`: the "Source map" row gains
  the `data-source-range` attribute next to `data-source-line`.
- The analysis doc (`docs/reviews/inline-editing-analysis-2026-08-04.md`)
  gains a pointer here; its §6.1 char-offset recommendation is superseded by
  the line-range design (rationale: §1 principle 4).
