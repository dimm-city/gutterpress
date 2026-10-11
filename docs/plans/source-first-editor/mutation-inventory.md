# SFE-P0a Lane B — Preview mutation caller and protocol inventory

> Produced by run SFE-P0a, Lane B ("Editor and mutation characterization").
> This is the search-proof checklist the P4a/P4b deletion runs will use to
> prove every caller and protocol identifier listed below has moved or
> disappeared (D15: every deletion claim requires search proof, dependency
> proof, and passing behavior tests). Every exact identifier and file:line
> below was verified against the tree at this run's baseline SHA by direct
> `Grep`/`Read`, not recalled from memory or PR 158.

## 1. Preview-originated source-mutation protocol messages

The desktop and the paginated preview communicate across two `postMessage`
boundaries: SPA host ↔ shell iframe (`preview-shell.js`) ↔ book iframe
(`preview-bridge.js` relaying to/from `preview-interface.js`, the book
document's `window.previewAPI`). Two distinct mechanisms carry protocol
traffic:

- **Commands** (`{ type: "gutterpress:cmd", id, cmd, args }`): host → book,
  answered with `{ type: "gutterpress:reply", id, ok, result | error }`.
- **Events** (`{ type: "gutterpress:event", name, detail }`): book → host,
  dispatched as `CustomEvent`s inside the book document and forwarded
  verbatim by `preview-bridge.js`.

### 1.1 Commands (host → book)

| Command | Payload | Produced (called) | Consumed (implemented) |
|---|---|---|---|
| `beginBlockEdit` | `{ chapter: string, range: [number, number], text: string, caret?: {x,y} }` → `Promise<{ ok: boolean, reason?: string }>` | `PreviewClient.beginBlockEdit()` (`packages/desktop/src/lib/preview-client.ts:340-347`); called from `InlineEditController.show()` (`packages/desktop/src/lib/routes/inline-edit-controller.svelte.ts:266-276`) | `previewAPI.beginBlockEdit` → `startEdit(spec)` (`packages/cli/src/assets/preview/scripts/preview-interface.js:1103-1106`, `919-964`) |
| `endBlockEdit` | `{ commit: boolean }` → `Promise<{ ended: boolean, text: string \| null }>` | `PreviewClient.endBlockEdit()` (`preview-client.ts:358-360`); called from `InlineEditController.endActive()` (`inline-edit-controller.svelte.ts:298-314`) | `previewAPI.endBlockEdit` → `finishEdit(commit, false)` (`preview-interface.js:1114-1117`, `810-843`) |

Both commands are generic `gutterpress:cmd` dispatches through
`preview-bridge.js`'s single `call(cmd, args)` function
(`packages/cli/src/assets/preview/scripts/preview-bridge.js:35-45`), which is
identical for every command name (`api[cmd].apply(api, args)`) — there is no
block-edit-specific dispatch code in the bridge itself.

`preview-shell.js`'s "transparent bridge relay" (lines 29-42) additionally
special-cases **only** `cmd === 'beginBlockEdit'` while relaying a host
command down to the active book iframe: it calls `active.focus()` on the
shell's own iframe element immediately after forwarding, to hand keyboard
focus the rest of the way down into the book document (a `postMessage`
carries no user activation the book iframe could focus itself with). No
other command gets this treatment. **This exact special case had zero
existing test coverage** — see §4.3.

### 1.2 Events (book → host)

| Event | Payload (`detail`) | Produced (dispatched) | Consumed (listened) |
|---|---|---|---|
| `blockEditRequested` | `{ chapter, range, x, y, via: "dblclick" }` | Double-click on a `[data-source-range]` element while no edit is open (`preview-interface.js:1406-1416`) | `InlineEditController.handleEvent()` case `"blockEditRequested"` (`inline-edit-controller.svelte.ts:165-180`) → calls `show()` |
| `blockEditFinished` | `{ text: string, commit: boolean, chapter, range }` | `finishEdit(commit, notify=true)` on an author-initiated end (Escape / Cmd-Ctrl-Enter / pointer-down outside the box) (`preview-interface.js:810-843`, dispatch at line 836) | `InlineEditController.handleEvent()` case `"blockEditFinished"` (`inline-edit-controller.svelte.ts:181-189`) → commits or discards |
| `blockEditStateChanged` | `{ open: boolean }` | `finishEdit()` (always, both commit and cancel paths — line 841) and `startEdit()` (line 962), i.e. on every open/close, including SPA-initiated ends | `preview-shell.js`'s own `message` listener (lines 49-54): tracks `blockEditOpen` and gates `armPendingSwap()` (line 280) so a hot-reload swap never destroys a live in-flow edit; also relayed further up to the host but the host (`+page.svelte`/`PreviewClient`) has no listener keyed on this specific event name — it only matters to the shell |

All three events cross the book→bridge boundary via
`window.addEventListener('blockEditRequested'/'blockEditFinished'/'blockEditStateChanged', ...)`
in `preview-bridge.js:91-99`, which `post()`s each one up as a
`gutterpress:event` message. `preview-shell.js` relays every book-iframe
event it doesn't specifically consume straight up to `window.parent` (line
65), so all three eventually reach `PreviewClient.on()` listeners
(`preview-client.ts:263-266`) on the SPA side, typed in
`PreviewEvent["name"]` (`preview-client.ts:16-18`) and `PreviewEvent["detail"]`
(`preview-client.ts:66-71`).

### 1.3 The contenteditable authoring path

`preview-interface.js`'s in-flow editing block (lines 628-964) is the only
place `contenteditable` is set for authoring purposes in the whole preview:
`startEdit()` sets `el.setAttribute('contenteditable', 'plaintext-only')`
(line 939) and `finishEdit()` removes it (line 823). This is a book-document
DOM attribute, not a protocol message, but it is the literal "preview
mutation" surface D8/P4a's "in-flow `contenteditable`" language refers to —
grep target: `contenteditable` in `preview-interface.js`.

### 1.4 Non-block-edit mutation traffic (context-menu commits)

`ContextMenuController` never uses `beginBlockEdit`/`endBlockEdit` for its
own mutations (image/link/marker/block-break/selection-format commits) — it
calls `CommitEngine.commitRangePatch()` directly (see §2 below), which writes
through the desktop's own buffer/CodeMirror path, not through the preview
document at all. The ONLY context-menu item that reaches the preview's
block-edit protocol is `"block-edit"` ("Edit this block"), which calls
`deps.openInlineEdit()` → `InlineEditController.show()` →
`beginBlockEdit`/`endBlockEdit` like the double-click path
(`context-menu-controller.svelte.ts:693-702`).

### 1.5 Context-menu protocol identifiers and source-mutation helpers

> Added in repair round 1: §1.1–§1.4 as originally written omitted the
> context-menu path's own protocol identifiers and its dedicated mutation
> helper module. This section closes that gap so P4b has search-proof
> identifiers for the whole context-menu source-mutation surface, not just
> the fact that it bypasses `beginBlockEdit`/`endBlockEdit` (§1.4).
>
> **Repair round 2 correction:** round 1's `getContextTargetAt` row claimed
> `ContextMenuController` calls it to resolve the pointer target. That was
> false — verified by `grep -rn "getContextTargetAt" packages/desktop/src`,
> which finds the method definition and doc-comment mentions only, no call
> site. The table row and the paragraph below it were corrected to state the
> host-side wrapper is TEST-ONLY (no production caller) and that
> `ContextMenuController` actually reads the payload from
> `contextMenuRequested`'s `detail`, built by the book document's own
> in-document `api.getContextTargetAt()` call.

The context-menu path reaches the preview through its OWN command/event pair
— neither is `beginBlockEdit`/`endBlockEdit` — and its source mutations run
through a dedicated pure-helper module neither table above named:

| Identifier | Kind | Produced (implemented/dispatched) | Consumed (called/listened) |
|---|---|---|---|
| `getContextTargetAt` | command (host → book) | `previewAPI.getContextTargetAt` (`packages/cli/src/assets/preview/scripts/preview-interface.js:1092`) | `PreviewClient.getContextTargetAt()` (`packages/desktop/src/lib/preview-client.ts:325-326`) has **no production caller** — `grep -rn "getContextTargetAt" packages/desktop/src` returns only the method definition, three doc-comment mentions (`preview-client.ts:84,96,108`), and two other doc comments (`commit-engine.ts:129`, `context-menu-controller.svelte.ts:147`); `ContextMenuController` never calls it. Per §2's classification scheme this wrapper is **TEST-ONLY**: exercised by `packages/desktop/tests/platform/preview-client.test.ts:174-207` and by the non-CI-gated `packages/desktop/tests/integration/editor-opens-with-content.pw.mjs:421` (via `window.__ask`), and nowhere else. |
| `contextMenuRequested` | event (book → host) | Dispatched from `preview-interface.js:1394` (mouse) and `:1454` (keyboard), sharing one payload builder; relayed by `preview-bridge.js:82-83` (`window.addEventListener('contextMenuRequested', ...)` → `post({ type: 'gutterpress:event', name: 'contextMenuRequested', detail: e.detail })`) | `ContextMenuController.handleEvent()` case `"contextMenuRequested"` (`context-menu-controller.svelte.ts:206`); typed in `PreviewEvent["name"]` (`preview-client.ts:15`), `detail` shape documented at `preview-client.ts:44-64` (carries `image.source`/`link.source`/`selection` as `InlineSourceToken`(s) — the mutation payload) |

`ContextMenuController` obtains its target payload from `contextMenuRequested`'s
`detail`, not by calling the host-side `getContextTargetAt` command. That
`detail` is assembled entirely inside the book document: `preview-interface.js`
calls its OWN in-document `api.getContextTargetAt(...)` at lines 1388 (mouse
path) and 1449 (keyboard path) — a same-document function call, not a
`gutterpress:cmd` round trip — and passes the resulting payload straight into
the event it dispatches. So the book-side implementation
(`previewAPI.getContextTargetAt`) is live and load-bearing; the host-side
command wrapper (`PreviewClient.getContextTargetAt()` /
`this.call("getContextTargetAt", [point])`) is not reachable from any feature
path today. **Consequence for P4b:** `PreviewClient.getContextTargetAt()` is a
deletion candidate in its own right, independent of whether the read-only
context menu survives past P4 — its removal would need to update or drop only
the two test files named above, not any production caller.

Both identifiers cross the same book→bridge→shell→host relay path §1.2
describes for the block-edit events; they are simply a different command/event
pair on it. **They are read/target-resolution messages, not mutations
themselves**, and `contextMenuRequested` (and the book-side
`getContextTargetAt` it depends on) may survive past P4 as part of the
read-only context menu D8 keeps (navigation, selection/copy, open link/image,
source reveal) — do not delete it merely because this section names it; the
deletion-ledger's `Preview mutation protocol messages` baseline
(`deletion-ledger.md:20`) deliberately does not count them (see the note added
there in this repair round) for the same reason. The host-side
`PreviewClient.getContextTargetAt()` wrapper is a separate matter (see above)
and is not protected by this paragraph.

`packages/desktop/src/lib/editor/context-menu-actions.ts` is the pure
source-token helper module every context-menu source mutation runs through —
this IS the deletion ledger's P4b row "Preview image/link rewrite scanners |
Context-menu source mutations | Shared editor commands | P4b |
command/scanner search." Its full export surface, all consumed at
`context-menu-controller.svelte.ts` (its only production consumer — confirmed
by `grep -rn "context-menu-actions" packages/desktop/src`, which returns only
that file's import block at lines 27-36 and its own header-comment mention):

| Export | Consumer call site(s) in `context-menu-controller.svelte.ts` |
|---|---|
| `findImageToken` | line 443 |
| `findImageWrapper` | line 449 |
| `resolveLinkToken` | line 557 |
| `rewriteImageToken` | line 511 |
| `rewriteLinkToken` | line 574 |
| `makeLinkToken` | line 823 |
| `spliceToken` | lines 514, 540, 579, 801, 819 |
| `LinkResolution` (type) | import only, line 33 |
| `ImageTokenMatch` / `LinkTokenMatch` (exported types) | not imported by name outside `context-menu-actions.ts` itself — consumed structurally through the functions above, which return/accept them |

**Explicitly NOT a P4b deletion target — SHARED-AND-SURVIVING:**
`packages/desktop/src/lib/editor/image-classes.ts` is imported by
`context-menu-controller.svelte.ts` alongside the helpers above (its own
import block, separate from `context-menu-actions.ts`'s), but it is not part
of the context-menu-only surface: it is also consumed by
`EditorToolbar.svelte:32`, `ImagePropertiesDialog.svelte:12`,
`toolbar-actions.ts:27`, and `+page.svelte:40` — rich-editor toolbar/dialog
surfaces that have nothing to do with the preview's context menu and are not
scheduled for deletion. A P4b executor must not delete or move
`image-classes.ts` merely because `context-menu-controller.svelte.ts` also
imports it; only the context-menu-only helpers in `context-menu-actions.ts`
above are this run's P4b target.

## 2. Production callers of `InlineEditController` and `CommitEngine`

| Symbol | Caller | file:line | Classification |
|---|---|---|---|
| `InlineEditController` (constructor) | `+page.svelte` | `packages/desktop/src/routes/+page.svelte:1916-1925` | **feature** — the app's one instance, wired to the live preview client, buffer, and toasts |
| `InlineEditController` (import) | `+page.svelte` | `+page.svelte:37` | feature |
| `inlineEdit.subscribe(c)` | `+page.svelte` | `+page.svelte:2023` | feature — wires the controller to the live `PreviewClient` event stream inside the client-attach effect |
| `inlineEdit.show(...)` | `ContextMenuController`'s injected `openInlineEdit` dep, itself called from `+page.svelte`'s `contextMenu` construction | `+page.svelte:1957` (the dep) → `context-menu-controller.svelte.ts:699` (the "block-edit" item's `run()`) | feature — the context menu's "Edit this block" entry point |
| `inlineEdit.endActive(true)` | `+page.svelte`, four call sites, all "opening a dialog commits the in-flow edit first" | `+page.svelte:971`, `994`, `2760`, `2761` | feature — GitHub-open, new-project-wizard, and (per the two earlier sites) other modal-opening flows that must not leave a live in-flow edit under a dialog |
| `CommitEngine` (constructor) | `+page.svelte` | `+page.svelte:1838-1848` | feature — the app's one instance, injected into both `InlineEditController` and `ContextMenuController` |
| `CommitEngine` (import) | `+page.svelte`, `context-menu-controller.svelte.ts` (type-only), `inline-edit-controller.svelte.ts` (type-only) | `+page.svelte:41`; `context-menu-controller.svelte.ts:24`; `inline-edit-controller.svelte.ts:26` | feature (the two `.svelte.ts` files only import the *type*, not a value — they receive the instance via `deps.commitEngine`) |
| `commitEngine.commitRangePatch(...)` | `InlineEditController.commit()` (private) | `inline-edit-controller.svelte.ts:331-337` | feature — the in-flow edit's write path |
| `commitEngine.commitRangePatch(...)` | `ContextMenuController.commit()` (private) | `context-menu-controller.svelte.ts:416-422` | feature — every context-menu mutation (image properties, image unwrap, link edit, marker edit, page-marker edit, block-break-before/after, selection format bold/italic/strike/code, make-link) funnels through this one private method |
| `commitEngine.generation` (read) | `ContextMenuController.buildItems()`, `.singleBlockSelectionItems()` | `context-menu-controller.svelte.ts:363`, `769` | feature — captured at menu-open time as `expectedGeneration` |
| `commitEngine.noteRenderingComplete()` | `InlineEditController.handleEvent()` case `"renderingComplete"`; `ContextMenuController.handleEvent()` case `"renderingComplete"` | `inline-edit-controller.svelte.ts:198`; `context-menu-controller.svelte.ts:213` | feature — both controllers bump the SAME engine's generation counter on every render; the double-bump when both are live is a documented no-op (see the comment at `inline-edit-controller.svelte.ts:190-197`) |

No dead or test-only production callers were found — every reference to
`InlineEditController`/`CommitEngine` outside `packages/desktop/tests/**` is
inside `+page.svelte`, `context-menu-controller.svelte.ts`, or the two
modules' own source files. There is no second desktop entry point, no
Storybook/playground harness, and no CLI/`packages/cli` reference to either
symbol (grep confirmed zero hits outside `packages/desktop`).

**P4 deletion consequence:** P4a ("Remove in-flow preview editing", Lane B —
"Delete `InlineEditController` and its wiring") must remove every row above
except the `CommitEngine` rows, which move to P4b. `ContextMenuController`'s
`"block-edit"` item (`context-menu-controller.svelte.ts:693-702`) and the four
`endActive(true)` call sites in `+page.svelte` are the wiring P4a's "Remove
preview edit state and UI affordances" must also touch or remove, since they
have no meaning once `InlineEditController` is gone.

## 3. `CommitEngine` validation gates and which tests pin them

`CommitEngine.commitRangePatch()` (`packages/desktop/src/lib/editor/commit-engine.ts:170-301`)
runs, in order (comments in source label these GATE 0a/0b/0c and Steps 1-5):

| Gate / step | What it checks | Failure reason | Pinned by (`commit-engine.test.ts`) |
|---|---|---|---|
| GATE 0a — path resolution | project open; `isSafeChapterId(chapter)` before any join | `no-project`, `unsafe-chapter-path` | `describe("GATE 0a — path resolution")`: "refuses when no project is open", `test.each` of 7 unsafe chapter ids, "accepts a nested-but-safe chapter id" |
| GATE 0b — render-in-flight / generation | no render in flight; `expectedGeneration === this.gen` | `render-in-flight`, `stale-generation` | `describe("GATE 0b")`: "refuses while a render is in flight", "refuses when expectedGeneration is stale", "accepts a current expectedGeneration" |
| Step 1 — ensure buffer holds the target chapter | same-chapter fast path vs. cross-chapter `selectEditorFile()`; flushes a dirty OUTGOING file first | `flush-outgoing-failed`, `load-failed` | `describe("Step 1")`: cross-chapter switch, flush-outgoing-failed (distinct message names the file), clean/non-pending skips flush, `load-failed` via `selectEditorFile` resolving false, `load-failed` via a switched-to buffer left in `phase: "error"` |
| GATE 0c — freshness / clean-buffer gate | same-chapter path calls `reconcileExternalChange()` first; buffer must be clean (`phase !== "error"`, no pending `externalChange`, `content === diskContent`) BEFORE the slice-equality check | `chapter-changed`, `not-clean` | `describe("GATE 0c")`: fast-path calls reconcile, dirty buffer, error-phase buffer, pending externalChange, **the dirty-buffer misalignment repro** (a repeated boilerplate line that would pass a naive slice check but is caught by this gate), chapter-changed race during reconcile |
| Step 2/3 — offset resolution + mismatch | `charRange()` resolves the line range; `buf.content.slice(from,to) === patch.expected` | `malformed-range`, `mismatch` | `describe("Steps 2-3")`: non-finite/inverted range, expected-no-longer-matches, `degradeLine = range[0]+1` on any failure |
| Step 4 — apply | editor-mounted → `applyRangeEdit`; else `buffer.edit()`; increments `this.gen` | (no distinct failure reason — always applies once gates pass) | `describe("Step 4")`: editor-mounted path, buffer-only path (editor holds a different file), buffer-only path (no editor mounted), generation increments by exactly 1 on success |
| Step 5 — flush | flushes immediately (not behind autosave debounce); a throw (external conflict) is still `ok: true, flushed: false` | (no failure reason — `flush()` throwing is folded into a still-`ok` outcome) | `describe("Step 5")`: immediate flush, flush-throws-but-still-ok |
| (cross-cutting) | Windows path separators: chapter id is joined with the project dir's OWN separator, compared with `===`, never `endsWith` | — | top-level test "joins the chapter id using the project directory's OWN separator" |
| Generation counter | starts at 0; `noteRenderingComplete()` increments | — | `describe("generation counter")`: both cases |

**Every gate above is already exhaustively pinned.** `commit-engine.test.ts`
(441 lines, an existing file — Lane B may not modify it) covers all nine
`CommitFailureReason` values, both success shapes (`flushed: true/false`),
both apply paths, and the one documented cross-cutting hazard (the dirty-
buffer misalignment repro). **No new `CommitEngine` test was added — nothing
was missing.**

## 4. Existing test coverage for `packages/desktop/tests/editor/**` (P4-relevant)

| File | What it pins | P4-relevant? |
|---|---|---|
| `commit-engine.test.ts` | All of §3 above | Yes — P4b deletes `CommitEngine` outright once P4a removes its last caller |
| `inline-edit-controller.test.ts` | `show()` opening (buffer-slice-as-source, live-buffer-over-readFile precedence, focus-before-command ordering, caret pass-through, no-project/no-op, unreadable-chapter toast, unresolved-block toast, bridge-throw-is-not-a-crash); `blockEditRequested` (opens on double-click, ignores a request with no range); `blockEditFinished` (commits with captured gate inputs, cancel writes nothing, a refused commit surfaces the engine's reason, the trailing-blank-run boundary rule); `endActive` (host-initiated end reads text back and commits, no-op when nothing is open); the `pendingRender` guard (refuses between commit and re-render, cleared by the next render, a no-op commit does not brick the next edit, a REFUSED commit does not brick the next edit, chaining from the menu does not walk past the guard, a cancelled edit never sets the guard); `renderingComplete` while open (discards the in-progress edit, bumps the engine's generation); `splitTrailingBlankRun` (all four boundary cases including CRLF) | Yes — P4a deletes this controller |
| *(no other file under `tests/editor/**` mentions `InlineEditController`, `CommitEngine`, or block-edit protocol identifiers)* | — | — |

`context-menu-controller.test.ts` (1401 lines, also existing, also
off-limits to this lane) separately pins every `ContextMenuController`
mutation command that flows through `CommitEngine` — image properties/unwrap,
link edit/copy, marker/page-marker edit, block-break before/after,
selection-format bold/italic/strikethrough/code/make-link, and the
`"block-edit"` item opening `InlineEditController`. This file is a P4a/P4b
concern (the mutation *commands* it builds move to rich/source editor
commands or disappear per D8) but is out of this lane's write ownership and
was not modified.

### 4.1 Coverage outside `packages/desktop/tests/editor/**`

The run spec also names `packages/desktop/tests/preview-bridge.test.mjs` and
the preview viewer sources as inventory targets. Both are pre-existing files
this lane may not modify; what they already pin, for the P4 search-proof
record:

- **`packages/desktop/tests/preview-bridge.test.mjs`** (475 lines) — despite
  its name, this file loads and exercises the REAL `preview-interface.js`
  (not `preview-bridge.js`), focused on chapter-scoped `data-source-line`
  resolution (`scrollTo`/sync, `getContextTargetAt`) — it contains no
  block-edit assertions at all.
- **`packages/desktop/tests/preview-interface.test.mjs`** (1111 lines) — the
  file that actually pins block-edit protocol behavior against the real
  scripts: `beginBlockEdit`/`endBlockEdit` semantics (unresolved range,
  idempotent end, a second `beginBlockEdit` commits its predecessor,
  contenteditable set/removed, `plaintext-only`, caret restore across a
  refresh, protocol-version-8 command surface including the REMOVAL of
  `getRectsFor`/`setEditMask`), double-click request/suppression-while-editing,
  Escape/Cmd-Enter key handling, and — using the REAL `preview-bridge.js` via
  `bridgeSource`/`runBridge` (lines 1077-1105) — that the bridge forwards all
  three protocol-v8 events (`blockEditRequested`, `blockEditFinished`,
  `blockEditStateChanged`) from the book iframe up to the host, with an exact
  `deepEqual` on each event's `detail`.
- **`packages/desktop/tests/preview-shell-regression.test.mjs`** —
  `runBlockEditHoldRegression` pins the swap-hold behavior driven by
  `blockEditStateChanged`: an open in-flow edit holds a queued hot-reload
  swap (`document.querySelectorAll("iframe").length` stays 1, nothing
  applied), and closing the edit releases the hold and applies the queued
  revision. This file loads the real `preview-shell.js`, `preview-interface.js`,
  AND `preview-bridge.js` together (see its `installBridge`/`installBook`
  helpers).
- **`packages/desktop/tests/integration/inline-editing.pw.mjs`** (1047
  lines) — a genuine end-to-end Playwright smoke test against the packaged
  Electron app (real mouse/keyboard input, not `dispatchEvent`). Its own
  header comment states it is explicitly **NOT CI-gated** — "the integration
  layer is explicitly NOT CI-gated" — so it does not run as part of
  `bun run test` / the P0a gate and cannot be relied on as a regression trip-
  wire before P4a lands; it is nonetheless the fullest behavioral evidence
  this feature has and should be listed, not silently dropped, when P4a
  removes or repurposes it.

### 4.2 Gap found and pinned by this run (new files)

Two genuine gaps survived the audit above — both are behavior the existing
files never exercise, both are squarely inside what P4a/P4b will touch or
delete, and both are now pinned by new characterization tests:

1. **`InlineEditController.show()`'s `requestId` race guards.** `show()` has
   three checkpoints of the form `if (requestId !== this.requestId) return;`
   (`inline-edit-controller.svelte.ts:230`, `241`, `277`) that discard a
   stale, still-in-flight `show()` call once a newer one has superseded it.

   **Repair round 1 correction:** this item and the test file's own header
   previously claimed the FIRST checkpoint (line 230, immediately after
   `await this.endActive(true)`) was already pinned by
   `inline-edit-controller.test.ts`'s "chaining from the menu does not walk
   past the guard" test. That claim was false on inspection: that test's
   final assertion is on `toastInfoCalls` (the *pendingRender* re-check
   message at the SECOND checkpoint, lines 235-238), not the `requestId`
   comparison at line 230, and because both of its `show()` calls are
   awaited sequentially, `this.requestId` never diverges from the local
   `requestId` there — the line-230 condition is never even exercised
   false by that test. **All three checkpoints had zero coverage before
   this run.** All three are now pinned in
   `packages/desktop/tests/editor/inline-edit-controller-characterization.test.ts`
   with three tests, each proving a slow, superseded request's late
   resolution cannot re-read its chapter, reopen, recapture, or otherwise
   disturb a faster request that already completed.

   **G-12 deliberate-failure proof** (each guard line commented out one at a
   time in `inline-edit-controller.svelte.ts`, the corresponding test run
   in isolation, then the line restored byte-for-byte):

   | Checkpoint | Line | Guard removed → | Command | Result |
   |---|---:|---|---|---|
   | 1st (after `endActive(true)`) | 230 | test 3 fails | `bun test tests/editor/inline-edit-controller-characterization.test.ts` | `readCalls` becomes `["/proj/b.md"]` instead of `[]` — 1 fail, 2 pass |
   | 2nd (after `readChapterSource()`) | 241 | test 2 fails | same | `beginCalls` gains an `"a.md"` entry — 1 fail, 2 pass |
   | 3rd (after `beginBlockEdit()`) | 277 | test 1 fails | same | `capturedChapter(ctrl)` becomes `"a.md"` instead of `"b.md"` — 1 fail, 2 pass |

   Each sabotage affected only its own test; the other two tests kept
   passing, confirming the three tests pin three independent conditions
   rather than one shared side effect. All three lines were confirmed
   restored identical to the pre-sabotage file (`diff` against a saved copy
   showed no difference) before this run's final gate was run.

2. **`preview-shell.js`'s host-command relay and its `beginBlockEdit`-only
   focus special case.** `preview-shell.js:29-42`'s message listener forwards
   every `gutterpress:cmd` message from the host down to the active book
   iframe verbatim, AND, only when `cmd === 'beginBlockEdit'`, additionally
   calls `active.focus()` on the shell's own iframe element — the mechanism
   `InlineEditController.show()`'s `focusPreview()` doc comment depends on
   ("the shell hands focus down to the active book frame as it relays
   `beginBlockEdit`"). Neither the generic relay nor this special case had
   any existing test anywhere in the repo (confirmed by grep: zero hits for
   `gutterpress:cmd` in `preview-shell-regression.test.mjs`). Pinned in
   `packages/desktop/tests/editor/preview-mutation-protocol-characterization.test.ts`,
   which has four tests: generic forwarding without a focus call, the
   `beginBlockEdit` case forwarding AND focusing exactly once, `endBlockEdit`
   forwarding without focusing (contrast case), and the special case being
   keyed on the command name every time (two `beginBlockEdit` relays produce
   two focus calls) rather than a one-shot latch.

   **Repair round 1 correction:** the fourth test's title previously claimed
   "a beginBlockEdit relay with no active iframe never throws (defensive:
   focus is wrapped, not load-bearing for delivery)". Its body never removes
   or nulls the active iframe, and that scenario is in fact unreachable —
   `preview-shell.js:27`'s `if (!active) return;` runs before the `message`
   listener is even installed, so with no active iframe there is no relay
   and nothing to focus. The title was corrected to describe what the test
   actually verifies (the keyed-on-command-name behavior above). A follow-up
   attempt to add a genuinely sabotage-provable test for the
   `try { active.focus(); } catch (_f) {}` defensive wrapper it wrongly
   claimed to cover was tried and abandoned: `active.contentWindow.postMessage(...)`
   (the forward) always runs BEFORE `active.focus()` in the relay branch,
   and an outer `try { ... } catch (_) {}` already wraps the whole listener
   (`preview-shell.js:32-75`), so no assertion on `forwarded`/
   `getFocusCalls()` can distinguish the inner wrapper's presence from its
   absence — verified locally by removing both the inner wrapper and
   converting the outer catch to a rethrow (not committed): the existing
   assertions still passed unchanged either way. That inner wrapper remains
   genuinely unpinned by this file; pinning it would need a white-box
   source-text check, which is out of scope here. This is recorded rather
   than silently left as another unproven coverage claim.

Everything else this run's candidate list named — "InlineEditController
lifecycle (begin/end, generation counter increments, stale-generation
rejection, pending-render handling)" — was found to be **fully pinned**
already (generation counter and stale-generation rejection live on
`CommitEngine` and are pinned there per §3; begin/end and pending-render are
pinned in `inline-edit-controller.test.ts` per §4 above). No duplicate tests
were written for those.

## 5. New files this run added (write ownership)

- `packages/desktop/tests/editor/inline-edit-controller-characterization.test.ts`
  — 3 tests, all new coverage (§4.2 item 1; a third test and its G-12
  deliberate-failure proof were added in repair round 1 after the original 2
  were found to leave the first `requestId` checkpoint unpinned).
- `packages/desktop/tests/editor/preview-mutation-protocol-characterization.test.ts`
  — 4 tests, all new coverage (§4.2 item 2; the fourth test's title was
  corrected in repair round 1 to match what it verifies — see §4.2 item 2's
  correction note for why a genuinely sabotage-provable replacement test for
  the defensive wrapper it wrongly claimed to cover was not addable).

Both files are additive only — no existing test file was read for the
purpose of modification, and none was changed.

## 6. Verification run at this run's baseline

| Command | Exit code | Notes |
|---|---:|---|
| `bun test tests/editor/inline-edit-controller-characterization.test.ts tests/editor/preview-mutation-protocol-characterization.test.ts` (from `packages/desktop`) | 0 | 7 pass, 0 fail, 24 `expect()` calls (repair round 1: was 6 pass / 19 `expect()` before the checkpoint-1 test was added — net +1 test, the fourth `preview-mutation-protocol-characterization.test.ts` test was retitled in place, not added) |
| `bun test --isolate tests/editor` (from `packages/desktop`) | 0 | 534 pass, 0 fail, across 26 files (repair round 1: was 533; net +1, includes the 2 files above) |
| `bun run test` (from `packages/desktop`; runs `svelte-kit sync` + the three `.mjs` preview regression scripts + `bun test --isolate tests/updater tests/platform tests/recovery tests/editor tests/media`) | 0 | 2132 pass, 1 skip, 0 fail, across 142 files (repair round 1: was 2131) |
| `bun run test` (from `packages/cli`) | 0 | 1810 pass, 60 skip, 0 fail, across 151 files (unchanged — Lane B made no `packages/cli` changes in this repair round) |
| `bun run typecheck` (repo root; `bun --filter '*' typecheck`) | 0 | both `gutterpress` and `@dimm-city/gutterpress-desktop` typecheck scripts pass (desktop's covers `electron/tsconfig.json` only — see §6.1) |
| `svelte-check` against a scratch tsconfig extending `packages/desktop/.svelte-kit/tsconfig.json` and explicitly including the two new test files plus `inline-edit-controller.svelte.ts`, `commit-engine.ts`, `preview-client.ts` | 0 | 849 files, 0 errors, 0 warnings (run before repair round 1; not re-run for the repair since `bun run typecheck` above and the full `bun run test` desktop run already re-verify these same files after the round-1 edits and both stayed green) |

### 6.1 Why a scratch tsconfig was needed

`packages/desktop/tsconfig.json` (the project `bun run check` / `svelte-check`
uses) explicitly excludes `tests/editor/**` (along with
`tests/updater/**`/`platform/**`/`recovery/**`/`media/**`), and
`packages/desktop/package.json`'s `typecheck` script only runs
`tsc -p electron/tsconfig.json` (the Electron main process, not the SPA or
its tests). Neither configured command in this repo statically typechecks
any file under `packages/desktop/tests/**` — this appears to be an
established, deliberate repo convention (the same pattern holds in
`packages/cli/tsconfig.json`, whose `include` is `["src"]` only, excluding
`tests/`). To still produce a real static-typecheck signal for the two new
files (which import a rune-bearing `.svelte.ts` module, requiring
`svelte-check` rather than plain `tsc`), this run built a temporary tsconfig
in the run's scratch directory that extends
`packages/desktop/.svelte-kit/tsconfig.json` (the same base the project's own
`tsconfig.json` extends) and lists the two new files plus their production
dependencies explicitly in `include`, with `bun-types`' `typeRoots` pointed
at the workspace's Bun-managed copy so `bun:test` resolves. This scratch file
was not committed and is not part of the repository.
