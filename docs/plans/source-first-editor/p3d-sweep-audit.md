# SFE-P3d-sweep — scenario audit

> Per-lane audit of the twenty P3d interaction scenarios against existing
> evidence, and the gaps each lane closed. Each lane owns and writes only
> its own `## Lane <X>` section below.

## Lane A

Scope: scenarios 1 (type ordinary text), 2 (format selection), 3 (insert
and modify image), 4 (create/edit table), 5 (slash menu / actual insertion
affordance), 6 (move block by keyboard and pointer), 7 (activate/deactivate
plugin region), 8 (edit near generated content), 9 (paste rich/plain text),
10 (IME composition), 12 (external file change while active), 13 (stale
source edit rejection), 16 (undo/redo within current mode), 17 (oversized
file source fallback), 18 (untrusted VS Code workspace fallback), 19
(dispose/remount without leaked listeners) — at the editor-package and
VS Code extension level, in the real-Chromium harness.

Every citation below was verified by reading the cited test's body (not
just its name/title) and, for every gap closed, by empirically driving the
real harness before writing the final assertions (see each new test's own
header/inline comments for the specific offsets/behavior measured live).

### Audit table

| # | Scenario | Status | Evidence citations | Gap closed by |
|---|---|---|---|---|
| 1 | type ordinary text | already-proven | `packages/editor/tests/vscode-adapter/browser.cases.btest.ts` — `describe("case 1 — exact source edits")`: end-of-document typing submits the exact minimal `SourceEdit`; multi-block edit locality (typing in block 2 never touches block 1's bytes). Foundational layer: `packages/editor/tests/web/mount.btest.ts` — `describe("typing updates host through the adapter path")`. | — |
| 2 | format selection | already-proven | `packages/editor/tests/standard/wrap-toggles.test.ts` — `toggle-bold`/`toggle-italic`/`toggle-strike`/`toggle-inline-code`, each across caret-only, partial selection, full-line, multi-line, toggle-OFF (canonical + alt spelling), caret-between-pair, idempotence, and `commandState` active/applicable — a pure `(snapshot, selection) -> edit` function exhaustively unit-tested. `packages/editor` ships zero toolbar/menu UI (D4: framework-free); a "click bold, see it toggle" browser test would exercise desktop/extension chrome this package does not own. | — |
| 3 | insert and modify image | already-proven at this package's scope | `packages/editor/tests/standard/link-image.test.ts` — `insert-link`/`insert-image`: selection-wraps-as-text/alt, explicit-text/alt override, caret-only placeholder. `src/core/commands.ts`'s own doc comment records that desktop's richer `applyImage` (width/position/size/shape) is *intentionally* left unmapped to this package's minimal `{src, alt?}` shape — a documented capability boundary, not an omission. | — (Gutterpress-specific "modify" richness — size/position/shape — is desktop-owned: `packages/desktop/tests/editor/parity-image-link-image-properties.test.ts`, `image-classes.test.ts`; citable only, outside this lane's write scope, not independently re-verified this run.) |
| 4 | create/edit table | **partial → closed** | Before: `packages/editor/tests/standard/table.test.ts` proved only `insert-table`'s skeleton-generation command (pure function, no mount). No test drove the real, pinned fork against an *existing* table and edited a cell, even though the fork's own `dist/index.d.ts` shows table cells are a real, hit-tested (`_resolveTableCellOffset`), independently editable AST/view kind. | NEW `packages/editor/tests/vscode-adapter/table-editing.btest.ts` (4 tests): live-rendering liveness (real `<table>`, 4 rows, all 6 cell values present); a keystroke inside an *existing* data cell is a byte-exact interior edit, rest of the table untouched; same for a header cell. Offsets computed via `TABLE_SOURCE.indexOf(...)` and independently verified live before being written (Home reliably lands at the row's own source start; `ArrowRight` then advances linearly through the raw source, including the hidden pipe/glue characters). |
| 5 | slash menu / actual insertion affordance | audited — no such affordance exists at this level | Workspace-wide search for "slash" (`packages/editor`, `packages/vscode-extension`, `packages/desktop`) returns zero hits describing a slash-command menu — every hit is an unrelated path-separator use. `packages/vscode-extension/package.json`'s `contributes.commands` lists only `gutterpress.build`/`preview`/`openSource` — zero insertion commands. `packages/editor` ships no toolbar/menu chrome at all (D4). The command vocabulary any such affordance would dispatch is exhaustively proven at the pure-function level (see scenarios 2–4's citations above). | — (No slash menu was ever built, at any layer. The product's actual, sole insertion affordance is the desktop's `EditorToolbar.svelte`/`toolbar-actions.ts` — citable only, Lane C's/out of this lane's write scope. Inventing an editor- or extension-level insertion UI this run would be a new public feature not named in the run specification.) |
| 6 | move block by keyboard and pointer | keyboard: desktop-only (citable); **pointer: pinned/closed** | Keyboard: `moveBlock`/`applyBlockMove`/`splitIntoBlocks` live entirely in `packages/desktop/src/lib/editor/rich-commands.ts`, wired to `Alt+Shift+ArrowUp/Down` directly in `packages/desktop/src/routes/+page.svelte` — confirmed **absent** from `packages/editor/src/core/commands.ts`'s `EditorCommand` union (12 members, no `move-block`). Desktop evidence (citable, not independently re-verified): `packages/desktop/tests/editor/rich-commands.test.ts`. Pointer: a workspace-wide search found **zero** production code implementing pointer/drag block reordering anywhere. Verified directly against the pinned fork's own bundle (`packages/vscode-markdown-editor/dist/index.js`): its only "drag"-related identifiers are `isSelecting`/a pointer-driven **text selection** in progress — never block reordering. | NEW test appended to `browser.cases.btest.ts` — `describe("pointer drag across block boundaries...")`: a real `mouse.down`/`move`/`up` drag spanning 3 blocks submits **zero** edits and leaves the document byte-identical; the editor remains normally typeable immediately afterward. |
| 7 | activate/deactivate plugin region | already-proven, thoroughly | `packages/editor/tests/gutterpress/plugin-region.btest.ts` — `describe("two-state: activation, deactivation restores the chip with zero drift")` (activating shows real source with zero host mutation; deactivating restores the exact original chip, zero drift); `describe("edit locality...")` (byte-exact interior edit inside an active region); `describe("refused plugin-region...")` (no-source-range-evidence fail-closed path stays plainly editable with a named diagnostic). | — |
| 8 | edit near generated content | **partial → closed** | Before: `gutterpress.btest.ts`'s `describe("generated chapter-opener preview")` proved the generated view is read-only/unfocusable, in isolation — no test edited an ordinary paragraph immediately touching a generated-view-anchoring marker. | NEW `describe` block appended to `packages/editor/tests/gutterpress/gutterpress.btest.ts` — "editing paragraphs immediately adjacent to a generated-view-anchoring marker" (2 tests, one fixture with an ordinary paragraph on *both* sides of the `@page` marker that anchors a generated chapter-opener): editing the paragraph immediately BEFORE, and separately the one immediately AFTER, is each a byte-exact local edit; the marker line, the generated preview's exact rendered HTML, the overall chip count, and the page chip's own CSS class are all unaffected in both directions. |
| 9 | paste rich/plain text | **partial/aspirational → pinned, closed** | Before: `input-a11y.btest.ts`'s `describe("case 8 — clipboard")` proved PLAIN-text paste (execCommand no-op, `keyboard.insertText`, real `Ctrl+C`/`Ctrl+V`) — no case exercised HTML-flavored clipboard content. Source evidence (that file's own header, independently re-verified by me against `packages/vscode-markdown-editor/dist/index.js`): the paste handler is exactly `const c = r.clipboardData?.getData("text/plain"); c && e.insertText(c);` — grepping the whole bundle for `"text/html"` returns **zero** matches. | NEW `describe` block appended to `input-a11y.btest.ts` — "case 8 — paste: HTML-flavored clipboard content (pinned behavior)" (2 tests, via a script-constructed `ClipboardEvent`/`DataTransfer`, dispatched at the real `.md-editor` element the package's own listener is bound to): (a) both `text/html` and `text/plain` present → only the plain flavor is ever inserted, byte-exact, with an explicit negative check ruling out the HTML tag or any markdown-ified rendering of it; (b) ONLY `text/html` present → pasting is a complete no-op, zero edits, byte-identical document (`dispatchEvent()===false` proves the handler genuinely ran, not that the event went unhandled). |
| 10 | IME composition | already-proven, with an honest documented limitation | `input-a11y.btest.ts` — `describe("case 8 — IME / composition")`: confirms the surface is NOT `contenteditable` and wires ONLY `EditContext.textupdate` (verified against the real bundle); a synthetic `CompositionEvent`+`beforeinput` sequence submits no partial `SourceEdit`. | — (Already-documented, correctly-left-open limitation, not a gap I closed or need to: Playwright/CDP expose no public real-IME API, so this proves synthetic composition is inert but cannot rule out a real OS IME's interim `EditContext.textupdate` events, which the package's own handler has no composition-state guard against.) |
| 12 | external file change while active | already-proven, at both layers | Editor: `browser.cases.btest.ts` — `describe("case 2 — external authoritative replacement")` + `describe("rejection path — external replacement lands during the rejection window (repair)")` (both sync and microtask timing: converges on the host's post-external text, next keystroke is accepted, not itself rejected). Foundational: `web/mount.btest.ts` — `describe("external replacement re-renders the document")`. VS Code: `packages/vscode-extension/tests/webview/edit-version-reconciliation.btest.ts` — `describe("(c) an external change racing a queued edit discards the queue and converges byte-identically")`; `packages/vscode-extension/tests/host/document-gateway.test.ts` — `describe("DocumentGateway — external change broadcast (workspace.onDidChangeTextDocument)")`. | — |
| 13 | stale source edit rejection | already-proven, at both layers | Editor: `browser.cases.btest.ts` — `describe("rejection path — stale edit reverts the model and fires EDITOR_STALE_EDIT")`. VS Code: `document-gateway.test.ts` — `describe("DocumentGateway — concurrent change (stale base) and invalid-range dry-run rejection")` + `describe("DocumentGateway — base stamp bookkeeping (reconciliation addendum's fix)")`. | — |
| 16 | undo/redo within current mode | already-proven / pinned — beyond that, out of this harness's reach | Editor: `browser.cases.btest.ts` — `describe("case 3 — host-delegated undo/redo (D7)")`: the package's OWN `Ctrl+Z` is inert — does not revert source, does not become a competing edit, fires no diagnostic — exactly D7's "hosts own undo, not the package." VS Code: `document-gateway.test.ts`'s whole `DocumentGateway` suite proves every accepted edit is applied via the REAL `vscode.workspace.applyEdit(this.#api.createWorkspaceEdit())` — the sole mechanism that makes VS Code's native undo/redo work once wired correctly (D7). | — (Proving VS Code's OWN native undo command actually reverts text needs a live VS Code instance; every harness in this tree uses a `vscode-mock.ts`/`fidelity-vscode.ts` FAKE api surface — a test asserting the mock's own fake undo-stack "works" would be circular, not evidence about real VS Code. Correctly out of reach here, not a gap this lane can close. Desktop rich-mode undo is Lane C's/out of this lane's write scope; not independently re-verified.) |
| 17 | oversized file source fallback | already-proven, thoroughly | Decision layer: `packages/vscode-extension/tests/provider.test.ts` — "D13: a document over the 2 MiB ceiling reports mode 'source-fallback' with EDITOR_FILE_TOO_LARGE" (plus a boundary case exactly AT the limit). Rendering layer: `packages/vscode-extension/tests/webview/fallback.btest.ts` — `describe("D13 oversized file: presentation-input mode 'source-fallback' renders honest fallback text, never a mount")`: exact diagnostic message/category/safe-action shown, zero editor mount, zero edits ever possible. | — (The 2 MiB threshold is intentionally a HOST-level policy duplicated, not shared, between `vscode-extension`'s `provider.ts` and desktop's `editor-projection.ts`, per D4's import-direction rule — nothing to close at the shared-package level; `packages/editor/tests/core/diagnostics.test.ts` covers the shared `EDITOR_FILE_TOO_LARGE` category contract itself.) |
| 18 | untrusted VS Code workspace fallback | **partial → closed** | Before: `packages/vscode-extension/tests/webview/trust-explanation.btest.ts` thoroughly proved the trust GATE (banner appears with correct message/category; clears via both its independent mechanisms) — no test ever clicked into the mounted editor and typed. | NEW `describe` block appended to `trust-explanation.btest.ts` — "D9 untrusted workspace: standard rich editing keeps working while the trust notice is showing": mounts untrusted with the notice genuinely showing (liveness-checked first), types a real keystroke, and proves via the fake host's own recorded `SourceEdit` that it reaches the host byte-exact, with the notice still visible throughout — neither direction silently overrides the other. |
| 19 | dispose/remount without leaked listeners | already-proven, extremely thoroughly, at three layers | Foundational: `web/mount.btest.ts` — `describe("dispose")`, `describe("dispose then remount on the same host")`, plus two SFE-P2a repair-round `describe`s (re-entrant disposal during `applyEdit`; cross-mount isolation, separate-host AND shared-host variants). vscode-adapter: `input-a11y.btest.ts` — `describe("case 8 — disposal")` (zero further `applyEdit` calls / empty container after dispose; clean remount, exactly one `applyEdit` per keypress, no duplicate). VS Code webview: `packages/vscode-extension/tests/webview/disposal.btest.ts` (transport-listener count 1→0; dispose is idempotent; dispose-then-remount on the SAME fake host produces exactly one MORE recorded edit, never two). | — |

### Behavior pinned as-is (for the product owner — not fixed this run; no production changes are permitted in this lane)

- **Paste is plain-text-only.** There is no HTML-to-Markdown paste conversion
  anywhere in this product today. When the clipboard carries both flavors,
  the plain-text one silently wins; when it carries *only* an HTML flavor
  (no plain-text sibling), pasting is a complete, silent no-op. Verified
  against the pinned fork's own bundle and pinned by
  `input-a11y.btest.ts`'s new "paste: HTML-flavored clipboard content" suite.
- **Pointer/drag-based block movement does not exist at any layer of this
  product** — not in `packages/editor`, not in the VS Code extension, not
  on desktop. Only *keyboard*-driven block movement exists, and only on
  desktop (`Alt+Shift+ArrowUp/Down`, wired outside the shared
  `EditorCommand` vocabulary entirely). Pinned by `browser.cases.btest.ts`'s
  new pointer-drag suite: a drag across blocks extends a text selection
  (the fork's real, documented pointer behavior) and never reorders
  anything.
- **A real OS IME's interim composition events remain formally unverified.**
  `input-a11y.btest.ts`'s IME suite proves synthetic `CompositionEvent`
  sequences are inert, but Playwright/CDP expose no public real-IME API, so
  this cannot rule out a real IME's `EditContext.textupdate` stream (which
  the package's own handler has no composition-state guard against). This
  was already an open, correctly-recorded risk before this run; nothing new
  closes it.
- **VS Code's native undo/redo is architecturally correct but not
  end-to-end provable in this tree.** Every accepted edit flows through the
  real `vscode.workspace.applyEdit`/`WorkspaceEdit` API (the mechanism
  native undo depends on), proven by `document-gateway.test.ts`. Whether
  VS Code's own `Ctrl+Z` actually reverts a real editing session cannot be
  tested here — no harness in this repository runs inside a live VS Code
  instance; they all use a fidelity-mocked `vscode` API surface.
- **Gutterpress-specific "modify image" richness (size/position/shape) is
  entirely desktop-owned.** `packages/editor`'s shared `insert-image`
  command is deliberately narrower (`{src, alt?}` only); desktop's own
  richer `applyImage` is intentionally left unmapped to it
  (`src/core/commands.ts`'s own doc comment records this as a genuine,
  accepted capability gap between the shared vocabulary and desktop's
  toolbar, not an oversight).
- **No slash menu, and no insertion-affordance UI at all, exists in
  `packages/editor` or `packages/vscode-extension`.** The sole insertion
  affordance anywhere in the shipped product is the desktop's
  `EditorToolbar.svelte`. `packages/vscode-extension` registers zero
  insertion commands in its `package.json` `contributes.commands`.

### What this lane could not independently verify, and why

- Desktop-level citations above (rich-commands.test.ts, parity-image-*
  tests, document-session undo tests) were located and read for context but
  **not** re-executed by this lane — `packages/desktop/**` is explicitly
  outside this lane's write/verification scope for this run (Lane C's
  citable-but-not-owned territory per the run specification).
- VS Code's real native undo/redo (see scenario 16) cannot be exercised by
  any harness this repository currently has; a live VS Code instance would
  be required, which is out of scope for this run's tooling.

## Lane C

Scope: scenario 11 (screen-reader landmarks and labels) at the desktop
level, scenarios 14 (source/rich mode switch) and 15 (file switch) audit +
gap closure at the desktop-unit level, and the packaged-Electron `.pw.mjs`
driver probe. Write ownership this run: `packages/desktop/tests/**` and this
section only — no production source anywhere, per the run's lane discipline.

Guiding principle applied throughout (SFE-P3e's ruling, and this run's own
"P3e ruling" binding decision): no new machinery where an existing harness
serves. Every closure below uses a pattern this test tree already has —
`bun:test` source-text assertions matching `app-toolbar.test.ts`'s own
established convention for the a11y audit, and the existing `.pw.mjs`
driver files, unmodified, for the packaged probe. Nothing new was added to
`tools/`, no test framework was introduced, and the packaged probe was not
fought with new xvfb wiring (below).

### Scenarios 14 + 15 — audit and gap closure

**Citations read in full before writing anything (not just titles):**

- `packages/desktop/tests/editor/rich-mode.test.ts` (218 lines) —
  `RichModeController` unit tests. `describe("mode selection")`: defaults to
  `"source"`; `switchTo` changes mode and bumps `epoch`; switching to the
  already-active surface is a no-op (no epoch bump). `describe("switching
  never alters source")`: three `switchTo` calls in a row (rich→source→rich)
  and a separate `onFileSwitch()` call both leave a shared
  `MemoryDocumentHost`'s snapshot byte-and-version-identical, proving mode
  switching alone can never touch source (D2/D7). `describe("file
  switches")`: `onFileSwitch()` bumps the epoch and preserves the current
  mode by default; can also reset the mode explicitly. `describe("exactly
  one surface mounted at a time")`: `registerMount`/`registerUnmount`
  enforce D7's "only one editing surface mounted" invariant — a mount
  attempted for a DIFFERENT surface while one is already registered throws
  AND leaves the existing registration intact (not clobbered by the throw);
  same-surface double-mount is a harmless no-op; a full
  mount→unmount→mount-other-surface cycle succeeds; a mount attempted
  WITHOUT unmounting the other surface first is rejected, not silently
  tolerated. `trackSurfaceMount` (the Svelte action `+page.svelte` actually
  uses) registers on attach and unregisters on destroy, proven for two
  sequential attach/destroy cycles on different surfaces.
- `packages/desktop/tests/editor/rich-mode-commit-integration.test.ts` (144
  lines) — proves the SFE-P3ab review round-1 fix end-to-end with a REAL
  `DesktopDocumentHost` (not a fake): while rich mode is the live surface, a
  preview-originated `CommitEngine` write reaches `richDocHost` (not just
  the buffer), and a SUBSEQUENT rich-mode command (`applyRichCommand` —
  toggle-bold) builds on top of the committed text instead of silently
  reverting it. This is the mode-switch-adjacent "the two surfaces must
  never silently diverge" half of scenario 14.
- `packages/desktop/tests/editor/real-book-byte-identity.test.ts` (306
  lines, 25 real chapter files across 5 corpora) — for every real chapter:
  constructs a `DesktopDocumentHost` at the exact file text, mounts via
  `RichModeController.registerMount("rich")` (liveness-checked), builds the
  real D6 projection via `createEditorProjection` (the exact function
  `+page.svelte`'s own `buildRichProjection` calls), unmounts via
  `registerUnmount`, and asserts byte-and-buffer-identical source with ZERO
  host change notifications across the whole cycle. This is the "session
  lifecycle" scenario-14 evidence my brief named — confirmed by reading the
  file, not assumed from its name. Its own header is explicit that this is
  NOT a real browser mount (`EditContext` is undefined under happy-dom for
  the real fork — verified live in this sandbox before that file was
  written) — a real-Chromium mount of actual book chapters remains a named,
  owner-attributed gap for a follow-up, not something this lane re-opens.
- `packages/desktop/tests/editor/editor-file-session.test.ts` (148 lines) —
  `EditorFileSession` (the lower buffer-swap layer `+page.svelte`'s
  `editorFiles` is) race-hardening: latest selection wins when an older
  file read resolves last (a blocked read released only after a later
  select has already won); a delayed automatic default cannot overtake a
  newer explicit selection; a failed outgoing flush blocks the atomic
  handoff (stays on the dirty file, edit preserved); concurrent recovery
  restores serialize and each flushes its own outgoing file in turn;
  `reset()` cancels a queued recovery restore before its work starts, and
  cancels queued restores' orphan autosave timers too. This governs the
  BUFFER swap. It has no async build step of its own to race, so — see the
  gap below — it does not and cannot exercise the SEPARATE, decoupled async
  rich-projection-rebuild race that sits one layer above it.
- **The "P3c-era `selectEditorFile` await" my brief named — read and
  corrected.** `selectEditorFile` (the `+page.svelte` function, distinct
  from `EditorFileSession.select`) does predate P3e, but the specific
  behavior my brief was pointing at — awaiting `richDocHostPending` in
  addition to `editorFiles.select(path)` — is NOT P3c-era; it is the SFE-P3e
  review round-2 CONFIRMED-finding fix (verified directly against the
  function's own doc comment and the `richDocHostEpoch`/`richDocHostPending`
  state it reads, `+page.svelte` lines ~1521-1620 and ~2286-2293). Recording
  the correction plainly rather than silently reusing the imprecise framing.
  Its regression coverage:
  - `packages/desktop/tests/editor/commit-engine.test.ts`, describe
    `"SFE-P3e round 2: cross-chapter commit vs. an in-flight rich-host
    publish"` (read in full) — a harness toggling ONE boolean
    (`awaitPending`) proves BOTH the pre-fix defect (without awaiting the
    pending publish, a cross-chapter commit silently falls through to
    `buf.edit`, and the rich host later publishes STALE pre-commit text —
    reproduced on purpose) AND the fix (awaiting it routes the edit through
    the rich host, which carries POST-commit text). This is real,
    already-existing regression coverage for the `richDocHostPending`-await
    half of the mechanism, exercised through a real `CommitEngine`.
  - `packages/desktop/tests/editor/file-tree-open-file-rename-delete.test.ts`,
    test `"+page delegates file selection and default loading to the
    behavior-tested session"` — a structural wiring pin (`+page.svelte`
    can't be compiled/mounted by `bun:test`; see that file's own "Wiring
    check" header) confirming `selectEditorFile` still awaits
    `editorFiles.select(path)` rather than returning it bare.

**The genuine gap, confirmed by search before closing it:** the
`richDocHostPending`-await coverage above exercises exactly ONE in-flight
rich-projection build at a time, always through `CommitEngine`'s specific
"await selectEditorFile, then immediately check `editorHasFile` with no
further await" seam. None of it exercises `richDocHostEpoch`'s own job — the
guard that discards a rebuild's late-arriving async publish when a SECOND
file switch has already superseded it before the first one's
`buildRichProjection` IPC round trip resolves (`rebuildRichDocHost`'s own
doc comment names this exact scenario). `grep -rn "richDocHostEpoch"
packages/desktop/tests` returned zero matches before this lane wrote
anything. This is precisely the "switch DURING an in-flight projection
build landing in the right final state" case my brief asked me to check —
confirmed genuinely open, not already pinned.

**Closed by:** NEW
`packages/desktop/tests/editor/rich-doc-host-rebuild-race.test.ts` (6
tests, run standalone: 6 pass / 0 fail / 21 `expect()` calls). Since
`richDocHostEpoch`/`richDocHostPending`/`rebuildRichDocHost` are private
`+page.svelte` closure state — uncompileable by this test tree, the exact
limitation `file-tree-open-file-rename-delete.test.ts` and
`commit-engine.test.ts` both already document for this identical file —
this follows `commit-engine.test.ts`'s own established precedent of
modeling the exact seam with a toggleable fake rather than inventing a new
harness. `RichDocHostHarness` is a line-verified model of the real epoch
guard (`if (epoch !== richDocHostEpoch) return;`, quoted and matched against
the real source in the file's final test — see below), with async
resolution order controlled by deferred promises (not timers) for
determinism. It proves: an ordinary single switch still publishes normally
(control case); a second switch (C) superseding a still-pending first (B)
discards B's late publish REGARDLESS of resolution order (both "C resolves
first, B resolves late" and "B resolves first but is still stale, C
resolves after" are asserted separately); three overlapping switches still
land on only the last one; and (AP-21/G-12 — "a gate must prove it can
fail") a `guardEnabled: false` variant, modeling `rebuildRichDocHost` with
its guard line deleted, reproduces the exact defect class this mechanism
exists to prevent (B's late publish WINS, landing the switch on the wrong
final state) — proving the fixed-shape assertions are not vacuously true.
A final test ties the model to the REAL current source: it reads
`+page.svelte` and asserts `richDocHostEpoch` is declared, bumped at least
twice (rebuild AND dispose), and that the exact guard line appears inside
`rebuildRichDocHost` itself, textually before `richDocHost = nextHost;` —
sanity-checked live during authoring by temporarily corrupting the expected
string (a scratch copy, restored immediately after) and confirming the test
fails, then restoring and confirming it passes again clean
(`git diff --stat` on the test file was empty afterward).

**Honest residual limitation of the new test, stated plainly:** unlike
`commit-engine.test.ts`'s harness (which wraps a REAL `CommitEngine`
instance with only ONE dependency faked), `RichDocHostHarness` calls no
production code at all — nothing in `packages/desktop/src` can be imported
here. Its algorithmic assertions are proven internally consistent and its
final test ties it to the real source TEXTUALLY (so deleting the guard line
from the real file fails that one test), but a change that keeps the guard
line present while breaking its actual runtime semantics elsewhere in
`rebuildRichDocHost` would not be caught by this file. Closing that
completely would need extracting the rebuild logic into a testable unit —
a production change outside this lane's write ownership.

### Scenario 11 — accessibility audit

**The fork's own a11y surface (`packages/editor/tests/vscode-adapter/
input-a11y/input-a11y.btest.ts`, 782 lines, read in full) — precisely what
it asserts:**

- **Focus: yes, directly.** Tab from a sentinel element lands
  `document.activeElement` on `.md-editor`; the `.md-focused` class (the
  DOM-visible side effect of the package's own `EditorView.focused`) is
  present at the same moment; arrow keys move a real `.md-cursor` element
  measurably. Tab-trap-for-indentation is the PROVEN default behavior (Tab
  stays inside `.md-editor` twice in a row), with `Control+M` proven as a
  real, working escape hatch (focus lands on the AFTER-sentinel once
  toggled).
- **Roles: explicitly NOT asserted as a specific value.** The file's own
  words: "whatever role Chromium actually computes for this
  focusable-but-role-less element is evidence... The one hard requirement
  proven here is that the node is REACHABLE in the accessibility tree at
  all." It calls `Locator.ariaSnapshot()` and logs the result either way —
  a recorded observation, not a pass/fail on a specific role.
- **ARIA attributes (`aria-description`, `aria-keyshortcuts`): recorded as
  verified STATIC SOURCE evidence, not DOM-queried at runtime.** The file's
  header quotes the exact `dist/index.js` lines that set them, independently
  verified against the installed fork before the file was written — but no
  test body itself calls `getAttribute("aria-description")`. The behavior
  those attributes DOCUMENT (the trap + the escape hatch) is what gets the
  runtime DOM assertion, not the attributes' own presence.
- Also proven: clipboard (plain-text round-trip, HTML-flavored paste is
  pinned to plain-fallback-or-no-op), IME (synthetic composition events
  submit no partial edit — with an honestly-recorded real-IME limitation),
  and dispose/remount listener hygiene.

**What this proves and does not prove for the DESKTOP shell:** the fork's
mounted root is a focusable, keyboard-operable, but role-less div. It
carries no landmark or name of its own — the surrounding desktop chrome is
entirely responsible for giving the editing surface (and every other major
region) a reachable name and role. That is this lane's actual scope, and
input-a11y.btest.ts's own finding is exactly why `RichEditor.svelte`'s own
mount div (audited below) is correctly bare — its name has to come from
somewhere else, and it does.

**Desktop side — audit table.** No component-render harness exists in this
test tree: verified independently (no `@testing-library/svelte`, no
vitest+svelte-plugin config, no `bunfig.toml` anywhere in the workspace) and
confirmed authoritatively by `packages/desktop/tests/platform/
app-toolbar.test.ts`'s own header, quoted directly: *"Svelte component
templates lack a mount/DOM test harness in this repo's bun:test setup (no
JSDOM/Svelte-compile harness is wired up) — these tests follow the
established project convention (NewProjectWizard.test.ts,
ProjectsListBody.test.ts, CrashRecoveryDialog.test.ts, …) of asserting the
source contains the required wiring, rather than exercising a live
component."* Every row below follows that same, already-established
convention — asserting at the level that IS established, per this run's own
escape hatch. `AppToolbar.svelte` itself already has thorough a11y coverage
in `app-toolbar.test.ts` (the small-screen WAI-ARIA tabs pattern; `Edit`/
`Read`/`Focus` mode `aria-label`s; the semantic `<header>` root) — cited,
not duplicated below.

| Surface | Assertion | Evidence |
|---|---|---|
| `EditorToolbar.svelte` (the formatting toolbar, distinct from `AppToolbar`) | Root is `role="toolbar" aria-label="Markdown formatting toolbar"`; every per-item button carries `aria-label={item.ariaLabel}` (≥6 occurrences) plus named standalone controls (heading level, insert layout block, more-options, mode switch); the image/table dialogs label every field and surface errors as `role="alert"` | NEW `app-shell-a11y-landmarks.test.ts`, `describe("EditorToolbar — ...")`, 3 tests, verified against `src/lib/components/EditorToolbar.svelte` |
| `LeftPanel.svelte` | `<aside aria-label="Left panel">` root; resize handle is a real WAI-ARIA `role="separator"` with `aria-label`/`aria-valuemin`/`aria-valuemax`/`aria-valuenow`/`tabindex` (not a bare drag div); tab strip is `role="tablist"` + per-tab `role="tab"`/`aria-label`, each `tabpanel` `aria-labelledby` its own tab id; TOC tree exposes expand/collapse state in the label text itself and `aria-current` for the active entry | NEW `app-shell-a11y-landmarks.test.ts`, `describe("LeftPanel — ...")`, 4 tests |
| `StatusBar.svelte` | Root is `role="status" aria-label="Application status"`; icon-only sync/save/settings/help buttons all carry `aria-label` | NEW `app-shell-a11y-landmarks.test.ts`, `describe("StatusBar — ...")`, 2 tests |
| `ProblemsPanel.svelte` | A polite `aria-live` region (`class="sr-only"`) announces lint completion for screen-reader users who can't see the badge; outer panel has `aria-label="Problems"` with `aria-expanded`/`aria-controls` on its toggle; the expanded body is a SEPARATE named `role="region" aria-label="Problems list"` | NEW `app-shell-a11y-landmarks.test.ts`, `describe("ProblemsPanel — ...")`, 3 tests |
| `FileTree.svelte` | Root is `<nav aria-label="Project files">`; per-row rename/delete controls are labeled with the specific file name, not a generic icon label; destructive confirmation is a real `role="alert"`; the open file is exposed via `aria-current`, not color alone | NEW `app-shell-a11y-landmarks.test.ts`, `describe("FileTree — ...")`, 3 tests |
| `PreviewFrame.svelte` | The `<iframe>` itself carries `title="Gutterpress preview"` — an accessible name independent of, and present on every layout unlike, the wrapping section's conditional `aria-labelledby` (next row) | NEW `app-shell-a11y-landmarks.test.ts`, `describe("PreviewFrame — ...")`, 1 test |
| `+page.svelte` editor/preview panes + resize separator | Editor pane's `aria-label` (CSS vs. Markdown editor) is UNCONDITIONAL — true on every layout; preview pane's `aria-labelledby`/`role` are set ONLY when `isNarrow` (recorded honestly, not assumed equivalent to the editor pane); the editor/preview split has a labeled, keyboard-operable `role="separator"` | NEW `app-shell-a11y-landmarks.test.ts`, `describe("+page.svelte — ...")`, 3 tests |
| `RichEditor.svelte` mount container | Its own root `<div>` carries NO `role`/`aria-*` of its own — verified by exact-string equality on the whole element, not a substring check — confirming this is deliberate (component header: "owns DOM lifecycle for its own subtree only") and consistent with input-a11y.btest.ts's own finding that the fork's mounted root is likewise role-less; the "Markdown editor" name comes ENTIRELY from the ancestor `<section>` in `+page.svelte` | NEW `app-shell-a11y-landmarks.test.ts`, `describe("RichEditor — ...")`, 1 test |
| Assertion-mechanism liveness (AP-21) | The exact `toContain` check the EditorToolbar row above uses is proven to both pass against the real (good) markup shape and FAIL against a deliberately-broken TEST-LOCAL fixture copy (aria-label stripped) — never production | NEW `app-shell-a11y-landmarks.test.ts`, `describe("assertion liveness (AP-21) — ...")`, 2 tests |

All 22 tests in the new file pass standalone (`bun test
tests/platform/app-shell-a11y-landmarks.test.ts`: 22 pass / 0 fail / 66
`expect()` calls). One authoring-time bug in my own test (an `<iframe>`
mention inside this exact component's doc-comment header made
`indexOf("<iframe")` match the wrong occurrence) was caught by the very
first run and fixed before this report — recorded because it is itself a
small, concrete demonstration that these assertions are reading real file
content, not trivially passing.

**Real gaps recorded for the product owner (not fixable in this lane —
production is off-limits):**

- **The rich-editing surface has no ARIA role of its own anywhere in the
  stack** — neither the fork's own mounted root (input-a11y.btest.ts's
  finding) nor `RichEditor.svelte`'s wrapper div. It is nameable (via the
  ancestor `<section>`'s `aria-label`) but not a landmark a screen-reader
  user can jump to directly by role; they reach it via focus order or the
  section's implicit role. Whether that implicit role is `region` in every
  real browser (see next point) is unconfirmed here.
- **Two real HTML-AAM/browser facts are cited, not independently verified,**
  because no harness in this tree can drive a real accessibility tree
  against the desktop shell (input-a11y.btest.ts's `ariaSnapshot()` is
  `packages/editor`-only, browser-only, and drives the fork's own mount —
  it is not reachable from `packages/desktop/tests`): (1) whether
  `<section aria-label="...">` with no explicit `role` attribute actually
  computes an implicit `region` role in the target Chromium version — the
  standard HTML-AAM mapping says yes, but this is asserted from the spec,
  not measured; (2) the preview pane's accessible name/role is
  `isNarrow`-conditional at the `<section>` level (only the `<iframe>`'s own
  `title` is unconditional) — both facts are true of the shipped source as
  read, but neither is confirmed against a live accessibility tree.
- **No skip-link and no `<main>` landmark exist anywhere in the shell** —
  verified by a repo-wide grep for `<main\b`, `<header\b` (outside dialogs),
  `role="banner"`, `role="contentinfo"`, `role="application"`, and
  `skip-link`/"Skip to" text across every `.svelte` file: only dialog
  `<header>`s and `AppToolbar.svelte`'s own top-level `<header
  class="toolbar">` exist; nothing implements a "skip to editor"/"skip to
  content" affordance for keyboard/screen-reader users navigating past the
  toolbar and panel chrome. Recorded as a genuine, unaddressed gap — not
  something this lane can add given the no-production-changes boundary.

### Packaged-Electron driver probe

**Environment, recorded first:** `DISPLAY` is unset; no X server is
running; `/usr/bin/Xvfb`/`/usr/bin/xvfb-run` ARE installed but were not
touched or configured by this lane (per the run spec: "do NOT fight the
sandbox with xvfb machinery this run"). Electron (`electron@42.1.0`, a
`node_modules/.bin/electron` symlink resolving into the bun-cache package)
is present. `packages/desktop/out/main/main.js` (the `electron-vite`
output) already existed from prior work this session (mtime predates this
lane's work) — this lane did not need to build it.

**Command 1 — the smallest named pick.**

```
cd packages/desktop && node tests/integration/app-lifecycle-log.pw.mjs out/main/main.js
```

Result: **launch failure**, exit code 1. Exact tail of the output:

```
[app-lifecycle-log] launching /home/user/gutterpress/packages/desktop/out/main/main.js
electron.launch: Process failed to launch!
Call log:
  - <launching> .../electron --inspect=0 --remote-debugging-port=0 .../out/main/main.js --user-data-dir=/tmp/gutterpress-applog-QwU03f --no-sandbox
  - <launched> pid=4274
  - [pid=4274][err] ERROR:dbus/bus.cc:405] Failed to connect to the bus: Failed to connect to socket /run/dbus/system_bus_socket: No such file or directory
  - [pid=4274][out] [startup +0ms] main.js evaluated
  - [pid=4274][err] ERROR:ui/ozone/platform/x11/ozone_platform_x11.cc:257] Missing X server or $DISPLAY
  - [pid=4274][err] ERROR:ui/aura/env.cc:246] The platform failed to initialize.  Exiting.
  - [pid=4274] <process did exit: exitCode=null, signal=SIGSEGV>
    at async .../tests/integration/app-lifecycle-log.pw.mjs:55:21
Node.js v22.22.2
```

Root cause: Chromium's X11/Ozone backend requires a real display; this
script calls Playwright's `_electron.launch()` directly with no headless or
Xvfb fallback of its own, so the Electron process segfaults during platform
init and Playwright's `launch()` throws — uncaught (the throw happens at
the top-level `await`, before the script's own `try`/`catch` even starts).

**Command 2 — `electron-driver.pw.mjs` (also tried, for completeness):**

```
cd packages/desktop && node tests/integration/electron-driver.pw.mjs out/main/main.js tests/integration/fixtures/multichapter
```

Result: **launch failure**, exit code 1 — but a DIFFERENT, unrelated root
cause, recorded precisely rather than conflated with the display problem
above:

```
electron.launch: Failed to launch: Error: spawn /home/user/gutterpress/packages/desktop/out/main/main.js EACCES
    at async .../tests/integration/electron-driver.pw.mjs:47:21
```

This script's docstring says its first argument is `<main-js-path>`, but
unlike `app-lifecycle-log.pw.mjs` (which branches on `target.endsWith(".js")`
and resolves `require("electron")` as the real `executablePath` in that
case), `electron-driver.pw.mjs` passes whatever path it's given straight
through as `executablePath` with no such branch — so handing it the `.js`
output tries to `spawn()` a text file as a native executable. A genuine,
pre-existing inconsistency between two sibling drivers in this directory,
recorded as a deviation — not something this lane's write ownership
(`packages/desktop/tests/**`) covers fixing, and not touched.

**Commands 3 and 4 — the two "editor-relevant" scenarios my brief named —
both actually launch and pass:**

```
cd packages/desktop && node tests/integration/editor-toggle-loads-module.pw.mjs out/main/main.js tests/integration/fixtures/multichapter
cd packages/desktop && node tests/integration/editor-opens-with-content.pw.mjs out/main/main.js tests/integration/fixtures/multichapter
```

Both PASS (exit code 0). This is not this lane fighting the sandbox: both
scripts already contain their OWN pre-existing fallback —
`const useXvfb = process.platform === "linux" && !process.env.DISPLAY;` —
and spawn through the system `xvfb-run` themselves when no display is
present, exactly the condition this sandbox is in. Running them exactly as
documented (no wrapper added by this lane) produced:

```
[editor-toggle] launching: xvfb-run -a -s -screen 0 1600x1000x24 .../electron .../out/main/main.js --remote-debugging-port=9907 --no-sandbox --user-data-dir=/tmp/.../userData
[editor-toggle] SPA ready
[editor-toggle] project opened — editor module NOT yet loaded (no file clicked)
[editor-toggle] Edit mode segment clicked
[editor-toggle] PASS — Save enabled, Ctrl+S wrote source, preview updated in 163ms, and the app remained responsive (pre-shell 77ms, shell 86ms)
```

```
[editor-opens] launching: xvfb-run -a -s -screen 0 1600x1000x24 .../electron .../out/main/main.js --remote-debugging-port=9744 --no-sandbox --user-data-dir=/tmp/.../userData
[editor-opens] SPA ready
[editor-opens] project opened
[editor-opens] CONTROL ok: Edit mode active, editor pane rendered
[editor-opens] ok   — DEFECT 1: opening a book in Edit mode must mount CodeMirror — pane stayed on "Loading editor…"
[editor-opens] ok   — DEFECT 1: the editor must open showing the book's first chapter
[editor-opens] ok   — DEFECT 2: a single click on content from 02-beta.md must load that file into the editor
[editor-opens] ok   — DEFECT 3: clicking the TOC row "Gamma Chapter 2" in Edit mode must navigate the EDITOR, not just the viewer
[editor-opens] ok   — DEFECT 3: the same TOC click must also move the VIEWER — rectTop 362.4 -> 39.4
[editor-opens] ok   — DEFECT 4: "Collapse Alpha Chapter" must work while that branch holds the active heading — aria-expanded/children checked
[editor-opens] ok   — re-expanding "Alpha Chapter" after a manual collapse must still work
[editor-opens] PASS — all checks green
```

Worth noting for the a11y audit above: `editor-opens-with-content.pw.mjs`'s
own DEFECT 4 already asserts real `aria-expanded` behavior on a TOC
collapse/expand row, at the fully-packaged level — corroborating evidence
for the LeftPanel TOC row this lane's new a11y test also pins structurally,
now confirmed live in a real (if Xvfb-virtual) Chromium window, not just
read from source.

**Net honest record:** the packaged driver is NOT uniformly broken in this
sandbox. Two of its four scripts launch and pass cleanly today because they
already carry their own `xvfb-run` fallback; two fail for two DIFFERENT,
unrelated reasons (no display handling at all; an argument-contract bug).
Per the run spec's instruction, nothing was added — the two passing runs
already covered "run the editor-relevant ones," and the two failures are
recorded here as the packaged-scenario deviation rather than patched.

### What this lane could not independently verify, and why

- Whether the a11y attributes this lane pinned by source-text actually
  compute into the ARIA roles/names a real screen reader announces cannot
  be confirmed by any harness in `packages/desktop/tests` — no real or
  virtual accessibility-tree inspection tool is wired into this package
  (unlike `packages/editor`'s Chromium-backed `input-a11y.btest.ts`, which
  is out of this lane's write scope and mounts a different, narrower
  surface — the fork itself, not the desktop shell around it).
- The `rich-doc-host-rebuild-race.test.ts` model's fidelity to
  `rebuildRichDocHost` is verified textually (its final test), not by
  calling the real function, which cannot be extracted or imported from
  `+page.svelte` without a production change outside this lane's ownership.
- Whether `electron-driver.pw.mjs`'s `EACCES` argument-contract bug is a
  pre-existing defect worth fixing, or an intentional (if confusingly
  documented) "packaged executable only" contract, was not resolved — the
  script was read and run as-is, not modified or judged further.

## Lane B

Scope: scenario 20 (25 KiB / 100 KiB / 250 KiB / 1 MiB performance runs) and
the D13 gate. New files only, under `packages/editor/tests/perf/**`:
`support/corpus.ts` (deterministic seeded markdown generator),
`support/entry.ts` (browser-side driver — mounts the REAL `mountEditor`,
`src/web/mount.ts`, "the fork surface"), `support/drive.ts` (Node-side
mount/type/measure loop), `support/stats.ts` (percentile helper),
`support/constants.ts` (shared knobs), `perf-sweep.btest.ts` (the D13
evidence), `perf-control.btest.ts` (the G-12/AP-20 control). Wired as
`test:perf` in `packages/editor/package.json`, its own script, not folded
into `test`/`test:browser`.

### Corpus

`tests/corpus/fixtures.ts` is a small fixed dictionary, not a size-targeted
generator, so there was nothing there to reuse directly for "produce a
realistic N-KiB document" — what IS reused is its seeded-PRNG primitive,
`mulberry32` (`tests/corpus/support/command-harness.ts`), imported rather
than re-implemented. `generateMarkdownCorpus(targetBytes)` builds prose
paragraphs, headings, lists, fenced code, and a sparse sprinkling of
bare-line Gutterpress markers (`@page splash`, `@page-break`,
`@section .gp-columns-2` — realistic CONTENT SHAPE only; this run mounts
through the plain `mountEditor`, not the projection-aware
`mountGutterpressEditor`, so the markers are never expected to be
projected) until the target size is reached, deterministically (fixed
seed) and byte-exactly (pure-ASCII vocabulary, so `string.length` is the
UTF-8 byte count). Actual generated sizes, confirmed at measurement time:
25,600 / 102,400 / 256,000 / 1,048,576 bytes — exact.

### Measurement method, and why

Both measurements (mount-to-interactive; per-keystroke edit-to-paint) use
the same primitive: observe the real DOM mutation an action produced
(`MutationObserver`, `childList`/`characterData` only — never
`attributes`, so cursor-blink/selection-highlight class churn can never
masquerade as "the edit landed"), then one `requestAnimationFrame`.
`requestAnimationFrame`'s callback runs immediately before the browser
computes style/layout/paint for the next frame — the earliest point a
script can honestly say "this frame, containing the mutation just
observed, is about to be presented," and the same convention the run
spec's own wording names ("requestAnimationFrame after the mutation is
observable").

Rejected alternative: `PerformanceObserver` (`type: "event"`, the Event
Timing API behind real-world INP measurement). Its entries are reported
only once a per-event `duration` exceeds a threshold (spec default 104ms;
the lowest a caller may request is a small nonzero floor) — precisely the
fast, in-budget keystrokes this evidence most needs a p50 for would be
silently absent from the sample, corrupting the percentile rather than
merely coarsening it. Its `"paint"` entries are page-lifecycle events
(first paint / first contentful paint), fired once per page load, not
once per interaction, so they cannot answer "was frame N painted" at all.
The chosen method has no duration floor and observes the exact DOM the
edit is expected to change.

Per-keystroke `t0` is `KeyboardEvent.timeStamp` (same clock as
`performance.now()` in Chromium), read from a capture-phase `keydown`
listener — not `performance.now()` read inside the listener body. This is
what makes the sabotage control (below) valid regardless of listener
ordering: `timeStamp` is stamped by the browser at real dispatch time,
before any listener (including the injected busy-wait) runs.

Keystrokes are dispatched with Playwright's `page.keyboard` — real,
trusted, CDP-level `keydown`/`keypress`/`input`/`keyup` events, never
`element.dispatchEvent(...)` from in-page script.

**Harness bug found and fixed during this run, for the record:** the
first working version of `mountAndMeasureInteractive` armed the
mount-quiescence `MutationObserver` AFTER calling `mountEditor(...)`.
`mountEditor` is documented synchronous, so the initial render's
mutations had already happened before the observer started watching, and
`waitForQuiescence` waited forever (live repro: the 25 KiB case hung the
full 120s test timeout, then cascaded into "Target page ... has been
closed" failures for every later case sharing the session). Fixed by
constructing the `waitForQuiescence` promise (whose executor calls
`observer.observe(...)` synchronously) BEFORE calling `mountEditor`, not
after. Separately, `waitForQuiescence`'s safety net was changed from a
frame-COUNT cap to a wall-clock cap: `mountEditor` running synchronously
means the main thread is fully occupied during the mount call itself, so
no `requestAnimationFrame` tick — including a frame-counting cap — can
fire until it returns; only a wall-clock bound is a predictable cap under
exactly the slow-mount condition it exists to catch (observed live: the 1
MiB case's single Chromium renderer process ran at 100%+ CPU for the
entire ~2.8–3.1s mount).

### Warm-up definition

20 keystrokes typed and measured but excluded from reported percentiles,
then **60** keystrokes (D13's stated minimum) measured and reported — 80
keystrokes per full pass. 20 is a stated, round number chosen to clear
one-off first-keystroke costs (JIT warm-up of the hot input path, the
first MutationObserver/rAF round trip in a fresh mount) without
materially extending the run; it was not tuned to produce a particular
result. Cadence: 70ms paced between keystrokes (after each keystroke's
measurement resolves, before the next dispatch) — models a fast,
sustained typist (~14 chars/sec, ~170wpm at 5 chars/word), not a
synthetic max-speed hammer. The measured latency itself does not depend
on this pacing choice.

### D13 evidence — two full `test:perf` invocations (variance honesty)

Each sub-table is one complete `bun run test:perf` process invocation
(fresh Chromium launch); each invocation itself runs the 250 KiB
measurement twice in-process, so four independent 250 KiB samples appear
across the two invocations below, all n=60 post-warm-up.

**Invocation 1** — wall time 5m42.651s (342.65s) — exit code 1 (250 KiB
gate correctly failed; see verdict below):

| Size | Doc bytes | Mount-to-interactive | p50 | p95 | max | min | mean | n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 KiB | 25,600 | 213.5 ms | 61.9 ms | 82.7 ms | 101.2 ms | 53.0 ms | 65.3 ms | 60 |
| 100 KiB | 102,400 | 354.7 ms | 220.4 ms | 251.7 ms | 268.1 ms | 197.9 ms | 222.4 ms | 60 |
| 250 KiB (run 1/2) | 256,000 | 719.9 ms | 522.5 ms | **631.7 ms** | 673.8 ms | 471.3 ms | 534.0 ms | 60 |
| 250 KiB (run 2/2) | 256,000 | 784.0 ms | 521.9 ms | **571.1 ms** | 609.9 ms | 471.0 ms | 523.9 ms | 60 |
| 1 MiB | 1,048,576 | 2,802.5 ms | 2,088.5 ms | 2,264.6 ms | 2,359.6 ms | 2,011.5 ms | 2,101.5 ms | 60 |

**Invocation 2** — wall time 5m45.454s (345.45s) — exit code 1 (same):

| Size | Doc bytes | Mount-to-interactive | p50 | p95 | max | min | mean | n |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| 25 KiB | 25,600 | 222.3 ms | 58.8 ms | 72.3 ms | 94.7 ms | 51.6 ms | 61.0 ms | 60 |
| 100 KiB | 102,400 | 409.2 ms | 214.0 ms | 243.8 ms | 263.5 ms | 193.5 ms | 216.2 ms | 60 |
| 250 KiB (run 1/2) | 256,000 | 749.4 ms | 517.6 ms | **585.4 ms** | 611.1 ms | 485.2 ms | 526.3 ms | 60 |
| 250 KiB (run 2/2) | 256,000 | 768.1 ms | 516.8 ms | **554.3 ms** | 572.1 ms | 478.2 ms | 517.4 ms | 60 |
| 1 MiB | 1,048,576 | 2,881.3 ms | 2,128.8 ms | 2,292.5 ms | 2,431.5 ms | 2,003.5 ms | 2,144.7 ms | 60 |

Bold = the value the D13 gate assertion (`p95 < 100ms`) evaluates. All
four 250 KiB p95 samples across both invocations land in a tight
554–632ms band — consistent run to run, and consistently 5.5×–6.3× over
budget. 25 KiB, 100 KiB, and 1 MiB mount and edit-to-paint numbers are
**recorded, not gated** — D13 names only the 250 KiB budget; no other size
gets an invented gate.

### Budget verdict

**FAIL**, honestly and reproducibly. D13's stated gate — p95 edit-to-paint
under 100ms at 250 KiB after warm-up — is not met by the current rich
editor in this environment: measured p95 across four independent 60-sample
runs (two full process invocations) ranges 554.3–631.7ms. This is reported
as a finding with the measurement, per the run spec's own instruction, not
tuned away by weakening the measure — Lane B owns only the harness and the
test trees under `packages/editor/tests/perf/**`; closing this gap is
production-code work outside this lane's write ownership (no production
file was touched to produce or avoid this result). 1 MiB (under the 2 MiB
rich-mode ceiling, so `mountEditor` is called directly, exactly as a real
host would) mounts successfully but is markedly worse: edit-to-paint p50
~2.1s, p95 ~2.3s — reported plainly, not gated, per DETAILS.

### Control (G-12/AP-20)

A synchronous ~150ms busy-wait is injected on every `keydown`, entirely at
the test level (`support/entry.ts`'s `enableSlowdown`, a listener added by
the test — no production file touched), against the same 250 KiB corpus.
The control test asserts the resulting p95 EXCEEDS the D13 budget (and
exceeds it by more than half the injected delay, as a sanity margin
against a false pass from a degraded-to-noise measurement) — the
permanently-green control pattern already used in this repo (e.g.
`packages/editor/scripts/check-browser-purity.test.mjs`'s per-specifier
sabotage fixtures).

| Invocation | p50 | p95 | max | min | mean | n |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 661.0 ms | 715.4 ms | 715.4 ms | 633.8 ms | 661.6 ms | 15 |
| 2 | 669.3 ms | 737.3 ms | 737.3 ms | 641.4 ms | 677.4 ms | 15 |

Both invocations: **PASS** (p95 > 100ms budget; p95 > 75ms sanity margin).
The control proves the harness is sensitive to a real, injected slowdown
on the exact path it measures — it is not a tautology that happens to
always read "slow."

### Environment caveat

Exactly as the run spec words it: this sandbox is not the project's CI
reference runner — the numbers above are recorded as absolute numbers
together with this caveat; the budget verdict here is provisional
evidence, not the final CI-runner word.

### Known gap requiring integrator action (not in Lane B's write ownership)

`bun run typecheck`'s ROOT program (`packages/editor/tsconfig.json`,
`lib: ["ES2023"]`, no DOM) currently fails on the new `tests/perf/**`
files: `include: ["src","tests"]` covers them (no `exclude` entry names
`tests/perf`), yet `support/entry.ts` genuinely needs DOM types
(`document`/`window`/`MutationObserver`/`KeyboardEvent`/
`requestAnimationFrame`) to mount a real editor and drive real input. This
mirrors an EXACT, already-recorded precedent in this same package —
`src/web.tsconfig.json`'s own header describes the identical situation
from run P1a ("Integrator action required ... Lane B cannot make these
edits itself") for `tests/web`. Neither `packages/editor/tsconfig.json`
nor `src/web.tsconfig.json` is in this lane's write ownership
(`packages/editor/tests/perf/**`, `package.json` test:perf line only, this
doc's own section), so the fix is recorded here rather than applied.

Live-verified two-line fix (confirmed clean via a scratch tsconfig outside
the repo that reproduces `web.tsconfig.json`'s exact settings pointed at
`tests/perf/**` — `tsc --noEmit` exits 0 against it):

1. Add `"tests/perf"` to `packages/editor/tsconfig.json`'s existing
   `"exclude"` array (alongside `"tests/web"`, `"tests/vscode-adapter"`,
   `"tests/browser-harness"`, `"tests/gutterpress"`).
2. Add `"../tests/perf"` to `src/web.tsconfig.json`'s existing `"include"`
   array (alongside `"../tests/web"`, `"../tests/vscode-adapter"`,
   `"../tests/browser-harness"`) — `tests/perf` needs exactly the DOM +
   `MutationObserver`/`KeyboardEvent` lib set already configured there,
   nothing Gutterpress-specific.

Until that lands, the ROOT program's own transitive-import behavior (not
this lane's files in isolation) also surfaces 3 additional, pre-existing
`Cannot find name 'Element'` errors in `src/web/mount.ts` /
`src/vscode-adapter/adapter.ts` — those two files are NOT excluded from
the root program by omission, they are ALREADY excluded; the root program
only reaches them because `tests/perf/support/entry.ts` (the only file
newly in the root's included set that does so) imports `mountEditor` from
`src/web/mount.ts`, and TypeScript's `exclude` does not block a file being
pulled in transitively through an import from an included file. Confirmed
by grep: no other file in the root program's actual covered set
(`src/core/**`, `tests/core/**`, `tests/corpus/**`) imports `src/web/**`
or `src/vscode-adapter/**`. Fix (1) above removes the root program's only
path to those files at the same time it fixes `tests/perf`'s own errors.

This does not affect `bun run test:perf` itself — Bun's test runner
transpiles and runs directly, it does not invoke `tsc` — so the D13
evidence above is unaffected by this gap; it affects only the separate
`bun run typecheck` command.

### Verification run by this lane

| Command | Exit code | Note |
|---|---:|---|
| `bun run typecheck` (root) | 2 | Tests/perf's own DOM-typed files fail under the DOM-free root program (tsconfig wiring gap above, not in this lane's write ownership); scratch self-check (DOM-aware program, real deps, pointed at `tests/perf/**` only) exits 0 |
| `cd packages/editor && bun run test:perf` (invocation 1) | 1 | Correct: 250 KiB budget genuinely missed today (see verdict); control + all recorded sizes behaved as designed |
| `cd packages/editor && bun run test:perf` (invocation 2) | 1 | Same, numbers consistent with invocation 1 |
| `cd packages/editor && bun run test` | 0 | 3038 pass / 0 fail — `tests/perf/**` correctly invisible to plain `bun test` (`.btest.ts` naming, matching the existing `test:browser` convention) |
| `cd packages/editor && bun run test:browser` | 0 | 114 pass / 0 fail across the 8 existing suites — unaffected by this lane's changes |
